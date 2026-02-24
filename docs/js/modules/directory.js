/**
 * ═══════════════════════════════════════════════════════════════════════
 * MODULE: directory.js - Public Directory Page Controller
 * ═══════════════════════════════════════════════════════════════════════
 *
 * PURPOSE:
 *   Drives the public-facing Utah Fab Directory page.  Loads shop data,
 *   renders the card grid grouped by region → category, and exposes
 *   search / filter controls.  Also handles the "Join the Directory"
 *   submission form.
 *
 * DATA FLOW:
 *   1. On page load, the IIFE at the bottom tries to fetch shops from
 *      Supabase via `fetchShops(true)` (active shops only).
 *   2. If Supabase fails (offline, CORS, etc.), it falls back to the
 *      local static file `data/shops.json` via `fetchJSONShops()`.
 *   3. `buildDirectory(shops)` groups the array by region (in the order
 *      defined by REGION_ORDER), then by category, and injects the HTML
 *      into `#directoryContent`.  Card entrance animations are staggered.
 *   4. `applyFilters()` runs on every user interaction (search input,
 *      service/tag dropdown, region dropdown) and toggles `.hidden` on
 *      each card, hiding empty category headers and region sections.
 *
 * KEY SECTIONS:
 *   • STATE          - `allShops` (full dataset) and `activeFilter`
 *                      (currently selected service tag, default "all").
 *   • DOM REFERENCES - Cached element references for performance.
 *   • HELPERS        - `mapsLink()` builds a Google Maps link icon;
 *                      `renderCard()` builds one card's HTML.
 *   • BUILD DOM      - `buildDirectory()` constructs the entire card
 *                      grid from the shop array.
 *   • FILTER ENGINE  - `applyFilters()` shows/hides cards and sections
 *                      based on the current search, region, and tag.
 *   • JOIN FORM      - Handles the "Request to join the directory"
 *                      form submission, inserting a row into the
 *                      `directory_requests` Supabase table.  Includes
 *                      detailed error handling for common Supabase
 *                      error codes (duplicate, null constraint, RLS,
 *                      missing table, network errors, JWT expiry).
 *
 * HOW TO ADD FEATURES / MODIFY:
 *   • NEW CARD FIELD - Add the field to `renderCard()`, then make sure
 *     the field exists in the normalised shop object (update
 *     `normaliseShop()` in utils.js and the shop's column in Supabase).
 *   • NEW FILTER - Add an `<input>` or `<select>` to the HTML, cache
 *     its reference up top, read its value inside `applyFilters()`,
 *     and add an event listener at the bottom that calls
 *     `applyFilters()`.
 *   • CATEGORY SORT ORDER - Currently categories render in insertion
 *     order.  To sort alphabetically, call
 *     `[...rObj.categories.entries()].sort((a,b) => a[0].localeCompare(b[0]))`
 *     inside `buildDirectory()` before iterating.
 *   • PAGINATION / VIRTUAL SCROLL - Replace the `contentRoot.innerHTML`
 *     approach with an incremental rendering strategy if the shop count
 *     grows beyond ~500.
 *   • NEW JOIN-FORM FIELD - Add the input to the HTML, read its value
 *     inside the submit handler's `payload` object, and add the
 *     matching column to the `directory_requests` table in Supabase.
 * ═══════════════════════════════════════════════════════════════════════
 */

import { supabase as _sb } from "./supabase.js";
import { REGION_ORDER } from "./constants.js";
import { esc, websiteLink, debounce } from "./utils.js";
import { fetchShops, fetchJSONShops } from "./api.js";

/* ═══════════════════════════════════════════════════
   STATE
═══════════════════════════════════════════════════ */
let allShops = [];
let activeFilter = "all";

/* ═══════════════════════════════════════════════════
   DOM REFERENCES
═══════════════════════════════════════════════════ */
const searchInput = document.getElementById("searchInput");
const serviceFilter = document.getElementById("serviceFilter");
const regionFilter = document.getElementById("regionFilter");
const visibleCount = document.getElementById("visibleCount");
const noResults = document.getElementById("noResults");
const googleFallback = document.getElementById("googleFallback");
const contentRoot = document.getElementById("directoryContent");

/* ═══════════════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════════════ */

/** Build a Google Maps link if maps_url is present */
function mapsLink(shop) {
  const url = (shop.maps_url || "").trim();
  if (!url) return "";
  const href = url.startsWith("http") ? url : "https://" + url;
  return (
    ` <a class="card-link card-link--maps" href="${esc(href)}" target="_blank" rel="noopener noreferrer">` +
    `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> ` +
    `Maps</a>`
  );
}

/** Build a single card's HTML string */
function renderCard(shop) {
  return `
    <div class="card" data-tags="${esc(shop.tags.join(" "))}" data-id="${shop.id}">
      <div class="card-top"><span class="card-name">${esc(shop.name)}</span></div>
      <div class="card-city">${esc(shop.city)}</div>
      <div class="card-size">${esc(shop.size)}</div>
      <div class="card-services">${esc(shop.services)}</div>
      <div class="card-website">${websiteLink(shop)}${mapsLink(shop)}</div>
    </div>`;
}

