/**
 * ═══════════════════════════════════════════════════════════════════════
 * MODULE: script.js — Portfolio Page Logic (Lightbox + Contact Form)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * PURPOSE:
 *   Powers the portfolio / landing page with two independent features:
 *     1. An image lightbox overlay
 *     2. A contact form that uploads an optional photo to Supabase
 *        Storage and inserts a message row into the `contact_messages`
 *        table.
 *
 * FEATURE 1 — LIGHTBOX:
 *   • `openLightbox(element)` — Called from inline `onclick` handlers in
 *     the HTML.  Reads the child <img>'s `src` and the element's
 *     `data-label` attribute, then shows the #lightbox overlay.
 *   • `closeLightbox()` — Hides the overlay, clears the image source.
 *   • Both functions are attached to `window` so inline HTML event
 *     handlers can call them.
 *   • Pressing Escape while the lightbox is open closes it.
 *
 * FEATURE 2 — CONTACT FORM:
 *   • On submit, validates the email (basic regex) and message length
 *     (max 1 000 characters).
 *   • If a photo file is attached, validates its type (JPEG, PNG, GIF,
 *     WEBP) and size (max 5 MB), then uploads it to the Supabase
 *     "contact-photos" storage bucket.  A unique filename is generated
 *     with a timestamp + UUID.
 *   • Inserts { email, message, photo_url } into the `contact_messages`
 *     table.
 *   • Shows success / error feedback via the #cfFeedback element.
 *   • `initContactForm()` is called at module load; it no-ops silently
 *     if the form element doesn't exist (i.e. on non-portfolio pages).
 *
 * HOW TO ADD FEATURES / MODIFY:
 *   • ADDITIONAL FILE TYPES — Add MIME → extension entries to the
 *     `ALLOWED_TYPES` map inside `initContactForm()`.
 *   • LARGER UPLOADS — Increase `MAX_FILE_SIZE` (in bytes).
 *   • NEW FORM FIELDS — Add the field to the HTML, read its value
 *     inside the submit handler, and include it in the insert payload.
 *     Make sure the matching column exists in the `contact_messages`
 *     Supabase table.
 *   • LIGHTBOX NAVIGATION (prev/next) — Track all portfolio items in
 *     an array, store the current index, and add prev/next button
 *     handlers that update `lightboxImg.src`.
 * ═══════════════════════════════════════════════════════════════════════
 */

import { supabase as sb } from "./supabase.js";

const lightbox = document.getElementById("lightbox");
const lightboxImg = document.getElementById("lightbox-img");
const lightboxLabel = document.getElementById("lightbox-label");

export function openLightbox(element) {
  if (!lightbox || !lightboxImg || !lightboxLabel) {
    return;
  }

  const image = element.querySelector("img");
  if (!image) {
    return;
  }

  lightboxImg.src = image.src;
  lightboxImg.alt = image.alt || "";
  lightboxLabel.textContent = element.getAttribute("data-label") || "";
  lightbox.classList.add("open");
}

export function closeLightbox() {
  if (!lightbox) {
    return;
  }

  lightbox.classList.remove("open");
  if (lightboxImg) {
    lightboxImg.src = "";
    lightboxImg.alt = "";
  }
  if (lightboxLabel) {
    lightboxLabel.textContent = "";
  }
}

// Expose to window for inline HTML handlers
window.openLightbox = openLightbox;
window.closeLightbox = closeLightbox;

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && lightbox?.classList.contains("open")) {
    closeLightbox();
  }
});

/* ═══════════════════════════════════════════════════════════════════════
   CONTACT FORM — Supabase submission + photo upload
   ═══════════════════════════════════════════════════════════════════════ */
function initContactForm() {
  const form = document.getElementById("contactForm");
  if (!form) return; // Not on the portfolio page

  const cfEmail = document.getElementById("cfEmail");
  const cfMessage = document.getElementById("cfMessage");
  const cfFile = document.getElementById("cfFile");
  const cfFileName = document.getElementById("cfFileName");
  const cfFileLabel = document.getElementById("cfFileLabel");
  const submitBtn = document.getElementById("cfSubmitBtn");
  const feedback = document.getElementById("cfFeedback");

  if (!cfFile || !cfFileName || !cfFileLabel || !feedback || !submitBtn) return;

  // Constants
  const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
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

  // Show selected file name
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

    // Basic validation
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

    // Validate file before touching the button
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
      // Upload photo if present (already validated above)
      if (cfFile.files.length > 0) {
        const file = cfFile.files[0];
        const fileType = (file.type || "").toLowerCase();

        const ext = ALLOWED_TYPES[fileType];
        const uniqueId = crypto.randomUUID
          ? crypto.randomUUID()
          : Array.from(crypto.getRandomValues(new Uint8Array(16)))
              .map((b) => b.toString(16).padStart(2, "0")).join("");
        const path = `${Date.now()}_${uniqueId}.${ext}`;

        const { data: uploadData, error: uploadErr } = await sb.storage
          .from("contact-photos")
          .upload(path, file, { contentType: file.type });

        if (uploadErr)
          throw new Error("Photo upload failed: " + uploadErr.message);

        // Get public URL
        const { data: urlData } = sb.storage
          .from("contact-photos")
          .getPublicUrl(path);
        photoUrl = urlData.publicUrl;
      }

      // Insert contact message
      const { error: insertErr } = await sb.from("contact_messages").insert([
        {
          email,
          message,
          photo_url: photoUrl || null,
        },
      ]);

      if (insertErr) throw new Error("Submit failed: " + insertErr.message);

      // Success
      showFeedback("MESSAGE SENT — I'LL BE IN TOUCH", "success");
      form.reset();
      cfFileName.textContent = "Attach photo";
      cfFileLabel.classList.remove("has-file");
    } catch (err) {
      console.error("Contact form error:", err);
      showFeedback(err.message || "SOMETHING WENT WRONG", "error");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "SEND";
    }
  });
}

initContactForm();
