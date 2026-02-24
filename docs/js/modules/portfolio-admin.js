/**
 * ═══════════════════════════════════════════════════════════════════════
 * MODULE: portfolio-admin.js — Portfolio Admin Controller (Runtime Contract)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * SCOPE:
 *   This module owns all client-side behavior for the portfolio admin tab
 *   embedded in `admin.html`: tab activation, list loading, filtering,
 *   card rendering, modal editing, asset management, upload flows,
 *   persistence, and delete operations.
 *
 * RUNTIME CONTRACT:
 *   1) Initialization and auth gate:
 *      - Static UI listeners are bound immediately via `bindStaticUI()`.
 *      - Data load is lazy: portfolio fetch waits until tab is active and
 *        a Supabase session exists (`ensurePortfolioReadyFromSession()`).
 *      - `_ready` prevents duplicate initialization.
 *
 *   2) Data/state ownership:
 *      - `allItems` stores full admin dataset from `fetchAllPortfolioItems()`.
 *      - `filtered` is derived view state from toolbar search/tag/visibility.
 *      - `currentMediaAssets` is the modal’s in-memory source of truth for
 *        multi-asset editing and payload serialization.
 *
 *   3) Rendering model:
 *      - Grid HTML is regenerated from `filtered` and injected into the
 *        portfolio container.
 *      - Card previews are driven by normalized visual assets and legacy
 *        fallback fields (`image_url`, `model_url`).
 *      - Fullscreen preview supports native Fullscreen API with CSS
 *        pseudo-fullscreen fallback.
 *
 *   4) Modal and asset editor semantics:
 *      - Add/Edit mode toggles title, delete visibility, and form defaults.
 *      - Asset editor rows are normalized via `media-assets.js` helpers;
 *        cover invariants and positions are re-established after edits.
 *      - Live preview reflects form values + current asset selection.
 *
 *   5) Upload behavior:
 *      - Image upload max: 10MB per file.
 *      - Model upload max: 25MB total for selected files.
 *      - Uploads use `uploadPortfolioAsset()` and write returned URLs back
 *        into modal state; model multi-file uploads are stored as comma-
 *        separated URL string for embed consumption.
 *
 *   6) Save behavior (`handleSave`):
 *      - Validates required title and media asset contract before write.
 *      - Merges legacy URLs/uploads into `currentMediaAssets`, then derives
 *        both modern payload (`media_assets`) and legacy columns
 *        (`image_url`, `model_url`, sizes, `cover_index`).
 *      - Resolves `sort_order` collisions by shifting conflicting rows
 *        upward before saving; reverts shifts if save fails.
 *      - Includes schema-compat retry path when newer columns are missing,
 *        retrying without size/media fields.
 *      - Supports "Apply" (save and keep modal open) and "Save & Close".
 *
 *   7) Delete behavior:
 *      - Requires explicit confirmation, deletes by item id, reloads grid.
 *
 * OPERATIONAL CAVEATS:
 *   • Sort shifting performs multiple sequential updates; concurrent admin
 *     sessions can still race on ordering.
 *   • External model mode enforces 3dviewer.net embed URL requirement.
 *   • Persistence supports mixed legacy/new schema, but migration should be
 *     completed to preserve file-size and multi-asset data.
 *
 * MAINTENANCE CHECKLIST:
 *   • New form field: wire DOM ref + openModal population + payload map +
 *     live preview representation.
 *   • Asset contract changes: update `media-assets.js` usage and any save/
 *     validation assumptions here.
 *   • New filter: extend `applyFilters()` and toolbar listeners.
 *   • Ordering rules: update collision resolution + rollback behavior as one
 *     unit to avoid partial reorder writes.
 *   • Upload constraints: keep UI copy, constants, and enforcement aligned.
 * ═══════════════════════════════════════════════════════════════════════
 */

import { supabase as _supabase } from "./supabase.js";
import {
  fetchAllPortfolioItems,
  insertPortfolioItem,
  updatePortfolioItem,
  deletePortfolioItem,
  uploadPortfolioAsset,
} from "./api.js";
import {
  esc,
  normalisePortfolioImageUrl,
  trapFocus,
  isExternalEmbedUrl,
} from "./utils.js";
import {
  MEDIA_LIMITS,
  createAssetDraft,
  normaliseMediaAssets,
  toMediaAssetsPayload,
  validateMediaAssets,
  mediaAssetsToLegacy,
  getCardVisualAssets,
} from "./media-assets.js";

// ── DOM refs ────────────────────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);

// Tab system
const adminTabs = $("#adminTabs");
const tabDirectory = $("#tabDirectory");
const tabPortfolio = $("#tabPortfolio");

// Portfolio panel
const portAdminSearch = $("#portAdminSearch");
const portTagFilter = $("#portTagFilter");
const showHidden = $("#showHidden");
const portAdminCount = $("#portAdminCount");
const addPortfolioBtn = $("#addPortfolioBtn");
const portAdminGrid = $("#portAdminGrid");
const portAdminEmpty = $("#portAdminEmpty");

// Modal
const portModalBackdrop = $("#portModalBackdrop");
const portModal = $("#portModal");
const portModalTitle = $("#portModalTitle");
const portForm = $("#portForm");
const portModalCloseBtn = $("#portModalCloseBtn");
const portModalCancelBtn = $("#portModalCancelBtn");
const portDeleteBtn = $("#portDeleteBtn");
const portApplyBtn = $("#portApplyBtn");
const portSaveBtn = $("#portSaveBtn");
const portLivePreview = $("#portLivePreview");

// Form fields
const pId = $("#pId");
const pTitle = $("#pTitle");
const pDesc = $("#pDesc");
const pTag = $("#pTag");
const pSortOrder = $("#pSortOrder");
const pImage = $("#pImage");
const pImageZone = $("#pImageZone");
const pImagePreview = $("#pImagePreview");
const pImageUrl = $("#pImageUrl");
const pModelFile = $("#pModelFile");
const pModelZone = $("#pModelZone");
const pModelPreview = $("#pModelPreview");
const pModelUrl = $("#pModelUrl");
const pFeatured = $("#pFeatured");
const pVisible = $("#pVisible");
const pExistingImageUrl = $("#pExistingImageUrl");
const pImageSizeBytes = $("#pImageSizeBytes");
const pModelSizeBytes = $("#pModelSizeBytes");
const pModelSourceHosted = $("#pModelSourceHosted");
const pModelSourceExternal = $("#pModelSourceExternal");
const pAssetList = $("#pAssetList");
const pAssetAddImageBtn = $("#pAssetAddImageBtn");
const pAssetAddGifBtn = $("#pAssetAddGifBtn");
const pAssetAddModelBtn = $("#pAssetAddModelBtn");
const pAssetSummary = $("#pAssetSummary");

