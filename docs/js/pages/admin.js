// @ts-check
// Trigger lint

/**
 * ═══════════════════════════════════════════════════════════════════════
 * MODULE: admin.js — Admin Dashboard Controller (Authoritative Runtime Notes)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * SCOPE:
 *   This module owns all client-side behavior for `admin.html`.
 *   It is the orchestration layer between:
 *   • Supabase Auth (`auth.signInWithPassword`, session checks, sign-out)
 *   • Supabase data tables (`fab_shops`, `directory_requests`)
 *   • Admin dashboard DOM (filters, table, bulk actions, modal, requests)
 *
 * RUNTIME CONTRACT:
 *   1) Authentication gate:
 *      - No dashboard data is loaded until a valid session exists.
 *      - `checkSession()` and `onAuthStateChange()` can both trigger
 *        `showDashboard(user)`; `_dashboardLoading` prevents double-init.
 *
 *   2) Data sources and state:
 *      - `REGIONS` is loaded from `fetchRegions()`.
 *      - `allShops` stores the full admin dataset from `fetchShops(false)`.
 *      - `filtered` is derived-only view state from `applyFilters()`.
 *      - `pendingRequests` mirrors pending rows from `fetchRequests()`.
 *      - `selectedIds` tracks checkbox selection across table re-renders.
 *
 *   3) Rendering model:
 *      - The table and requests panel render via string templates and
 *        `innerHTML` assignment, then rely on parent-level delegation.
 *      - Filter controls mutate only `filtered`; source of truth remains
 *        `allShops`.
 *
 *   4) CRUD behavior for shops:
 *      - Create/Update writes to `fab_shops` from modal form values.
 *      - Delete is hard delete (`DELETE FROM fab_shops WHERE id = ...`).
 *      - Bulk toggle groups selected rows into activate/deactivate batches
 *        and performs up to two update queries.
 *
 *   5) Request approval flow:
 *      - Approve attempts to insert a new `fab_shops` row built from the
 *        request payload (+ parsed city fallback from maps URL).
 *      - Duplicate-name-per-region conflicts are treated as non-fatal:
 *        insert is skipped, request is still marked approved.
 *      - Reject marks request status as dismissed.
 *
 *   6) Deep-link behavior:
 *      - `?approve_id=<uuid>` opens/highlights a request card for review.
 *      - Query param is removed from URL immediately after parsing.
 *
 * OPERATIONAL DETAILS / CAVEATS:
 *   • This module expects all queried DOM nodes for admin UI to exist in
 *     `admin.html`; if IDs/classes change, event wiring can silently break.
 *   • Region dropdown options come from live `REGIONS`; if region fetch
 *     fails, UI remains usable but region pickers may be empty.
 *   • User-facing save errors are normalized for unique and FK violations
 *     to provide actionable admin guidance.
 *   • `REGION_BOUNDS` is imported but not used in this module currently.
 *
 * MAINTENANCE CHECKLIST (when extending):
 *   • New form field: update modal HTML + DOM refs + `openEditModal()` +
 *     submit payload mapping.
 *   • New filter: add control + read in `applyFilters()` + listener.
 *   • New requests attribute: surface in `renderRequestsList()` and map to
 *     `newShop` on approve.
 *   • Any new async init path must respect `_dashboardLoading` guard.
 * ═══════════════════════════════════════════════════════════════════════
 */

import { supabase as _supabase } from "../services/supabase.js";
import { ALL_TAGS, CATEGORIES, REGION_BOUNDS } from "../utils/constants.js";
import {
  esc,
  parseMapsUrl,
  websiteLink,
  debounce,
  trapFocus,
} from "../utils/utils.js";
import { fetchShops, fetchRegions, fetchRequests } from "../services/api.js";

// ── Canonical regions (loaded from DB, fallback hardcoded) ─────────────
/** @type {Array<{ slug: string, title: string }>} */
let REGIONS = [];

// ── State ───────────────────────────────────────────────────────────────────
/** @type {import('../utils/utils.js').NormalisedShop[]} */
let allShops = [];
/** @type {import('../utils/utils.js').NormalisedShop[]} */
let filtered = [];
/** @type {Set<string>} */
let selectedIds = new Set();
/** @type {Array<Record<string, any>>} */
let pendingRequests = [];
let _dashboardLoading = false;

