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

/**
 * Build a contact/website link (or links) for a shop card.
 * Tries email → URL → phone → Google search fallback.
 */
export function websiteLink(shop) {
  const raw = (shop.website || "").trim();
  if (!raw) {
    const q = encodeURIComponent(shop.name + " " + shop.city + " Utah");
    return (
      `<a class="card-link card-link--search" href="https://www.google.com/search?q=${q}" target="_blank" rel="noopener noreferrer">` +
      `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg> ` +
      `Search Google</a>`
    );
  }

  // 1. Try to extract an Email
  const emailMatch = raw.match(
    /([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/i,
  );
  if (emailMatch) {
    const email = emailMatch[0];
    const remaining = raw
      .replace(email, "")
      .replace(/^[\s|,·]+|[\s|,·]+$/g, "")
      .trim();
    const link = `<a class="card-link" href="mailto:${esc(email)}">${esc(email)}</a>`;
    if (remaining) {
      return link + ` <span class="card-contact-extra">${esc(remaining)}</span>`;
    }
    return link;
  }

  // 2. Try to extract a URL
  const urlMatch = raw.match(
    /(https?:\/\/[^\s|,]+|[a-zA-Z0-9][a-zA-Z0-9\-]*\.[a-zA-Z]{2,}[^\s|,]*)/i,
  );
  if (urlMatch) {
    const href = urlMatch[0].startsWith("http")
      ? urlMatch[0]
      : "https://" + urlMatch[0];
    const display = urlMatch[0].replace(/^https?:\/\//i, "").replace(/\/$/, "");
    const remaining = raw
      .replace(urlMatch[0], "")
      .replace(/^[\s|,·]+|[\s|,·]+$/g, "")
      .trim();
    const link = `<a class="card-link" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(display)}</a>`;
    if (remaining) {
      return link + ` <span class="card-contact-extra">${esc(remaining)}</span>`;
    }
    return link;
  }

  // 3. Try to extract a Phone number
  const phoneMatch = raw.match(
    /(\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/,
  );
  if (phoneMatch) {
    const phone = phoneMatch[0];
    const tel = phone.replace(/[^\d+]/g, "");
    const link = `<a class="card-link" href="tel:${esc(tel)}">${esc(phone.trim())}</a>`;
    const remaining = raw
      .replace(phone, "")
      .replace(/^[\s|,·]+|[\s|,·]+$/g, "")
      .trim();
    if (remaining) {
      return link + ` <span class="card-contact-extra">${esc(remaining)}</span>`;
    }
    return link;
  }

  // 4. Default fallback: show raw text + Google search
  const q = encodeURIComponent(shop.name + " " + shop.city + " Utah");
  return (
    `<span class="card-contact-extra">${esc(raw)}</span> ` +
    `<a class="card-link card-link--search" href="https://www.google.com/search?q=${q}" target="_blank" rel="noopener noreferrer">` +
    `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg> ` +
    `Search</a>`
  );
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
