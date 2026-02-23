/**
 * ═══════════════════════════════════════════════════════════════════════
 * MODULE: script.js - Shared Page Logic
 *   1. Image lightbox overlay (with alt-text propagation)
 *   2. Contact form → Supabase
 *   3. Dynamic portfolio grid (portfolio.html only)
 *      - Image items: static thumbnail + lightbox
 *      - 3D model items: inline interactive viewport (same card dimensions)
 *   4. Portfolio filter bar (portfolio.html, shown only when 2+ distinct tags)
 * ═══════════════════════════════════════════════════════════════════════
 */

import { supabase as sb } from "./supabase.js";
import { fetchPortfolioItems } from "./api.js";

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

/** Escape HTML to prevent XSS */
function esc(str) {
  const d = document.createElement("div");
  d.textContent = str || "";
  return d.innerHTML;
}

/**
 * Build HTML for a single portfolio <figure>.
 * Items with model_url render as interactive inline 3D viewports.
 * Items with image_url render as static thumbnails with lightbox.
 */
function portfolioItemHTML(item) {
  const tag = esc(item.tag || "RENDER");
  const title = esc(item.title);
  const desc = esc(item.description || "");
  const label = `${tag} · ${title}`;

  let embedSrc = item.model_url || "";
  if (embedSrc && !embedSrc.includes("3dviewer.net")) {
    embedSrc = `https://3dviewer.net/embed.html#model=${embedSrc}`;
  }

  const mediaHtml = embedSrc
    ? `<div class="port-thumb port-thumb--model">
        <iframe class="port-model-frame" src="${esc(embedSrc)}" allow="fullscreen" loading="lazy" title="${title}"></iframe>
        <span class="port-model-badge">3D</span>
       </div>`
    : `<div class="port-thumb thumb" onclick="openLightbox(this)" data-label="${esc(label)}">
        <img src="${esc(item.image_url || 'assets/Render.png')}" alt="${title}" loading="lazy">
        <div class="thumb-overlay">[ VIEW ]</div>
       </div>`;

  return `<figure class="port-item${embedSrc ? ' port-item--model' : ''}" data-tag="${tag}">
    ${mediaHtml}
    <figcaption class="port-caption">
      <span class="port-tag">${tag}</span>
      <span class="port-title">${title}</span>
      ${desc ? `<span class="port-meta">${desc}</span>` : ""}
    </figcaption>
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
  const emptyState = document.getElementById("portEmpty");
  if (!grid || !filterBar) return;

  // Only runs on portfolio.html
  if (!document.querySelector(".port-filter-bar")) return;

  if (loading) loading.classList.remove("hidden");

  try {
    const items = await fetchPortfolioItems(false);

    grid.innerHTML = "";

    if (!items.length) {
      if (loading) loading.classList.add("hidden");
      if (emptyState) emptyState.classList.remove("hidden");
      return;
    }

    // Show filter bar only when there are 2+ distinct tags
    const tags = [...new Set(items.map((i) => i.tag || "RENDER"))];
    tags.sort();
    if (tags.length >= 2) {
      tags.forEach((tag) => {
        const btn = document.createElement("button");
        btn.className = "port-filter-btn";
        btn.dataset.filter = tag;
        btn.textContent = tag;
        filterBar.appendChild(btn);
      });
      filterBar.style.display = "flex";
    }

    grid.innerHTML = items.map(portfolioItemHTML).join("");
    refreshThumbs();

    if (loading) loading.classList.add("hidden");

    // Filter handler
    filterBar.addEventListener("click", (e) => {
      const btn = e.target.closest(".port-filter-btn");
      if (!btn) return;
      filterBar.querySelectorAll(".port-filter-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const filter = btn.dataset.filter;
      grid.querySelectorAll(".port-item").forEach((item) => {
        item.style.display = (filter === "all" || item.dataset.tag === filter) ? "" : "none";
      });
    });
  } catch (err) {
    console.warn("Portfolio load failed:", err);
    if (loading) loading.classList.add("hidden");
    if (emptyState) emptyState.classList.remove("hidden");
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

/* ═════════════════════════════════════════════════════════════════════
   INITIALISE
   ═════════════════════════════════════════════════════════════════════ */
initContactForm();
renderPortfolioPage();
