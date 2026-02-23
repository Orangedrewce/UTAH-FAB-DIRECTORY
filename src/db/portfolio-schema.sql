-- ═══════════════════════════════════════════════════════════════════════
-- PORTFOLIO_ITEMS - Dynamic portfolio managed from Admin dashboard
-- ═══════════════════════════════════════════════════════════════════════
--
-- Run this in Supabase SQL Editor (Dashboard → SQL → New Query).
--
-- After running, create a Storage bucket called "portfolio-assets" in
-- Supabase Dashboard → Storage → New Bucket:
--   Name:   portfolio-assets
--   Public: ON  (so images/models load without auth)
--   Allowed MIME types: image/png, image/jpeg, image/webp,
--                       model/gltf+json, model/gltf-binary,
--                       application/octet-stream (for .step/.stl)
--   Max file size: 50 MB
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS portfolio_items (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title             TEXT NOT NULL,
  description       TEXT,
  tag               TEXT NOT NULL DEFAULT 'RENDER',     -- e.g. INTAKE, MODEL, OUTPUT, RENDER, ASSEMBLY
  image_url         TEXT,                                -- PNG/JPG stored in Supabase Storage
  image_size_bytes  BIGINT,                              -- File size of the uploaded image
  model_url         TEXT,                                -- Optional: URL to .glb/.gltf/.step for 3D viewer
  model_size_bytes  BIGINT,                              -- Total file size of the uploaded 3D model(s)
  sort_order        INTEGER DEFAULT 0,
  is_featured       BOOLEAN DEFAULT FALSE,              -- Show on homepage hero section
  is_visible        BOOLEAN DEFAULT TRUE,               -- Hide without deleting
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

-- ── Migration: add file-size columns to existing installs ──
-- Run this block once if your table was created before these columns existed:
-- ALTER TABLE portfolio_items
--   ADD COLUMN IF NOT EXISTS image_size_bytes BIGINT,
--   ADD COLUMN IF NOT EXISTS model_size_bytes  BIGINT;

-- Index for public queries (visible items ordered by sort)
CREATE INDEX IF NOT EXISTS idx_portfolio_visible
  ON portfolio_items (is_visible, sort_order);

-- Index for featured items (homepage)
CREATE INDEX IF NOT EXISTS idx_portfolio_featured
  ON portfolio_items (is_featured, is_visible, sort_order);

-- Auto-update updated_at on row change
CREATE OR REPLACE FUNCTION update_portfolio_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_portfolio_updated ON portfolio_items;
CREATE TRIGGER trg_portfolio_updated
  BEFORE UPDATE ON portfolio_items
  FOR EACH ROW
  EXECUTE FUNCTION update_portfolio_timestamp();

-- ── Row Level Security ──────────────────────────────────────────────
ALTER TABLE portfolio_items ENABLE ROW LEVEL SECURITY;

-- Public can read visible items
DROP POLICY IF EXISTS "Public can read visible portfolio items" ON portfolio_items;
CREATE POLICY "Public can read visible portfolio items"
  ON portfolio_items FOR SELECT
  USING (is_visible = TRUE);

-- Authenticated users (admin) can do everything
DROP POLICY IF EXISTS "Auth users full access to portfolio" ON portfolio_items;
CREATE POLICY "Auth users full access to portfolio"
  ON portfolio_items FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- ── Storage bucket policy (run separately if needed) ────────────────
-- INSERT INTO storage.buckets (id, name, public) VALUES ('portfolio-assets', 'portfolio-assets', true);
