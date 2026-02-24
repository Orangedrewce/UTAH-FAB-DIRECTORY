/**
 * ═══════════════════════════════════════════════════════════════════════
 * MODULE: api.js - Data-Fetching Layer (Supabase + JSON Fallback)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * PURPOSE:
 *   Centralises every Supabase query and the static JSON fallback into
 *   one file so that both admin.js and directory.js share identical
 *   data-loading logic.  All functions are async and return plain arrays
 *   of normalised objects.
 *
 * EXPORTS:
 *   • fetchShops(onlyActive = true)
 *       Queries the `fab_shops` table, ordered by region → sort_order →
 *       name.  When `onlyActive` is true (default), only rows with
 *       `is_active = true` are returned - this is used by the public
 *       directory.  The admin dashboard passes `false` to get every row.
 *       Each row is enriched with regionTitle / regionSubtitle from
 *       REGION_META, then normalised via `normaliseShop()`.
 *
 *   • fetchRegions()
 *       Queries the `regions` table ordered by `sort_order`.  Returns
 *       the raw rows.  Falls back to REGION_ORDER + REGION_META if the
 *       query fails, so the admin dashboard still renders region
 *       dropdowns even without a DB connection.
 *
 *   • fetchRequests()
 *       Queries `directory_requests` for all rows with
 *       `status = 'pending'`, ordered newest-first.  Used by admin.js
 *       to populate the Requests panel.
 *
 *   • fetchJSONShops()
 *       Fetches `data/shops.json` via plain HTTP, normalises each shop
 *       object, and returns the array.  This is the offline / fallback
 *       data source used when Supabase is unreachable.
 *
 * HOW TO ADD FEATURES / MODIFY:
 *   • NEW TABLE QUERY - Export a new async function that calls
 *     `supabase.from("<table>").select(...)`, handles errors, and
 *     returns the data array.  Import it into whichever page module
 *     needs the data.
 *   • ADD COLUMNS - If you add columns to `fab_shops`, update the
 *     `normaliseShop()` function in utils.js so the new column has a
 *     default value and consistent key name.
 *   • CHANGE SORT ORDER - Adjust the `.order()` calls inside
 *     `fetchShops()`.
 *   • PAGINATION - Chain `.range(from, to)` on the Supabase query
 *     inside `fetchShops()` if the table grows large.
 * ═══════════════════════════════════════════════════════════════════════
 */

import { supabase } from "./supabase.js";
import { REGION_META, REGION_ORDER } from "./constants.js";
import { normaliseShop, generateUUID } from "./utils.js";

export async function fetchShops(onlyActive = true) {
  let query = supabase
    .from("fab_shops")
    .select("*")
    .order("region")
    .order("sort_order")
    .order("name");

  if (onlyActive) {
    query = query.eq("is_active", true);
  }

  const { data, error } = await query;
  if (error) throw error;

  return (data || []).map((s) => {
    const meta = REGION_META[s.region] || { title: s.region, subtitle: "" };
    s.regionTitle = meta.title;
    s.regionSubtitle = meta.subtitle;
    return normaliseShop(s);
  });
}

export async function fetchRegions() {
  const { data, error } = await supabase
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

export async function fetchRequests() {
  const { data, error } = await supabase
    .from("directory_requests")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data || [];
}

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
 * Pass `onlyFeatured = true` to get just homepage-featured items.
 */
export async function fetchPortfolioItems(onlyFeatured = false) {
  let query = supabase
    .from("portfolio_items")
    .select("*")
    .eq("is_visible", true)
    .order("sort_order")
    .order("created_at", { ascending: false });

  if (onlyFeatured) {
    query = query.eq("is_featured", true);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

/**
 * Fetch ALL portfolio items (including hidden) for admin dashboard.
 */
export async function fetchAllPortfolioItems() {
  const { data, error } = await supabase
    .from("portfolio_items")
    .select("*")
    .order("sort_order")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data || [];
}

/**
 * Insert a new portfolio item. Returns the inserted row.
 */
export async function insertPortfolioItem(payload) {
  const { data, error } = await supabase
    .from("portfolio_items")
    .insert([payload])
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Update an existing portfolio item by id. Returns the updated row.
 */
export async function updatePortfolioItem(id, payload) {
  const { data, error } = await supabase
    .from("portfolio_items")
    .update(payload)
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Delete a portfolio item by id.
 */
export async function deletePortfolioItem(id) {
  const { error } = await supabase
    .from("portfolio_items")
    .delete()
    .eq("id", id);

  if (error) throw error;
}

/**
 * Upload a portfolio image or 3D model file to Supabase Storage.
 * Returns the public URL.
 */
export async function uploadPortfolioAsset(file) {
  const ext = file.name.split(".").pop().toLowerCase();
  const uniqueId = generateUUID();
  const path = `${Date.now()}_${uniqueId}.${ext}`;

  // Browsers return empty type for CAD formats — map manually
  const MIME = {
    glb:  "model/gltf-binary",
    gltf: "model/gltf+json",
    step: "application/step",
    stp:  "application/step",
    stl:  "model/stl",
    obj:  "model/obj",
    png:  "image/png",
    jpg:  "image/jpeg",
    jpeg: "image/jpeg",
    gif:  "image/gif",
    webp: "image/webp",
  };
  const contentType = MIME[ext] || file.type || "application/octet-stream";

  const { error: uploadErr } = await supabase.storage
    .from("portfolio-assets")
    .upload(path, file, { contentType });

  if (uploadErr) throw new Error("Upload failed: " + uploadErr.message);

  const { data: urlData } = supabase.storage
    .from("portfolio-assets")
    .getPublicUrl(path);

  return urlData.publicUrl;
}