// ── DOM refs ────────────────────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);

const authGate = $("#authGate");
const adminDash = $("#adminDash");
const loginForm = $("#loginForm");
const authError = $("#authError");
const adminEmailEl = $("#adminEmail");
const logoutBtn = $("#logoutBtn");

const adminSearch = $("#adminSearch");
const adminRegionFilt = $("#adminRegionFilter");
const adminTagFilt = $("#adminTagFilter");
const showInactive = $("#showInactive");
const adminCountEl = $("#adminCount");
const addShopBtn = $("#addShopBtn");
const shopTableBody = $("#shopTableBody");
const tableEmpty = $("#tableEmpty");
const selectAllCb = $("#selectAll");
const bulkActions = $("#bulkActions");
const bulkCountEl = $("#bulkCount");
const bulkToggleBtn = $("#bulkToggleBtn");

// Requests panel
const requestsPanel = $("#requestsPanel");
const requestsToggle = $("#requestsToggle");
const requestsBadge = $("#requestsBadge");
const requestsBody = $("#requestsBody");
const requestsList = $("#requestsList");

// Modal
const modalBackdrop = $("#modalBackdrop");
const shopModal = $("#shopModal");
const modalTitle = $("#modalTitle");
const shopForm = $("#shopForm");
const modalCloseBtn = $("#modalCloseBtn");
const modalCancelBtn = $("#modalCancelBtn");
const deleteBtn = $("#deleteBtn");
const saveBtn = $("#saveBtn");
const tagPicker = $("#tagPicker");

// Form fields
const fId = $("#fId");
const fName = $("#fName");
const fCity = $("#fCity");
const fRegion = $("#fRegion");
const fCategory = $("#fCategory");
const fSize = $("#fSize");
const fServices = $("#fServices");
const fWebsite = $("#fWebsite");
const fMapsUrl = $("#fMapsUrl");
const fIsActive = $("#fIsActive");

let shopModalFocusCleanup = null;
let shopModalReturnFocusEl = null;

// trapFocus is imported from utils.js

/* ═══════════════════════════════════════════════════════════════════════
   AUTH
═══════════════════════════════════════════════════════════════════════ */

async function checkSession() {
  const {
    data: { session },
  } = await _supabase.auth.getSession();
  if (session) {
    showDashboard(session.user);
  } else {
    authGate.classList.remove("hidden");
    adminDash.classList.add("hidden");
  }
}

loginForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  authError.textContent = "";
  const email = $("#authEmail").value.trim();
  const pass = $("#authPassword").value;
  if (!_supabase) {
    authError.textContent =
      "Database connection failed. Please check your network or disable adblockers.";
    return;
  }
  const { data, error } = await _supabase.auth.signInWithPassword({
    email,
    password: pass,
  });
  if (error) {
    authError.textContent = error.message;
    return;
  }
  showDashboard(data.user);
});

logoutBtn?.addEventListener("click", async () => {
  await _supabase.auth.signOut();
  allShops = [];
  pendingRequests = [];
  if (shopTableBody) shopTableBody.innerHTML = "";
  authGate?.classList.remove("hidden");
  adminDash?.classList.add("hidden");
});

async function showDashboard(user) {
  // Guard against concurrent calls from onAuthStateChange + checkSession
  if (_dashboardLoading) return;
  _dashboardLoading = true;

  authGate.classList.add("hidden");
  adminDash.classList.remove("hidden");
  adminEmailEl.textContent = user.email;
  populateCategoryList();
  await loadRegions();
  await Promise.all([loadShops(), loadRequests()]);
  // Measure real header/toolbar heights now that dashboard is visible
  syncLayoutHeights();

  _dashboardLoading = false;

  // Handle ?approve_id= deep-link from Discord
  await handleApproveDeepLink();
}

/**
 * If the URL contains ?approve_id=<uuid>, open the requests panel
 * and highlight the matching card so the admin can review, pick a region,
 * and click Approve manually.
 */
