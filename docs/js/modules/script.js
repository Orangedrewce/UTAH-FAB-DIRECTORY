/**
 * ═══════════════════════════════════════════════════════════════════════
 * MODULE: script.js - Portfolio Page Logic
 *   1. Image lightbox overlay (with alt-text propagation)
 *   2. Contact form → Supabase
 *   3. Dynamic portfolio grid (portfolio.html only)
 *   4. 3D viewer initialisation (portfolio.html only)
 *   5. Portfolio filter bar (portfolio.html)
 *   6. Collapsible "What I Do" section (index.html)
 *
 * NOTE: The homepage portfolio grid is hardcoded HTML - no DB query.
 * Supabase dynamic loading is reserved for portfolio.html where
 * filtering and the 3D viewer add real value.
 * ═══════════════════════════════════════════════════════════════════════
 */

import { supabase as sb } from "./supabase.js";
import { fetchPortfolioItems } from "./api.js";
import { esc, generateUUID } from "./utils.js";

const lightbox = document.getElementById("lightbox");
const lightboxImg = document.getElementById("lightbox-img");
const lightboxLabel = document.getElementById("lightbox-label");

// ── Lightbox navigation state ───────────────────────────────────────────
let thumbs = [...document.querySelectorAll(".thumb")];
let currentIndex = 0;

/** Refresh thumb list (call after dynamic DOM inserts) */
function refreshThumbs() {
  thumbs = [...document.querySelectorAll(".thumb")];
}

export function openLightbox(element) {
  if (!lightbox || !lightboxImg || !lightboxLabel) return;
  const image = element.querySelector("img");
  if (!image) return;

  const idx = thumbs.indexOf(element);
  if (idx !== -1) currentIndex = idx;

  lightboxImg.src = image.src;
  lightboxImg.alt = image.alt || "";
  lightboxLabel.textContent = element.getAttribute("data-label") || "";
  lightbox.classList.add("open");
}

function navigateLightbox(delta) {
  if (!thumbs.length || !lightbox?.classList.contains("open")) return;
  currentIndex = (currentIndex + delta + thumbs.length) % thumbs.length;
  const thumb = thumbs[currentIndex];
  const image = thumb.querySelector("img");
  if (!image) return;
  lightboxImg.src = image.src;
  lightboxImg.alt = image.alt || "";
  lightboxLabel.textContent = thumb.getAttribute("data-label") || "";
}

export function closeLightbox() {
  if (!lightbox) return;
  lightbox.classList.remove("open");
  if (lightboxImg) { lightboxImg.src = ""; lightboxImg.alt = ""; }
  if (lightboxLabel) lightboxLabel.textContent = "";
}

// Expose to window for inline HTML handlers
window.openLightbox = openLightbox;
window.closeLightbox = closeLightbox;
window.navigateLightbox = navigateLightbox;

document.addEventListener("keydown", (event) => {
  const fsEl = document.fullscreenElement;
  if (event.key === "Escape" && fsEl?.closest?.(".port-thumb--model")) {
    event.preventDefault();
    document.exitFullscreen?.();
    return;
  }

  if (!lightbox?.classList.contains("open")) return;
  switch (event.key) {
    case "Escape":     closeLightbox(); break;
    case "ArrowLeft":  navigateLightbox(-1); break;
    case "ArrowRight": navigateLightbox(1); break;
  }
});

/* ═══════════════════════════════════════════════════════════════════════
   DYNAMIC PORTFOLIO - portfolio.html only (not homepage)
   ═══════════════════════════════════════════════════════════════════════ */

// ── Model URL normalisation ─────────────────────────────────────────────
/**
 * Split comma-separated model URLs, trim, return the first valid URL or null.
 */
function getPrimaryModelUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return null;
  const urls = rawUrl.split(",").map((u) => u.trim()).filter(Boolean);
  return urls.length > 0 ? urls[0] : null;
}

// ── Per-card OV viewer registry & lifecycle ─────────────────────────────
/** @type {Map<string, {viewer: object, hostEl: HTMLElement}>} */
const viewerRegistry = new Map();
const fullscreenTargets = new Set();