// ── State ───────────────────────────────────────────────────────────────
let allItems = [];
let filtered = [];
let _ready = false;
let _adminFsBound = false;
let portModalFocusCleanup = null;
let portModalReturnFocusEl = null;
let livePreviewImageBlobUrl = null;
let currentMediaAssets = [];
let pseudoFsScrollY = 0;
let pseudoFsScrollLocked = false;

const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_MODEL_SIZE_BYTES = 25 * 1024 * 1024;

function lockPseudoFullscreenScroll() {
  if (pseudoFsScrollLocked) return;
  pseudoFsScrollY =
    window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0;

  document.documentElement.classList.add("has-pseudo-fullscreen");
  document.body.classList.add("has-pseudo-fullscreen");
  document.body.style.position = "fixed";
  document.body.style.top = `-${pseudoFsScrollY}px`;
  document.body.style.left = "0";
  document.body.style.right = "0";
  document.body.style.width = "100%";

  pseudoFsScrollLocked = true;
}

function unlockPseudoFullscreenScroll() {
  document.documentElement.classList.remove("has-pseudo-fullscreen");
  document.body.classList.remove("has-pseudo-fullscreen");

  if (!pseudoFsScrollLocked) return;

  document.body.style.position = "";
  document.body.style.top = "";
  document.body.style.left = "";
  document.body.style.right = "";
  document.body.style.width = "";

  window.scrollTo(0, pseudoFsScrollY);
  pseudoFsScrollLocked = false;
}

// trapFocus and isExternalEmbedUrl are imported from utils.js

function getModelSourceMode() {
  return pModelSourceExternal?.checked ? "external" : "hosted";
}

function updateModelSourceUI() {
  const mode = getModelSourceMode();
  const hosted = mode === "hosted";

  if (pModelZone) {
    pModelZone.classList.toggle("is-disabled", !hosted);
    pModelZone.setAttribute("aria-disabled", String(!hosted));
  }

  if (pModelFile) pModelFile.disabled = !hosted;
  if (pModelUrl) {
    pModelUrl.placeholder = hosted
      ? "-- optional: paste hosted asset URL --"
      : "-- paste a 3dviewer.net embed URL --";
  }
}

// ── HELPERS ─────────────────────────────────────────────────────────────
function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return null;
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function getNextSortOrder(editingId = null) {
  const used = new Set(
    allItems
      .filter((item) => String(item.id) !== String(editingId || ""))
      .map((item) => Number.parseInt(item.sort_order, 10))
      .filter((value) => Number.isInteger(value) && value > 0),
  );

  let candidate = 1;
  while (used.has(candidate)) {
    candidate += 1;
  }
  return candidate;
}

