<#
.SYNOPSIS
  Syncs src/ to docs/ for GitHub Pages deployment.

.DESCRIPTION
  Cleans docs/, then mirrors everything from src/ into docs/.
  (db/ now lives at the project root, outside src/, so no exclusion needed.)

  JS file layout (organised by architectural role):
    src/js/pages/admin.js              — admin dashboard entry point
    src/js/pages/directory.js          — public directory entry point
    src/js/pages/home.js               — homepage + portfolio gallery entry point
    src/js/pages/portfolio-admin.js    — portfolio admin tab entry point
    src/js/services/api.js             — shared data-fetching / Supabase queries
    src/js/services/supabase.js        — shared Supabase client bootstrap
    src/js/utils/constants.js          — shared constants (regions, tags, categories)
    src/js/utils/utils.js              — shared utility functions
    src/js/utils/media-assets.js       — media asset normalisation + validation

  CSS files:
    src/css/base.css       — design tokens, reset, global styles (loaded everywhere)
    src/css/site.css       — homepage, portfolio, pricing styles
    src/css/directory.css  — public directory styles
    src/css/admin.css      — admin dashboard styles

  Workflow:
  # 1) Work in dev
  git checkout dev

  # 2) Edit files in src/

  # 3) Sync src -> docs
  ./scripts/sync-src-to-docs.ps1

  # 4) Save changes
  git add -A
  git commit -m "might regret this  pt2"

  # 5) Publish to live site
  git pull origin dev --rebase
  git pull origin main --rebase
  git push origin dev (DO THIS FIRST)
  git push origin dev:main (THEN THIS)

  
#>

$ErrorActionPreference = 'Stop'

# Resolve paths relative to repo root (one level up from scripts/)
$repoRoot = Split-Path $PSScriptRoot -Parent
$src      = Join-Path $repoRoot 'src'
$docs     = Join-Path $repoRoot 'docs'

# ── 1. Validate src/ exists ──────────────────────────────────────────────
if (-not (Test-Path $src)) {
    Write-Error "src/ directory not found at: $src"
    exit 1
}

# ── 2. Clean docs/ (preserve .git if present) ───────────────────────────
if (Test-Path $docs) {
    Write-Host "[sync] Cleaning docs/ ..." -ForegroundColor Yellow
    Get-ChildItem $docs -Exclude '.git','.nojekyll' | Remove-Item -Recurse -Force
} else {
    New-Item -ItemType Directory -Path $docs | Out-Null
}

# ── 3. Copy src/ -> docs/ ────────────────────────────────────────────
Write-Host "[sync] Copying src/ -> docs/ ..." -ForegroundColor Cyan

# robocopy is the most reliable way on Windows: mirror mode
$roboArgs = @(
    $src,
    $docs,
    '/MIR',          # Mirror directory tree
    '/NFL', '/NDL',  # No file/directory logging (cleaner output)
    '/NJH', '/NJS',  # No job header/summary
    '/R:1', '/W:1'   # Minimal retries
)

& robocopy @roboArgs | Out-Null

# robocopy exit codes 0-7 are success
if ($LASTEXITCODE -gt 7) {
    Write-Error "robocopy failed with exit code $LASTEXITCODE"
    exit 1
}

# ── 4. Ensure .nojekyll exists (disables Jekyll on GitHub Pages) ────────
$nojekyll = Join-Path $docs '.nojekyll'
if (-not (Test-Path $nojekyll)) {
    New-Item -ItemType File -Path $nojekyll | Out-Null
}

# ── 5. Summary ──────────────────────────────────────────────────────────
$fileCount = (Get-ChildItem $docs -Recurse -File).Count
Write-Host ""
Write-Host "[sync] Done! $fileCount files in docs/" -ForegroundColor Green
Write-Host "[sync] Ready to commit and push." -ForegroundColor Green
