-- ============================================================================
-- DISCORD WEBHOOKS — Unified Supabase Setup
-- Combines contact form + directory request tables, RLS, Discord
-- notification triggers, and contact-photos storage bucket.
-- Paste into Supabase Dashboard > SQL Editor > New Query
-- ============================================================================

-- 1. Enable pg_net (for HTTP calls to Discord)
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;


-- ============================================================================
-- CONTACT FORM
-- ============================================================================

-- 2a. Contact messages table
CREATE TABLE IF NOT EXISTS contact_messages (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email      TEXT NOT NULL CHECK (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  message    TEXT NOT NULL DEFAULT '' CHECK (char_length(message) <= 5000),
  photo_url  TEXT DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2b. RLS — anon can INSERT only; admin can read
ALTER TABLE contact_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anon insert contact" ON contact_messages;
CREATE POLICY "Anon insert contact"
  ON contact_messages FOR INSERT
  TO anon
  WITH CHECK (true);

DROP POLICY IF EXISTS "Admin read contact" ON contact_messages;
CREATE POLICY "Admin read contact"
  ON contact_messages FOR SELECT
  TO authenticated
  USING (true);

-- 2c. Discord notification — contact form
CREATE OR REPLACE FUNCTION notify_discord_contact()
RETURNS TRIGGER AS $$
DECLARE
  _payload JSONB;
  _fields  JSONB;
  _embed   JSONB;
BEGIN
  -- Build embed fields
  _fields := jsonb_build_array(
    jsonb_build_object('name', 'Email',   'value', NEW.email,   'inline', true),
    jsonb_build_object('name', 'Message', 'value', LEFT(COALESCE(NEW.message, '(none)'), 1024), 'inline', false)
  );

  -- Base embed object
  _embed := jsonb_build_object(
    'title',       'New Contact Form Submission',
    'color',       16738859,  -- #FF6B2B in decimal
    'fields',      _fields,
    'timestamp',   to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'footer',      jsonb_build_object('text', 'Utah Fab Directory')
  );

  -- Add photo preview if present
  IF NEW.photo_url IS NOT NULL AND NEW.photo_url <> '' THEN
    _embed := _embed || jsonb_build_object('image', jsonb_build_object('url', NEW.photo_url));

    -- Also add as a text field fallback
    _fields := _fields || jsonb_build_array(
      jsonb_build_object('name', 'Photo URL', 'value', NEW.photo_url, 'inline', false)
    );
    _embed := jsonb_set(_embed, '{fields}', _fields);
  END IF;

  _payload := jsonb_build_object(
    'username', 'Utah Fab Contact',
    'embeds', jsonb_build_array(_embed)
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

-- 2d. Trigger
DROP TRIGGER IF EXISTS on_contact_insert ON contact_messages;
CREATE TRIGGER on_contact_insert
  AFTER INSERT ON contact_messages
  FOR EACH ROW
  EXECUTE FUNCTION notify_discord_contact();


-- ============================================================================
-- DIRECTORY REQUESTS
-- ============================================================================

-- ── MIGRATION: fix old table schema BEFORE trying to create ─────────────
-- This runs first so the table is in a good state before anything else.
-- Safe to run repeatedly; safe if table doesn't exist yet.
DO $$
DECLARE _con RECORD;
BEGIN
  -- Only migrate if the table already exists
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'directory_requests') THEN

    -- Add new columns (no-op if already present)
    BEGIN
      ALTER TABLE directory_requests ADD COLUMN IF NOT EXISTS maps_url TEXT NOT NULL DEFAULT '';
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    BEGIN
      ALTER TABLE directory_requests ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    -- Drop known CHECK constraints on city/region by name
    BEGIN ALTER TABLE directory_requests DROP CONSTRAINT IF EXISTS directory_requests_city_check;
    EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN ALTER TABLE directory_requests DROP CONSTRAINT IF EXISTS directory_requests_region_check;
    EXCEPTION WHEN OTHERS THEN NULL; END;

    -- Drop any other CHECK constraints referencing city or region
    FOR _con IN
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'directory_requests'::regclass
        AND contype = 'c'
        AND (pg_get_constraintdef(oid) ~* '\bcity\b'
          OR pg_get_constraintdef(oid) ~* '\bregion\b')
    LOOP
      EXECUTE format('ALTER TABLE directory_requests DROP CONSTRAINT %I', _con.conname);
    END LOOP;

    -- Relax NOT NULL on city/region if those columns exist
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'directory_requests' AND column_name = 'city') THEN
      ALTER TABLE directory_requests ALTER COLUMN city DROP NOT NULL;
      ALTER TABLE directory_requests ALTER COLUMN city SET DEFAULT '';
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'directory_requests' AND column_name = 'region') THEN
      ALTER TABLE directory_requests ALTER COLUMN region DROP NOT NULL;
      ALTER TABLE directory_requests ALTER COLUMN region SET DEFAULT '';
    END IF;

    RAISE NOTICE 'directory_requests migration complete';
  ELSE
    RAISE NOTICE 'directory_requests does not exist yet — will be created fresh';
  END IF;