function looksLikeImageUrl(url) {
  if (!url) return false;
  const value = String(url).trim();
  if (!value) return false;
  if (/\.(png|jpe?g|gif|webp)(\?|#|$)/i.test(value)) return true;
  return /drive\.google\.com|lh3\.googleusercontent\.com/i.test(value);
}

function getAssetsTotalBytes(assets) {
  return (assets || []).reduce(
    (sum, asset) => sum + (Number(asset.size_bytes) || 0),
    0,
  );
}

function upsertMediaAssetFromLegacy(seed, options = {}) {
  const url = String(seed?.url || "").trim();
  if (!url) return;
  const type = seed.type || "image";
  const existingIdx = currentMediaAssets.findIndex(
    (asset) => asset.url === url && asset.type === type,
  );

  const draft = createAssetDraft(
    seed,
    existingIdx >= 0 ? existingIdx : currentMediaAssets.length,
  );
  if (existingIdx >= 0) {
    currentMediaAssets[existingIdx] = {
      ...currentMediaAssets[existingIdx],
      ...draft,
    };
  } else {
    if (!currentMediaAssets.length) draft.is_cover = true;
    currentMediaAssets.push(draft);
  }

  currentMediaAssets = normaliseMediaAssets(currentMediaAssets, "", "", {
    includeEmpty: true,
  });
  if (options.render !== false) {
    renderAssetEditor();
  }
}

function renderAssetEditor() {
  if (!pAssetList) return;

  if (!currentMediaAssets.length) {
    pAssetList.innerHTML =
      '<div class="port-asset-empty">No assets yet. Add image/GIF/3D URLs or upload files above.</div>';
  } else {
    pAssetList.innerHTML = currentMediaAssets
      .map((asset, index) => {
        return `
          <div class="port-asset-row" data-index="${index}">
            <label class="port-asset-cover-label" title="Set as cover image">
              <input class="port-asset-cover" type="radio" name="pAssetCover" ${asset.is_cover ? "checked" : ""}>
              <span>Cover</span>
            </label>
            <select class="port-asset-type" aria-label="Asset type">
              <option value="image" ${asset.type === "image" ? "selected" : ""}>Image</option>
              <option value="gif" ${asset.type === "gif" ? "selected" : ""}>GIF</option>
              <option value="model" ${asset.type === "model" ? "selected" : ""}>3D</option>
            </select>
            <input class="port-asset-url" type="url" placeholder="https://..." value="${esc(asset.url || "")}">
            <input class="port-asset-alt" type="text" placeholder="Alt text (optional)" value="${esc(asset.alt || "")}">
            <input class="port-asset-size" type="number" min="0" step="1" placeholder="Bytes" value="${asset.size_bytes || ""}">
            <button type="button" class="btn btn-danger btn-sm port-asset-remove" aria-label="Remove asset">Remove</button>
          </div>
        `;
      })
      .join("");
  }

  if (pAssetSummary) {
    const totalBytes = getAssetsTotalBytes(currentMediaAssets);
    const totalMb = (totalBytes / (1024 * 1024)).toFixed(1);
    pAssetSummary.textContent = `${currentMediaAssets.length}/${MEDIA_LIMITS.maxAssets} assets · ${totalMb} MB / 100 MB`;
  }
}

function focusAndHighlightLastAssetRow() {
  if (!pAssetList) return;
  const rows = [...pAssetList.querySelectorAll(".port-asset-row")];
  if (!rows.length) return;

  const lastRow = rows[rows.length - 1];
  lastRow.classList.add("port-asset-row--new");

  const urlInput = lastRow.querySelector(".port-asset-url");
  if (urlInput?.focus) {
    urlInput.focus();
    urlInput.select?.();
  }

  window.setTimeout(() => {
    lastRow.classList.remove("port-asset-row--new");
  }, 900);
}

function setAssetSummaryMessage(message) {
  if (!pAssetSummary || !message) return;
  const prev = pAssetSummary.textContent;
  pAssetSummary.textContent = message;
  pAssetSummary.classList.add("port-asset-summary-flash");

  window.setTimeout(() => {
    pAssetSummary.classList.remove("port-asset-summary-flash");
    const totalBytes = getAssetsTotalBytes(currentMediaAssets);
    const totalMb = (totalBytes / (1024 * 1024)).toFixed(1);
    pAssetSummary.textContent = `${currentMediaAssets.length}/${MEDIA_LIMITS.maxAssets} assets · ${totalMb} MB / 100 MB`;
  }, 800);
}

function readAssetEditorState() {
  if (!pAssetList) return [];

  const next = [...pAssetList.querySelectorAll(".port-asset-row")].map(
    (row, index) => {
      const type = row.querySelector(".port-asset-type")?.value || "image";
      const url = row.querySelector(".port-asset-url")?.value || "";
      const alt = row.querySelector(".port-asset-alt")?.value || "";
      const sizeRaw = row.querySelector(".port-asset-size")?.value || "";
      const size = Number(sizeRaw);
      const isCover = !!row.querySelector(".port-asset-cover")?.checked;

      return createAssetDraft(
        {
          type,
          url,
          alt,
          size_bytes: Number.isFinite(size) && size > 0 ? size : null,
          is_cover: isCover,
        },
        index,
      );
    },
  );

  return normaliseMediaAssets(next, "", "", { includeEmpty: true });
}

function revokeLivePreviewImageBlobUrl() {
  if (!livePreviewImageBlobUrl) return;
  try {
    URL.revokeObjectURL(livePreviewImageBlobUrl);
  } catch (_) {
    // best effort
  }
  livePreviewImageBlobUrl = null;
}

async function ensurePortfolioReadyFromSession() {
  if (_ready) return;
  try {
    const {
      data: { session },
    } = await _supabase.auth.getSession();
    if (session && tabPortfolio?.classList.contains("active")) {
      await initPortfolio();
    }
  } catch (err) {
    console.warn("Portfolio session check failed:", err);
  }
}

// ── TAB SWITCHING ───────────────────────────────────────────────────────
if (adminTabs) {
  adminTabs.addEventListener("click", (e) => {
    const btn = e.target.closest(".admin-tab");
    if (!btn) return;
    const tab = btn.dataset.tab;

    // Update button states
    adminTabs
      .querySelectorAll(".admin-tab")
      .forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");

    // Toggle panels
    if (tabDirectory)
      tabDirectory.classList.toggle("active", tab === "directory");
    if (tabPortfolio)
      tabPortfolio.classList.toggle("active", tab === "portfolio");

    // Load portfolio data on first switch
    if (tab === "portfolio" && !_ready) {
      ensurePortfolioReadyFromSession();
    }
  });
}

// ── STATIC UI WIRING ────────────────────────────────────────────────────
// Bind all DOM listeners that don't depend on fetched data.  Runs once at
// module evaluation so the modal, upload zones, and asset-editor buttons
// are always live — even if initPortfolio() hasn't resolved yet.
// ─────────────────────────────────────────────────────────────────────────
function bindStaticUI() {
  // Panel-level controls (toolbar filters, add-item, modal chrome)
  if (portAdminSearch) portAdminSearch.addEventListener("input", applyFilters);
  if (portTagFilter) portTagFilter.addEventListener("change", applyFilters);
  if (showHidden) showHidden.addEventListener("change", applyFilters);
  if (addPortfolioBtn)
    addPortfolioBtn.addEventListener("click", () => openModal());
  if (portModalCloseBtn)
    portModalCloseBtn.addEventListener("click", closeModal);
  if (portModalCancelBtn)
    portModalCancelBtn.addEventListener("click", closeModal);
  if (portDeleteBtn) portDeleteBtn.addEventListener("click", handleDelete);
  if (portApplyBtn)
    portApplyBtn.addEventListener("click", () =>
      handleSave(null, { keepOpen: true }),
    );
  if (portForm) portForm.addEventListener("submit", handleSave);

  // ── Asset editor (delegated on pAssetList container) ──
  if (pAssetList) {
    pAssetList.addEventListener("input", (e) => {
      // Auto-select the cover radio when a URL is typed into that row,
      // so the first linked URL becomes cover without needing manual selection.
      const urlInput = e.target.closest(".port-asset-url");
      if (urlInput && urlInput.value.trim()) {
        const row = urlInput.closest(".port-asset-row");
        const noCoverChecked = !pAssetList.querySelector(
          ".port-asset-cover:checked",
        );
        if (row && noCoverChecked) {
          const radio = row.querySelector(".port-asset-cover");
          if (radio) radio.checked = true;
        }
      }
      currentMediaAssets = readAssetEditorState();
      if (pAssetSummary) {
        const totalBytes = getAssetsTotalBytes(currentMediaAssets);
        const totalMb = (totalBytes / (1024 * 1024)).toFixed(1);
        pAssetSummary.textContent = `${currentMediaAssets.length}/${MEDIA_LIMITS.maxAssets} assets · ${totalMb} MB / 100 MB`;
      }
      updateLivePreview();
    });

    pAssetList.addEventListener("change", () => {
      currentMediaAssets = normaliseMediaAssets(
        readAssetEditorState(),
        "",
        "",
        {
          includeEmpty: true,
        },
      );
      renderAssetEditor();
      updateLivePreview();
    });

    pAssetList.addEventListener("click", (e) => {
      const row = e.target.closest(".port-asset-row");
      if (!row) return;

      const index = Number(row.dataset.index);
      if (!Number.isInteger(index) || index < 0) return;

      if (e.target.closest(".port-asset-remove")) {
        currentMediaAssets.splice(index, 1);
        if (
          currentMediaAssets.length &&
          !currentMediaAssets.some((asset) => asset.is_cover)
        ) {
          currentMediaAssets[0].is_cover = true;
        }
        currentMediaAssets = normaliseMediaAssets(currentMediaAssets, "", "", {
          includeEmpty: true,
        });
        renderAssetEditor();
        updateLivePreview();
      }
    });
  }

  // ── Add-asset buttons (Image / GIF / 3D) ──
  [pAssetAddImageBtn, pAssetAddGifBtn, pAssetAddModelBtn].forEach((btn) => {
    if (!btn) return;
    btn.addEventListener("click", () => {
      if (currentMediaAssets.length >= MEDIA_LIMITS.maxAssets) {
        alert(`Maximum ${MEDIA_LIMITS.maxAssets} assets per card.`);
        return;
      }

      const type =
        btn === pAssetAddGifBtn
          ? "gif"
          : btn === pAssetAddModelBtn
            ? "model"
            : "image";
      currentMediaAssets.push(
        createAssetDraft(
          { type, is_cover: currentMediaAssets.length === 0 },
          currentMediaAssets.length,
        ),
      );
      currentMediaAssets = normaliseMediaAssets(currentMediaAssets, "", "", {
        includeEmpty: true,
      });
      renderAssetEditor();
      updateLivePreview();
      focusAndHighlightLastAssetRow();
      setAssetSummaryMessage(`Added ${type.toUpperCase()} slot`);
    });
  });

  // ── Image upload zone ──
  if (pImageZone) {
    pImageZone.addEventListener("click", () => pImage?.click());
    pImageZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      pImageZone.classList.add("dragover");
    });
    pImageZone.addEventListener("dragleave", () =>
      pImageZone.classList.remove("dragover"),
    );
    pImageZone.addEventListener("drop", (e) => {
      e.preventDefault();
      pImageZone.classList.remove("dragover");
      if (e.dataTransfer.files.length > 0) {
        pImage.files = e.dataTransfer.files;
        updateImagePreview();
      }
    });
  }
  if (pImage) pImage.addEventListener("change", updateImagePreview);

  // ── Model upload zone ──
  if (pModelZone) {
    pModelZone.addEventListener("click", () => pModelFile?.click());
    pModelZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      pModelZone.classList.add("dragover");
    });
    pModelZone.addEventListener("dragleave", () =>
      pModelZone.classList.remove("dragover"),
    );
    pModelZone.addEventListener("drop", (e) => {
      e.preventDefault();
      pModelZone.classList.remove("dragover");
      if (e.dataTransfer.files.length > 0) {
        pModelFile.files = e.dataTransfer.files;
        handleModelFileSelected();
      }
    });
  }
  if (pModelFile)
    pModelFile.addEventListener("change", handleModelFileSelected);
  [pModelSourceHosted, pModelSourceExternal].forEach((el) => {
    if (el) el.addEventListener("change", updateModelSourceUI);
  });

  // ── Live preview updates ──
  [pTitle, pDesc, pTag, pModelUrl, pImageUrl].forEach((el) => {
    if (el) el.addEventListener("input", updateLivePreview);
  });
  [pFeatured, pVisible].forEach((el) => {
    if (el) el.addEventListener("change", updateLivePreview);
  });

  // ── Close modal on backdrop click ──
  if (portModalBackdrop) {
    portModalBackdrop.addEventListener("click", (e) => {
      if (e.target === portModalBackdrop) closeModal();
    });
  }

  updateModelSourceUI();

  // ── Escape to close ──
  document.addEventListener("keydown", (e) => {
    const pseudoFs = document.querySelector(
      ".port-admin-card-img.is-pseudo-fullscreen",
    );
    if (e.key === "Escape" && pseudoFs) {
      e.preventDefault();
      pseudoFs.classList.remove("is-pseudo-fullscreen");
      pseudoFs
        .closest(".port-item, .port-admin-card")
        ?.classList.remove("has-pseudo-fullscreen-wrapper");
      unlockPseudoFullscreenScroll();
      setTimeout(() => window.dispatchEvent(new Event("resize")), 50);
      return;
    }

    if (
      e.key === "Escape" &&
      document.fullscreenElement?.closest?.(".port-admin-card-img")
    ) {
      e.preventDefault();
      document.exitFullscreen?.();
      return;
    }

    if (
      e.key === "Escape" &&
      portModalBackdrop &&
      !portModalBackdrop.classList.contains("hidden")
    ) {
      closeModal();
    }
  });
}

