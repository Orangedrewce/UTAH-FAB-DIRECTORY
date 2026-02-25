// @ts-check

/**
 * ═══════════════════════════════════════════════════════════════════════
 * MODULE: utils.js — Shared Utility Primitives (Cross-Module Contract)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * SCOPE:
 *   Provides shared, low-level helper functions consumed by directory,
 *   admin, portfolio, and API-adjacent modules. This file centralizes
 *   formatting, parsing, normalization, and small UX primitives to avoid
 *   duplicated logic and drift.
 *
 * RUNTIME CONTRACT:
 *   1) Timing utility:
 *      - debounce(fn, wait): delays invocation until no calls occur for
 *        wait ms. Last-call arguments are used.
 *
 *   2) HTML safety:
 *      - esc(str): escapes &, <, >, and ".
 *      - Intended for safe interpolation into HTML strings.
 *
 *   3) Google Drive normalization:
 *      - extractDriveFileId(url): extracts Drive/lh3 file IDs from known
 *        URL patterns or raw ID input.
 *      - toEmbedUrl(fileId): converts file ID to lh3 direct-serve URL.
 *      - normalisePortfolioImageUrl(url): rewrites Drive-style inputs to
 *        stable embed form; passes through non-Drive URLs unchanged.
 *
 *   4) Maps parsing:
 *      - parseMapsUrl(url): returns { city, region, label }.
 *      - Region is inferred from coordinate bounding boxes in
 *        REGION_BOUNDS; defaults to region "other".
 *      - City is inferred from /place/ path pattern when available.
 *
 *   5) Contact link rendering:
 *      - websiteLink(shop): returns HTML using precedence:
 *        email -> URL -> phone -> text + search fallback.
 *      - Preserves unmatched contact text as a secondary note.
 *
 *   6) Shop normalization:
 *      - normaliseShop(s): canonicalizes raw shop records from Supabase
 *        or JSON into a stable object shape for downstream rendering.
 *      - Ensures string id, defaults for optional fields, and key bridging
 *        (size vs size_desc, regionTitle vs region_title, etc.).
 *
 *   7) Identifier generation:
 *      - generateUUID(): RFC 4122 v4 via crypto.randomUUID when present,
 *        with getRandomValues fallback preserving version/variant bits.
 *
 *   8) Accessibility helper:
 *      - trapFocus(container): keeps Tab focus cycling inside modal-like
 *        container and returns cleanup handler.
 *
 *   9) Embed URL classification:
 *      - isExternalEmbedUrl(url): identifies 3dviewer.net URLs for shared
 *        model-embed branching logic.
 *
 * OPERATIONAL CAVEATS:
 *   • websiteLink returns HTML strings; callers must treat output as
 *     trusted utility output and avoid re-escaping/unsafe concatenation.
 *   • parseMapsUrl cannot resolve short-link redirects client-side; it
 *     only parses directly available URL structure.
 *   • trapFocus requires focusable descendants (or focusable container)
 *     for best keyboard UX.
 *
 * MAINTENANCE CHECKLIST:
 *   • New contact type: extend websiteLink precedence safely.
 *   • New region geometry: update REGION_BOUNDS in constants module.
 *   • New shop fields: add defaults/mapping in normaliseShop.
 *   • New Drive URL patterns: extend extractDriveFileId matcher set.
 *   • Any helper with side effects should remain explicit and minimal;
 *     keep pure parsing/formatting functions deterministic.
 * ═══════════════════════════════════════════════════════════════════════
 */

/**
 * @typedef {Object} NormalisedShop
 * @property {string}   id
 * @property {string}   name
 * @property {string}   city
 * @property {string}   size
 * @property {string}   services
 * @property {string}   website
 * @property {string}   maps_url
 * @property {string[]} tags
 * @property {string}   [region]
 * @property {string}   regionTitle
 * @property {string}   regionSubtitle
 * @property {string}   category
 * @property {boolean}  is_active
 */

/**
 * @typedef {Object} ParsedMapsResult
 * @property {string} city   — city name extracted from the URL, or ""
 * @property {string} region — region slug inferred from coordinates, or "other"
 * @property {string} label  — human-readable region label, or ""
 */

import { REGION_BOUNDS } from "./constants.js";

/**
 * Delay function execution until after `wait` ms of no calls.
 * @param {Function} fn   — function to debounce
 * @param {number}   [wait=250] — debounce interval in ms
 * @returns {(...args: any[]) => void}
 */
export function debounce(fn, wait = 250) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

/**
 * Escape a string for safe HTML insertion.
 * @param {string} str
 * @returns {string}
 */
export function esc(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ============================================
// GOOGLE DRIVE URL HELPERS (shared)
// ============================================
/**
 * Extract a Google Drive / lh3 file ID from a URL or raw ID string.
 * @param {string} url
 * @returns {string | null} file ID or null if unrecognised
 */
export function extractDriveFileId(url) {
  if (!url || typeof url !== "string") return null;
  url = url.trim();
  let m = url.match(/lh3\.googleusercontent\.com\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  m = url.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  m = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9_-]{25,}$/.test(url)) return url;
  return null;
}