function syncViewerFullscreenButtons() {
  for (const target of fullscreenTargets) {
    const btn = target.querySelector(".model-fullscreen-btn");
    if (!btn) continue;
    const active = document.fullscreenElement === target;
    btn.textContent = active ? "EXIT" : "FULL";
    btn.setAttribute("aria-label", active ? "Exit fullscreen" : "Enter fullscreen");
    btn.classList.toggle("is-active", active);
  }
}

document.addEventListener("fullscreenchange", syncViewerFullscreenButtons);

/**
 * Monkey-patch OV navigation so controls match Fusion 360:
 *   MMB = orbit,  Shift+MMB = pan,  Scroll = zoom,  LMB = no nav
 *
 * In both OV and Fusion 360 the *camera* moves around a fixed pivot
 * (camera.center) — the object stays put. OV.Orbit() already does this:
 * it rotates camera.eye around camera.center. So no inversion is needed;
 * we only remap which mouse button triggers each action.
 */
function patchFusion360Controls(embeddedViewer) {
  try {
    const iv = embeddedViewer.GetViewer();
    if (!iv || !iv.navigation || !iv.navigation.mouse) return;
    const mouseObj = iv.navigation.mouse;
    const origGetButton = mouseObj.GetButton.bind(mouseObj);
    mouseObj.GetButton = function () {
      const btn = origGetButton();
      if (btn === 2) return 1;  // MMB → treated as LMB → orbit path
      if (btn === 1) return 0;  // LMB → no navigation match
      return btn;
    };
  } catch (_) { /* default OV controls still functional */ }
}

// ── XYZ orbit-axis gizmo settings ───────────────────────────────────────
const AXIS_LENGTH  = 18;   // px – half-length of each axis line
const AXIS_WIDTH   = 1.5;  // px – stroke width
const AXIS_MARGIN  = 18;   // px – margin from bottom-left corner
const AXIS_COLORS  = { x: "#ff3333", y: "#33cc33", z: "#3388ff" }; // standard RGB

/**
 * Draw a tiny XYZ axis indicator at the orbit centre while MMB is held.
 * Uses a transparent <canvas> overlay sized to match the viewer canvas.
 */
function addPivotGizmo(embeddedViewer, hostEl) {
  try {
    const iv = embeddedViewer.GetViewer();
    if (!iv || !iv.canvas) return;

    const overlay = document.createElement("canvas");
    overlay.className = "ov-pivot-gizmo";
    hostEl.appendChild(overlay);
    const ctx = overlay.getContext("2d");

    function drawAxes() {
      const w = iv.canvas.clientWidth;
      const h = iv.canvas.clientHeight;
      overlay.width  = w * (window.devicePixelRatio || 1);
      overlay.height = h * (window.devicePixelRatio || 1);
      overlay.style.width  = w + "px";
      overlay.style.height = h + "px";
      ctx.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);

      const cx = AXIS_MARGIN;
      const cy = h - AXIS_MARGIN;

      ctx.clearRect(0, 0, w, h);
      ctx.lineWidth = AXIS_WIDTH;
      ctx.lineCap = "round";

      // X axis → right (red)
      ctx.strokeStyle = AXIS_COLORS.x;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + AXIS_LENGTH, cy); ctx.stroke();
      // Y axis → up (green)
      ctx.strokeStyle = AXIS_COLORS.y;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx, cy - AXIS_LENGTH); ctx.stroke();
      // Z axis → diagonal towards viewer (blue)
      ctx.strokeStyle = AXIS_COLORS.z;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx - AXIS_LENGTH * 0.6, cy + AXIS_LENGTH * 0.6); ctx.stroke();
    }

    const show = () => { drawAxes(); overlay.classList.add("visible"); };
    const hide = () => { overlay.classList.remove("visible"); ctx.clearRect(0, 0, overlay.width, overlay.height); };

    let mmbDown = false;
    let rafId = null;

    function tick() {
      if (!mmbDown) return;
      drawAxes();
      rafId = requestAnimationFrame(tick);
    }

    iv.canvas.addEventListener("mousedown", (e) => {
      if (e.button === 1) { mmbDown = true; show(); tick(); }
    });
    // Listen on document so release is caught even if cursor leaves the canvas
    document.addEventListener("mouseup", (e) => {
      if (e.button === 1) { mmbDown = false; if (rafId) cancelAnimationFrame(rafId); hide(); }
    });
  } catch (_) { /* non-critical — orbit still works without gizmo */ }
}