// Run immediately at module scope — no auth or data dependency needed.
bindStaticUI();

// ── INIT (data-dependent) ───────────────────────────────────────────────
async function initPortfolio() {
  if (_ready) return;
  _ready = true;
  await loadItems();
}

// ── DATA LOADING ────────────────────────────────────────────────────────
async function loadItems() {
  try {
    allItems = await fetchAllPortfolioItems();
  } catch (err) {
    console.error("Failed to load portfolio items:", err);
    allItems = [];
  }
  applyFilters();
}

// ── FILTERING ───────────────────────────────────────────────────────────
function applyFilters() {
  const search = (portAdminSearch?.value || "").toLowerCase().trim();
  const tagFilter = portTagFilter?.value || "";
  const includeHidden = showHidden?.checked || false;

  filtered = allItems
    .filter((item) => {
      if (!includeHidden && !item.is_visible) return false;
      if (tagFilter && item.tag !== tagFilter) return false;
      if (search) {
        const haystack =
          `${item.title} ${item.description || ""} ${item.tag}`.toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    })
    .sort((a, b) => {
      const orderA = Number.parseInt(a.sort_order, 10) || 9999;
      const orderB = Number.parseInt(b.sort_order, 10) || 9999;
      return orderA - orderB;
    });

  if (portAdminCount) portAdminCount.textContent = filtered.length;
  renderGrid();
}

// ── RENDERING ───────────────────────────────────────────────────────────
function buildEmbedSrc(modelUrl) {
  if (!modelUrl) return "";
  // Already a 3dviewer.net embed — use as-is
  if (modelUrl.includes("3dviewer.net")) return modelUrl;
  // Raw file URL(s) — wrap in 3dviewer embed
  return `https://3dviewer.net/embed.html#model=${modelUrl}`;
}

function renderGrid() {
  if (!portAdminGrid) return;

  if (filtered.length === 0) {
    portAdminGrid.innerHTML = "";
    if (portAdminEmpty) portAdminEmpty.classList.remove("hidden");
    return;
  }

  if (portAdminEmpty) portAdminEmpty.classList.add("hidden");

  const liveRankById = new Map();
  filtered.forEach((item, index) => {
    liveRankById.set(String(item.id), index + 1);
  });

  portAdminGrid.innerHTML = filtered
    .map((item) => {
      const { assets, visualAssets, modelAssets } = getCardVisualAssets(item);
      const coverAsset =
        assets.find((asset) => asset.is_cover) || assets[0] || null;
      const normalisedImageUrl = normalisePortfolioImageUrl(
        coverAsset?.url || item.image_url,
      );
      const displayOrder = liveRankById.get(String(item.id)) || 0;

      return `
    <div class="port-admin-card${item.is_visible ? "" : " port-admin-card--hidden"}${item.is_featured ? " port-admin-card--featured" : ""}" data-id="${item.id}">
      <div class="port-admin-card-img">
        ${
          normalisedImageUrl
            ? `<img src="${esc(normalisedImageUrl)}" alt="${esc(item.title)}" loading="lazy">`
            : item.model_url
              ? `<iframe class="port-admin-card-preview-frame" src="${esc(buildEmbedSrc(item.model_url))}" loading="lazy" tabindex="-1"></iframe>
                 <button type="button" class="port-admin-fs-btn" aria-label="Enter fullscreen">FULL</button>`
              : `<div class="port-admin-card-placeholder">NO IMAGE</div>`
        }
        ${modelAssets.length ? '<span class="port-admin-3d-badge">3D</span>' : ""}
      </div>
      <div class="port-admin-card-body">
        <span class="port-admin-card-tag">${esc(item.tag)}</span>
        <span class="port-admin-card-title">${esc(item.title)}</span>
        <span class="port-admin-card-meta">${esc(item.description || "")}</span>
        <div class="port-admin-card-flags">
          ${item.is_featured ? '<span class="port-admin-flag port-admin-flag--feat">FEATURED</span>' : ""}
          ${!item.is_visible ? '<span class="port-admin-flag port-admin-flag--hidden">HIDDEN</span>' : ""}
          <span class="port-admin-flag port-admin-flag--order">#${displayOrder}</span>
          ${assets.length ? `<span class="port-admin-flag">ASSETS ${assets.length}</span>` : ""}
          ${visualAssets.length ? `<span class="port-admin-flag">IMG ${visualAssets.length}</span>` : ""}
          ${item.image_size_bytes ? `<span class="port-admin-flag port-admin-flag--size" title="Image file size">IMG ${formatBytes(item.image_size_bytes)}</span>` : ""}
          ${item.model_size_bytes ? `<span class="port-admin-flag port-admin-flag--size" title="3D model file size">3D ${formatBytes(item.model_size_bytes)}</span>` : ""}
        </div>
      </div>
      <div class="port-admin-card-actions">
        <button class="btn btn-outline btn-sm port-edit-btn" data-id="${item.id}">Edit</button>
      </div>
    </div>
  `;
    })
    .join("");

  // Attach edit/fullscreen listeners via delegation (bind once)
  if (!portAdminGrid.dataset.bound) {
    portAdminGrid.addEventListener("click", (e) => {
      const fsBtn = e.target.closest(".port-admin-fs-btn");
      if (fsBtn) {
        const frameWrap = fsBtn.closest(".port-admin-card-img");
        if (!frameWrap) return;

        const toggle = async () => {
          // Exit path
          if (
            document.fullscreenElement === frameWrap ||
            frameWrap.classList.contains("is-pseudo-fullscreen")
          ) {
            if (document.fullscreenElement) {
              await document.exitFullscreen?.();
            } else {
              frameWrap.classList.remove("is-pseudo-fullscreen");
              frameWrap
                .closest(".port-item, .port-admin-card")
                ?.classList.remove("has-pseudo-fullscreen-wrapper");
              unlockPseudoFullscreenScroll();
              setTimeout(() => window.dispatchEvent(new Event("resize")), 50);
            }
            return;
          }
          // Enter path — native with iOS fallback
          if (frameWrap.requestFullscreen) {
            try {
              await frameWrap.requestFullscreen();
            } catch (err) {
              // Bug 3 Fix: native threw (permission / gesture) — use CSS fallback
              frameWrap.classList.add("is-pseudo-fullscreen");
              frameWrap
                .closest(".port-item, .port-admin-card")
                ?.classList.add("has-pseudo-fullscreen-wrapper");
              lockPseudoFullscreenScroll();
              setTimeout(() => window.dispatchEvent(new Event("resize")), 50);
            }
          } else {
            // Bug 3 Fix: iOS Safari — requestFullscreen is undefined
            frameWrap.classList.add("is-pseudo-fullscreen");
            frameWrap
              .closest(".port-item, .port-admin-card")
              ?.classList.add("has-pseudo-fullscreen-wrapper");
            lockPseudoFullscreenScroll();
            setTimeout(() => window.dispatchEvent(new Event("resize")), 50);
          }
        };

        toggle();
        return;
      }

      const editBtn = e.target.closest(".port-edit-btn");
      if (editBtn) {
        const item = allItems.find((i) => i.id === editBtn.dataset.id);
        if (item) openModal(item);
      }
    });
    portAdminGrid.dataset.bound = "1";
  }

  if (!_adminFsBound) {
    document.addEventListener("fullscreenchange", () => {
      portAdminGrid.querySelectorAll(".port-admin-fs-btn").forEach((btn) => {
        const frameWrap = btn.closest(".port-admin-card-img");
        const active = document.fullscreenElement === frameWrap;
        btn.textContent = active ? "EXIT" : "FULL";
        btn.setAttribute(
          "aria-label",
          active ? "Exit fullscreen" : "Enter fullscreen",
        );
        btn.classList.toggle("is-active", active);
      });
    });
    _adminFsBound = true;
  }
}

// ── MODAL ───────────────────────────────────────────────────────────────
function openModal(item = null) {
  if (!portModalBackdrop || !portForm) return;

  portModalReturnFocusEl = document.activeElement;
  portForm.reset();
  if (pExistingImageUrl) pExistingImageUrl.value = "";

  if (item) {
    // EDIT mode
    portModalTitle.textContent = "Edit Portfolio Item";
    pId.value = item.id;
    pTitle.value = item.title || "";
    pDesc.value = item.description || "";
    pTag.value = item.tag || "RENDER";
    pSortOrder.value = item.sort_order || getNextSortOrder(item.id);
    pModelUrl.value = item.model_url || "";
    if (pModelSourceExternal && pModelSourceHosted) {
      const external = isExternalEmbedUrl(item.model_url || "");
      pModelSourceExternal.checked = external;
      pModelSourceHosted.checked = !external;
    }
    pFeatured.checked = !!item.is_featured;
    pVisible.checked = item.is_visible !== false;
    if (pExistingImageUrl) pExistingImageUrl.value = item.image_url || "";
    if (pImageUrl) pImageUrl.value = item.image_url || "";
    if (pImageSizeBytes) pImageSizeBytes.value = item.image_size_bytes || 0;
    if (pModelSizeBytes) pModelSizeBytes.value = item.model_size_bytes || 0;
    currentMediaAssets = normaliseMediaAssets(
      item.media_assets,
      item.image_url,
      item.model_url,
      { includeEmpty: true },
    );

    // Show existing image in preview
    const normalisedImageUrl = normalisePortfolioImageUrl(item.image_url);
    if (normalisedImageUrl) {
      pImagePreview.innerHTML = `<img src="${esc(normalisedImageUrl)}" alt="Current image">`;
    } else {
      pImagePreview.innerHTML =
        '<span class="port-upload-placeholder">Click or drag to upload image (Max 10MB)</span>';
    }

    // Show existing model state
    if (pModelPreview) {
      if (item.model_url) {
        const filename = item.model_url.split("/").pop().split("?")[0];
        pModelPreview.innerHTML = `<span class="port-upload-placeholder" style="color:var(--brand-orange-dim)">${esc(filename)}</span>`;
      } else {
        pModelPreview.innerHTML =
          '<span class="port-upload-placeholder">Click or drag to upload (Max 25MB): .glb / .step / .stl</span>';
      }
    }
    if (pModelFile) pModelFile.value = "";
    updateModelSourceUI();

    portDeleteBtn?.classList.remove("hidden");
  } else {
    // ADD mode
    portModalTitle.textContent = "Add Portfolio Item";
    pId.value = "";
    if (pSortOrder) pSortOrder.value = getNextSortOrder();
    pImagePreview.innerHTML =
      '<span class="port-upload-placeholder">Click or drag to upload image (Max 10MB)</span>';
    if (pModelPreview)
      pModelPreview.innerHTML =
        '<span class="port-upload-placeholder">Click or drag to upload (Max 25MB): .glb / .step / .stl</span>';
    if (pModelFile) pModelFile.value = "";
    if (pModelUrl) pModelUrl.value = "";
    if (pImageUrl) pImageUrl.value = "";
    if (pModelSourceHosted && pModelSourceExternal) {
      pModelSourceHosted.checked = true;
      pModelSourceExternal.checked = false;
    }
    currentMediaAssets = [];
    updateModelSourceUI();
    portDeleteBtn?.classList.add("hidden");
  }

  revokeLivePreviewImageBlobUrl();
  renderAssetEditor();

  updateLivePreview();
  portModalBackdrop.classList.remove("hidden");
  document.body.classList.add("modal-open");
  if (portModal) {
    if (portModalFocusCleanup) portModalFocusCleanup();
    portModalFocusCleanup = trapFocus(portModal);
  }
}

function closeModal() {
  if (portModalFocusCleanup) {
    portModalFocusCleanup();
    portModalFocusCleanup = null;
  }
  if (portModalBackdrop) portModalBackdrop.classList.add("hidden");
  document.body.classList.remove("modal-open");
  revokeLivePreviewImageBlobUrl();
  if (portModalReturnFocusEl?.focus) portModalReturnFocusEl.focus();
}

// ── IMAGE PREVIEW ────────────────────────────────────────────────────────────────────────
function updateImagePreview() {
  if (!pImage || !pImagePreview) return;
  revokeLivePreviewImageBlobUrl();
  if (pImage.files.length > 0) {
    const file = pImage.files[0];
    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      alert("Image exceeds max size (10MB).");
      pImage.value = "";
      pImagePreview.innerHTML =
        '<span class="port-upload-placeholder">Click or drag to upload image (Max 10MB)</span>';
      return;
    }
    livePreviewImageBlobUrl = URL.createObjectURL(file);
    pImagePreview.innerHTML = `<img src="${livePreviewImageBlobUrl}" alt="Preview">`;
  }

  updateLivePreview();
}

