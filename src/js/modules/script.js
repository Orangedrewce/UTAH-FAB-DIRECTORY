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
import { esc } from "./utils.js";

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

/**
 * Build HTML for a single portfolio <figure>.
 */
function portfolioItemHTML(item) {
  const tag = esc(item.tag || "RENDER");
  const title = esc(item.title);
  const desc = esc(item.description || "");
  const label = `${tag} · ${title}`;
  const imgUrl = item.image_url || "assets/Render.png";

  return `<figure class="port-item" data-tag="${tag}">
    <div class="port-thumb thumb" onclick="openLightbox(this)" data-label="${esc(label)}">
      <img src="${esc(imgUrl)}" alt="${title}" loading="lazy">
      <div class="thumb-overlay">[ VIEW ]</div>
    </div>
    <figcaption class="port-caption">
      <span class="port-tag">${tag}</span>
      <span class="port-title">${title}</span>
      ${desc ? `<span class="port-meta">${desc}</span>` : ""}
    </figcaption>
  </figure>`;
}

/**
 * Initialise the 3D viewer iframe with the first model_url found.
 * Only runs on portfolio.html (viewer elements don't exist on index.html).
 */
function init3DViewer(items) {
  const wrap = document.getElementById("viewer3dWrap");
  const frame = document.getElementById("viewer3dFrame");
  const titleEl = document.getElementById("viewer3dTitle");
  if (!wrap || !frame) return;

  const modelItem = items.find((i) => i.model_url);
  if (!modelItem) return;

  let src = modelItem.model_url;
  // If it's a raw file URL (not already a 3dviewer embed), wrap it
  if (!src.includes("3dviewer.net") && !src.includes("embed")) {
    src = `https://3dviewer.net/embed.html#model=${encodeURIComponent(src)}`;
  }

  frame.src = src;
  if (titleEl) titleEl.textContent = modelItem.title || "3D Model";
  wrap.style.display = "";
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

    // Render all items
    grid.innerHTML = items.map(portfolioItemHTML).join("");
    refreshThumbs();
    init3DViewer(items);

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
        const uniqueId = crypto.randomUUID
          ? crypto.randomUUID()
          : Array.from(crypto.getRandomValues(new Uint8Array(16)))
              .map((b) => b.toString(16).padStart(2, "0"))
              .join("");
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
   INITIALISE
   ═════════════════════════════════════════════════════════════════════ */
initContactForm();
initCollapsible();
renderPortfolioPage();
