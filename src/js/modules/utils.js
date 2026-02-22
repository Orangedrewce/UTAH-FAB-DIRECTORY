/**
 * ═══════════════════════════════════════════════════════════════════════
 * MODULE: utils.js — Shared Utility / Helper Functions
 * ═══════════════════════════════════════════════════════════════════════
 *
 * PURPOSE:
 *   Pure, reusable helper functions shared across the admin dashboard,
 *   public directory, and portfolio pages.  None of these functions
 *   touch the DOM directly (except by returning HTML strings); they are
 *   safe to call from any context.
 *
 * EXPORTS:
 *   • esc(str)            – Escapes a string for safe insertion into
 *                           HTML (prevents XSS).  Used everywhere HTML
 *                           is built from user data.
 *   • parseMapsUrl(url)   – Extracts { city, region, label } from a
 *                           Google Maps URL by parsing the embedded
 *                           coordinates and /place/ path segment.
 *                           Uses REGION_BOUNDS from constants.js to
 *                           determine which Utah region the coordinates
 *                           fall within.
 *   • websiteLink(shop)   – Given a shop object, returns an HTML string
 *                           for the shop's contact/website link.  Uses
 *                           a priority cascade:
 *                             1. Email → mailto: link
 *                             2. URL   → <a href> link
 *                             3. Phone → tel: link
 *                             4. Fallback → raw text + Google Search
 *                           Any leftover text after extraction is shown
 *                           beside the link as a secondary contact note.
 *   • normaliseShop(s)    – Normalises a raw shop object (from either
 *                           shops.json or Supabase) into a consistent
 *                           shape with guaranteed string `id`, default
 *                           values, and unified key names.
 *
 * HOW TO ADD FEATURES / MODIFY:
 *   • NEW CONTACT TYPE — To support a new contact format (e.g. Instagram
 *     handle), add a new regex/match block inside `websiteLink()` before
 *     the fallback section (step 4).
 *   • NEW REGION — If you add a new geographic region, add its bounding
 *     box to REGION_BOUNDS in constants.js; `parseMapsUrl` will pick
 *     it up automatically.
 *   • NEW SHOP FIELD — Add a default value in `normaliseShop()` so
 *     every consumer sees a consistent property.
 *   • NEW HELPER — Export a new function from this file and import it
 *     where needed.  Keep functions pure (no side-effects).
 * ═══════════════════════════════════════════════════════════════════════
 */

import { REGION_BOUNDS } from "./constants.js";

/** Delay fn execution until after `wait` ms of no calls (reduces redundant work on rapid input) */
export function debounce(fn, wait = 250) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

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
    // Block javascript: and other non-http(s) schemes
    if (!/^https?:\/\//i.test(href)) {
      const q = encodeURIComponent(shop.name + " " + shop.city + " Utah");
      return (
        `<a class="card-link card-link--search" href="https://www.google.com/search?q=${q}" target="_blank" rel="noopener noreferrer">` +
        `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg> ` +
        `Search Google</a>`
      );
    }
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

/** Normalise a shop object — handles both shops.json keys and Supabase column names */
export function normaliseShop(s) {
  return {
    id: s.id != null ? String(s.id) : "",
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