END
$$;

-- 3a. Directory requests table (fresh installs only; IF NOT EXISTS skips if migrated above)
CREATE TABLE IF NOT EXISTS directory_requests (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_name   TEXT NOT NULL CHECK (char_length(shop_name) BETWEEN 1 AND 200),
  maps_url    TEXT NOT NULL DEFAULT '' CHECK (char_length(maps_url) <= 2000),
  contact     TEXT NOT NULL CHECK (char_length(contact) BETWEEN 1 AND 500),
  services    TEXT NOT NULL DEFAULT '' CHECK (char_length(services) <= 5000),
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','dismissed')),
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- 3b. RLS — anon can INSERT; admin can read + update
ALTER TABLE directory_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anon insert directory request" ON directory_requests;
CREATE POLICY "Anon insert directory request"
  ON directory_requests FOR INSERT
  TO anon
  WITH CHECK (true);

DROP POLICY IF EXISTS "Admin read directory requests" ON directory_requests;
CREATE POLICY "Admin read directory requests"
  ON directory_requests FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Admin update directory requests" ON directory_requests;
CREATE POLICY "Admin update directory requests"
  ON directory_requests FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- 3c. Discord notification — directory request (with Approve deep-link)
CREATE OR REPLACE FUNCTION notify_discord_directory_request()
RETURNS TRIGGER AS $$
DECLARE
  _payload JSONB;
  _fields  JSONB;
  _embed   JSONB;
BEGIN
  _fields := jsonb_build_array(
    jsonb_build_object('name', 'Shop Name',  'value', NEW.shop_name, 'inline', true),
    jsonb_build_object('name', 'Contact',    'value', LEFT(NEW.contact, 1024),  'inline', true),
    jsonb_build_object('name', 'Maps URL',   'value', LEFT(COALESCE(NEW.maps_url, '(none)'), 1024), 'inline', false),
    jsonb_build_object('name', 'Services',   'value', LEFT(COALESCE(NEW.services, '(none)'), 1024), 'inline', false),
    jsonb_build_object('name', E'\u2705 Quick Approve', 'value',
      '[Approve in Admin Dashboard](https://orangedrewce.github.io/UTAH-FAB-DIRECTORY/admin?approve_id=' || NEW.id::TEXT || ')',
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

-- 3d. Trigger
DROP TRIGGER IF EXISTS on_directory_request_insert ON directory_requests;
CREATE TRIGGER on_directory_request_insert
  AFTER INSERT ON directory_requests
  FOR EACH ROW
  EXECUTE FUNCTION notify_discord_directory_request();


-- ============================================================================
-- STORAGE: contact-photos bucket
-- ============================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('contact-photos', 'contact-photos', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Anon upload contact photos" ON storage.objects;
CREATE POLICY "Anon upload contact photos"
  ON storage.objects FOR INSERT
  TO anon
  WITH CHECK (
    bucket_id = 'contact-photos'
    AND (COALESCE(metadata->>'mimetype', '') ~* '^image/(jpeg|png|gif|webp)$')
    AND (COALESCE((metadata->>'size')::BIGINT, 0) BETWEEN 1 AND 5242880)  -- 1 byte to 5 MB
  );

DROP POLICY IF EXISTS "Public read contact photos" ON storage.objects;
CREATE POLICY "Public read contact photos"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'contact-photos');

-- Done!
