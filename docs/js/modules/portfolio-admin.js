/**
 * ═══════════════════════════════════════════════════════════════════════
 * MODULE: portfolio-admin.js - Portfolio Dashboard Controller
 * ═══════════════════════════════════════════════════════════════════════
 *
 * PURPOSE:
 *   Full CRUD admin interface for managing Portfolio items shown on the
 *   public portfolio page and homepage featured section.  Runs inside
 *   the admin dashboard alongside admin.js (directory management).
 *
 * ARCHITECTURE:
 *   • Shares the Supabase client from supabase.js and API functions
 *     from api.js.
 *   • Manages its own tab panel (#tabPortfolio) and modal
 *     (#portModalBackdrop).
 *   • Renders a responsive card grid of portfolio items with inline
 *     image previews.
 *   • Image uploads go to the "portfolio-assets" Supabase Storage
 *     bucket via api.js helpers.
 *   • Waits for auth state before initializing (listens for a custom
 *     "admin-ready" event dispatched by admin.js, or checks session).
 *
 * FEATURES:
 *   • Add / Edit / Delete portfolio items
 *   • Upload PNG/JPG/WebP images
 *   • Set featured flag (homepage), visibility, sort order, tags
 *   • Optional 3D model URL for Online3DViewer embed
 *   • Tab switching between Directory and Portfolio
 *   • Search and tag filter
 *   • Live preview in modal
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
import { esc, normalisePortfolioImageUrl } from "./utils.js";

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

// ── State ───────────────────────────────────────────────────────────────
let allItems = [];
let filtered = [];
let _ready = false;
let _adminFsBound = false;
let portModalFocusCleanup = null;
let portModalReturnFocusEl = null;
let livePreviewImageBlobUrl = null;

const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_MODEL_SIZE_BYTES = 25 * 1024 * 1024;

function trapFocus(container) {
  if (!container) return () => {};

  const getFocusable = () =>
    [...container.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
      .filter((el) => !el.disabled && el.offsetParent !== null);

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

function isExternalEmbedUrl(url) {
  return /3dviewer\.net/i.test(url || "");
}

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
    adminTabs.querySelectorAll(".admin-tab").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");

    // Toggle panels
    if (tabDirectory) tabDirectory.classList.toggle("active", tab === "directory");
    if (tabPortfolio) tabPortfolio.classList.toggle("active", tab === "portfolio");

    // Load portfolio data on first switch
    if (tab === "portfolio" && !_ready) {
      ensurePortfolioReadyFromSession();
    }
  });
}

// ── INIT ────────────────────────────────────────────────────────────────
async function initPortfolio() {
  if (_ready) return;
  _ready = true;
  await loadItems();

  // Attach event listeners
  if (portAdminSearch) portAdminSearch.addEventListener("input", applyFilters);
  if (portTagFilter) portTagFilter.addEventListener("change", applyFilters);
  if (showHidden) showHidden.addEventListener("change", applyFilters);
  if (addPortfolioBtn) addPortfolioBtn.addEventListener("click", () => openModal());
  if (portModalCloseBtn) portModalCloseBtn.addEventListener("click", closeModal);
  if (portModalCancelBtn) portModalCancelBtn.addEventListener("click", closeModal);
  if (portDeleteBtn) portDeleteBtn.addEventListener("click", handleDelete);
  if (portForm) portForm.addEventListener("submit", handleSave);

  // Image upload zone
  if (pImageZone) {
    pImageZone.addEventListener("click", () => pImage?.click());
    pImageZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      pImageZone.classList.add("dragover");
    });
    pImageZone.addEventListener("dragleave", () => pImageZone.classList.remove("dragover"));
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

  // Model upload zone
  if (pModelZone) {
    pModelZone.addEventListener("click", () => pModelFile?.click());
    pModelZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      pModelZone.classList.add("dragover");
    });
    pModelZone.addEventListener("dragleave", () => pModelZone.classList.remove("dragover"));
    pModelZone.addEventListener("drop", (e) => {
      e.preventDefault();
      pModelZone.classList.remove("dragover");
      if (e.dataTransfer.files.length > 0) {
        pModelFile.files = e.dataTransfer.files;
        handleModelFileSelected();
      }
    });
  }
  if (pModelFile) pModelFile.addEventListener("change", handleModelFileSelected);
  [pModelSourceHosted, pModelSourceExternal].forEach((el) => {
    if (el) el.addEventListener("change", updateModelSourceUI);
  });

  // Live preview updates
  [pTitle, pDesc, pTag, pModelUrl, pImageUrl].forEach((el) => {
    if (el) el.addEventListener("input", updateLivePreview);
  });
  [pFeatured, pVisible].forEach((el) => {
    if (el) el.addEventListener("change", updateLivePreview);
  });

  // Close modal on backdrop click
  if (portModalBackdrop) {
    portModalBackdrop.addEventListener("click", (e) => {
      if (e.target === portModalBackdrop) closeModal();
    });
  }

  updateModelSourceUI();

  // Escape to close
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && document.fullscreenElement?.closest?.(".port-admin-card-img")) {
      e.preventDefault();
      document.exitFullscreen?.();
      return;
    }

    if (e.key === "Escape" && portModalBackdrop && !portModalBackdrop.classList.contains("hidden")) {
      closeModal();
    }
  });
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

  filtered = allItems.filter((item) => {
    if (!includeHidden && !item.is_visible) return false;
    if (tagFilter && item.tag !== tagFilter) return false;
    if (search) {
      const haystack = `${item.title} ${item.description || ""} ${item.tag}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  }).sort((a, b) => {
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
    .map(
      (item) => {
        const normalisedImageUrl = normalisePortfolioImageUrl(item.image_url);
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
        ${item.model_url ? '<span class="port-admin-3d-badge">3D</span>' : ""}
      </div>
      <div class="port-admin-card-body">
        <span class="port-admin-card-tag">${esc(item.tag)}</span>
        <span class="port-admin-card-title">${esc(item.title)}</span>
        <span class="port-admin-card-meta">${esc(item.description || "")}</span>
        <div class="port-admin-card-flags">
          ${item.is_featured ? '<span class="port-admin-flag port-admin-flag--feat">FEATURED</span>' : ""}
          ${!item.is_visible ? '<span class="port-admin-flag port-admin-flag--hidden">HIDDEN</span>' : ""}
          <span class="port-admin-flag port-admin-flag--order">#${displayOrder}</span>
          ${item.image_size_bytes ? `<span class="port-admin-flag port-admin-flag--size" title="Image file size">IMG ${formatBytes(item.image_size_bytes)}</span>` : ""}
          ${item.model_size_bytes ? `<span class="port-admin-flag port-admin-flag--size" title="3D model file size">3D ${formatBytes(item.model_size_bytes)}</span>` : ""}
        </div>
      </div>
      <div class="port-admin-card-actions">
        <button class="btn btn-outline btn-sm port-edit-btn" data-id="${item.id}">Edit</button>
      </div>
    </div>
  `;
      }
    )
    .join("");

  // Attach edit/fullscreen listeners via delegation (bind once)
  if (!portAdminGrid.dataset.bound) {
    portAdminGrid.addEventListener("click", (e) => {
    const fsBtn = e.target.closest(".port-admin-fs-btn");
    if (fsBtn) {
      const frameWrap = fsBtn.closest(".port-admin-card-img");
      if (!frameWrap) return;

      const toggle = async () => {
        try {
          if (document.fullscreenElement === frameWrap) {
            await document.exitFullscreen?.();
          } else {
            await frameWrap.requestFullscreen?.();
          }
        } catch (err) {
          console.warn("Admin preview fullscreen failed:", err);
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
        btn.setAttribute("aria-label", active ? "Exit fullscreen" : "Enter fullscreen");
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
  pExistingImageUrl.value = "";

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
    pExistingImageUrl.value = item.image_url || "";
    if (pImageUrl) pImageUrl.value = item.image_url || "";
    if (pImageSizeBytes) pImageSizeBytes.value = item.image_size_bytes || 0;
    if (pModelSizeBytes) pModelSizeBytes.value = item.model_size_bytes || 0;

    // Show existing image in preview
    const normalisedImageUrl = normalisePortfolioImageUrl(item.image_url);
    if (normalisedImageUrl) {
      pImagePreview.innerHTML = `<img src="${esc(normalisedImageUrl)}" alt="Current image">`;
    } else {
      pImagePreview.innerHTML = '<span class="port-upload-placeholder">Click or drag to upload image (Max 10MB)</span>';
    }

    // Show existing model state
    if (pModelPreview) {
      if (item.model_url) {
        const filename = item.model_url.split("/").pop().split("?")[0];
        pModelPreview.innerHTML = `<span class="port-upload-placeholder" style="color:var(--brand-orange-dim)">${esc(filename)}</span>`;
      } else {
        pModelPreview.innerHTML = '<span class="port-upload-placeholder">Click or drag to upload (Max 25MB): .glb / .step / .stl</span>';
      }
    }
    if (pModelFile) pModelFile.value = "";
    updateModelSourceUI();

    portDeleteBtn.classList.remove("hidden");
  } else {
    // ADD mode
    portModalTitle.textContent = "Add Portfolio Item";
    pId.value = "";
    if (pSortOrder) pSortOrder.value = getNextSortOrder();
    pImagePreview.innerHTML = '<span class="port-upload-placeholder">Click or drag to upload image (Max 10MB)</span>';
    if (pModelPreview) pModelPreview.innerHTML = '<span class="port-upload-placeholder">Click or drag to upload (Max 25MB): .glb / .step / .stl</span>';
    if (pModelFile) pModelFile.value = "";
    if (pModelUrl) pModelUrl.value = "";
    if (pImageUrl) pImageUrl.value = "";
    if (pModelSourceHosted && pModelSourceExternal) {
      pModelSourceHosted.checked = true;
      pModelSourceExternal.checked = false;
    }
    updateModelSourceUI();
    portDeleteBtn.classList.add("hidden");
  }

  revokeLivePreviewImageBlobUrl();

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
      pImagePreview.innerHTML = '<span class="port-upload-placeholder">Click or drag to upload image (Max 10MB)</span>';
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
    pModelPreview.innerHTML = '<span class="port-upload-placeholder">Click or drag to upload (Max 25MB): .glb / .step / .stl</span>';
    return;
  }

  const names = files.map((f) => f.name).join(" + ");
  pModelPreview.innerHTML = `<span class="port-upload-placeholder">UPLOADING ${esc(names)}\u2026</span>`;
  pModelZone?.classList.add("dragover");

  try {
    const urls = await Promise.all(files.map((f) => uploadPortfolioAsset(f)));
    pModelUrl.value = urls.join(",");
    if (pModelSizeBytes) pModelSizeBytes.value = totalBytes;
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
  const imgSrc =
    pImage?.files?.length > 0
      ? livePreviewImageBlobUrl || ""
      : normalisePortfolioImageUrl(pImageUrl?.value || pExistingImageUrl?.value || "");
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
async function handleSave(e) {
  e.preventDefault();

  const title = pTitle?.value?.trim();
  if (!title) return;

  portSaveBtn.disabled = true;
  portSaveBtn.textContent = "SAVING…";

  try {
    let imageUrl = normalisePortfolioImageUrl(
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
      image_url: imageUrl,
      image_size_bytes: imageSizeBytes || null,
      model_url: modelUrl,
      model_size_bytes: modelSizeBytes || null,
      is_featured: !!pFeatured?.checked,
      is_visible: pVisible?.checked !== false,
    };

    const id = pId?.value;
    const save = (p) => id ? updatePortfolioItem(id, p) : insertPortfolioItem(p);
    let shiftedItems = [];

    try {
      // ── START COLLISION RESOLUTION ──
      const usedOrders = new Set(
        allItems
          .filter((item) => String(item.id) !== String(id))
          .map((item) => Number.parseInt(item.sort_order, 10))
          .filter((num) => Number.isInteger(num) && num > 0),
      );

      if (usedOrders.has(sortOrder)) {
        portSaveBtn.textContent = "SHIFTING…";

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
          .sort((a, b) => Number.parseInt(b.sort_order, 10) - Number.parseInt(a.sort_order, 10));

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

      await save(payload);
    } catch (schemaErr) {
      // If the size columns haven't been migrated yet, retry without them
      if (schemaErr.message?.includes("image_size_bytes") || schemaErr.message?.includes("model_size_bytes") || schemaErr.message?.includes("schema cache")) {
        console.warn("Size columns not found in DB — retrying without them. Run the migration SQL to enable file size tracking.");
        const { image_size_bytes, model_size_bytes, ...fallbackPayload } = payload;
        await save(fallbackPayload);
      } else {
        if (shiftedItems.length) {
          await Promise.all(
            shiftedItems.map((item) =>
              updatePortfolioItem(item.id, { sort_order: item.previousOrder }),
            ),
          );
        }
        throw schemaErr;
      }
    }

    closeModal();
    await loadItems();
  } catch (err) {
    console.error("Portfolio save error:", err);
    alert("Save failed: " + (err.message || "Unknown error"));
  } finally {
    portSaveBtn.disabled = false;
    portSaveBtn.textContent = "Save Item";
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

ensurePortfolioReadyFromSession();
