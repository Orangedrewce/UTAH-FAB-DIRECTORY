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
      "Ogden · Roy · Layton · Clearfield · Riverdale · Kaysville · Sunset — Hill AFB Aerospace & Defense Corridor",
  },
  "cache-valley": {
    title: "Cache Valley",
    subtitle:
      "Logan · North Logan · Providence · Smithfield · Hyrum · Richmond — Home of Utah State University",
  },
  "southern-utah": {
    title: "St. George / Southern Utah",
    subtitle:
      "St. George · Washington · Ivins · Hurricane · Cedar City — Off-Road Hub & Growing Custom Scene",
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
