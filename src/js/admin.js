/* ═══════════════════════════════════════════════════════════════════════
   ADMIN DASHBOARD  — admin.js
   Supabase-backed CRUD for the Utah Fab Directory
   ═══════════════════════════════════════════════════════════════════════ */

// ── Supabase config ─────────────────────────────────────────────────────
const SUPABASE_URL = "https://dntcmvspcwwdwnmyqfiw.supabase.co";
const SUPABASE_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRudGNtdnNwY3d3ZHdubXlxZml3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE3MDA5MDksImV4cCI6MjA4NzI3NjkwOX0.cgiLMn6YH0BnLshl_458nGwdjnAJaN3MZz8jT4lwfkc";

if (typeof window.supabase === "undefined") {
  document.body.innerHTML =
    '<p style="color:#d63031;text-align:center;margin-top:4rem;">Supabase SDK failed to load. Check your network or script order.</p>';
  throw new Error("Supabase SDK not available");
}

const _supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

// ── All known tags (matches the existing tag vocabulary in shops.json) ──
const ALL_TAGS = [
  "3dprint",
  "aerospace",
  "cnc",
  "heattreat",
  "laser",
  "makerspace",
  "offroad",
  "ornamental",
  "powder",
  "waterjet",
  "welding",
  "plasma",
  "anodize",
  "plating",
  "assembly",
  "prototype",
  "structural",
  "sheetmetal",
];

// ── Canonical categories (single source of truth for datalist + validation) ──
const CATEGORIES = [
  "Fabrication & Machining",
  "Welding & Metalwork",
  "Specialty Automotive",
  "Specialty Automotive & Off-Road",
  "Industrial Finishing: Anodizing, Plating & Heat Treating",
  "Powder Coating & Finishing",
  "Digital Fabrication & Community Spaces",
  "Statewide / Multi-Region Fabrication",
  "Rural Hubs: Moab / Rock Crawling",
  "Rural Hubs: Uinta Basin / Carbon County / Central Utah",
  "Specialty",
  "Finishing & Community",
];

// ── Canonical regions (loaded from DB, fallback hardcoded) ─────────────
let REGIONS = [];

// ── Utah region bounding boxes (lat/lng ranges) ────────────────────────
// Slugs MUST match the `regions` table in Supabase (FK constraint on fab_shops)
const REGION_BOUNDS = [
  {
    slug: "cache-valley",
    label: "Cache Valley",
    latMin: 41.4,
    latMax: 42.05,
    lngMin: -112.5,
    lngMax: -111.5,
  },
  {
    slug: "weber-ogden",
    label: "Weber / Ogden Area",
    latMin: 40.85,
    latMax: 41.4,
    lngMin: -112.2,
    lngMax: -111.7,
  },
  {
    slug: "salt-lake",
    label: "Salt Lake Valley",
    latMin: 40.5,
    latMax: 40.85,
    lngMin: -112.15,
    lngMax: -111.7,
  },
  {
    slug: "utah-county",
    label: "Utah County",
    latMin: 39.9,
    latMax: 40.5,
    lngMin: -112.0,
    lngMax: -111.3,
  },
  {
    slug: "southern-utah",
    label: "St. George / Southern Utah",
    latMin: 37.0,
    latMax: 37.9,
    lngMin: -114.0,
    lngMax: -113.0,
  },
];

/**
 * Parse a Google Maps URL and try to extract city name + region.
 * Works with full URLs like:
 *   https://www.google.com/maps/place/Shop+Name,+City,+UT/@40.76,-111.89,17z/...
 * Short links (maps.app.goo.gl) can't be resolved client-side due to CORS.
 * Returns { city, region, label } — all empty strings if nothing could be parsed.
 */
