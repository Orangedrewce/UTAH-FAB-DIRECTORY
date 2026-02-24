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
import { esc, generateUUID, normalisePortfolioImageUrl } from "./utils.js";
import { getCardVisualAssets } from "./media-assets.js";

const lightbox = document.getElementById("lightbox");
const lightboxImg = document.getElementById("lightbox-img");
const lightboxLabel = document.getElementById("lightbox-label");

// ── Lightbox two-level navigation state ─────────────────────────────────
let lightboxCards = [];
let currentCardIndex = 0;
let currentMediaIndex = 0;

function setLightboxCards(cards) {
  lightboxCards = Array.isArray(cards) ? cards : [];
  if (currentCardIndex >= lightboxCards.length) currentCardIndex = 0;
  if (currentMediaIndex < 0) currentMediaIndex = 0;
}

function getCurrentCard() {
  return lightboxCards[currentCardIndex] || null;
}

function getCurrentMedia() {
  const card = getCurrentCard();
  if (!card?.visualAssets?.length) return null;
  if (currentMediaIndex >= card.visualAssets.length) currentMediaIndex = 0;
  return card.visualAssets[currentMediaIndex] || null;
}

function renderLightboxState() {
  if (!lightbox || !lightboxImg || !lightboxLabel) return;
  const card = getCurrentCard();
  const media = getCurrentMedia();
  if (!card || !media) return;

  lightboxImg.src = media.url;
  lightboxImg.alt = media.alt || card.title || "";
  const cardPos = currentCardIndex + 1;
  const mediaPos = currentMediaIndex + 1;
  lightboxLabel.textContent = `${card.label} · Card ${cardPos}/${lightboxCards.length} · Media ${mediaPos}/${card.visualAssets.length}`;
}

export function openLightbox(element) {
  if (!lightbox) return;
  const cardIndex = Number(element?.dataset?.cardIndex);
  const mediaIndex = Number(element?.dataset?.mediaIndex || 0);
  if (!Number.isInteger(cardIndex) || cardIndex < 0 || cardIndex >= lightboxCards.length) return;

  currentCardIndex = cardIndex;
  currentMediaIndex = Number.isInteger(mediaIndex) && mediaIndex >= 0 ? mediaIndex : 0;
  renderLightboxState();
  lightbox.classList.add("open");
}

function navigateLightbox(delta) {
  if (!lightbox?.classList.contains("open")) return;
  const card = getCurrentCard();
  if (!card?.visualAssets?.length) return;
  currentMediaIndex = (currentMediaIndex + delta + card.visualAssets.length) % card.visualAssets.length;
  renderLightboxState();
}

function navigateLightboxCards(delta) {
  if (!lightbox?.classList.contains("open") || !lightboxCards.length) return;
  currentCardIndex = (currentCardIndex + delta + lightboxCards.length) % lightboxCards.length;
  currentMediaIndex = 0;
  renderLightboxState();
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
window.navigateLightboxCards = navigateLightboxCards;

document.addEventListener("keydown", (event) => {
  // Escape while pseudo-fullscreen → close it
  const pseudoFs = document.querySelector(".port-thumb--model.is-pseudo-fullscreen");
  if (event.key === "Escape" && pseudoFs) {
    event.preventDefault();
    togglePseudoFullscreen(pseudoFs); // toggles off
    return;
  }

  const openModelCard = document.querySelector(".port-thumb--model.is-model-open");
  if (event.key === "Escape" && openModelCard) {
    event.preventDefault();
    const exitFullscreenAndClose = async () => {
      if (document.fullscreenElement) {
        try { await document.exitFullscreen?.(); } catch (_) { /* no-op */ }
      }
      setModelCardOpen(openModelCard, false);
    };
    exitFullscreenAndClose();
    return;
  }

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
    case "ArrowUp":    navigateLightboxCards(-1); break;
    case "ArrowDown":  navigateLightboxCards(1); break;
  }
});

/* ═══════════════════════════════════════════════════════════════════════
   DYNAMIC PORTFOLIO - portfolio.html only (not homepage)
   ═══════════════════════════════════════════════════════════════════════ */

// ── Model URL normalisation ─────────────────────────────────────────────
/**
 * Split comma-separated model URLs, trim, return all valid URLs.
 */
function getModelUrlList(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return [];
  return rawUrl.split(",").map((u) => u.trim()).filter(Boolean);
}

function isExternalEmbedUrl(url) {
  return /3dviewer\.net/i.test(url || "");
}

// ── Per-card OV viewer registry & lifecycle ─────────────────────────────
/** @type {Map<string, {viewer: object, hostEl: HTMLElement}>} */
const viewerRegistry = new Map();
const fullscreenTargets = new Set();
const orbitToastTimers = new WeakMap();
const controlsIdleTimers = new WeakMap();