// ── MODEL UPLOAD ───────────────────────────────────────────────────────────────────────
async function handleModelFileSelected() {
  if (!pModelFile?.files?.length || !pModelPreview || !pModelUrl) return;
  if (getModelSourceMode() !== "hosted") {
    pModelFile.value = "";
    return;
  }
  const files = Array.from(pModelFile.files);
  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
  if (totalBytes > MAX_MODEL_SIZE_BYTES) {
    alert("3D upload exceeds max size (25MB total).");
    pModelFile.value = "";
    pModelPreview.innerHTML =
      '<span class="port-upload-placeholder">Click or drag to upload (Max 25MB): .glb / .step / .stl</span>';
    return;
  }

  const names = files.map((f) => f.name).join(" + ");
  pModelPreview.innerHTML = `<span class="port-upload-placeholder">UPLOADING ${esc(names)}\u2026</span>`;
  pModelZone?.classList.add("dragover");

  try {
    const urls = await Promise.all(files.map((f) => uploadPortfolioAsset(f)));
    pModelUrl.value = urls.join(",");
    if (pModelSizeBytes) pModelSizeBytes.value = totalBytes;
    upsertMediaAssetFromLegacy({
      type: "model",
      url: pModelUrl.value,
      alt: pTitle?.value || "",
      size_bytes: totalBytes,
      is_cover: !currentMediaAssets.length,
    });
    pModelPreview.innerHTML = `<span class="port-upload-placeholder" style="color:var(--brand-orange-dim)">${esc(names)}</span>`;
    updateLivePreview();
  } catch (err) {
    console.error("Model upload failed:", err);
    pModelPreview.innerHTML = `<span class="port-upload-placeholder" style="color:#c0392b">UPLOAD FAILED - ${esc(err.message)}</span>`;
  } finally {
    pModelZone?.classList.remove("dragover");
  }
}