/** Create an OV.EmbeddedViewer inside a host element. */
function initCardViewer(hostEl, modelUrl) {
  const id = hostEl.dataset.itemId;
  if (!id || !modelUrl) return;
  disposeCardViewer(id);

  const fullscreenTarget = hostEl.closest(".port-thumb--model") || hostEl;
  let fullscreenBtn = fullscreenTarget.querySelector(".model-fullscreen-btn");
  fullscreenTargets.add(fullscreenTarget);

  if (!fullscreenBtn) {
    fullscreenBtn = document.createElement("button");
    fullscreenBtn.type = "button";
    fullscreenBtn.className = "model-fullscreen-btn";
    fullscreenTarget.appendChild(fullscreenBtn);
  }

  fullscreenBtn.onclick = async () => {
    try {
      if (document.fullscreenElement === fullscreenTarget) {
        await document.exitFullscreen?.();
      } else {
        await fullscreenTarget.requestFullscreen?.();
      }
    } catch (err) {
      console.warn("Fullscreen toggle failed:", err);
    }
  };

  syncViewerFullscreenButtons();

  if (typeof OV === "undefined") {
    console.warn("Online3DViewer (OV) not loaded — falling back.");
    hostEl.innerHTML = '<span class="model-viewer-fallback">3D PREVIEW UNAVAILABLE</span>';
    return;
  }

  try {
    const viewer = new OV.EmbeddedViewer(hostEl, {
      backgroundColor: new OV.RGBAColor(13, 17, 23, 255),
      defaultColor: new OV.RGBColor(200, 200, 200),
      onModelLoaded: () => {
        patchFusion360Controls(viewer);
        addPivotGizmo(viewer, hostEl);
      },
      onModelLoadFailed: () => {
        hostEl.innerHTML = '<span class="model-viewer-fallback">LOAD FAILED</span>';
        viewerRegistry.delete(id);
      }
    });
    viewer.LoadModelFromUrlList([modelUrl]);
    viewerRegistry.set(id, { viewer, hostEl });
  } catch (err) {
    console.warn(`Viewer init failed [${id}]:`, err);
    hostEl.innerHTML = '<span class="model-viewer-fallback">3D PREVIEW UNAVAILABLE</span>';
  }
}

/** Tear down a single card viewer and release its WebGL context. */
function disposeCardViewer(id) {
  const entry = viewerRegistry.get(id);
  if (!entry) return;
  const fullscreenTarget = entry.hostEl.closest(".port-thumb--model") || entry.hostEl;
  fullscreenTargets.delete(fullscreenTarget);
  try { entry.viewer.Destroy(); } catch (_) { /* best-effort */ }
  entry.hostEl.innerHTML = "";
  viewerRegistry.delete(id);
}

/** Tear down every registered card viewer. */
function disposeAllCardViewers() {
  for (const id of [...viewerRegistry.keys()]) {
    disposeCardViewer(id);
  }
}

/**
 * Build HTML for a single portfolio <figure>.
 * Cards with a model_url render a host <div> for the OV viewer;
 * all other cards keep the existing image/lightbox path.
 */