function parseMapsUrl(url) {
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

/** Validate a region slug against the DB-loaded REGIONS array, falling back to 'other' */
function validRegion(slug) {
  if (!slug) return "other";
  if (REGIONS.length && REGIONS.some((r) => r.slug === slug)) return slug;
  // If REGIONS hasn't loaded yet, accept known hardcoded slugs
  const known = [
    "salt-lake",
    "utah-county",
    "weber-ogden",
    "cache-valley",
    "southern-utah",
    "other",
  ];
  return known.includes(slug) ? slug : "other";
}

// ── State ───────────────────────────────────────────────────────────────
let allShops = []; // full dataset from fab_shops
let filtered = []; // after search/filter applied
let selectedIds = new Set(); // bulk-selection state
let pendingRequests = []; // directory_requests with status='pending'
let _dashboardLoading = false; // guard against double init

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

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  authError.textContent = "";
  const email = $("#authEmail").value.trim();
  const pass = $("#authPassword").value;
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

logoutBtn.addEventListener("click", async () => {
  await _supabase.auth.signOut();
  allShops = [];
  pendingRequests = [];
  shopTableBody.innerHTML = "";
  authGate.classList.remove("hidden");
  adminDash.classList.add("hidden");
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
  const clean = new URL(window.location);
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
  const { data, error } = await _supabase
    .from("regions")
    .select("*")
    .order("sort_order");

  if (!error && data && data.length > 0) {
    REGIONS = data;
  } else {
    // Fallback
    REGIONS = [
      { slug: "salt-lake", title: "Salt Lake Valley" },
      { slug: "utah-county", title: "Utah County" },
      { slug: "weber-ogden", title: "Weber / Ogden Area" },
      { slug: "cache-valley", title: "Cache Valley" },
      { slug: "southern-utah", title: "St. George / Southern Utah" },
      { slug: "other", title: "Other: Statewide, Rural & Specialty" },
    ];
  }

  // Populate toolbar region filter (build string, assign once)
  let regionFilterHtml = '<option value="">All Regions</option>';
  REGIONS.forEach((r) => {
    const label = r.title || r.name || r.slug;
    regionFilterHtml += `<option value="${r.slug}">${esc(label)}</option>`;
  });
  adminRegionFilt.innerHTML = regionFilterHtml;

  // Populate modal region select (build string, assign once)
  let regionSelectHtml = "";
  REGIONS.forEach((r) => {
    const label = r.title || r.name || r.slug;
    regionSelectHtml += `<option value="${r.slug}">${esc(label)}</option>`;
  });
  fRegion.innerHTML = regionSelectHtml;
}

async function loadShops() {
  // Authenticated users can see all shops (including inactive) via RLS
  const { data, error } = await _supabase
    .from("fab_shops")
    .select("*")
    .order("region")
    .order("sort_order")
    .order("name");

  if (error) {
    console.error("Failed to load shops:", error);
    allShops = [];
  } else {
    allShops = data || [];
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

adminSearch.addEventListener("input", applyFilters);
adminRegionFilt.addEventListener("change", applyFilters);
adminTagFilt.addEventListener("change", applyFilters);
showInactive.addEventListener("change", applyFilters);

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
shopTableBody.addEventListener("click", (e) => {
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

selectAllCb.addEventListener("change", () => {
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

bulkToggleBtn.addEventListener("click", async () => {
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

function esc(str) {
  if (!str) return "";
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

/* ═══════════════════════════════════════════════════════════════════════
   MODAL  — Add / Edit
═══════════════════════════════════════════════════════════════════════ */

function buildTagPicker(selectedTags = []) {
  tagPicker.innerHTML = ALL_TAGS.map((t) => {
    const sel = selectedTags.includes(t) ? " selected" : "";
    return `<span class="tag-chip${sel}" data-tag="${t}">${t}</span>`;
  }).join("");

  tagPicker.querySelectorAll(".tag-chip").forEach((chip) => {
    chip.addEventListener("click", () => chip.classList.toggle("selected"));
  });
}

function getSelectedTags() {
  return [...tagPicker.querySelectorAll(".tag-chip.selected")].map(
    (c) => c.dataset.tag,
  );
}

addShopBtn.addEventListener("click", () => openAddModal());

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
  fSize.value = shop.size_desc || "";
  fServices.value = shop.services || "";
  fWebsite.value = shop.website || "";
  fMapsUrl.value = shop.maps_url || "";
  fIsActive.checked = shop.is_active !== false;
  buildTagPicker(shop.tags || []);
  openModal();
}

function openModal() {
  modalBackdrop.classList.remove("hidden");
  document.body.classList.add("modal-open");
}

function closeModal() {
  modalBackdrop.classList.add("hidden");
  document.body.classList.remove("modal-open");
}

modalCloseBtn.addEventListener("click", closeModal);
modalCancelBtn.addEventListener("click", closeModal);
modalBackdrop.addEventListener("click", (e) => {
  if (e.target === modalBackdrop) closeModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !modalBackdrop.classList.contains("hidden"))
    closeModal();
});

/* ═══════════════════════════════════════════════════════════════════════
   SAVE  (INSERT or UPDATE)
═══════════════════════════════════════════════════════════════════════ */

shopForm.addEventListener("submit", async (e) => {
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
    if (error.code === "23503") {
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

deleteBtn.addEventListener("click", async () => {
  const editId = fId.value;
  if (!editId) return;
  if (!confirm("Delete this shop permanently?")) return;

  const DELETE_LABEL = "Delete";

  deleteBtn.disabled = true;
  deleteBtn.textContent = "Deleting…";

  const { error } = await _supabase.from("fab_shops").delete().eq("id", editId);

  deleteBtn.disabled = false;
  deleteBtn.textContent = DELETE_LABEL;

  if (error) {
    alert("Delete failed: " + error.message);
    return;
  }

  closeModal();
  await loadShops();
});

/* ═══════════════════════════════════════════════════════════════════════
   INIT — Reactive auth + layout measurement
═════════════════════════════════════════════════════════════════════ */

/** Measure real header height and set toolbar top + table-scroll max-height dynamically */
function syncLayoutHeights() {
  const header = document.querySelector(".admin-header");
  const toolbar = document.querySelector(".toolbar");
  const tableScroll = document.querySelector(".table-scroll");
  if (!header || !toolbar) return;

  const headerH = header.offsetHeight;
  const toolbarH = toolbar.offsetHeight;
  toolbar.style.top = headerH + "px";
  if (tableScroll) {
    tableScroll.style.maxHeight = `calc(100vh - ${headerH + toolbarH}px)`;
    tableScroll.style.maxHeight = `calc(100dvh - ${headerH + toolbarH}px)`;
  }
}

// Listen for auth state changes reactively
_supabase.auth.onAuthStateChange((event, session) => {
  if (event === "SIGNED_OUT" || !session) {
    allShops = [];
    pendingRequests = [];
    shopTableBody.innerHTML = "";
    authGate.classList.remove("hidden");
    adminDash.classList.add("hidden");
    _dashboardLoading = false;
  } else if (session) {
    showDashboard(session.user);
  }
});

// Also check on load (handles page refresh with existing session)
checkSession();

// Sync layout heights after dashboard renders and on resize
window.addEventListener("resize", syncLayoutHeights);

/* ═══════════════════════════════════════════════════════════════════════
   DIRECTORY REQUESTS  — Load, Render, Approve, Dismiss
═══════════════════════════════════════════════════════════════════════ */

async function loadRequests() {
  const { data, error } = await _supabase
    .from("directory_requests")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Failed to load requests:", error);
    pendingRequests = [];
  } else {
    pendingRequests = data || [];
  }

  renderRequests();
}

/** Build a <select> dropdown for region, pre-selected to detectedSlug */
function regionSelectHtml(requestId, detectedSlug) {
  const fallback = [
    { slug: 'salt-lake',     title: 'Salt Lake Valley' },
    { slug: 'utah-county',   title: 'Utah County' },
    { slug: 'weber-ogden',   title: 'Weber / Ogden Area' },
    { slug: 'cache-valley',  title: 'Cache Valley' },
    { slug: 'southern-utah', title: 'St. George / Southern Utah' },
    { slug: 'other',         title: 'Other / Statewide' },
  ];
  const list = REGIONS.length ? REGIONS : fallback;
  const safe = validRegion(detectedSlug);
  const opts = list.map(r =>
    `<option value="${esc(r.slug)}"${r.slug === safe ? ' selected' : ''}>${esc(r.title || r.slug)}</option>`
  ).join('');
  return `<select class="requests-region-select" data-request-id="${requestId}">${opts}</select>`;
}

function renderRequests() {
  const count = pendingRequests.length;
  requestsBadge.textContent = count;

  if (count === 0) {
    requestsPanel.classList.add("hidden");
    return;
  }

  requestsPanel.classList.remove("hidden");

  requestsList.innerHTML = pendingRequests
    .map((r) => {
      const date = new Date(r.created_at).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
      const mapsLink = r.maps_url
        ? `<a href="${esc(r.maps_url)}" target="_blank" rel="noopener noreferrer">Maps ↗</a>`
        : "";
      const loc = parseMapsUrl(r.maps_url);
      const regionDropdown = regionSelectHtml(r.id, loc.region);
      const cityTag = loc.city ? `<span class="requests-card-city">${esc(loc.city)}</span>` : '';
      return `<div class="requests-card" data-request-id="${r.id}">
      <div class="requests-card-info">
        <div class="requests-card-name">${esc(r.shop_name)} ${cityTag}</div>
        <div class="requests-card-meta">${esc(r.contact)} · ${date} ${mapsLink}</div>
        <div class="requests-card-region-row">Region: ${regionDropdown}</div>
        ${r.services ? `<div class="requests-card-services">${esc(r.services)}</div>` : ""}
      </div>
      <div class="requests-card-actions">
        <label class="toggle-active-label" title="Activate shop immediately upon approval">
          <input type="checkbox" class="toggle-active-cb" data-id="${r.id}">
          <span class="toggle-active-slider"></span>
          <span class="toggle-active-text">Set Active</span>
        </label>
        <button class="btn btn-primary btn-sm approve-req-btn" data-id="${r.id}">Approve</button>
        <button class="btn btn-outline btn-sm dismiss-req-btn" data-id="${r.id}">Dismiss</button>
      </div>
    </div>`;
    })
    .join("");
}

// Toggle requests panel open/closed
requestsToggle.addEventListener("click", () => {
  requestsPanel.classList.toggle("open");
  requestsBody.classList.toggle("hidden");
});

// Delegate clicks inside requests list
requestsList.addEventListener("click", async (e) => {
  const approveBtn = e.target.closest(".approve-req-btn");
  const dismissBtn = e.target.closest(".dismiss-req-btn");

  if (approveBtn) {
    const id = approveBtn.dataset.id;
    const req = pendingRequests.find((r) => r.id === id);
    if (!req) return;

    approveBtn.disabled = true;
    approveBtn.textContent = "Approving…";

    // Read region from the dropdown the admin may have edited
    const regionSelect = requestsList.querySelector(`select[data-request-id="${id}"]`);
    const chosenRegion = regionSelect ? regionSelect.value : validRegion(parseMapsUrl(req.maps_url).region);
    const mapsInfo = parseMapsUrl(req.maps_url);

    // Read visibility toggle
    const activeCb = requestsList.querySelector(`.toggle-active-cb[data-id="${id}"]`);
    const setActive = activeCb ? activeCb.checked : false;

    // Insert into fab_shops
    const shopPayload = {
      name: req.shop_name,
      city: mapsInfo.city,
      region: chosenRegion,
      services: req.services || "",
      website: req.contact || "",
      maps_url: req.maps_url || "",
      category: "Fabrication & Machining",
      tags: [],
      is_active: setActive,
    };

    const { error: insertErr } = await _supabase
      .from("fab_shops")
      .insert([shopPayload]);
    if (insertErr) {
      // Handle duplicate name+region constraint
      if (
        insertErr.code === "23505" ||
        insertErr.message.includes("uq_fab_shops_name_region")
      ) {
        if (
          !confirm(
            `A shop named "${req.shop_name}" already exists in this region. Mark this request as approved anyway?`,
          )
        ) {
          approveBtn.disabled = false;
          approveBtn.textContent = "Approve";
          return;
        }
        // Skip insert — just mark as approved below
      } else {
        alert("Failed to create shop: " + insertErr.message);
        approveBtn.disabled = false;
        approveBtn.textContent = "Approve";
        return;
      }
    }

    // Mark request as approved
    const { error: updateErr } = await _supabase
      .from("directory_requests")
      .update({ status: "approved" })
      .eq("id", id);

    if (updateErr) console.error("Failed to update request status:", updateErr);

    // Refresh both panels
    await Promise.all([loadShops(), loadRequests()]);
    return;
  }

  if (dismissBtn) {
    const id = dismissBtn.dataset.id;
    if (!confirm("Dismiss this listing request?")) return;

    dismissBtn.disabled = true;
    dismissBtn.textContent = "Dismissing…";

    const { error } = await _supabase
      .from("directory_requests")
      .update({ status: "dismissed" })
      .eq("id", id);

    if (error) {
      alert("Dismiss failed: " + error.message);
      dismissBtn.disabled = false;
      dismissBtn.textContent = "Dismiss";
      return;
    }

    await loadRequests();
  }
});