// ── LIVE PREVIEW ────────────────────────────────────────────────────────
function updateLivePreview() {
  if (!portLivePreview) return;

  const title = pTitle?.value || "Untitled";
  const desc = pDesc?.value || "";
  const tag = pTag?.value || "RENDER";
  const hasImageFileSelected = (pImage?.files?.length || 0) > 0;
  if (hasImageFileSelected && !livePreviewImageBlobUrl) {
    console.warn(
      "Live preview image blob URL is missing while a file is selected.",
    );
  }
  const coverAsset =
    currentMediaAssets.find((asset) => asset.is_cover) ||
    currentMediaAssets[0] ||
    null;
  const imgSrc = hasImageFileSelected
    ? livePreviewImageBlobUrl || ""
    : normalisePortfolioImageUrl(
        coverAsset?.url || pImageUrl?.value || pExistingImageUrl?.value || "",
      );
  const hasModel = !!pModelUrl?.value;
  const featured = pFeatured?.checked;

  portLivePreview.innerHTML = `
    <figure class="port-item" style="margin:0;">
      <div class="port-thumb" style="aspect-ratio:4/3;overflow:hidden;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);position:relative;">
        ${imgSrc ? `<img src="${esc(imgSrc)}" alt="${esc(title)}" style="width:100%;height:100%;object-fit:cover;display:block;">` : '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);font-family:var(--font-mono);font-size:.7rem;letter-spacing:2px;">NO IMAGE</div>'}
        ${hasModel ? '<span style="position:absolute;top:6px;right:6px;background:var(--brand-orange-dim);color:#fff;font-family:var(--font-mono);font-size:.6rem;padding:2px 6px;border-radius:3px;letter-spacing:1px;">3D</span>' : ""}
      </div>
      <figcaption style="display:flex;flex-direction:column;gap:3px;margin-top:8px;">
        <span style="font-family:var(--font-mono);font-size:9px;letter-spacing:2px;color:var(--brand-orange-dim);text-transform:uppercase;">${esc(tag)}</span>
        <span style="font-family:var(--font-mono);font-size:11px;color:var(--text-main);letter-spacing:0.5px;">${esc(title)}</span>
        <span style="font-family:var(--font-body);font-size:11px;color:var(--text-muted);font-weight:300;">${esc(desc)}</span>
        ${featured ? '<span style="font-family:var(--font-mono);font-size:9px;color:var(--brand-orange-dim);letter-spacing:1px;margin-top:4px;">FEATURED ON HOMEPAGE</span>' : ""}
      </figcaption>
    </figure>
  `;
}