/**
 * Convert a Drive file ID to an lh3 direct-serve URL.
 * @param {string} fileId
 * @returns {string}
 */
export function toEmbedUrl(fileId) {
  return `https://lh3.googleusercontent.com/d/${fileId}`;
}

/**
 * Normalize portfolio image/media URL.
 * Converts Google Drive share URLs (or raw IDs) into direct lh3 embed URLs;
 * passes normal URLs through unchanged.
 * @param {string} url
 * @returns {string}
 */
export function normalisePortfolioImageUrl(url) {
  if (!url || typeof url !== "string") return "";
  const trimmed = url.trim();
  if (!trimmed) return "";
  const driveId = extractDriveFileId(trimmed);
  return driveId ? toEmbedUrl(driveId) : trimmed;
}

/**
 * Parse a Google Maps URL and try to extract city name + region.
 * Works with full URLs like:
 *   https://www.google.com/maps/place/Shop+Name,+City,+UT/@40.76,-111.89,17z/...
 * Short links (maps.app.goo.gl) can’t be resolved client-side due to CORS.
 * @param {string} url
 * @returns {ParsedMapsResult}
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
 * @param {{ name: string, city?: string, website?: string }} shop
 * @returns {string} HTML string
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
    const escapedEmail = email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const remaining = raw
      .replace(new RegExp(escapedEmail, "g"), "")
      .replace(/^[\s|,·]+|[\s|,·]+$/g, "")
      .trim();
    const link = `<a class="card-link" href="mailto:${esc(email)}">${esc(email)}</a>`;
    if (remaining) {
      return (
        link + ` <span class="card-contact-extra">${esc(remaining)}</span>`
      );
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
    // Note: href is always https?:// at this point (either matched as-is or prefixed above),
    // so a scheme check here is not needed.
    const display = urlMatch[0].replace(/^https?:\/\//i, "").replace(/\/$/, "");
    const escapedMatch = urlMatch[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const remaining = raw
      .replace(new RegExp(escapedMatch, "g"), "")
      .replace(/^[\s|,·]+|[\s|,·]+$/g, "")
      .trim();
    const link = `<a class="card-link" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(display)}</a>`;
    if (remaining) {
      return (
        link + ` <span class="card-contact-extra">${esc(remaining)}</span>`
      );
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
      return (
        link + ` <span class="card-contact-extra">${esc(remaining)}</span>`
      );
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

/**
 * Normalise a raw shop record into a stable shape for rendering.
 * Handles both shops.json keys and Supabase column names.
 * @param {Record<string, any>} s — raw shop object from Supabase or JSON
 * @returns {NormalisedShop}
 */
export function normaliseShop(s) {
  return {
    id: s.id != null ? String(s.id) : "",
    name: s.name ?? "",
    city: s.city ?? "",
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

/**
 * Returns a v4 UUID (RFC 4122).
 * Uses `crypto.randomUUID()` when available, with `getRandomValues` fallback.
 * @returns {string}
 */
export function generateUUID() {
  if (crypto.randomUUID) return crypto.randomUUID();
  // Manual RFC 4122 v4 construction — do NOT simplify to a plain hex join;
  // the version nibble (0x4x) and variant bits (0x8x/0x9x/0xax/0xbx) are required.
  const h = Array.from(crypto.getRandomValues(new Uint8Array(16)));
  h[6] = (h[6] & 0x0f) | 0x40; // version 4
  h[8] = (h[8] & 0x3f) | 0x80; // variant bits
  return h
    .map(
      (b, i) =>
        ([4, 6, 8, 10].includes(i) ? "-" : "") +
        b.toString(16).padStart(2, "0"),
    )
    .join("");
}

/**
 * Trap keyboard focus inside a container (modal / dialog).
 * Returns a cleanup function that removes the keydown listener.
 * @param {HTMLElement} container
 * @returns {() => void} cleanup function
 */
export function trapFocus(container) {
  if (!container) return () => {};

  const getFocusable = () =>
    [
      ...container.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    ].filter((el) => !el.disabled && el.offsetParent !== null);

  const keyHandler = (e) => {
    if (e.key !== "Tab") return;
    const focusable = getFocusable();
    if (!focusable.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  container.addEventListener("keydown", keyHandler);
  const focusable = getFocusable();
  (focusable[0] || container).focus();

  return () => container.removeEventListener("keydown", keyHandler);
}

/**
 * Returns true if the URL is a 3dviewer.net external embed link.
 * @param {string} url
 * @returns {boolean}
 */
export function isExternalEmbedUrl(url) {
  return /3dviewer\.net/i.test(url || "");
}