/* ═══════════════════════════════════════════════════
   BUILD DOM FROM JSON
═══════════════════════════════════════════════════ */

function buildDirectory(shops) {
  // Group: region → categories (ordered Map)
  const regionMap = new Map();

  for (const shop of shops) {
    if (!regionMap.has(shop.region)) {
      regionMap.set(shop.region, {
        title: shop.regionTitle,
        subtitle: shop.regionSubtitle,
        categories: new Map(),
      });
    }
    const rObj = regionMap.get(shop.region);
    if (!rObj.categories.has(shop.category)) {
      rObj.categories.set(shop.category, []);
    }
    rObj.categories.get(shop.category).push(shop);
  }

  const parts = [];

  for (const regionSlug of REGION_ORDER) {
    const rObj = regionMap.get(regionSlug);
    if (!rObj) continue;

    parts.push(
      `<section class="region" data-region="${esc(regionSlug)}">`,
      `  <div class="region-header">`,
      `    <h2 class="region-title">${esc(rObj.title)}</h2>`,
      `    <span class="region-subtitle">${esc(rObj.subtitle)}</span>`,
      `  </div>`,
    );

    for (const [catName, catShops] of rObj.categories) {
      parts.push(`  <div class="category-header">${esc(catName)}</div>`);
      parts.push(`  <div class="card-grid">`);
      for (const shop of catShops) {
        parts.push(renderCard(shop));
      }
      parts.push(`  </div>`);
    }

    parts.push(`</section>`);
  }

  contentRoot.innerHTML = parts.join("\n");

  // Stagger card entrance animations
  contentRoot.querySelectorAll(".card").forEach((card, i) => {
    card.style.animationDelay = `${Math.min(i * 15, 600)}ms`;
  });
}

/* ═══════════════════════════════════════════════════
   FILTER ENGINE  (operates on JSON array → toggles DOM)
═══════════════════════════════════════════════════ */

function applyFilters() {
  // Abort silently if any required element is missing — prevents crash on partial pages
  if (
    !searchInput ||
    !regionFilter ||
    !contentRoot ||
    !visibleCount ||
    !noResults ||
    !googleFallback
  )
    return;

  const searchTerm = searchInput.value.toLowerCase().trim();
  const regionVal = regionFilter.value;
  let count = 0;

  // Determine visible shop IDs from in-memory data
  const visibleIds = new Set();

  for (const shop of allShops) {
    // Region gate
    if (regionVal && shop.region !== regionVal) continue;

    // Service / tag gate
    if (activeFilter !== "all") {
      if (!shop.tags.includes(activeFilter)) continue;
    }

    // Free-text search
    if (searchTerm) {
      const haystack = [
        shop.name,
        shop.city,
        shop.size,
        shop.services,
        shop.website,
        shop.tags.join(" "),
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(searchTerm)) continue;
    }

    visibleIds.add(shop.id);
    count++;
  }

  // Reflect in DOM
  contentRoot.querySelectorAll(".card").forEach((card) => {
    card.classList.toggle("hidden", !visibleIds.has(card.dataset.id));
  });

  // Hide empty category headers
  contentRoot.querySelectorAll(".category-header").forEach((hdr) => {
    const grid = hdr.nextElementSibling;
    if (!grid) return;
    hdr.style.display =
      grid.querySelectorAll(".card:not(.hidden)").length === 0 ? "none" : "";
  });

  // Hide empty region sections
  contentRoot.querySelectorAll(".region").forEach((section) => {
    section.style.display =
      section.querySelectorAll(".card:not(.hidden)").length === 0 ? "none" : "";
  });

  visibleCount.textContent = count;

  // Show / hide no-results with Google fallback
  const hasNoResults = count === 0;
  noResults.classList.toggle("visible", hasNoResults);
  if (hasNoResults && searchTerm) {
    googleFallback.href =
      "https://www.google.com/search?q=" +
      encodeURIComponent(searchTerm + " fabrication machining Utah");
    googleFallback.style.display = "inline-block";
  } else {
    googleFallback.style.display = "none";
  }

  // ── Shareable URL - push current filter state into the address bar ──
  const params = new URLSearchParams();
  if (regionVal) params.set("region", regionVal);
  if (activeFilter !== "all") params.set("service", activeFilter);
  if (searchTerm) params.set("q", searchTerm);
  const qs = params.toString();
  history.replaceState(null, "", qs ? "?" + qs : window.location.pathname);
}

/* ═══════════════════════════════════════════════════
   EVENT LISTENERS
═══════════════════════════════════════════════════ */

serviceFilter?.addEventListener("change", () => {
  activeFilter = serviceFilter.value;
  applyFilters();
});

searchInput?.addEventListener("input", debounce(applyFilters, 250));
regionFilter?.addEventListener("change", applyFilters);

