const lightbox = document.getElementById("lightbox");
const lightboxImg = document.getElementById("lightbox-img");
const lightboxLabel = document.getElementById("lightbox-label");

function openLightbox(element) {
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

function closeLightbox() {
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

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && lightbox?.classList.contains("open")) {
    closeLightbox();
  }
});

/* ═══════════════════════════════════════════════════════════════════════
   CONTACT FORM — Supabase submission + photo upload
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  const SUPABASE_URL = "https://dntcmvspcwwdwnmyqfiw.supabase.co";
  const SUPABASE_ANON =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRudGNtdnNwY3d3ZHdubXlxZml3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE3MDA5MDksImV4cCI6MjA4NzI3NjkwOX0.cgiLMn6YH0BnLshl_458nGwdjnAJaN3MZz8jT4lwfkc";

  // Guard: Supabase SDK may not be loaded on all pages
  if (typeof window.supabase === "undefined") return;

  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

  const form = document.getElementById("contactForm");
  const cfEmail = document.getElementById("cfEmail");
  const cfMessage = document.getElementById("cfMessage");
  const cfFile = document.getElementById("cfFile");
  const cfFileName = document.getElementById("cfFileName");
  const cfFileLabel = document.getElementById("cfFileLabel");
  const submitBtn = document.getElementById("cfSubmitBtn");
  const feedback = document.getElementById("cfFeedback");

  if (!form) return; // Not on the portfolio page
  if (!cfFile || !cfFileName || !cfFileLabel || !feedback || !submitBtn) return;

  // Constants
  const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
  const ALLOWED_TYPES = {
    'image/jpeg': 'jpg',
    'image/png':  'png',
    'image/gif':  'gif',
    'image/webp': 'webp',
  };

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

  function showFeedback(msg, type) {
    if (!feedback) return;
    feedback.textContent = msg;
    feedback.classList.remove('error', 'success');
    if (type) feedback.classList.add(type);
  }

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

    submitBtn.disabled = true;
    submitBtn.textContent = "SENDING…";
    showFeedback("", "");

    let photoUrl = null;

    try {
      // Validate & upload photo if present
      if (cfFile.files.length > 0) {
        const file = cfFile.files[0];

        if (file.size > MAX_FILE_SIZE) {
          showFeedback('FILE TOO LARGE (MAX 5 MB)', 'error');
          return;
        }
        if (!(file.type in ALLOWED_TYPES)) {
          showFeedback('ONLY JPEG, PNG, GIF, WEBP ALLOWED', 'error');
          return;
        }

        const ext = ALLOWED_TYPES[file.type];
        const uniqueId = typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : Math.random().toString(36).slice(2, 10);
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
})();