async function handleApproveDeepLink() {
  const params = new URLSearchParams(window.location.search);
  const approveId = params.get("approve_id");
  if (!approveId) return;

  // Clean the URL so a refresh doesn't re-trigger
  const clean = new URL(window.location.href);
  clean.searchParams.delete("approve_id");
  history.replaceState(null, "", clean);

  // Check if the request exists and is still pending
  let req = pendingRequests.find((r) => r.id === approveId);

  if (!req) {
    const { data, error } = await _supabase
      .from("directory_requests")
      .select("*")
      .eq("id", approveId)
      .single();

    if (error || !data) {
      alert("Request not found. It may have been deleted.");
      return;
    }
    const status = data.status || "pending";
    if (status !== "pending") {
      alert(`This request has already been ${status}.`);
      return;
    }

    req = data;
    const exists = pendingRequests.some((r) => r.id === approveId);
    if (!exists) {
      pendingRequests = [req, ...pendingRequests];
      renderRequestsBadge();
      renderRequestsList();
    }
  }

  // Open the requests panel
  if (!requestsPanel.classList.contains("open")) {
    requestsPanel.classList.add("open");
    requestsBody.classList.remove("hidden");
  }

  // Scroll to and highlight the matching card
  const card = requestsList.querySelector(`[data-request-id="${approveId}"]`);
  if (card) {
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    card.classList.add("requests-card--highlight");
    setTimeout(() => card.classList.remove("requests-card--highlight"), 3000);
  }
}

/** Populate the category datalist from the JS-defined CATEGORIES array */
function populateCategoryList() {
  const dl = document.getElementById("categoryList");
  if (!dl) return;
  dl.innerHTML = CATEGORIES.map((c) => `<option value="${esc(c)}">`).join("");
}

/* ═══════════════════════════════════════════════════════════════════════
   DATA LOADING
═══════════════════════════════════════════════════════════════════════ */

async function loadRegions() {
  try {
    REGIONS = await fetchRegions();
  } catch (error) {
    console.error("Critical error loading regions:", error);
    // Surface the failure so the admin knows region dropdowns may be empty
    const banner =
      document.getElementById("adminError") || document.createElement("p");
    banner.id = "adminError";
    banner.style.cssText = "color:#e74c3c;padding:.5rem 1rem;font-size:.85rem;";
    banner.textContent =
      "Warning: region list could not be loaded — region dropdowns may be empty. Check your Supabase connection.";
    adminDash?.prepend(banner);
  }

  // Populate toolbar region filter (build string, assign once)
  let regionFilterHtml = '<option value="">All Regions</option>';
  REGIONS.forEach((r) => {
    const label = r.title || r.slug;
    regionFilterHtml += `<option value="${r.slug}">${esc(label)}</option>`;
  });
  adminRegionFilt.innerHTML = regionFilterHtml;

  // Populate modal region select (build string, assign once)
  let regionSelectHtml = "";
  REGIONS.forEach((r) => {
    const label = r.title || r.slug;
    regionSelectHtml += `<option value="${r.slug}">${esc(label)}</option>`;
  });
  fRegion.innerHTML = regionSelectHtml;
}

async function loadShops() {
  try {
    allShops = await fetchShops(false); // fetch all for admin
  } catch (error) {
    console.error("Failed to load shops:", error);
    allShops = [];
  }

  // Populate tag filter dropdown with tags that exist in data (build string, assign once)
  const usedTags = new Set();
  allShops.forEach((s) => (s.tags || []).forEach((t) => usedTags.add(t)));
  const sortedTags = [...usedTags].sort();
  let tagFilterHtml = '<option value="">All Tags</option>';
  sortedTags.forEach((t) => {
    tagFilterHtml += `<option value="${esc(t)}">${esc(t)}</option>`;
  });
  adminTagFilt.innerHTML = tagFilterHtml;

  applyFilters();
}

