-- ============================================================================
-- UTAH FAB DIRECTORY — Regions Seed Data
-- Run this in your Supabase SQL Editor to fix the Foreign Key Error
-- ============================================================================

INSERT INTO regions (slug, title, subtitle, sort_order) VALUES
  ('salt-lake',     'Salt Lake Valley',                   'SLC . West Valley . Murray . Sandy . West Jordan . Draper . Midvale . Taylorsville . Bountiful . North Salt Lake', 1),
  ('utah-county',   'Utah County',                        'Provo . Orem . Lehi . American Fork . Lindon . Springville . Spanish Fork . Payson . Salem . Saratoga Springs', 2),
  ('weber-ogden',   'Weber / Ogden Area',                 'Ogden . Roy . Layton . Clearfield . Riverdale . Kaysville . Sunset -- Hill AFB Aerospace & Defense Corridor', 3),
  ('cache-valley',  'Cache Valley',                       'Logan . North Logan . Providence . Smithfield . Hyrum . Richmond -- Home of Utah State University', 4),
  ('southern-utah', 'St. George / Southern Utah',         'St. George . Washington . Ivins . Hurricane . Cedar City -- Off-Road Hub & Growing Custom Scene', 5),
  ('other',         'Other: Statewide, Rural & Specialty', 'Moab . Vernal . Roosevelt . Price . Richfield . Statewide Multi-Region Shops', 6)
ON CONFLICT (slug) DO UPDATE SET
  title      = EXCLUDED.title,
  subtitle   = EXCLUDED.subtitle,
  sort_order = EXCLUDED.sort_order;

-- Also ensure the uq_fab_shops_name_region constraint exists to prevent app-level crashes on duplicates
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_fab_shops_name_region'
  ) THEN
    ALTER TABLE fab_shops ADD CONSTRAINT uq_fab_shops_name_region UNIQUE (name, region);
  END IF;
END
$$;