function portfolioItemHTML(item) {
  const tag = esc(item.tag || "RENDER");
  const title = esc(item.title);
  const desc = esc(item.description || "");
  const label = `${tag} · ${title}`;
  const imgUrl = item.image_url || "assets/Render.png";
  const modelUrl = getPrimaryModelUrl(item.model_url);

  const caption = `<figcaption class="port-caption">
      <span class="port-tag">${tag}</span>
      <span class="port-title">${title}</span>
      ${desc ? `<span class="port-meta">${desc}</span>` : ""}
    </figcaption>`;

  if (modelUrl) {
    return `<figure class="port-item port-item--model" data-tag="${tag}">
    <div class="port-thumb port-thumb--model">
      <div class="model-viewer-host" data-item-id="${esc(String(item.id || title))}" data-model-url="${esc(modelUrl)}"></div>
      <span class="port-model-badge">3D</span>
    </div>
    ${caption}
  </figure>`;
  }

  return `<figure class="port-item" data-tag="${tag}">
    <div class="port-thumb thumb" onclick="openLightbox(this)" data-label="${esc(label)}">
      <img src="${esc(imgUrl)}" alt="${title}" loading="lazy">
      <div class="thumb-overlay">[ VIEW ]</div>
    </div>
    ${caption}
  </figure>`;
}

/**
 * Render portfolio grid on portfolio.html (full gallery with filters).
 * The homepage portfolio grid is hardcoded HTML - no DB query needed.
 */
