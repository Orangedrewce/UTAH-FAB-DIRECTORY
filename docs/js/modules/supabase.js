/**
 * ═══════════════════════════════════════════════════════════════════════
 * MODULE: supabase.js — Supabase Client Initialisation
 * ═══════════════════════════════════════════════════════════════════════
 *
 * PURPOSE:
 *   Creates and exports the single, shared Supabase client instance used
 *   by every other module in the app (api.js, admin.js, directory.js,
 *   script.js).  All database queries, auth calls, and storage uploads
 *   flow through this client.
 *
 * HOW IT WORKS:
 *   1. Defines the project URL and anonymous (public) API key.
 *   2. Checks that the Supabase JS SDK has already been loaded via a
 *      <script> tag in the HTML (it attaches `window.supabase`).
 *   3. Calls `window.supabase.createClient()` with the URL + key and
 *      exports the resulting client as `supabase`.
 *
 * PREREQUISITES:
 *   The Supabase CDN script must be included in the HTML *before* this
 *   module is imported:
 *     <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
 *
 * HOW TO ADD FEATURES / MODIFY:
 *   • To change the Supabase project, update SUPABASE_URL and
 *     SUPABASE_ANON with values from your new project's Settings → API.
 *   • To add Supabase options (e.g. custom headers, localStorage key),
 *     pass an options object as the third argument to `createClient()`:
 *       export const supabase = window.supabase.createClient(
 *         SUPABASE_URL, SUPABASE_ANON, { auth: { persistSession: true } }
 *       );
 *   • To add Realtime subscriptions, import `supabase` in a new module
 *     and call `supabase.channel(...)`.
 * ═══════════════════════════════════════════════════════════════════════
 */

const SUPABASE_URL = "https://dntcmvspcwwdwnmyqfiw.supabase.co";
const SUPABASE_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRudGNtdnNwY3d3ZHdubXlxZml3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE3MDA5MDksImV4cCI6MjA4NzI3NjkwOX0.cgiLMn6YH0BnLshl_458nGwdjnAJaN3MZz8jT4lwfkc";

if (typeof window.supabase === "undefined") {
  throw new Error(
    "Supabase SDK not available. Ensure the script is loaded in the HTML.",
  );
}

export const supabase = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON,
);
