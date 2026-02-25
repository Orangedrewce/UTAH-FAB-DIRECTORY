// @ts-check

/**
 * ═══════════════════════════════════════════════════════════════════════
 * MODULE: api.js — API/Data Access Layer (Supabase + JSON Fallback)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * SCOPE:
 *   This module is the canonical boundary for browser-side data I/O.
 *   Calling modules (e.g., directory/admin/portfolio controllers) should
 *   consume these exports instead of issuing raw Supabase calls directly.
 *
 * RUNTIME CONTRACT:
 *   1) Client precondition:
 *      - Every Supabase-backed export uses `requireClient()`.
 *      - If the SDK client is unavailable, the function throws a
 *        descriptive error immediately (except `fetchJSONShops()`, which
 *        does not depend on Supabase).
 *
 *   2) Directory/shop data:
 *      - `fetchShops(onlyActive = true)` reads `fab_shops`, ordered by
 *        `region`, `sort_order`, then `name`.
 *      - When `onlyActive` is true, it filters `is_active = true`.
 *      - Each row is enriched with `regionTitle`/`regionSubtitle` from
 *        `REGION_META` and then normalized through `normaliseShop()`.
 *
 *   3) Region data:
 *      - `fetchRegions()` reads `regions` ordered by `sort_order`.
 *      - On query failure, it logs and returns a deterministic fallback
 *        list derived from `REGION_ORDER` + `REGION_META`.
 *
 *   4) Join-request data:
 *      - `fetchRequests()` returns only `directory_requests` rows where
 *        `status = 'pending'`, newest first by `created_at` desc.
 *
 *   5) Static JSON fallback:
 *      - `fetchJSONShops()` fetches `data/shops.json`, validates HTTP OK,
 *        parses JSON, and normalizes each entry via `normaliseShop()`.
 *      - Invalid JSON throws a descriptive parsing error.
 *
 *   6) Portfolio data:
 *      - `fetchPortfolioItems(onlyFeatured = false)` returns visible
 *        items (`is_visible = true`), sorted by `sort_order`, then
 *        newest `created_at`.
 *      - `fetchAllPortfolioItems()` returns all items (including hidden)
 *        with the same ordering for admin use.
 *      - `insertPortfolioItem(payload)` and `updatePortfolioItem(id,
 *        payload)` return the single inserted/updated row.
 *      - `deletePortfolioItem(id)` removes a row and returns no value.
 *
 *   7) Portfolio asset upload:
 *      - `uploadPortfolioAsset(file)` enforces a fixed extension allowlist
 *        (CAD + image formats), writes to storage bucket
 *        `portfolio-assets`, and returns a public URL.
 *      - MIME type is inferred from extension map first, then `file.type`,
 *        then fallback `application/octet-stream`.
 *
 * ERROR SEMANTICS:
 *   • Supabase failures throw `Error` with function-prefixed messages
 *     (e.g., `fetchShops: ...`) for traceability at call sites.
 *   • Region lookup intentionally degrades gracefully with fallback data
 *     instead of throwing.
 *
 * MAINTENANCE CHECKLIST (when extending):
 *   • New DB query: add a dedicated export here; keep consumers thin.
 *   • New `fab_shops` fields: update `normaliseShop()` to preserve stable
 *     shape/defaults used by UI modules.
 *   • New sort/filter contract: encode it here (not in page modules).
 *   • New upload format: update both extension allowlist and MIME map.
 *   • Schema evolution: keep thrown error prefixes consistent so existing
 *     UI-level error handling remains actionable.
 * ═══════════════════════════════════════════════════════════════════════
 */

/**
 * @typedef {Object} PortfolioItem
 * @property {string}  id
 * @property {string}  title
 * @property {string}  [description]
 * @property {string}  [tag]
 * @property {string}  [tags]
 * @property {string}  [image_url]
 * @property {string}  [model_url]
 * @property {number}  [image_size_bytes]
 * @property {number}  [model_size_bytes]
 * @property {any}     [media_assets]
 * @property {number}  [cover_index]
 * @property {number}  sort_order
 * @property {boolean} is_visible
 * @property {boolean} [is_featured]
 * @property {string}  [created_at]
 */

import { supabase } from "./supabase.js";
import { REGION_META, REGION_ORDER } from "../utils/constants.js";
import { normaliseShop, generateUUID } from "../utils/utils.js";

/** Throws a descriptive error if the Supabase client failed to initialise. */
function requireClient() {
  if (!supabase) {
    throw new Error(
      "Supabase client not available — the SDK script likely failed to load. " +
        "Check network connectivity and ensure the CDN <script> is not blocked.",
    );
  }
  return supabase;
}

/**
 * Fetch shops from Supabase, enriched with region metadata.
 * @param {boolean} [onlyActive=true] — filter to active shops only
 * @returns {Promise<import('../utils/utils.js').NormalisedShop[]>}
 */
export async function fetchShops(onlyActive = true) {
  let query = requireClient()
    .from("fab_shops")
    .select("*")
    .order("region")
    .order("sort_order")
    .order("name");

  if (onlyActive) {
    query = query.eq("is_active", true);
  }

  const { data, error } = await query;
  if (error) throw new Error(`fetchShops: ${error.message}`);

  return (data || []).map((s) => {
    const meta = REGION_META[s.region] || { title: s.region, subtitle: "" };
    s.regionTitle = meta.title;
    s.regionSubtitle = meta.subtitle;
    return normaliseShop(s);
  });
}