/* ═══════════════════════════════════════════════════
   INIT - fetch shops.json → render → filter
═══════════════════════════════════════════════════ */

(async () => {
  try {
    // Try Supabase first; fall back to static shops.json
    try {
      allShops = await fetchShops(true);
    } catch (sbErr) {
      console.warn("Supabase failed, falling back to shops.json:", sbErr);
      allShops = await fetchJSONShops();
    }

    buildDirectory(allShops);

    // ── Restore filters from URL query params (shareable links) ──
    const params = new URLSearchParams(window.location.search);
    const urlRegion = params.get("region");
    const urlService = params.get("service");
    const urlQuery = params.get("q");

    if (urlRegion && regionFilter) regionFilter.value = urlRegion;
    if (urlService && serviceFilter) {
      serviceFilter.value = urlService;
      activeFilter = urlService;
    }
    if (urlQuery && searchInput) searchInput.value = urlQuery;

    applyFilters();
  } catch (err) {
    console.error("Directory load error:", err);
    if (contentRoot) {
      contentRoot.innerHTML =
        '<div style="text-align:center;padding:4rem 1rem;color:var(--accent);">' +
        "<h2>Failed to load shop data</h2>" +
        '<p style="color:var(--text-dim);margin-top:.5rem;">Check console for details.<br>' +
        "If testing locally without Supabase, ensure <code>data/shops.json</code> is in the same directory.</p>" +
        "</div>";
    }
  }
})();

/* ═══════════════════════════════════════════════════
   JOIN THE DIRECTORY - Tag picker + Form submission
═══════════════════════════════════════════════════ */
// Tag chip click → toggle selected
const jTagPicker = document.getElementById("jTagPicker");
if (jTagPicker) {
  jTagPicker.addEventListener("click", (e) => {
    const chip = e.target.closest(".tag-chip");
    if (chip) chip.classList.toggle("selected");
  });
}

const joinForm = document.getElementById("joinForm");
const joinSubmitBtn = document.getElementById("joinSubmitBtn");
const joinFeedback = document.getElementById("joinFeedback");

if (joinForm) {
  joinForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    joinSubmitBtn.disabled = true;
    joinSubmitBtn.textContent = "Sending…";
    joinFeedback.textContent = "";
    joinFeedback.className = "join-feedback";

    const selectedTags = [
      ...document.querySelectorAll("#jTagPicker .tag-chip.selected"),
    ].map((el) => el.dataset.tag);

    const payload = {
      shop_name: document.getElementById("jShopName").value.trim(),
      city: document.getElementById("jCity").value.trim(),
      region: document.getElementById("jRegion").value,
      maps_url: document.getElementById("jMapsUrl").value.trim(),
      contact: document.getElementById("jContact").value.trim(),
      services: document.getElementById("jServices").value.trim(),
      tags: selectedTags,
    };

    try {
      if (!_sb)
        throw new Error(
          "Database connection blocked. Please check your network or adblocker.",
        );
      const { error } = await _sb.from("directory_requests").insert([payload]);
      if (error) throw error;

      // Discord notification is handled server-side by the Supabase trigger
      joinFeedback.textContent = "Request submitted - we'll review it shortly!";
      joinFeedback.classList.add("success");
      joinForm.reset();
      // Clear tag selections (guard against missing picker)
      jTagPicker
        ?.querySelectorAll(".tag-chip.selected")
        .forEach((c) => c.classList.remove("selected"));
    } catch (err) {
      console.error("Join request failed:", err);

      let msg = "Something went wrong. Please try again.";
      const code = err?.code || "";
      const em = (err && (err.message || err.details || err.hint)) || "";

      if (code === "23505" || em.includes("duplicate") || em.includes("unique"))
        msg = "A request for this shop has already been submitted.";
      else if (
        code === "23502" ||
        em.includes("not-null") ||
        em.includes("null value")
      )
        msg = "Please fill in all required fields.";
      else if (code === "42501" || em.includes("row-level security"))
        msg =
          "Permission denied - the database is not accepting requests right now.";
      else if (code === "42P01")
        msg =
          "The request form is not set up yet (table missing). Please contact the admin.";
      else if (
        code === "42703" ||
        (em.includes("column") && em.includes("does not exist"))
      )
        msg =
          "The form schema is outdated - please contact the admin to run the latest migration.";
      else if (code.startsWith("42") || em.includes("check constraint"))
        msg =
          "Database schema error - please contact the admin. (" +
          (em || code) +
          ")";
      else if (
        em.includes("Failed to fetch") ||
        em.includes("NetworkError") ||
        em.includes("network")
      )
        msg = "Network error - check your internet connection and try again.";
      else if (code === "PGRST301" || em.includes("JWT"))
        msg = "Session expired - please refresh the page and try again.";
      else if (em) msg = "Error: " + em;

      joinFeedback.textContent = msg;
      joinFeedback.classList.add("error");
    } finally {
      joinSubmitBtn.disabled = false;
      joinSubmitBtn.textContent = "Submit Request";
    }
  });
}
