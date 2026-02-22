-- ============================================================================
-- DIRECTORY REQUESTS — Supabase Setup
-- Allows shop owners to request to be listed in the directory.
-- Submissions trigger a Discord notification via the existing webhook.
-- Paste into Supabase Dashboard > SQL Editor > New Query
-- ============================================================================

-- 1. Ensure pg_net is available (may already exist from contact-setup)
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- 2. Directory requests table
CREATE TABLE IF NOT EXISTS directory_requests (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_name   TEXT NOT NULL CHECK (char_length(shop_name) BETWEEN 1 AND 200),
  city        TEXT NOT NULL CHECK (char_length(city) BETWEEN 1 AND 200),
  contact     TEXT NOT NULL CHECK (char_length(contact) BETWEEN 1 AND 500),
  services    TEXT NOT NULL DEFAULT '' CHECK (char_length(services) <= 5000),
  region      TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','dismissed')),
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- 3. RLS — anon can INSERT only; admin can read
ALTER TABLE directory_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anon insert directory request" ON directory_requests;
CREATE POLICY "Anon insert directory request"
  ON directory_requests FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "Admin read directory requests" ON directory_requests;
CREATE POLICY "Admin read directory requests"
  ON directory_requests FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Admin update directory requests" ON directory_requests;
CREATE POLICY "Admin update directory requests"
  ON directory_requests FOR UPDATE
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- 4. Discord notification function
CREATE OR REPLACE FUNCTION notify_discord_directory_request()
RETURNS TRIGGER AS $$
DECLARE
  _payload JSONB;
  _fields  JSONB;
  _embed   JSONB;
BEGIN
  _fields := jsonb_build_array(
    jsonb_build_object('name', 'Shop Name', 'value', NEW.shop_name, 'inline', true),
    jsonb_build_object('name', 'City',      'value', NEW.city,      'inline', true),
    jsonb_build_object('name', 'Region',    'value', NEW.region,    'inline', true),
    jsonb_build_object('name', 'Contact',   'value', LEFT(NEW.contact, 1024),  'inline', false),
    jsonb_build_object('name', 'Services',  'value', LEFT(COALESCE(NEW.services, '(none)'), 1024), 'inline', false),
    jsonb_build_object('name', E'\u2705 Quick Approve', 'value',
      '[Approve in Admin Dashboard](https://utahfabdirectory.com/admin.html?approve_id=' || NEW.id::TEXT || ')',
      'inline', false)
  );

  _embed := jsonb_build_object(
    'title',     'New Directory Listing Request',
    'color',     16738859,  -- #FF6B2B in decimal
    'fields',    _fields,
    'timestamp', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'footer',    jsonb_build_object('text', 'Utah Fab Directory')
  );

  _payload := jsonb_build_object(
    'username', 'Utah Fab Directory',
    'embeds',   jsonb_build_array(_embed)
  );

  -- ⚠️  SECURITY: This webhook URL is a secret — do NOT commit to public repos.
  --    Move to a Supabase Vault secret or environment variable in production.
  PERFORM net.http_post(
    url     := 'https://discord.com/api/webhooks/1474899689680928981/SJduDzevWXaj47df2aaDefLDUjabqu-YT6_RSNW4Uhqn7-LcaincWgp-UCfXhFgdV-cy',
    body    := _payload,
    headers := jsonb_build_object('Content-Type', 'application/json')
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Trigger
DROP TRIGGER IF EXISTS on_directory_request_insert ON directory_requests;
CREATE TRIGGER on_directory_request_insert
  AFTER INSERT ON directory_requests
  FOR EACH ROW
  EXECUTE FUNCTION notify_discord_directory_request();

-- Done!