async function loadRequests() {
  try {
    pendingRequests = await fetchRequests();
    renderRequestsBadge();
    renderRequestsList();
  } catch (err) {
    console.error("Failed to load requests:", err);
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   FILTERING
═══════════════════════════════════════════════════════════════════════ */

function applyFilters() {
  const q = adminSearch.value.trim().toLowerCase();
  const region = adminRegionFilt.value;
  const tag = adminTagFilt.value;
  const incInactive = showInactive.checked;

  filtered = allShops.filter((s) => {
    if (!incInactive && !s.is_active) return false;
    if (region && s.region !== region) return false;
    if (tag && !(s.tags || []).includes(tag)) return false;
    if (q) {
      const haystack = [
        s.name || "",
        s.city || "",
        s.category || "",
        s.services || "",
        ...(s.tags || []),
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  renderTable();
}

adminSearch?.addEventListener("input", debounce(applyFilters, 250));
adminRegionFilt?.addEventListener("change", applyFilters);
adminTagFilt?.addEventListener("change", applyFilters);
showInactive?.addEventListener("change", applyFilters);

/* ═══════════════════════════════════════════════════════════════════════
   TABLE RENDERING
═══════════════════════════════════════════════════════════════════════ */

/** Render a single shop as a <tr> string */
function renderRow(s) {
  const regionLabel =
    (REGIONS.find((r) => r.slug === s.region) || {}).title || s.region;
  const tagHtml = (s.tags || [])
    .map((t) => `<span class="tag-pill">${esc(t)}</span>`)
    .join("");
  const activeClass = s.is_active ? "" : " inactive";
  const checked = selectedIds.has(s.id) ? " checked" : "";

  return `<tr class="${activeClass}" data-id="${s.id}">
    <td class="col-select"><input type="checkbox" class="row-select" data-id="${s.id}"${checked} aria-label="Select ${esc(s.name)}"></td>
    <td class="col-status"><span class="status-dot${s.is_active ? "" : " off"}"></span></td>
    <td class="col-name">${esc(s.name)}</td>
    <td class="col-city">${esc(s.city)}</td>
    <td class="col-region">${esc(regionLabel)}</td>
    <td class="col-category">${esc(s.category)}</td>
    <td class="col-tags">${tagHtml}</td>
    <td class="col-actions">
      <button class="btn btn-outline btn-sm edit-btn" data-id="${s.id}">Edit</button>
    </td>
  </tr>`;
}

function renderTable() {
  adminCountEl.textContent = filtered.length;
  if (filtered.length === 0) {
    shopTableBody.innerHTML = "";
    tableEmpty.classList.remove("hidden");
    return;
  }
  tableEmpty.classList.add("hidden");

  const activeShops = filtered.filter((s) => s.is_active);
  const inactiveShops = filtered.filter((s) => !s.is_active);
  const COL_COUNT = 8; // must match <thead> column count

  let html = "";

  if (activeShops.length) {
    html += `<tr class="section-header"><td colspan="${COL_COUNT}"><span class="status-dot"></span> Active <span class="section-count">${activeShops.length}</span></td></tr>`;
    html += activeShops.map(renderRow).join("");
  }

  if (inactiveShops.length) {
    html += `<tr class="section-header section-inactive"><td colspan="${COL_COUNT}"><span class="status-dot off"></span> Inactive <span class="section-count">${inactiveShops.length}</span></td></tr>`;
    html += inactiveShops.map(renderRow).join("");
  }

  shopTableBody.innerHTML = html;
  syncSelectAllState();
}

// Delegate clicks on the table body (attached once, survives re-renders)
shopTableBody?.addEventListener("click", (e) => {
  const btn = e.target.closest(".edit-btn");
  if (btn) {
    openEditModal(btn.dataset.id);
    return;
  }

  // Row checkbox toggling
  const cb = e.target.closest(".row-select");
  if (cb) {
    const id = cb.dataset.id;
    if (cb.checked) {
      selectedIds.add(id);
    } else {
      selectedIds.delete(id);
    }
    syncSelectAllState();
  }
});

/* ═══════════════════════════════════════════════════════════════════════
   BULK SELECTION
═══════════════════════════════════════════════════════════════════════ */

/** Sync the Select All checkbox and bulk-action bar to current selection state */
function syncSelectAllState() {
  const rowCbs = shopTableBody.querySelectorAll(".row-select");
  const checkedCount = selectedIds.size;

  // Select-all tri-state
  if (rowCbs.length && checkedCount === rowCbs.length) {
    selectAllCb.checked = true;
    selectAllCb.indeterminate = false;
  } else if (checkedCount > 0) {
    selectAllCb.checked = false;
    selectAllCb.indeterminate = true;
  } else {
    selectAllCb.checked = false;
    selectAllCb.indeterminate = false;
  }

  // Show/hide bulk actions bar
  if (checkedCount > 0) {
    bulkActions.classList.remove("hidden");
    bulkCountEl.textContent = `${checkedCount} selected`;
  } else {
    bulkActions.classList.add("hidden");
  }
}

selectAllCb?.addEventListener("change", () => {
  const rowCbs = shopTableBody.querySelectorAll(".row-select");
  if (selectAllCb.checked) {
    rowCbs.forEach((cb) => {
      cb.checked = true;
      selectedIds.add(cb.dataset.id);
    });
  } else {
    rowCbs.forEach((cb) => {
      cb.checked = false;
      selectedIds.delete(cb.dataset.id);
    });
  }
  syncSelectAllState();
});

bulkToggleBtn?.addEventListener("click", async () => {
  if (selectedIds.size === 0) return;

  const ids = [...selectedIds];
  const label = `Toggle active status for ${ids.length} shop${ids.length > 1 ? "s" : ""}?`;
  if (!confirm(label)) return;

  bulkToggleBtn.disabled = true;
  bulkToggleBtn.textContent = "Updating…";

  // Determine new state per shop: flip each shop's current is_active
  const updates = ids.map((id) => {
    const shop = allShops.find((s) => String(s.id) === String(id));
    return { id, is_active: shop ? !shop.is_active : true };
  });

  // Batch into activate / deactivate groups for two efficient queries
  const toActivate = updates.filter((u) => u.is_active).map((u) => u.id);
  const toDeactivate = updates.filter((u) => !u.is_active).map((u) => u.id);

  let error = null;
  if (toActivate.length) {
    const res = await _supabase
      .from("fab_shops")
      .update({ is_active: true })
      .in("id", toActivate);
    if (res.error) error = res.error;
  }
  if (!error && toDeactivate.length) {
    const res = await _supabase
      .from("fab_shops")
      .update({ is_active: false })
      .in("id", toDeactivate);
    if (res.error) error = res.error;
  }

  bulkToggleBtn.disabled = false;
  bulkToggleBtn.textContent = "Toggle Active Status";

  if (error) {
    alert("Bulk update failed: " + error.message);
    return;
  }

  selectedIds.clear();
  await loadShops();
});

/* ═══════════════════════════════════════════════════════════════════════
   MODAL  - Add / Edit
═══════════════════════════════════════════════════════════════════════ */

function buildTagPicker(selectedTags = []) {
  tagPicker.innerHTML = ALL_TAGS.map((t) => {
    const sel = selectedTags.includes(t) ? " selected" : "";
    return `<span class="tag-chip${sel}" data-tag="${t}">${t}</span>`;
  }).join("");

  tagPicker.querySelectorAll(".tag-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      chip.classList.toggle("selected");
      updateLivePreview();
    });
  });
}

/** Reads the current form values and renders a live preview card */
function updateLivePreview() {
  const previewContainer = $("#liveCardPreview");
  if (!previewContainer) return;

  const shop = {
    name: fName.value.trim() || "Shop Name",
    city: fCity.value.trim() || "City",
    size: fSize.value.trim() || "",
    services: fServices.value.trim() || "Services listed here…",
    website: fWebsite.value.trim() || "",
    maps_url: fMapsUrl.value.trim() || "",
    tags: getSelectedTags(),
  };

  const tagsHtml = shop.tags
    .map((t) => `<span class="tag">${esc(t)}</span>`)
    .join(" ");

  previewContainer.innerHTML = `
    <div class="card">
      <div class="card-top"><span class="card-name">${esc(shop.name)}</span></div>
      <div class="card-city">${esc(shop.city)}</div>
      <div class="card-size">${esc(shop.size)}</div>
      <div class="card-services">${esc(shop.services)}</div>
      <div style="margin-top:.5rem;margin-bottom:1rem;">${tagsHtml}</div>
      <div class="card-website">${websiteLink(shop)}</div>
    </div>
  `;
}

function getSelectedTags() {
  return [...tagPicker.querySelectorAll(".tag-chip.selected")].map(
    (c) => c.dataset.tag,
  );
}

addShopBtn?.addEventListener("click", () => openAddModal());

function openAddModal() {
  modalTitle.textContent = "Add Shop";
  deleteBtn.classList.add("hidden");
  fId.value = "";
  fName.value = "";
  fCity.value = "";
  fRegion.value = REGIONS.length ? REGIONS[0].slug : "";
  fCategory.value = "Fabrication & Machining";
  fSize.value = "";
  fServices.value = "";
  fWebsite.value = "";
  fMapsUrl.value = "";
  fIsActive.checked = true;
  buildTagPicker([]);
  updateLivePreview();
  openModal();
}

function openEditModal(id) {
  const shop = allShops.find((s) => String(s.id) === String(id));
  if (!shop) return;

  modalTitle.textContent = "Edit Shop";
  deleteBtn.classList.remove("hidden");
  fId.value = shop.id;
  fName.value = shop.name || "";
  fCity.value = shop.city || "";
  fRegion.value = shop.region || "";
  fCategory.value = shop.category || "";
  fSize.value = shop.size || "";
  fServices.value = shop.services || "";
  fWebsite.value = shop.website || "";
  fMapsUrl.value = shop.maps_url || "";
  fIsActive.checked = shop.is_active !== false;
  buildTagPicker(shop.tags || []);
  updateLivePreview();
  openModal();
}

function openModal() {
  shopModalReturnFocusEl = document.activeElement;
  modalBackdrop.classList.remove("hidden");
  document.body.classList.add("modal-open");
  if (shopModal) {
    if (shopModalFocusCleanup) shopModalFocusCleanup();
    shopModalFocusCleanup = trapFocus(shopModal);
  }
}

function closeModal() {
  if (shopModalFocusCleanup) {
    shopModalFocusCleanup();
    shopModalFocusCleanup = null;
  }
  modalBackdrop.classList.add("hidden");
  document.body.classList.remove("modal-open");
  if (shopModalReturnFocusEl?.focus) {
    shopModalReturnFocusEl.focus();
  }
}

modalCloseBtn?.addEventListener("click", closeModal);
modalCancelBtn?.addEventListener("click", closeModal);
modalBackdrop?.addEventListener("click", (e) => {
  if (e.target === modalBackdrop) closeModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !modalBackdrop.classList.contains("hidden"))
    closeModal();
});

// Live preview updates on any form input
shopForm?.addEventListener("input", updateLivePreview);

/* ═══════════════════════════════════════════════════════════════════════
   SAVE  (INSERT or UPDATE)
═══════════════════════════════════════════════════════════════════════ */

shopForm?.addEventListener("submit", async (e) => {
  e.preventDefault();

  // Validate maps_url if provided
  const mapsUrlRaw = fMapsUrl.value.trim();
  if (mapsUrlRaw) {
    try {
      const mapsUrlObj = new URL(mapsUrlRaw);
      if (!["http:", "https:"].includes(mapsUrlObj.protocol)) {
        alert("Maps URL must start with http:// or https://");
        return;
      }
    } catch {
      alert("Maps URL is not a valid URL.");
      return;
    }
  }

  saveBtn.disabled = true;
  saveBtn.textContent = "Saving…";

  const payload = {
    name: fName.value.trim(),
    city: fCity.value.trim(),
    region: fRegion.value,
    category: fCategory.value.trim(),
    size_desc: fSize.value.trim(),
    services: fServices.value.trim(),
    website: fWebsite.value.trim(),
    maps_url: mapsUrlRaw,
    tags: getSelectedTags(),
    is_active: fIsActive.checked,
  };

  let error;
  const editId = fId.value;
  // Note: avoid logging payload here — it may contain contact/website data

  if (editId) {
    // UPDATE
    ({ error } = await _supabase
      .from("fab_shops")
      .update(payload)
      .eq("id", editId));
  } else {
    // INSERT
    ({ error } = await _supabase.from("fab_shops").insert([payload]));
  }

  saveBtn.disabled = false;
  saveBtn.textContent = "Save Shop";

  if (error) {
    let msg = error.message;
    if (
      error.code === "23505" ||
      (error.message && error.message.includes("uq_fab_shops_name_region"))
    ) {
      const action = editId ? "update" : "add";
      msg = `Cannot ${action}: a different shop named "${payload.name}" already exists in the "${payload.region}" region. Delete the duplicate first, or choose a different region.`;
    } else if (error.code === "23503") {
      msg =
        "Invalid region selected. Please ensure your regions table is seeded.";
    }
    alert("Save failed: " + msg);
    return;
  }

  closeModal();
  await loadShops();
});

/* ═══════════════════════════════════════════════════════════════════════
   DELETE
═══════════════════════════════════════════════════════════════════════ */

deleteBtn?.addEventListener("click", async () => {
  const editId = fId.value;
  if (!editId) return;
  if (!confirm("Delete this shop permanently?")) return;

  deleteBtn.disabled = true;
  deleteBtn.textContent = "Deleting…";

  const { error } = await _supabase.from("fab_shops").delete().eq("id", editId);

  deleteBtn.disabled = false;
  deleteBtn.textContent = "Delete";

  if (error) {
    alert("Delete failed: " + error.message);
    return;
  }

  closeModal();
  await loadShops();
});

/* ═══════════════════════════════════════════════════════════════════════
   REQUESTS PANEL
═══════════════════════════════════════════════════════════════════════ */

requestsToggle.addEventListener("click", () => {
  const isOpen = requestsPanel.classList.toggle("open");
  requestsBody.classList.toggle("hidden", !isOpen);
  requestsToggle.setAttribute("aria-expanded", isOpen);
});

function renderRequestsBadge() {
  const count = pendingRequests.length;
  requestsBadge.textContent = count;
  requestsBadge.classList.toggle("hidden", count === 0);
  requestsPanel.classList.toggle("hidden", count === 0);
}

function renderRequestsList() {
  if (pendingRequests.length === 0) {
    requestsList.innerHTML =
      '<p class="requests-empty">No pending requests.</p>';
    return;
  }

  requestsList.innerHTML = pendingRequests
    .map((r) => {
      const mapsInfo = parseMapsUrl(r.maps_url);
      const city = r.city || mapsInfo.city || "(Unknown City)";
      const date = new Date(r.created_at).toLocaleDateString();

      // Build region options from the live REGIONS array so new regions appear automatically
      const regionOptions = REGIONS.map((reg) => {
        const selected =
          r.region === reg.slug || (!r.region && reg.slug === "other")
            ? "selected"
            : "";
        return `<option value="${reg.slug}" ${selected}>${esc(reg.title || reg.slug)}</option>`;
      }).join("");

      return `
      <div class="requests-card" data-request-id="${r.id}">
        <div class="requests-card-header">
          <div class="requests-card-title">${esc(r.shop_name)}</div>
          <div class="requests-card-date">${date}</div>
        </div>
        <div class="requests-card-row"><strong>City:</strong> ${esc(city)}</div>
        <div class="requests-card-row"><strong>Services:</strong> ${esc(r.services || "-")}</div>
        <div class="requests-card-row"><strong>Contact:</strong> ${esc(r.contact)}</div>
        <div class="requests-card-actions">
           <div class="requests-card-assign">
             <select class="assign-region-select" aria-label="Assign Region">
               ${regionOptions}
             </select>
           </div>
           <button class="btn btn-primary btn-sm approve-req-btn" data-id="${r.id}">Approve</button>
           <button class="btn btn-outline btn-sm reject-req-btn" data-id="${r.id}">Reject</button>
        </div>
      </div>`;
    })
    .join("");
}

requestsList?.addEventListener("click", async (e) => {
  const approveId = e.target.closest(".approve-req-btn")?.dataset.id;
  const rejectId = e.target.closest(".reject-req-btn")?.dataset.id;

  if (approveId) {
    const card = e.target.closest(".requests-card");
    const region = card.querySelector(".assign-region-select").value;
    await handleRequestAction(approveId, "approve", region);
  } else if (rejectId) {
    if (confirm("Reject and delete this request?")) {
      await handleRequestAction(rejectId, "reject");
    }
  }
});

async function handleRequestAction(requestId, action, region = null) {
  const req = pendingRequests.find((r) => r.id === requestId);
  if (!req) return;

  const btn = requestsList.querySelector(
    `[data-id="${requestId}"].${action === "approve" ? "approve-req-btn" : "reject-req-btn"}`,
  );
  if (btn) btn.disabled = true;

  try {
    if (action === "approve") {
      const mapsInfo = parseMapsUrl(req.maps_url);

      const newShop = {
        name: req.shop_name,
        city: req.city || mapsInfo.city || "",
        region: region || req.region || "other",
        services: req.services || "",
        website: req.contact,
        maps_url: req.maps_url || "",
        tags: req.tags || [],
        is_active: true,
      };

      const { error: insErr } = await _supabase
        .from("fab_shops")
        .insert([newShop]);

      const isDuplicateNameRegion =
        insErr &&
        (insErr.code === "23505" ||
          (insErr.message &&
            insErr.message.includes("uq_fab_shops_name_region")));

      if (insErr && !isDuplicateNameRegion) {
        throw insErr;
      }
      if (isDuplicateNameRegion) {
        console.warn(
          `[approve] Shop "${req.shop_name}" already exists in region "${region || req.region}" — skipping insert, marking request approved.`,
        );
        // Surface a non-blocking notice in the UI
        const card = requestsList?.querySelector(
          `[data-request-id="${requestId}"]`,
        );
        if (card) {
          const notice = document.createElement("p");
          notice.style.cssText =
            "color:#f39c12;font-size:.8rem;margin:.25rem 0;";
          notice.textContent = `⚠️ Shop already exists — request marked approved but no new entry was created.`;
          card.prepend(notice);
        }
      }
    } // end if (action === "approve")

    const { error: updErr } = await _supabase
      .from("directory_requests")
      .update({ status: action === "approve" ? "approved" : "dismissed" })
      .eq("id", requestId);

    if (updErr) throw updErr;

    pendingRequests = pendingRequests.filter((r) => r.id !== requestId);
    renderRequestsBadge();
    renderRequestsList();
    if (action === "approve") await loadShops();
  } catch (err) {
    console.error(`Request ${action} failed:`, err);
    alert(`Failed to ${action} request: ` + err.message);
    if (btn) btn.disabled = false;
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   LAYOUT STICKINESS
═══════════════════════════════════════════════════════════════════════ */

function syncLayoutHeights() {
  const adminHeader = $(".admin-header");
  const toolbar = $(".toolbar");
  if (!adminHeader || !toolbar) return;

  const headerH = adminHeader.offsetHeight;
  const toolbarH = toolbar.offsetHeight;

  document.documentElement.style.setProperty("--header-h", headerH + "px");
  document.documentElement.style.setProperty("--toolbar-h", toolbarH + "px");
  document.documentElement.style.setProperty(
    "--sticky-top",
    headerH + toolbarH + "px",
  );
}

window.addEventListener("resize", syncLayoutHeights);

/* ═══════════════════════════════════════════════════════════════════════
   INIT
═══════════════════════════════════════════════════════════════════════ */

if (_supabase) {
  checkSession();

  // Listen for auth state changes
  _supabase.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_IN" && session) {
      showDashboard(session.user);
    } else if (event === "SIGNED_OUT") {
      authGate.classList.remove("hidden");
      adminDash.classList.add("hidden");
    }
  });
} else {
  // Graceful fallback for Adblockers
  if (authGate) authGate.classList.remove("hidden");
  if (adminDash) adminDash.classList.add("hidden");
  if (authError)
    authError.textContent =
      "Supabase SDK not loaded. Please disable adblockers or check connection.";
}
