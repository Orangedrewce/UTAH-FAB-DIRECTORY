/**
 * ═══════════════════════════════════════════════════════════════════════
 * MODULE: api.js — Data-Fetching Layer (Supabase + JSON Fallback)
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
 *       `is_active = true` are returned — this is used by the public
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
 *   • NEW TABLE QUERY — Export a new async function that calls
 *     `supabase.from("<table>").select(...)`, handles errors, and
 *     returns the data array.  Import it into whichever page module
 *     needs the data.
 *   • ADD COLUMNS — If you add columns to `fab_shops`, update the
 *     `normaliseShop()` function in utils.js so the new column has a
 *     default value and consistent key name.
 *   • CHANGE SORT ORDER — Adjust the `.order()` calls inside
 *     `fetchShops()`.
 *   • PAGINATION — Chain `.range(from, to)` on the Supabase query
 *     inside `fetchShops()` if the table grows large.
 * ═══════════════════════════════════════════════════════════════════════
 */

import { supabase } from "./supabase.js";
import { REGION_META, REGION_ORDER } from "./constants.js";
import { normaliseShop } from "./utils.js";

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
