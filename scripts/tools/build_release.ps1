# build_release.ps1 - Build a release dist from the dev source tree.
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts/tools/build_release.ps1            # build dist/
#   powershell -ExecutionPolicy Bypass -File scripts/tools/build_release.ps1 -Zip       # build + itch.io zip
#   powershell -ExecutionPolicy Bypass -File scripts/tools/build_release.ps1 -Serve     # build + local serve dist/
param(
    [switch]$Zip,
    [switch]$Serve
)
$ErrorActionPreference = "Stop"

# Repo root = parent of scripts/tools
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$dist = Join-Path $root "dist"
$fail = 0

# Full run log written next to the repo root
Start-Transcript -Path (Join-Path $root "build_release.log") -Force | Out-Null

Write-Host "=== BlindDuel release build ==="
Write-Host "root: $root"

if (Test-Path $dist) { Remove-Item -Recurse -Force $dist }
New-Item -ItemType Directory -Path $dist | Out-Null

# ---------- 1. Whitelist copy ----------
Copy-Item (Join-Path $root "babylon_demo.html") (Join-Path $dist "index.html")
Copy-Item (Join-Path $root "style.css") $dist
Copy-Item (Join-Path $root "character_demo.js") $dist
New-Item -ItemType Directory -Path (Join-Path $dist "lib") | Out-Null
Copy-Item (Join-Path $root "lib\babylon.js") (Join-Path $dist "lib")

# scripts/ (exclude tools and any ps1)
New-Item -ItemType Directory -Path (Join-Path $dist "scripts") | Out-Null
Get-ChildItem (Join-Path $root "scripts") -Exclude "tools" |
    Copy-Item -Destination (Join-Path $dist "scripts") -Recurse -Force
Get-ChildItem (Join-Path $dist "scripts") -Recurse -File -Filter *.ps1 | Remove-Item -Force

# Data/ (exclude PushBox / TrailMarker; strip RootMotion png)
New-Item -ItemType Directory -Path (Join-Path $dist "Data") | Out-Null
Get-ChildItem (Join-Path $root "Data") -Exclude "PushBox", "TrailMarker" |
    Copy-Item -Destination (Join-Path $dist "Data") -Recurse -Force
Get-ChildItem (Join-Path $dist "Data\RootMotion") -Recurse -File -Filter *.png -ErrorAction SilentlyContinue |
    Remove-Item -Force

# Art/ (exclude RawAssets)
New-Item -ItemType Directory -Path (Join-Path $dist "Art") | Out-Null
Get-ChildItem (Join-Path $root "Art") -Exclude "RawAssets" |
    Copy-Item -Destination (Join-Path $dist "Art") -Recurse -Force

# Audio/ (exclude _raw and sfx_converted; _converted IS runtime-referenced by audio_clips.json)
Copy-Item (Join-Path $root "Audio") (Join-Path $dist "Audio") -Recurse -Force
Get-ChildItem (Join-Path $dist "Audio") -Recurse -Directory |
    Where-Object { $_.Name -eq "_raw" -or $_.FullName -like "*sfx_converted*" } |
    Remove-Item -Recurse -Force

# docs needed at runtime: Credits menu fetches these two files (attribution compliance)
New-Item -ItemType Directory -Path (Join-Path $dist "docs") | Out-Null
Copy-Item (Join-Path $root "docs\Credits.MD") (Join-Path $dist "docs")
Copy-Item (Join-Path $root "docs\AudioLicensesInfo.MD") (Join-Path $dist "docs")

# Strip scancache anywhere in dist
Get-ChildItem $dist -Recurse -File -Filter *.scancache | Remove-Item -Force