// ── SAVE ────────────────────────────────────────────────────────────────
async function handleSave(e, { keepOpen = false } = {}) {
  if (e) e.preventDefault();

  const title = pTitle?.value?.trim();
  if (!title) {
    pTitle?.focus();
    return;
  }

  const activeBtn = keepOpen ? portApplyBtn : portSaveBtn;
  if (activeBtn) {
    activeBtn.disabled = true;
    activeBtn.textContent = keepOpen ? "APPLYING…" : "SAVING…";
  }

  try {
    let imageUrl =
      normalisePortfolioImageUrl(
        pImageUrl?.value || pExistingImageUrl?.value || "",
      ) || null;
    let imageSizeBytes = parseInt(pImageSizeBytes?.value, 10) || null;
    const modelSource = getModelSourceMode();

    // Upload new image if selected
    if (pImage?.files?.length > 0) {
      if (pImage.files[0].size > MAX_IMAGE_SIZE_BYTES) {
        throw new Error("Image exceeds max size (10MB).");
      }
      imageSizeBytes = pImage.files[0].size;
      imageUrl = await uploadPortfolioAsset(pImage.files[0]);
    }

    let modelUrl = pModelUrl?.value?.trim() || null;
    let modelSizeBytes = parseInt(pModelSizeBytes?.value, 10) || null;

    if (!imageUrl && looksLikeImageUrl(modelUrl)) {
      imageUrl = normalisePortfolioImageUrl(modelUrl);
      modelUrl = null;
      modelSizeBytes = null;
      if (pImageUrl && !pImageUrl.value) pImageUrl.value = imageUrl || "";
    }

    if (modelSource === "external") {
      if (modelUrl && !isExternalEmbedUrl(modelUrl)) {
        throw new Error("External embed mode requires a 3dviewer.net URL.");
      }
      modelSizeBytes = null;
    }

    currentMediaAssets = readAssetEditorState();

    // ── Merge uploaded / legacy URLs into the in-memory asset list ──
    // Suppress DOM re-render (render: false) — we only need the in-memory
    // array for serialisation; the modal is about to close anyway.
    if (imageUrl) {
      const imageType = /\.gif(\?|#|$)/i.test(imageUrl) ? "gif" : "image";
      const existingImageUrl = normalisePortfolioImageUrl(
        pExistingImageUrl?.value || "",
      );

      // If the user uploaded a *new* file, replace the previous cover image
      // instead of appending a duplicate.
      if (pImage?.files?.length > 0 && existingImageUrl) {
        const oldIdx = currentMediaAssets.findIndex(
          (a) =>
            (a.type === "image" || a.type === "gif") &&
            a.url === existingImageUrl,
        );
        if (oldIdx >= 0) {
          currentMediaAssets[oldIdx] = createAssetDraft(
            {
              ...currentMediaAssets[oldIdx],
              url: imageUrl,
              type: imageType,
              size_bytes: imageSizeBytes,
              alt: title,
            },
            oldIdx,
          );
        } else {
          // Old URL not in list — append, but claim cover if none set
          upsertMediaAssetFromLegacy(
            {
              type: imageType,
              url: imageUrl,
              alt: title,
              size_bytes: imageSizeBytes,
              is_cover: !currentMediaAssets.some((a) => a.is_cover),
            },
            { render: false },
          );
        }
      } else {
        // No file upload — only inject the legacy URL when the asset editor has
        // no visual (image/gif) assets yet.  If the user already has entries in
        // the editor (even with a different URL), trust those and skip to avoid
        // appending a stale duplicate.
        const hasVisualAsset = currentMediaAssets.some(
          (a) => (a.type === "image" || a.type === "gif") && a.url,
        );
        if (!hasVisualAsset) {
          upsertMediaAssetFromLegacy(
            {
              type: imageType,
              url: imageUrl,
              alt: title,
              size_bytes: imageSizeBytes,
              is_cover: !currentMediaAssets.some((a) => a.is_cover),
            },
            { render: false },
          );
        }
      }
    }

    if (modelUrl) {
      upsertMediaAssetFromLegacy(
        {
          type: "model",
          url: modelUrl,
          alt: title,
          size_bytes: modelSizeBytes,
          is_cover: !currentMediaAssets.some((a) => a.is_cover),
        },
        { render: false },
      );
    }

    // ── Serialise from the in-memory array (single source of truth) ──
    const mediaAssetsPayload = toMediaAssetsPayload(currentMediaAssets);
    const validation = validateMediaAssets(mediaAssetsPayload);
    if (!validation.ok) {
      throw new Error(validation.errors.join("\n"));
    }

    const legacyFromAssets = mediaAssetsToLegacy(mediaAssetsPayload);

    let sortOrder = parseInt(pSortOrder?.value, 10);
    if (!Number.isInteger(sortOrder) || sortOrder <= 0) {
      sortOrder = getNextSortOrder(pId?.value || null);
      if (pSortOrder) pSortOrder.value = String(sortOrder);
    }

    const payload = {
      title,
      description: pDesc?.value?.trim() || null,
      tag: pTag?.value || "RENDER",
      sort_order: sortOrder,
      image_url: legacyFromAssets.image_url || null,
      image_size_bytes: legacyFromAssets.image_size_bytes || null,
      model_url: legacyFromAssets.model_url || null,
      model_size_bytes: legacyFromAssets.model_size_bytes || null,
      media_assets: mediaAssetsPayload,
      cover_index: legacyFromAssets.cover_index,
      is_featured: !!pFeatured?.checked,
      is_visible: pVisible?.checked !== false,
    };

    const id = pId?.value;
    const save = (p) =>
      id ? updatePortfolioItem(id, p) : insertPortfolioItem(p);
    let shiftedItems = [];
    let saveSucceeded = false;
    let savedItem = null;

    try {
      // ── START COLLISION RESOLUTION ──
      const usedOrders = new Set(
        allItems
          .filter((item) => String(item.id) !== String(id))
          .map((item) => Number.parseInt(item.sort_order, 10))
          .filter((num) => Number.isInteger(num) && num > 0),
      );

      if (usedOrders.has(sortOrder)) {
        // Update the *active* button label (Apply vs Save & Close)
        if (activeBtn) activeBtn.textContent = "SHIFTING…";

        let firstAvailableGap = sortOrder + 1;
        while (usedOrders.has(firstAvailableGap)) {
          firstAvailableGap += 1;
        }

        const itemsToShift = allItems
          .filter((item) => {
            const itemOrder = Number.parseInt(item.sort_order, 10);
            return (
              Number.isInteger(itemOrder) &&
              itemOrder >= sortOrder &&
              itemOrder < firstAvailableGap &&
              String(item.id) !== String(id)
            );
          })
          .sort(
            (a, b) =>
              Number.parseInt(b.sort_order, 10) -
              Number.parseInt(a.sort_order, 10),
          );

        shiftedItems = itemsToShift.map((item) => ({
          id: item.id,
          previousOrder: Number.parseInt(item.sort_order, 10),
        }));

        await Promise.all(
          itemsToShift.map((item) =>
            updatePortfolioItem(item.id, {
              sort_order: Number.parseInt(item.sort_order, 10) + 1,
            }),
          ),
        );
      }
      // ── END COLLISION RESOLUTION ──

      savedItem = await save(payload);
      saveSucceeded = true;
    } catch (schemaErr) {
      // If the size columns haven't been migrated yet, retry without them
      if (
        schemaErr.message?.includes("image_size_bytes") ||
        schemaErr.message?.includes("model_size_bytes") ||
        schemaErr.message?.includes("schema cache")
      ) {
        console.warn(
          "[portfolio-admin] Size / media_assets columns not found in DB schema.\n" +
            "Retrying WITHOUT image_size_bytes, model_size_bytes, media_assets, or cover_index.\n" +
            "Run the migration SQL to enable file-size tracking and multi-asset support.",
        );
        const {
          image_size_bytes,
          model_size_bytes,
          media_assets,
          cover_index,
          ...fallbackPayload
        } = payload;
        savedItem = await save(fallbackPayload);
        saveSucceeded = true;
      } else {
        throw schemaErr;
      }
    } finally {
      if (!saveSucceeded && shiftedItems.length) {
        await Promise.all(
          shiftedItems.map((item) =>
            updatePortfolioItem(item.id, { sort_order: item.previousOrder }),
          ),
        );
      }
    }

    if (keepOpen) {
      // Stay in modal — update ID (new item just got one) and mark as Edit
      if (savedItem?.id && pId) pId.value = savedItem.id;
      if (savedItem?.image_url && pExistingImageUrl)
        pExistingImageUrl.value = savedItem.image_url || "";
      portModalTitle.textContent = "Edit Portfolio Item";
      if (portDeleteBtn) portDeleteBtn.classList.remove("hidden");
      setAssetSummaryMessage("Saved ✓");
      await loadItems();
    } else {
      closeModal();
      await loadItems();
    }
  } catch (err) {
    console.error("Portfolio save error:", err);
    alert("Save failed: " + (err.message || "Unknown error"));
  } finally {
    if (portSaveBtn) {
      portSaveBtn.disabled = false;
      portSaveBtn.textContent = "Save & Close";
    }
    if (portApplyBtn) {
      portApplyBtn.disabled = false;
      portApplyBtn.textContent = "Apply";
    }
  }
}

// ── DELETE ──────────────────────────────────────────────────────────────
async function handleDelete() {
  const id = pId?.value;
  if (!id) return;
  if (!confirm("Delete this portfolio item permanently?")) return;

  portDeleteBtn.disabled = true;
  try {
    await deletePortfolioItem(id);
    closeModal();
    await loadItems();
  } catch (err) {
    console.error("Portfolio delete error:", err);
    alert("Delete failed: " + (err.message || "Unknown error"));
  } finally {
    portDeleteBtn.disabled = false;
  }
}

// ── AUTO-INIT if tab already active or user authenticated ───────────────
// Listen for auth state from admin.js
_supabase.auth.onAuthStateChange((event, session) => {
  if (session && tabPortfolio?.classList.contains("active") && !_ready) {
    initPortfolio();
  }
});

// Note: pAssetList and pAssetAdd*Btn listeners are now inside initPortfolio() above.

ensurePortfolioReadyFromSession();
