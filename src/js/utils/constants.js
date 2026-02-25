// @ts-check

/**
 * ═══════════════════════════════════════════════════════════════════════
 * MODULE: constants.js — Shared Application Constants (Source of Truth)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * SCOPE:
 *   This module defines immutable, shared configuration primitives used
 *   across UI modules and utility functions. It contains no runtime side
 *   effects and no environment-dependent behavior.
 *
 * RUNTIME CONTRACT:
 *   1) `ALL_TAGS`:
 *      - Canonical tag vocabulary for shop capabilities/services.
 *      - Consumed by admin tag selection and request intake flows.
 *      - Values are machine slugs (lowercase, no spaces) used as stable
 *        identifiers in persisted `tags` arrays.
 *
 *   2) `CATEGORIES`:
 *      - Human-readable category labels used as UI suggestions.
 *      - Intended for display/autocomplete; not a strict enum validator.
 *
 *   3) `REGION_BOUNDS`:
 *      - Bounding-box heuristics for region inference from map URLs.
 *      - Each entry requires `{ slug, label, latMin, latMax, lngMin,
 *        lngMax }` and is interpreted by utility parsers.
 *      - This list is heuristic support, not authoritative DB taxonomy.
 *
 *   4) `REGION_META`:
 *      - Presentation metadata keyed by region slug.
 *      - Supplies `{ title, subtitle }` used in public/admin rendering.
 *      - Must include a resilient fallback key `other` for unmatched or
 *        cross-region/statewide entries.
 *
 *   5) `REGION_ORDER`:
 *      - Preferred display ordering for region-grouped presentation.
 *      - Slugs here should correspond to keys in `REGION_META`.
 *
 * CONSISTENCY REQUIREMENTS:
 *   • Region slug parity should be maintained across:
 *       - `REGION_BOUNDS[].slug`
 *       - `REGION_META` keys
 *       - `REGION_ORDER` entries
 *       - Supabase `regions.slug` records
 *   • Divergence is allowed only when intentional and documented (e.g.,
 *     temporary migration states), otherwise UI grouping may degrade.
 *
 * OPERATIONAL CAVEATS:
 *   • Changing tag or region slugs can orphan existing DB records unless
 *     corresponding data migrations are performed.
 *   • Category text changes are display-level only, but may affect admin
 *     data-entry consistency if labels are substantially renamed.
 *
 * MAINTENANCE CHECKLIST:
 *   • New tag: append to `ALL_TAGS`; confirm UI pickers still sort/render.
 *   • New category: append to `CATEGORIES`; verify modal datalist UX.
 *   • New region: update `REGION_BOUNDS`, `REGION_META`, and
 *     `REGION_ORDER`, then add matching DB seed/row in `regions`.
 *   • Region rename: update all slug references plus DB data migration.
 *   • Region removal: remove from all region structures and migrate any
 *     affected shops/requests to a valid fallback slug.
 * ═══════════════════════════════════════════════════════════════════════
 */

/**
 * @typedef {Object} RegionBound
 * @property {string} slug   — region identifier slug
 * @property {string} label  — human-readable region name
 * @property {number} latMin — southern latitude boundary
 * @property {number} latMax — northern latitude boundary
 * @property {number} lngMin — western longitude boundary
 * @property {number} lngMax — eastern longitude boundary
 */

/**
 * @typedef {Object} RegionMetaEntry
 * @property {string} title    — display title for region section header
 * @property {string} subtitle — city list / description shown under title
 */

/** @type {readonly string[]} Canonical tag vocabulary (machine slugs) */
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

/** @type {readonly string[]} Human-readable category labels for UI suggestions */
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

/** @type {readonly RegionBound[]} Bounding-box heuristics for region inference from map URLs */
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

/** @type {Readonly<Record<string, RegionMetaEntry>>} Presentation metadata keyed by region slug */
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

/** @type {readonly string[]} Preferred display ordering for region-grouped presentation */
export const REGION_ORDER = [
  "salt-lake",
  "utah-county",
  "weber-ogden",
  "cache-valley",
  "southern-utah",
  "other",
];
