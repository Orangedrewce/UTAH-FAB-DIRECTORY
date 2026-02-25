// @ts-check

/**
 * ═══════════════════════════════════════════════════════════════════════
 * MODULE: supabase.js — Shared Supabase Client Bootstrap
 * ═══════════════════════════════════════════════════════════════════════
 *
 * SCOPE:
 *   Provides one shared Supabase client export for browser modules.
 *   This file is intentionally minimal and handles only client bootstrap
 *   and graceful failure fallback.
 *
 * RUNTIME CONTRACT:
 *   1) Static configuration:
 *      - Defines project URL and anon key constants used to initialize
 *        the browser client.
 *
 *   2) SDK precondition:
 *      - Expects the Supabase JS SDK to be present on `window.supabase`
 *        (typically loaded via CDN script before module execution).
 *
 *   3) Initialization path:
 *      - Attempts `window.supabase.createClient(SUPABASE_URL,
 *        SUPABASE_ANON)` inside a guarded `try/catch`.
 *      - On success: exports live client instance.
 *      - On failure: logs a descriptive error and exports `null`.
 *
 *   4) Consumer expectation:
 *      - Downstream modules must tolerate `supabase === null` and either
 *        short-circuit features or surface user-facing degraded-mode
 *        messaging.
 *
 * OPERATIONAL CAVEATS:
 *   • This module does not itself enforce secret management; anon key is
 *     public by design and relies on Supabase RLS/policies for protection.
 *   • SDK load-order mistakes (script missing/blocked by adblock/CSP)
 *     resolve to `null` client rather than throwing uncaught exceptions.
 *   • No custom `createClient` options are passed currently; auth/storage
 *     behavior is default Supabase JS v2 behavior.
 *
 * MAINTENANCE CHECKLIST:
 *   • Project migration: update URL + anon key together.
 *   • If adding `createClient` options, keep all consumer assumptions
 *     (auth persistence, storage key behavior, headers) documented.
 *   • If changing failure behavior, coordinate with modules that currently
 *     branch on falsy client availability.
 *   • If moving away from CDN globals, replace `window.supabase` contract
 *     and update bootstrap checks accordingly.
 * ═══════════════════════════════════════════════════════════════════════
 */


const SUPABASE_URL = "https://dntcmvspcwwdwnmyqfiw.supabase.co";
const SUPABASE_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRudGNtdnNwY3d3ZHdubXlxZml3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE3MDA5MDksImV4cCI6MjA4NzI3NjkwOX0.cgiLMn6YH0BnLshl_458nGwdjnAJaN3MZz8jT4lwfkc";

/** @type {object | null} */
let _client = null;
try {
  const globalWindow = /** @type {any} */ (window);
  if (typeof globalWindow.supabase === "undefined") {
    throw new Error(
      "Supabase SDK not loaded. Ensure the CDN <script> appears before this module in the HTML.",
    );
  }
  _client = globalWindow.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
} catch (err) {
  console.error(
    "[supabase.js] Client could not be initialised — Supabase features will be unavailable.",
    err.message,
  );
}

export const supabase = _client;
