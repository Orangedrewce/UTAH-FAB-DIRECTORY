<#
.SYNOPSIS
  Syncs src/ to docs/ for GitHub Pages deployment.

.DESCRIPTION
  Cleans docs/, then copies everything from src/ EXCEPT the db/ folder
  (SQL schemas and migration scripts are dev-only).

  JS file layout (all entry points and modules live under src/js/modules/):
    src/js/modules/admin.js       — admin dashboard entry point
    src/js/modules/directory.js   — public directory entry point
    src/js/modules/script.js      — index/lightbox/contact entry point
    src/js/modules/supabase.js    — shared Supabase client
    src/js/modules/constants.js   — shared constants (regions, tags, categories)
    src/js/modules/utils.js       — shared utility functions
    src/js/modules/api.js         — shared data-fetching functions

  Workflow:
  # 1) Work in dev
  git checkout dev

  # 2) Edit files in src/

  # 3) Sync src -> docs
  ./scripts/sync-src-to-docs.ps1

  # 4) Save changes
  git add -A
  git commit -m "major additions, portfolio site"

  # 5) Publish to live site
  git pull origin dev --rebase
  git pull origin main --rebase
  git push origin dev
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

# ── 3. Copy src/ -> docs/ (excluding db/) ───────────────────────────────
Write-Host "[sync] Copying src/ -> docs/ (excluding db/) ..." -ForegroundColor Cyan

# robocopy is the most reliable way on Windows: mirror mode, exclude db/
$roboArgs = @(
    $src,
    $docs,
    '/MIR',          # Mirror directory tree
    '/XD', (Join-Path $src 'db'),   # Exclude db/
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
