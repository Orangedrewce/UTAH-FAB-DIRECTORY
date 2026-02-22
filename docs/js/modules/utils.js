import { REGION_BOUNDS } from "./constants.js";

/** Escape a string for safe HTML insertion */
export function esc(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Parse a Google Maps URL and try to extract city name + region.
 * Works with full URLs like:
 *   https://www.google.com/maps/place/Shop+Name,+City,+UT/@40.76,-111.89,17z/...
 * Short links (maps.app.goo.gl) can't be resolved client-side due to CORS.
 * Returns { city, region, label } — all empty strings if nothing could be parsed.
 */
export function parseMapsUrl(url) {
  const result = { city: "", region: "other", label: "" };
  if (!url) return result;

  // Try to extract coordinates: /@lat,lng
  const coordMatch = url.match(/@([-\d.]+),([-\d.]+)/);
  if (coordMatch) {
    const lat = parseFloat(coordMatch[1]);
    const lng = parseFloat(coordMatch[2]);
    for (const b of REGION_BOUNDS) {
      if (
        lat >= b.latMin &&
        lat <= b.latMax &&
        lng >= b.lngMin &&
        lng <= b.lngMax
      ) {
        result.region = b.slug;
        result.label = b.label;
        break;
      }
    }
  }

  // Try to extract city from /place/ segment: ".../place/Shop+Name,+City,+UT/..."
  const placeMatch = url.match(/\/place\/([^/@]+)/);
  if (placeMatch) {
    const decoded = decodeURIComponent(placeMatch[1]).replace(/\+/g, " ");
    // Look for ", City, UT" or ", City, Utah" pattern
    const cityMatch = decoded.match(/,\s*([A-Za-z\s]+?),\s*(?:UT|Utah)\b/i);
    if (cityMatch) {
      result.city = cityMatch[1].trim();
    }
  }

  return result;
}

/** Normalise a shop object — handles both shops.json keys and Supabase column names */
export function normaliseShop(s) {
  return {
    id: String(s.id),
    name: s.name,
    city: s.city,
    size: s.size || s.size_desc || "",
    services: s.services || "",
    website: s.website || "",
    maps_url: s.maps_url || "",
    tags: s.tags || [],
    region: s.region,
    regionTitle: s.regionTitle || s.region_title || "",
    regionSubtitle: s.regionSubtitle || s.region_subtitle || "",
    category: s.category || "Fabrication & Machining",
    is_active: s.is_active !== false,
  };
}