/**
 * Fetch region list from Supabase, with hardcoded fallback.
 * @returns {Promise<Array<{ slug: string, title: string }>>}
 */
export async function fetchRegions() {
  const { data, error } = await requireClient()
    .from("regions")
    .select("*")
    .order("sort_order");

  if (error) {
    console.error(
      "Failed to fetch regions from Supabase, using fallback defaults.",
      error,
    );
    return REGION_ORDER.map((slug) => ({
      slug,
      title: REGION_META[slug]?.title || slug,
    }));
  }

  return data;
}

/**
 * Fetch pending directory join requests (newest first).
 * @returns {Promise<Array<Record<string, any>>>}
 */
export async function fetchRequests() {
  const { data, error } = await requireClient()
    .from("directory_requests")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (error) throw new Error(`fetchRequests: ${error.message}`);
  return data || [];
}

/**
 * Fetch shops from static JSON fallback (no Supabase needed).
 * @returns {Promise<import('../utils/utils.js').NormalisedShop[]>}
 */
export async function fetchJSONShops() {
  const res = await fetch("data/shops.json");
  if (!res.ok) throw new Error("HTTP " + res.status);
  let data;
  try {
    data = await res.json();
  } catch (e) {
    throw new Error("Invalid JSON in shops.json: " + e.message);
  }
  return data.map(normaliseShop);
}

/* ═══════════════════════════════════════════════════════════════════════
   PORTFOLIO - Dynamic portfolio items (public + admin)
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Fetch visible portfolio items, ordered by sort_order.
 * @param {boolean} [onlyFeatured=false] — return only homepage-featured items
 * @returns {Promise<PortfolioItem[]>}
 */
export async function fetchPortfolioItems(onlyFeatured = false) {
  let query = requireClient()
    .from("portfolio_items")
    .select("*")
    .eq("is_visible", true)
    .order("sort_order")
    .order("created_at", { ascending: false });

  if (onlyFeatured) {
    query = query.eq("is_featured", true);
  }

  const { data, error } = await query;
  if (error) throw new Error(`fetchPortfolioItems: ${error.message}`);
  return data || [];
}

/**
 * Fetch ALL portfolio items (including hidden) for admin dashboard.
 * @returns {Promise<PortfolioItem[]>}
 */
export async function fetchAllPortfolioItems() {
  const { data, error } = await requireClient()
    .from("portfolio_items")
    .select("*")
    .order("sort_order")
    .order("created_at", { ascending: false });

  if (error) throw new Error(`fetchAllPortfolioItems: ${error.message}`);
  return data || [];
}

/**
 * Insert a new portfolio item. Returns the inserted row.
 * @param {Partial<PortfolioItem>} payload
 * @returns {Promise<PortfolioItem>}
 */
export async function insertPortfolioItem(payload) {
  const { data, error } = await requireClient()
    .from("portfolio_items")
    .insert([payload])
    .select()
    .single();

  if (error) throw new Error(`insertPortfolioItem: ${error.message}`);
  return data;
}

/**
 * Update an existing portfolio item by id. Returns the updated row.
 * @param {string} id
 * @param {Partial<PortfolioItem>} payload
 * @returns {Promise<PortfolioItem>}
 */
export async function updatePortfolioItem(id, payload) {
  const { data, error } = await requireClient()
    .from("portfolio_items")
    .update(payload)
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(`updatePortfolioItem: ${error.message}`);
  return data;
}

/**
 * Delete a portfolio item by id.
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deletePortfolioItem(id) {
  const { error } = await requireClient()
    .from("portfolio_items")
    .delete()
    .eq("id", id);

  if (error) throw new Error(`deletePortfolioItem: ${error.message}`);
}

/**
 * Upload a portfolio image or 3D model file to Supabase Storage.
 * Enforces extension allowlist and returns the public URL.
 * @param {File} file
 * @returns {Promise<string>} public URL of the uploaded asset
 */
export async function uploadPortfolioAsset(file) {
  const ext = file.name.split(".").pop().toLowerCase();

  const ALLOWED_EXTENSIONS = new Set([
    "glb",
    "gltf",
    "step",
    "stp",
    "stl",
    "obj",
    "png",
    "jpg",
    "jpeg",
    "gif",
    "webp",
  ]);
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error(
      `File type ".${ext}" is not permitted. ` +
        `Allowed formats: ${[...ALLOWED_EXTENSIONS].join(", ")}.`,
    );
  }

  const uniqueId = generateUUID();
  const path = `${Date.now()}_${uniqueId}.${ext}`;

  // Browsers return empty type for CAD formats — map manually
  const MIME = {
    glb: "model/gltf-binary",
    gltf: "model/gltf+json",
    step: "application/step",
    stp: "application/step",
    stl: "model/stl",
    obj: "model/obj",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
  };
  const contentType = MIME[ext] || file.type || "application/octet-stream";

  const { error: uploadErr } = await requireClient()
    .storage.from("portfolio-assets")
    .upload(path, file, { contentType });

  if (uploadErr) throw new Error("Upload failed: " + uploadErr.message);

  const { data: urlData } = requireClient()
    .storage.from("portfolio-assets")
    .getPublicUrl(path);

  return urlData.publicUrl;
}
