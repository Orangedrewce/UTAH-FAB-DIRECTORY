-- ============================================================================
-- CONTACT FORM — Supabase Setup
-- Paste into Supabase Dashboard > SQL Editor > New Query
-- ============================================================================

-- 1. Enable pg_net (for HTTP calls to Discord)
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- 2. Contact messages table
CREATE TABLE IF NOT EXISTS contact_messages (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email      TEXT NOT NULL CHECK (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  message    TEXT NOT NULL DEFAULT '' CHECK (char_length(message) <= 5000),
  photo_url  TEXT DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. RLS — anon can INSERT only; no read/update/delete
ALTER TABLE contact_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anon insert contact" ON contact_messages;
CREATE POLICY "Anon insert contact"
  ON contact_messages FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "Admin read contact" ON contact_messages;
CREATE POLICY "Admin read contact"
  ON contact_messages FOR SELECT
  USING (auth.role() = 'authenticated');

-- 4. Discord notification function
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

-- 5. Trigger
DROP TRIGGER IF EXISTS on_contact_insert ON contact_messages;
CREATE TRIGGER on_contact_insert
  AFTER INSERT ON contact_messages
  FOR EACH ROW
  EXECUTE FUNCTION notify_discord_contact();

-- ============================================================================
-- STORAGE: Create a "contact-photos" bucket via the Supabase Dashboard:
--   Storage > New Bucket > Name: contact-photos > Public: ON
--
-- Then add this RLS policy on the bucket (via SQL or Dashboard):
-- ============================================================================
-- Allow anonymous uploads to contact-photos
INSERT INTO storage.buckets (id, name, public)
VALUES ('contact-photos', 'contact-photos', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Anon upload contact photos" ON storage.objects;
CREATE POLICY "Anon upload contact photos"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'contact-photos'
    AND (octet_length(decode(
           COALESCE(metadata->>'size', '0'), 'escape'
         )) IS NOT NULL)                           -- metadata must exist
    AND (COALESCE(metadata->>'mimetype', '') ~* '^image/(jpeg|png|gif|webp)$')
    AND (COALESCE((metadata->>'size')::BIGINT, 0) <= 5242880)  -- 5 MB cap
  );

DROP POLICY IF EXISTS "Public read contact photos" ON storage.objects;
CREATE POLICY "Public read contact photos"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'contact-photos');

-- Done!
