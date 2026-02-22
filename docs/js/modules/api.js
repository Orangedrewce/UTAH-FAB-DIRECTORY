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
  const data = await res.json();
  return data.map(normaliseShop);
}
