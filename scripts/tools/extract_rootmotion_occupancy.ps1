param(
  [string]$RootAtlasJson,
  [string]$RootAtlasPng,
  [string]$OutJson
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

function Parse-HexColor([string]$hex) {
  $clean = $hex.Trim().TrimStart('#')
  [pscustomobject]@{ R=[Convert]::ToInt32($clean.Substring(0,2),16); G=[Convert]::ToInt32($clean.Substring(2,2),16); B=[Convert]::ToInt32($clean.Substring(4,2),16) }
}

function Match-Color([System.Drawing.Color]$c, $t) {
  return $c.A -ne 0 -and $c.R -eq $t.R -and $c.G -eq $t.G -and $c.B -eq $t.B
}

function Get-OrderedFrames($atlas) {
  $frames = @()
  foreach ($p in $atlas.frames.PSObject.Properties) {
    $frames += [pscustomobject]@{ name = $p.Name; data = $p.Value }
  }
  return @($frames | Sort-Object { $_.data.frame.y }, { $_.data.frame.x }, name)
}

function Extract-Regions($bmp, $fr, $target) {
  $fw = [int]$fr.w; $fh = [int]$fr.h; $fx=[int]$fr.x; $fy=[int]$fr.y
  $visited = New-Object 'bool[,]' $fw, $fh
  $dirs = @(@(-1,-1),@(0,-1),@(1,-1),@(-1,0),@(1,0),@(-1,1),@(0,1),@(1,1))
  $regions = @()
  for ($ly=0; $ly -lt $fh; $ly++) {
    for ($lx=0; $lx -lt $fw; $lx++) {
      if ($visited[$lx,$ly]) { continue }
      $c = $bmp.GetPixel($fx + $lx, $fy + $ly)
      if (-not (Match-Color $c $target)) { $visited[$lx,$ly] = $true; continue }
      $queue = New-Object System.Collections.Generic.Queue[object]
      $points = New-Object System.Collections.ArrayList
      $queue.Enqueue([pscustomobject]@{ X=$lx; Y=$ly })
      $visited[$lx,$ly] = $true
      while ($queue.Count -gt 0) {
        $p = $queue.Dequeue(); [void]$points.Add($p)
        foreach ($d in $dirs) {
          $nx = $p.X + $d[0]; $ny = $p.Y + $d[1]
          if ($nx -lt 0 -or $ny -lt 0 -or $nx -ge $fw -or $ny -ge $fh) { continue }
          if ($visited[$nx,$ny]) { continue }
          $nc = $bmp.GetPixel($fx + $nx, $fy + $ny)
          if (Match-Color $nc $target) {
            $visited[$nx,$ny] = $true
            $queue.Enqueue([pscustomobject]@{ X=$nx; Y=$ny })
          } else {
            $visited[$nx,$ny] = $true
          }
        }
      }
      $regions += ,$points
    }
  }
  return $regions
}

function Extract-Root($bmp, $fr, $target, $prevRoot) {
  $regions = @(Extract-Regions $bmp $fr $target | Where-Object { $_.Count -ge 1 })
  if ($regions.Count -eq 0) {
    if ($prevRoot) {
      Write-Warning "Frame '$($fr)' has no root pixels, reusing previous frame root."
      return $prevRoot
    }
    Write-Warning "Frame '$($fr)' has no root pixels, using default fallback."
    return [pscustomobject]@{ cx = [Math]::Round($fr.w / 2.0, 3); cy = [Math]::Round($fr.h * 0.8, 3) }
  }
  $best = $regions[0]
  $sumX = 0.0; $sumY = 0.0
  foreach ($p in $best) { $sumX += [double]$p.X; $sumY += [double]$p.Y }
  return [pscustomobject]@{ cx = [Math]::Round($sumX / $best.Count, 3); cy = [Math]::Round($sumY / $best.Count, 3) }
}

$ROOT_COLOR = '#7082C1'
$OCCUPANCY_W = 40
$OCCUPANCY_H = 24

$rootAtlas = Get-Content -Raw $RootAtlasJson | ConvertFrom-Json
$rootFrames = Get-OrderedFrames $rootAtlas

if (@($rootFrames).Count -eq 0) {
  Write-Error "Root atlas contains no frames."
  exit 1
}

$rootBmp = [System.Drawing.Bitmap]::new($RootAtlasPng)
$rootTarget = Parse-HexColor $ROOT_COLOR

try {
  $outFrames = @()
  $prevRoot = $null

  for ($i=0; $i -lt @($rootFrames).Count; $i++) {
    $fr = $rootFrames[$i].data.frame
    $rootAnchor = Extract-Root $rootBmp $fr $rootTarget $prevRoot
    $prevRoot = $rootAnchor

    $outFrames += [pscustomobject]@{
      frameIndex = $i
      frameName = $rootFrames[$i].name
      frameRect = [pscustomobject]@{ x=$fr.x; y=$fr.y; w=$fr.w; h=$fr.h }
      anchors = [pscustomobject]@{ root = $rootAnchor }
      occupancy = [pscustomobject]@{
        type = "aabb"
        cx = $rootAnchor.cx
        cy = $rootAnchor.cy
        w = $OCCUPANCY_W
        h = $OCCUPANCY_H
      }
    }
  }

  $result = [pscustomobject]@{
    source = [pscustomobject]@{
      rootAtlasJson = $RootAtlasJson
      rootAtlasPng = $RootAtlasPng
      rootColor = $ROOT_COLOR
      occupancyWidthPx = $OCCUPANCY_W
      occupancyHeightPx = $OCCUPANCY_H
      generatedAtUtc = [DateTime]::UtcNow.ToString('o')
    }
    frames = $outFrames
  }

  $result | ConvertTo-Json -Depth 8 | Set-Content -Path $OutJson -Encoding UTF8
  Write-Host "OK: wrote $($outFrames.Count) frames to $OutJson"
} finally {
  $rootBmp.Dispose()
}