# ---------- 2. Release flag overwrite ----------
Set-Content -Path (Join-Path $dist "scripts\ReleaseFlag.js") `
    -Value "export const IS_RELEASE = true;" -Encoding ASCII

# ---------- 3. Asset integrity check ----------
$scanFiles = @()
if (Test-Path (Join-Path $dist "character_demo.js")) {
    $scanFiles += Get-Item (Join-Path $dist "character_demo.js")
}
$scanFiles += @(Get-ChildItem (Join-Path $dist "scripts") -Recurse -File -Filter *.js)
$scanFiles += @(Get-ChildItem (Join-Path $dist "Data") -Recurse -File -Filter *.json)

# Normalize a path with ../ segments against a base dir (both dist-relative, / separated)
function Resolve-RelPath([string]$baseDir, [string]$rel) {
    $combined = "$baseDir/$rel"
    $parts = @()
    foreach ($seg in ($combined -split '/')) {
        if ($seg -eq '' -or $seg -eq '.') { continue }
        if ($seg -eq '..') {
            if ($parts.Count -gt 1) { $parts = $parts[0..($parts.Count - 2)] }
            elseif ($parts.Count -eq 1) { $parts = @() }
            continue
        }
        $parts += $seg
    }
    return ($parts -join '/')
}

# Each ref: raw string + referencing file's dist dir (for relative resolution)
$refs = New-Object System.Collections.Generic.List[object]
foreach ($f in $scanFiles) {
    # collider.json files are tool provenance only (audit 26.11.26): skip entirely
    if ($f.Name -like "*.collider.json") { continue }
    $text = Get-Content -Raw -LiteralPath $f.FullName
    if ([string]::IsNullOrEmpty($text)) { continue }
    $fromDir = $f.DirectoryName.Substring($dist.Length).Replace('\', '/').TrimStart('/')
    foreach ($m in [regex]::Matches($text, '"([^"\?\n]*[\\/][^"\?\n]*?\.(?:js|json|png|wav|ogg|m4a|jpg|jpeg|md))(?:\?[^"\n]*)?"', 'IgnoreCase')) {
        $raw = $m.Groups[1].Value -replace '\\', '/'
        if ($raw -match '^(https?:)?//') { continue }
        $refs.Add(@{ raw = $raw; fromDir = $fromDir; from = $f.FullName })
    }
}

$distFiles = Get-ChildItem $dist -Recurse -File |
    ForEach-Object { $_.FullName.Substring($dist.Length + 1) -replace '\\', '/' }
$exact = @{}; $lower = @{}
foreach ($p in $distFiles) { $exact[$p] = $true; $lower[$p.ToLower()] = $p }

$caseErrors = @(); $missing = @()
foreach ($r in $refs) {
    $raw = $r.raw
    if ($raw -match '/_raw/' -or $raw -like "*sfx_converted*") { continue }
    if ($raw -match '^[A-Za-z]:/') { continue }   # absolute source paths recorded by extraction tools

    # Candidate 1: resolve relative to the referencing file's dir (ES imports).
    # Candidate 2: root-relative (fetch("Art/..."), manifest JSON "Data/..." style).
    $candidates = @((Resolve-RelPath $r.fromDir $raw))
    $rootRel = ($raw -replace '/+', '/') -replace '^(\./|/)', ''
    if ($rootRel -notin $candidates) { $candidates += $rootRel }

    # Excluded-by-design targets (audit 26.11.26)
    $skip = $false
    foreach ($c in $candidates) {
        if ($c -match '^Data/(RootMotion|PushBox|TrailMarker)/.+\.png$') { $skip = $true }
        if ($c -match '^Data/(PushBox|TrailMarker)/') { $skip = $true }
    }
    if ($skip) { continue }

    $hit = $null; $hitLower = $null
    foreach ($c in $candidates) { if ($exact.ContainsKey($c)) { $hit = $c; break } }
    if ($hit) { continue }
    foreach ($c in $candidates) { if ($lower.ContainsKey($c.ToLower())) { $hitLower = $c; break } }
    if ($hitLower) {
        $caseErrors += "$hitLower  (referenced as '$raw' from: $($r.from))"
    } else {
        $missing += "$raw  (from: $($r.from))"
    }
}

# ---------- 4. Summary ----------
$fileCount = $distFiles.Count
$sizeMB = [math]::Round(((Get-ChildItem $dist -Recurse -File |
    Measure-Object Length -Sum).Sum / 1MB), 1)
Write-Host ""
Write-Host "dist files: $fileCount  size: $sizeMB MB"
Write-Host "refs scanned: $($refs.Count)"

if ($caseErrors.Count -gt 0) {
    $fail = 1
    Write-Host "CASE MISMATCH (Linux target is case-sensitive):" -ForegroundColor Red
    $caseErrors | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
}
if ($missing.Count -gt 0) {
    $fail = 1
    Write-Host "MISSING FILES:" -ForegroundColor Red
    $missing | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
}
if ($fail -eq 0) { Write-Host "Integrity check PASSED" -ForegroundColor Green }

Stop-Transcript | Out-Null

if ($Zip) {
    $zipPath = Join-Path $root "BlindDuel_release.zip"
    Compress-Archive -Path (Join-Path $dist "*") -DestinationPath $zipPath -Force
    Write-Host "zip written: $zipPath"
}
if ($Serve) {
    Write-Host "serving dist/ at http://127.0.0.1:9000 (Ctrl+C to stop)"
    Push-Location $dist
    python -m http.server 9000 --bind 127.0.0.1
    Pop-Location
}
exit $fail