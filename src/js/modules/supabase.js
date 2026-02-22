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
