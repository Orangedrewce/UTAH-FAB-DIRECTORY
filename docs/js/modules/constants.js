/**
 * ═══════════════════════════════════════════════════════════════════════
 * MODULE: constants.js - Shared Application Constants
 * ═══════════════════════════════════════════════════════════════════════
 *
 * PURPOSE:
 *   Single source of truth for every hard-coded list used across the
 *   admin dashboard, public directory, and API layer.  Keeping these
 *   values in one file prevents drift between pages.
 *
 * EXPORTS:
 *   • ALL_TAGS        – String[] of every service/capability tag a shop
 *                       can have (e.g. "cnc", "welding", "laser").
 *                       Used by the tag-picker in both admin and the
 *                       "Join the Directory" form.
 *   • CATEGORIES      – String[] of display names for shop categories
 *                       shown in the admin modal's <datalist>.
 *   • REGION_BOUNDS   – Array of { slug, label, latMin, latMax, lngMin,
 *                       lngMax } objects.  Used by `parseMapsUrl()` in
 *                       utils.js to auto-detect which geographic region
 *                       a Google Maps URL falls in.
 *   • REGION_META     – Object keyed by region slug, mapping each region
 *                       to a human-readable { title, subtitle } pair for
 *                       display in region headers on the public directory.
 *   • REGION_ORDER    – String[] defining the display order of regions
 *                       on the public directory page.
 *
 * HOW TO ADD FEATURES / MODIFY:
 *   • NEW TAG - Append a string to ALL_TAGS.  The admin tag-picker and
 *     "Join" form tag-picker will automatically include it.
 *   • NEW CATEGORY - Append a string to CATEGORIES.  The <datalist> in
 *     the admin edit modal will show it as a suggestion.
 *   • NEW REGION - Do all four:
 *       1. Add a bounding-box entry to REGION_BOUNDS.
 *       2. Add a { title, subtitle } entry to REGION_META.
 *       3. Insert the slug into REGION_ORDER at the desired position.
 *       4. Insert a matching row in the Supabase `regions` table so
 *          the admin region filter picks it up.
 *   • RENAME A REGION - Update the slug everywhere it appears in this
 *     file, then update the Supabase `regions` row to match.
 * ═══════════════════════════════════════════════════════════════════════
 */

export const ALL_TAGS = [
  "3dprint",
  "aerospace",
  "cnc",
  "heattreat",
  "laser",
  "makerspace",
  "offroad",
  "ornamental",
  "powder",
  "waterjet",
  "welding",
  "plasma",
  "anodize",
  "plating",
  "assembly",
  "prototype",
  "structural",
  "sheetmetal",
];

export const CATEGORIES = [
  "Fabrication & Machining",
  "Welding & Metalwork",
  "Specialty Automotive",
  "Specialty Automotive & Off-Road",
  "Industrial Finishing: Anodizing, Plating & Heat Treating",
  "Powder Coating & Finishing",
  "Digital Fabrication & Community Spaces",
  "Statewide / Multi-Region Fabrication",
  "Rural Hubs: Moab / Rock Crawling",
  "Rural Hubs: Uinta Basin / Carbon County / Central Utah",
  "Specialty",
  "Finishing & Community",
];

export const REGION_BOUNDS = [
  {
    slug: "cache-valley",
    label: "Cache Valley",
    latMin: 41.4,
    latMax: 42.05,
    lngMin: -112.5,
    lngMax: -111.5,
  },
  {
    slug: "weber-ogden",
    label: "Weber / Ogden Area",
    latMin: 40.85,
    latMax: 41.4,
    lngMin: -112.2,
    lngMax: -111.7,
  },
  {
    slug: "salt-lake",
    label: "Salt Lake Valley",
    latMin: 40.5,
    latMax: 40.85,
    lngMin: -112.15,
    lngMax: -111.7,
  },
  {
    slug: "utah-county",
    label: "Utah County",
    latMin: 39.9,
    latMax: 40.5,
    lngMin: -112.0,
    lngMax: -111.3,
  },
  {
    slug: "southern-utah",
    label: "St. George / Southern Utah",
    latMin: 37.0,
    latMax: 37.9,
    lngMin: -114.0,
    lngMax: -113.0,
  },
];

export const REGION_META = {
  "salt-lake": {
    title: "Salt Lake Valley",
    subtitle:
      "SLC · West Valley · Murray · Sandy · West Jordan · Draper · Midvale · Taylorsville · Bountiful · North Salt Lake",
  },
  "utah-county": {
    title: "Utah County",
    subtitle:
      "Provo · Orem · Lehi · American Fork · Lindon · Springville · Spanish Fork · Payson · Salem · Saratoga Springs",
  },
  "weber-ogden": {
    title: "Weber / Ogden Area",
    subtitle:
      "Ogden · Roy · Layton · Clearfield · Riverdale · Kaysville · Sunset - Hill AFB Aerospace & Defense Corridor",
  },
  "cache-valley": {
    title: "Cache Valley",
    subtitle:
      "Logan · North Logan · Providence · Smithfield · Hyrum · Richmond - Home of Utah State University",
  },
  "southern-utah": {
    title: "St. George / Southern Utah",
    subtitle:
      "St. George · Washington · Ivins · Hurricane · Cedar City - Off-Road Hub & Growing Custom Scene",
  },
  other: {
    title: "Other: Statewide, Rural & Specialty",
    subtitle:
      "Moab · Vernal · Roosevelt · Price · Richfield · Statewide Multi-Region Shops",
  },
};

export const REGION_ORDER = [
  "salt-lake",
  "utah-county",
  "weber-ogden",
  "cache-valley",
  "southern-utah",
  "other",
];