async function renderPortfolioPage() {
  const grid = document.getElementById("portfolioGrid");
  const filterBar = document.getElementById("portFilterBar");
  const loading = document.getElementById("portLoading");
  if (!grid || !filterBar) return;

  if (loading) loading.classList.remove("hidden");

  try {
    const items = await fetchPortfolioItems(false); // all visible
    if (!items.length) {
      if (loading) loading.classList.add("hidden");
      return; // keep static fallback
    }

    // Populate filter buttons from tags
    const tags = [...new Set(items.map((i) => i.tag || "RENDER"))];
    tags.sort();
    tags.forEach((tag) => {
      const btn = document.createElement("button");
      btn.className = "port-filter-btn";
      btn.dataset.filter = tag;
      btn.textContent = tag;
      filterBar.appendChild(btn);
    });

    // Dispose existing viewers before replacing DOM
    disposeAllCardViewers();

    // Render all items
    grid.innerHTML = items.map(portfolioItemHTML).join("");
    refreshThumbs();

    // Initialise per-card OV viewers
    grid.querySelectorAll(".model-viewer-host").forEach((hostEl) => {
      const url = hostEl.dataset.modelUrl;
      if (url) {
        initCardViewer(hostEl, url);
      } else {
        hostEl.innerHTML = '<span class="model-viewer-fallback">NO MODEL</span>';
      }
    });

    if (loading) loading.classList.add("hidden");

    // Filter handler
    filterBar.addEventListener("click", (e) => {
      const btn = e.target.closest(".port-filter-btn");
      if (!btn) return;

      // Update active state
      filterBar.querySelectorAll(".port-filter-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      const filter = btn.dataset.filter;
      grid.querySelectorAll(".port-item").forEach((item) => {
        if (filter === "all" || item.dataset.tag === filter) {
          item.style.display = "";
        } else {
          item.style.display = "none";
        }
      });
    });
  } catch (err) {
    console.warn("Portfolio load failed, keeping static fallback:", err);
    if (loading) loading.classList.add("hidden");
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   CONTACT FORM - Supabase submission + photo upload
   ═══════════════════════════════════════════════════════════════════════ */
function initContactForm() {
  const form = document.getElementById("contactForm");
  if (!form) return;

  const cfEmail = document.getElementById("cfEmail");
  const cfMessage = document.getElementById("cfMessage");
  const cfFile = document.getElementById("cfFile");
  const cfFileName = document.getElementById("cfFileName");
  const cfFileLabel = document.getElementById("cfFileLabel");
  const submitBtn = document.getElementById("cfSubmitBtn");
  const feedback = document.getElementById("cfFeedback");
  const quoteConfirmation = document.getElementById("quoteConfirmation");
  const quoteResetBtn = document.getElementById("quoteResetBtn");

  if (!cfFile || !cfFileName || !cfFileLabel || !feedback || !submitBtn) return;

  if (quoteResetBtn) {
    quoteResetBtn.addEventListener("click", () => {
      if (quoteConfirmation) quoteConfirmation.style.display = "none";
      form.style.display = "";
    });
  }

  const MAX_FILE_SIZE = 5 * 1024 * 1024;
  const ALLOWED_TYPES = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
  };

  function showFeedback(msg, type) {
    if (!feedback) return;
    feedback.textContent = msg;
    feedback.classList.remove("error", "success");
    if (type) feedback.classList.add(type);
  }

  cfFile.addEventListener("change", () => {
    if (cfFile.files.length > 0) {
      cfFileName.textContent = cfFile.files[0].name;
      cfFileLabel.classList.add("has-file");
    } else {
      cfFileName.textContent = "Attach photo";
      cfFileLabel.classList.remove("has-file");
    }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = cfEmail.value.trim();
    const message = cfMessage.value.trim();

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showFeedback("VALID EMAIL REQUIRED", "error");
      return;
    }
    if (!message) {
      showFeedback("MESSAGE REQUIRED", "error");
      return;
    }
    if (message.length > 1000) {
      showFeedback("MESSAGE TOO LONG (MAX 1000)", "error");
      return;
    }

    if (cfFile.files.length > 0) {
      const file = cfFile.files[0];
      if (file.size > MAX_FILE_SIZE) {
        showFeedback("FILE TOO LARGE (MAX 5 MB)", "error");
        return;
      }
      const fileType = (file.type || "").toLowerCase();
      if (!(fileType in ALLOWED_TYPES)) {
        showFeedback("ONLY JPEG, PNG, GIF, WEBP ALLOWED", "error");
        return;
      }
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "SENDING…";
    showFeedback("", "");

    let photoUrl = null;

    try {
      if (cfFile.files.length > 0) {
        const file = cfFile.files[0];
        const fileType = (file.type || "").toLowerCase();
        const ext = ALLOWED_TYPES[fileType];
        const uniqueId = generateUUID();
        const path = `${Date.now()}_${uniqueId}.${ext}`;

        const { data: uploadData, error: uploadErr } = await sb.storage
          .from("contact-photos")
          .upload(path, file, { contentType: file.type });

        if (uploadErr)
          throw new Error("Photo upload failed: " + uploadErr.message);

        const { data: urlData } = sb.storage
          .from("contact-photos")
          .getPublicUrl(path);
        photoUrl = urlData.publicUrl;
      }

      const { error: insertErr } = await sb.from("contact_messages").insert([
        { email, message, photo_url: photoUrl || null },
      ]);

      if (insertErr) throw new Error("Submit failed: " + insertErr.message);

      form.reset();
      cfFileName.textContent = "Attach photo";
      cfFileLabel.classList.remove("has-file");
      form.style.display = "none";
      if (quoteConfirmation) quoteConfirmation.style.display = "block";
    } catch (err) {
      console.error("Contact form error:", err);
      showFeedback(err.message || "SOMETHING WENT WRONG", "error");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "SEND";
    }
  });
}

/* ═══════════════════════════════════════════════════════════════════════
   COLLAPSIBLE "WHAT I DO" SECTION (index.html)
   ═════════════════════════════════════════════════════════════════════ */
function initCollapsible() {
  const toggle = document.getElementById("valuePropToggle");
  const grid = document.getElementById("valuePropGrid");
  if (!toggle || !grid) return;

  toggle.addEventListener("click", () => {
    const expanded = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-expanded", String(!expanded));
    grid.classList.toggle("collapsed");
  });
}

/* ═════════════════════════════════════════════════════════════════════
   PAGE-LEVEL CLEANUP (release WebGL contexts on navigation)
   ═════════════════════════════════════════════════════════════════════ */
window.addEventListener("pagehide", disposeAllCardViewers);
window.addEventListener("beforeunload", disposeAllCardViewers);

/* ═════════════════════════════════════════════════════════════════════
   INITIALISE
   ═════════════════════════════════════════════════════════════════════ */
initContactForm();
initCollapsible();
renderPortfolioPage();
