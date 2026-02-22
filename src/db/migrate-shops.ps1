<#
  migrate-shops.ps1
  Reads shops.json and generates migrate-data.sql with INSERT statements
  for the fab_shops table in Supabase.

  Usage:  .\migrate-shops.ps1
  Output: migrate-data.sql  (paste into Supabase SQL Editor)
#>

$shops = Get-Content -Path "shops.json" -Raw | ConvertFrom-Json

function SqlEscape ([string]$s) {
    if (!$s) { return '' }
    return $s.Replace("'", "''")
}

$lines = @()
$lines += "-- ═══════════════════════════════════════════════════════════════"
$lines += "-- DATA MIGRATION - shops.json to fab_shops"
$lines += "-- Generated $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
$lines += "-- ═══════════════════════════════════════════════════════════════"
$lines += ""
$lines += "INSERT INTO fab_shops (name, region, city, category, size_desc, services, notable_desc, website, tags, is_notable, is_active, sort_order)"
$lines += "VALUES"

$values = @()
$sort = 0

foreach ($s in $shops) {
    $sort++
    $name     = SqlEscape $s.name
    $region   = SqlEscape $s.region
    $city     = SqlEscape $s.city
    $category = SqlEscape $s.category
    $sizeDesc = SqlEscape $s.size
    $services = SqlEscape $s.services
    $notable  = SqlEscape $s.notable
    $website  = SqlEscape $s.website
    $isNotable = if ($s.isNotable) { 'true' } else { 'false' }

    # Build PostgreSQL TEXT[] literal
    if ($s.tags -and $s.tags.Count -gt 0) {
        $tagItems = ($s.tags | ForEach-Object { "'$(SqlEscape $_)'" }) -join ','
        $tagsLiteral = "ARRAY[$tagItems]::TEXT[]"
    } else {
        $tagsLiteral = "'{}'::TEXT[]"
    }

    $row = "  ('$name', '$region', '$city', '$category', '$sizeDesc', '$services', '$notable', '$website', $tagsLiteral, $isNotable, true, $sort)"
    $values += $row
}

$lines += ($values -join ",`n")
$lines += ";"

$sql = $lines -join "`n"
$sql | Out-File -FilePath "migrate-data.sql" -Encoding utf8

Write-Host "Done - Generated migrate-data.sql with $($shops.Count) INSERT rows"