function syncViewerFullscreenButtons() {
  for (const target of fullscreenTargets) {
    const btn = target.querySelector(".model-fullscreen-btn");
    if (!btn) continue;
    const active = isCardFullscreen(target);
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
const AXIS_COLORS  = { x: "#ff3333", y: "#33cc33", z: "#3388ff" }; // X red, Y green (depth), Z blue (up)

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
      // Y axis → diagonal towards viewer (green)
      ctx.strokeStyle = AXIS_COLORS.y;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx - AXIS_LENGTH * 0.6, cy + AXIS_LENGTH * 0.6); ctx.stroke();
      // Z axis → up (blue)
      ctx.strokeStyle = AXIS_COLORS.z;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx, cy - AXIS_LENGTH); ctx.stroke();
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
function initCardViewer(hostEl, modelUrls) {
  const id = hostEl.dataset.itemId;
  if (!id || !Array.isArray(modelUrls) || !modelUrls.length) return;
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
    viewer.LoadModelFromUrlList(modelUrls);
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

function ensureCardViewer(cardEl) {
  const hostEl = cardEl?.querySelector(".model-viewer-host");
  if (!hostEl || hostEl.dataset.viewerReady === "true") return;

  const embedUrl = hostEl.dataset.embedUrl;
  if (embedUrl && isExternalEmbedUrl(embedUrl)) {
    hostEl.innerHTML = `<iframe class="model-embed-frame" src="${esc(embedUrl)}" loading="lazy" tabindex="-1" title="3D model preview"></iframe>`;
    hostEl.dataset.viewerReady = "true";
    return;
  }

  const modelUrls = getModelUrlList(hostEl.dataset.modelUrls || "");
  if (!modelUrls.length) {
    hostEl.innerHTML = '<span class="model-viewer-fallback">NO MODEL</span>';
    hostEl.dataset.viewerReady = "true";
    return;
  }

  initCardViewer(hostEl, modelUrls);
  hostEl.dataset.viewerReady = "true";
}

function showModelOrbitToast(cardEl) {
  if (!cardEl) return;
  let toastEl = cardEl.querySelector(".model-orbit-toast");
  if (!toastEl) {
    toastEl = document.createElement("div");
    toastEl.className = "model-orbit-toast";
    toastEl.textContent = "Middle click to orbit";
    cardEl.appendChild(toastEl);
  }

  toastEl.classList.add("is-visible");
  const existingTimer = orbitToastTimers.get(cardEl);
  if (existingTimer) window.clearTimeout(existingTimer);

  const hideTimer = window.setTimeout(() => {
    toastEl.classList.remove("is-visible");
  }, 2200);

  orbitToastTimers.set(cardEl, hideTimer);
}

function clearControlsIdleTimer(cardEl) {
  const timer = controlsIdleTimers.get(cardEl);
  if (timer) {
    window.clearTimeout(timer);
    controlsIdleTimers.delete(cardEl);
  }
}

function scheduleControlsFade(cardEl) {
  if (!cardEl) return;
  clearControlsIdleTimer(cardEl);
  const timer = window.setTimeout(() => {
    cardEl.classList.add("model-controls-idle");
  }, 3000);
  controlsIdleTimers.set(cardEl, timer);
}

function showCardControls(cardEl) {
  if (!cardEl) return;
  cardEl.classList.remove("model-controls-idle");
  scheduleControlsFade(cardEl);
}

function bindModelCardActivity(cardEl) {
  if (!cardEl || cardEl.dataset.controlsBound === "true") return;

  const activate = () => showCardControls(cardEl);
  cardEl.addEventListener("mousemove", activate);
  cardEl.addEventListener("mouseenter", activate);
  cardEl.addEventListener("touchstart", activate, { passive: true });
  cardEl.addEventListener("pointerdown", activate);

  cardEl.dataset.controlsBound = "true";
  showCardControls(cardEl);
}

function setModelCardOpen(cardEl, isOpen) {
  if (!cardEl) return;
  cardEl.classList.toggle("is-model-open", isOpen);

  const hostEl = cardEl.querySelector(".model-viewer-host");
  const curtainEl = cardEl.querySelector(".model-render-curtain");
  const toggleBtn = cardEl.querySelector(".model-toggle-btn");

  if (hostEl) hostEl.setAttribute("aria-hidden", String(!isOpen));
  if (curtainEl) curtainEl.setAttribute("aria-hidden", String(isOpen));
  if (toggleBtn) {
    toggleBtn.textContent = isOpen ? "View Render" : "View 3D";
    toggleBtn.setAttribute(
      "aria-label",
      isOpen ? "Switch back to render" : "Open interactive 3D model"
    );
  }

  if (!isOpen) {
    cardEl.classList.remove("model-controls-idle");
  }
}

function openModelCard(cardEl) {
  const openCard = document.querySelector(".port-thumb--model.is-model-open");
  if (openCard && openCard !== cardEl) {
    setModelCardOpen(openCard, false);
  }

  ensureCardViewer(cardEl);
  setModelCardOpen(cardEl, true);
  showModelOrbitToast(cardEl);
  showCardControls(cardEl);
}

function closeModelCard(cardEl) {
  setModelCardOpen(cardEl, false);
  const toastEl = cardEl?.querySelector(".model-orbit-toast");
  if (toastEl) toastEl.classList.remove("is-visible");
  clearControlsIdleTimer(cardEl);
}

function toggleModelCard(cardEl) {
  if (!cardEl) return;
  const wasOpen = cardEl.classList.contains("is-model-open");
  if (wasOpen) {
    closeModelCard(cardEl);
  } else {
    openModelCard(cardEl);
  }
}

function isCardFullscreen(cardEl) {
  return document.fullscreenElement === cardEl || cardEl.classList.contains("is-pseudo-fullscreen");
}

function toggleCardFullscreen(cardEl) {
  if (!cardEl) return;

  // Native Fullscreen API available (desktop browsers, Android Chrome)
  if (cardEl.requestFullscreen) {
    const toggleNative = async () => {
      try {
        if (document.fullscreenElement === cardEl) {
          await document.exitFullscreen?.();
        } else {
          await cardEl.requestFullscreen();
        }
      } catch (err) {
        // Native failed (e.g. user gesture requirement) — fall back to CSS
        togglePseudoFullscreen(cardEl);
      }
    };
    toggleNative();
  } else {
    // No native API (iOS Safari) — use CSS pseudo-fullscreen
    togglePseudoFullscreen(cardEl);
  }
}

function togglePseudoFullscreen(cardEl) {
  const wasActive = cardEl.classList.contains("is-pseudo-fullscreen");
  // Close any other pseudo-fullscreen card first
  document.querySelectorAll(".is-pseudo-fullscreen").forEach((el) => {
    el.classList.remove("is-pseudo-fullscreen");
  });
  document.body.classList.remove("has-pseudo-fullscreen");

  if (!wasActive) {
    cardEl.classList.add("is-pseudo-fullscreen");
    document.body.classList.add("has-pseudo-fullscreen");
  }
  syncViewerFullscreenButtons();
}

/** Single-click focus: highlight the card with a visible outline. */
function focusCard(cardEl) {
  if (!cardEl) return;
  // Clear any previously focused card
  const prev = document.querySelector(".port-thumb--model.is-card-focused");
  if (prev && prev !== cardEl) prev.classList.remove("is-card-focused");
  cardEl.classList.add("is-card-focused");
}

// ── Single click: focus/select the card (outline highlight) ──
// ── Double click on render curtain: toggle fullscreen ──
document.addEventListener("click", (event) => {
  // Render curtain single-click → open lightbox (not fullscreen)
  const renderWindow = event.target.closest(".model-render-curtain");
  if (renderWindow) {
    const card = renderWindow.closest(".port-thumb--model");
    if (!card) return;
    // Single click focuses the card (visual highlight)
    focusCard(card);
    // Don't go fullscreen — let dblclick handle that
    return;
  }

  const fullscreenBtn = event.target.closest(".model-fullscreen-btn");
  if (fullscreenBtn) {
    const card = fullscreenBtn.closest(".port-thumb--model");
    if (!card) return;
    event.preventDefault();
    toggleCardFullscreen(card);
    return;
  }

  const actionBtn = event.target.closest("[data-model-action]");
  if (actionBtn) {
    const card = actionBtn.closest(".port-thumb--model");
    if (!card) return;
    event.preventDefault();

    if (actionBtn.dataset.modelAction === "toggle") {
      toggleModelCard(card);
    }
    return;
  }

  // Click outside any model card → close open card + clear focus
  const openCard = document.querySelector(".port-thumb--model.is-model-open");
  if (openCard && !openCard.contains(event.target)) {
    closeModelCard(openCard);
  }
  const focusedCard = document.querySelector(".port-thumb--model.is-card-focused");
  if (focusedCard && !focusedCard.contains(event.target)) {
    focusedCard.classList.remove("is-card-focused");
  }
});

// ── Double click on render curtain → fullscreen ──
document.addEventListener("dblclick", (event) => {
  const renderWindow = event.target.closest(".model-render-curtain");
  if (renderWindow) {
    const card = renderWindow.closest(".port-thumb--model");
    if (!card) return;
    event.preventDefault();
    toggleCardFullscreen(card);
    return;
  }
});

/**
 * Build HTML for a single portfolio <figure>.
 * Cards with a model_url render a host <div> for the OV viewer;
 * all other cards keep the existing image/lightbox path.
 */
function portfolioItemHTML(item, cardIndex, visualAssets) {
  const tag = esc(item.tag || "RENDER");
  const title = esc(item.title);
  const desc = esc(item.description || "");
  const label = `${tag} · ${title}`;
  const coverMedia = visualAssets[0] || null;
  const imgUrl = normalisePortfolioImageUrl(coverMedia?.url || item.image_url) || "assets/Render.png";

  const { modelAssets } = getCardVisualAssets(item);
  const modelUrlJoined = modelAssets.map((asset) => asset.url).find(Boolean) || item.model_url || "";
  const modelUrls = getModelUrlList(modelUrlJoined);
  const embedUrl = modelUrls.length === 1 && isExternalEmbedUrl(modelUrls[0]) ? modelUrls[0] : "";

  const caption = `<figcaption class="port-caption">
      <span class="port-tag">${tag}</span>
      <span class="port-title">${title}</span>
      ${desc ? `<span class="port-meta">${desc}</span>` : ""}
    </figcaption>`;

  if (modelUrls.length) {
    return `<figure class="port-item port-item--model" data-tag="${tag}">
    <div class="port-thumb port-thumb--model">
      <div class="model-viewer-host" data-item-id="${esc(String(item.id || title))}" data-model-urls="${esc(modelUrls.join(","))}" data-embed-url="${esc(embedUrl)}" aria-hidden="true"></div>
      <div class="model-render-curtain" aria-hidden="false">
        <img class="model-render-thumb" src="${esc(imgUrl)}" alt="${title}" loading="lazy" data-card-index="${cardIndex}" data-media-index="0" onclick="openLightbox(this)">
      </div>
      <button type="button" class="model-fullscreen-btn" aria-label="Enter fullscreen">FULL</button>
      <button type="button" class="model-toggle-btn" data-model-action="toggle" aria-label="Open interactive 3D model">View 3D</button>
      <span class="port-model-badge">3D</span>
    </div>
    ${caption}
  </figure>`;
  }

  return `<figure class="port-item" data-tag="${tag}">
    <div class="port-thumb thumb" onclick="openLightbox(this)" data-label="${esc(label)}" data-card-index="${cardIndex}" data-media-index="0">
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
  const empty = document.getElementById("portEmpty");
  const emptyLabel = document.querySelector("#portEmpty .port-empty-label");
  const retryBtn = document.getElementById("portRetryBtn");
  if (!grid || !filterBar) return;

  const showLoading = () => {
    if (loading) loading.classList.remove("hidden");
    if (empty) empty.classList.add("hidden");
  };

  const showEmptyState = (message) => {
    if (loading) loading.classList.add("hidden");
    if (emptyLabel) emptyLabel.textContent = message;
    if (empty) empty.classList.remove("hidden");
  };

  const showGridState = () => {
    if (loading) loading.classList.add("hidden");
    if (empty) empty.classList.add("hidden");
  };

  if (retryBtn) {
    retryBtn.onclick = () => {
      renderPortfolioPage();
    };
  }

  showLoading();

  try {
    const items = await fetchPortfolioItems(false); // all visible
    if (!items.length) {
      showEmptyState("No portfolio assets are currently published.");
      return;
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

    // Reset filter bar to base state before repopulating
    filterBar.innerHTML = '<button class="port-filter-btn active" data-filter="all">ALL</button>';

    const lightboxCardsData = items
      .map((item) => {
        const tag = item.tag || "RENDER";
        const title = item.title || "Untitled";
        const label = `${tag} · ${title}`;
        const { visualAssets } = getCardVisualAssets(item);
        const cardVisuals = visualAssets.length
          ? visualAssets.map((asset) => ({
              url: normalisePortfolioImageUrl(asset.url),
              alt: asset.alt || title,
            })).filter((asset) => !!asset.url)
          : [{ url: normalisePortfolioImageUrl(item.image_url) || "assets/Render.png", alt: title }];

        return {
          id: String(item.id || title),
          title,
          label,
          visualAssets: cardVisuals,
        };
      })
      .filter((card) => card.visualAssets.length);

    setLightboxCards(lightboxCardsData);

    // Render all items
    grid.innerHTML = items
      .map((item, index) => portfolioItemHTML(item, index, lightboxCardsData[index]?.visualAssets || []))
      .join("");

    grid.querySelectorAll(".port-thumb--model").forEach((cardEl) => {
      bindModelCardActivity(cardEl);
    });

    showGridState();

    // Filter handler
    if (!filterBar.dataset.bound) {
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
      filterBar.dataset.bound = "true";
    }
  } catch (err) {
    console.warn("Portfolio load failed:", err);
    showEmptyState("Unable to retrieve CAD assets. Please contact directly for a portfolio PDF.");
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
