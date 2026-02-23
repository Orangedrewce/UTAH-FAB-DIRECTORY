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
const pModelFile = $("#pModelFile");
const pModelZone = $("#pModelZone");
const pModelPreview = $("#pModelPreview");
const pModelUrl = $("#pModelUrl");
const pFeatured = $("#pFeatured");
const pVisible = $("#pVisible");
const pExistingImageUrl = $("#pExistingImageUrl");

// ── State ───────────────────────────────────────────────────────────────
let allItems = [];
let filtered = [];
let _ready = false;

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
      initPortfolio();
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

  // Live preview updates
  [pTitle, pDesc, pTag, pModelUrl].forEach((el) => {
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

  // Escape to close
  document.addEventListener("keydown", (e) => {
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

function esc(str) {
  const d = document.createElement("div");
  d.textContent = str || "";
  return d.innerHTML;
}

function renderGrid() {
  if (!portAdminGrid) return;

  if (filtered.length === 0) {
    portAdminGrid.innerHTML = "";
    if (portAdminEmpty) portAdminEmpty.classList.remove("hidden");
    return;
  }

  if (portAdminEmpty) portAdminEmpty.classList.add("hidden");

  portAdminGrid.innerHTML = filtered
    .map(
      (item) => `
    <div class="port-admin-card${item.is_visible ? "" : " port-admin-card--hidden"}${item.is_featured ? " port-admin-card--featured" : ""}" data-id="${item.id}">
      <div class="port-admin-card-img">
        ${
          item.image_url
            ? `<img src="${esc(item.image_url)}" alt="${esc(item.title)}" loading="lazy">`
            : item.model_url
              ? `<iframe class="port-admin-card-preview-frame" src="${esc(buildEmbedSrc(item.model_url))}" loading="lazy" tabindex="-1"></iframe>`
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
          <span class="port-admin-flag port-admin-flag--order">#${item.sort_order}</span>
        </div>
      </div>
      <div class="port-admin-card-actions">
        <button class="btn btn-outline btn-sm port-edit-btn" data-id="${item.id}">Edit</button>
      </div>
    </div>
  `
    )
    .join("");

  // Attach edit listeners via delegation
  portAdminGrid.addEventListener("click", (e) => {
    const editBtn = e.target.closest(".port-edit-btn");
    if (editBtn) {
      const item = allItems.find((i) => i.id === editBtn.dataset.id);
      if (item) openModal(item);
    }
  });
}

// ── MODAL ───────────────────────────────────────────────────────────────
function openModal(item = null) {
  if (!portModalBackdrop || !portForm) return;

  portForm.reset();
  pExistingImageUrl.value = "";

  if (item) {
    // EDIT mode
    portModalTitle.textContent = "Edit Portfolio Item";
    pId.value = item.id;
    pTitle.value = item.title || "";
    pDesc.value = item.description || "";
    pTag.value = item.tag || "RENDER";
    pSortOrder.value = item.sort_order || 0;
    pModelUrl.value = item.model_url || "";
    pFeatured.checked = !!item.is_featured;
    pVisible.checked = item.is_visible !== false;
    pExistingImageUrl.value = item.image_url || "";

    // Show existing image in preview
    if (item.image_url) {
      pImagePreview.innerHTML = `<img src="${esc(item.image_url)}" alt="Current image">`;
    } else {
      pImagePreview.innerHTML = '<span class="port-upload-placeholder">Click or drag to upload image</span>';
    }

    // Show existing model state
    if (pModelPreview) {
      if (item.model_url) {
        const filename = item.model_url.split("/").pop().split("?")[0];
        pModelPreview.innerHTML = `<span class="port-upload-placeholder" style="color:var(--brand-orange-dim)">${esc(filename)}</span>`;
      } else {
        pModelPreview.innerHTML = '<span class="port-upload-placeholder">Click or drag to upload .glb / .step / .stl</span>';
      }
    }
    if (pModelFile) pModelFile.value = "";

    portDeleteBtn.classList.remove("hidden");
  } else {
    // ADD mode
    portModalTitle.textContent = "Add Portfolio Item";
    pId.value = "";
    pImagePreview.innerHTML = '<span class="port-upload-placeholder">Click or drag to upload image</span>';
    if (pModelPreview) pModelPreview.innerHTML = '<span class="port-upload-placeholder">Click or drag to upload .glb / .step / .stl</span>';
    if (pModelFile) pModelFile.value = "";
    if (pModelUrl) pModelUrl.value = "";
    portDeleteBtn.classList.add("hidden");
  }

  updateLivePreview();
  portModalBackdrop.classList.remove("hidden");
  document.body.classList.add("modal-open");
}

function closeModal() {
  if (portModalBackdrop) portModalBackdrop.classList.add("hidden");
  document.body.classList.remove("modal-open");
}

// ── IMAGE PREVIEW ────────────────────────────────────────────────────────────────────────
function updateImagePreview() {
  if (!pImage || !pImagePreview) return;
  if (pImage.files.length > 0) {
    const file = pImage.files[0];
    const url = URL.createObjectURL(file);
    pImagePreview.innerHTML = `<img src="${url}" alt="Preview">`;
  }
  updateLivePreview();
}

// ── MODEL UPLOAD ───────────────────────────────────────────────────────────────────────
async function handleModelFileSelected() {
  if (!pModelFile?.files?.length || !pModelPreview || !pModelUrl) return;
  const files = Array.from(pModelFile.files);

  const names = files.map((f) => f.name).join(" + ");
  pModelPreview.innerHTML = `<span class="port-upload-placeholder">UPLOADING ${esc(names)}\u2026</span>`;
  pModelZone?.classList.add("dragover");

  try {
    const urls = await Promise.all(files.map((f) => uploadPortfolioAsset(f)));
    pModelUrl.value = urls.join(",");
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
      ? URL.createObjectURL(pImage.files[0])
      : pExistingImageUrl?.value || "";
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
    let imageUrl = pExistingImageUrl?.value || null;

    // Upload new image if selected
    if (pImage?.files?.length > 0) {
      imageUrl = await uploadPortfolioAsset(pImage.files[0]);
    }

    const payload = {
      title,
      description: pDesc?.value?.trim() || null,
      tag: pTag?.value || "RENDER",
      sort_order: parseInt(pSortOrder?.value, 10) || 0,
      image_url: imageUrl,
      model_url: pModelUrl?.value?.trim() || null,
      is_featured: !!pFeatured?.checked,
      is_visible: pVisible?.checked !== false,
    };

    const id = pId?.value;
    if (id) {
      await updatePortfolioItem(id, payload);
    } else {
      await insertPortfolioItem(payload);
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
