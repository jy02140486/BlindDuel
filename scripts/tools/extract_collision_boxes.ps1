param(
  [string]$AtlasJson,
  [string]$CollisionPng,
  [string]$RootPng,
  [string]$PushBoxPng,
  [string]$TrailMarkerPng,
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
function Get-OrientedBox($points) {
  $count = $points.Count
  $sumX = 0.0; $sumY = 0.0
  foreach ($p in $points) { $sumX += [double]$p.X; $sumY += [double]$p.Y }
  $meanX = $sumX / $count; $meanY = $sumY / $count
  $sxx = 0.0; $syy = 0.0; $sxy = 0.0
  foreach ($p in $points) {
    $dx = [double]$p.X - $meanX; $dy = [double]$p.Y - $meanY
    $sxx += $dx * $dx; $syy += $dy * $dy; $sxy += $dx * $dy
  }
  $sxx /= $count; $syy /= $count; $sxy /= $count
  $theta = 0.5 * [Math]::Atan2(2.0 * $sxy, ($sxx - $syy))
  $ux = [Math]::Cos($theta); $uy = [Math]::Sin($theta); $vx = -$uy; $vy = $ux
  $minU = [double]::PositiveInfinity; $maxU = [double]::NegativeInfinity; $minV = [double]::PositiveInfinity; $maxV = [double]::NegativeInfinity
  foreach ($p in $points) {
    $rx = [double]$p.X - $meanX; $ry = [double]$p.Y - $meanY
    $u = $rx * $ux + $ry * $uy; $v = $rx * $vx + $ry * $vy
    if ($u -lt $minU) { $minU = $u }
    if ($u -gt $maxU) { $maxU = $u }
    if ($v -lt $minV) { $minV = $v }
    if ($v -gt $maxV) { $maxV = $v }
  }
  $centerU = ($minU + $maxU) / 2.0; $centerV = ($minV + $maxV) / 2.0
  $centerX = $meanX + $centerU * $ux + $centerV * $vx
  $centerY = $meanY + $centerU * $uy + $centerV * $vy
  $width = ($maxU - $minU) + 1.0; $height = ($maxV - $minV) + 1.0
  $angleDeg = $theta * 180.0 / [Math]::PI
  if ($width -lt $height) { $tmp = $width; $width = $height; $height = $tmp; $angleDeg += 90.0 }
  while ($angleDeg -le -180.0) { $angleDeg += 360.0 }
  while ($angleDeg -gt 180.0) { $angleDeg -= 360.0 }
  return [pscustomobject]@{ cx=[Math]::Round($centerX,3); cy=[Math]::Round($centerY,3); w=[Math]::Round($width,3); h=[Math]::Round($height,3); angle=[Math]::Round($angleDeg,3) }
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
function Extract-Root($bmp, $fr, $target) {
  $regions = @(Extract-Regions $bmp $fr $target | Where-Object { $_.Count -ge 1 })
  if ($regions.Count -eq 0) { return $null }
  $best = $regions[0]
  $sumX = 0.0; $sumY = 0.0
  foreach ($p in $best) { $sumX += [double]$p.X; $sumY += [double]$p.Y }
  return [pscustomobject]@{ cx = [Math]::Round($sumX / $best.Count, 3); cy = [Math]::Round($sumY / $best.Count, 3) }
}
function Extract-Markers($bmp, $fr, $target, [int]$minPixels) {
  # Markers are points, not boxes: export only the centroid of each connected region, no OBB fitting.
  $regions = @(Extract-Regions $bmp $fr $target | Where-Object { $_.Count -ge $minPixels })
  $markers = @()
  foreach ($points in $regions) {
    $sumX = 0.0; $sumY = 0.0
    foreach ($p in $points) { $sumX += [double]$p.X; $sumY += [double]$p.Y }
    $markers += [pscustomobject]@{ cx = [Math]::Round($sumX / $points.Count, 3); cy = [Math]::Round($sumY / $points.Count, 3) }
  }
  # Sort by cx ascending so the first/second marker of a frame is stable.
  return @($markers | Sort-Object cx)
}
function Get-ProvenancePng([string]$outJsonPath, [string]$key) {
  if (-not ($outJsonPath -and (Test-Path $outJsonPath))) { return $null }
  try {
    $prev = Get-Content -Raw $outJsonPath | ConvertFrom-Json
    $prop = $prev.source.PSObject.Properties[$key]
    if ($prop -and $prop.Value) { return [string]$prop.Value }
  } catch { }
  return $null
}
function Get-CacheProp($obj, [string]$name) {
  if ($null -eq $obj) { return $null }
  $p = $obj.PSObject.Properties[$name]
  if ($p) { return $p.Value }
  return $null
}
function Test-CacheFrameLayout($cacheData, $frameNames) {
  if ($null -eq $cacheData) { return $false }
  $cached = @(Get-CacheProp $cacheData 'frameNames')
  if ($cached.Count -ne @($frameNames).Count) { return $false }
  for ($i=0; $i -lt $cached.Count; $i++) {
    if ($cached[$i] -ne @($frameNames)[$i]) { return $false }
  }
  return $true
}
function Get-ConventionalMaskPng([string]$atlasJsonPath, [string]$kind) {
  if (-not ($atlasJsonPath -and (Test-Path $atlasJsonPath))) { return $null }
  $maskDir = Split-Path -Parent $atlasJsonPath
  $dataRoot = Split-Path -Parent (Split-Path -Parent $maskDir)
  $character = Split-Path -Leaf $maskDir
  $baseName = [System.IO.Path]::GetFileNameWithoutExtension($atlasJsonPath)
  foreach ($dirName in @($character, ($character -replace '_', ''))) {
    $p = Join-Path (Join-Path (Join-Path $dataRoot $kind) $dirName) ($baseName + '.png')
    if (Test-Path $p) { return $p }
  }
  return $null
}
function Resolve-OptionalMask {
  param([string]$Kind, [string]$ParamPng, [string]$ProvenanceKey, [string]$AtlasJsonPath, [string]$OutJsonPath, $FrameNames)
  $probe = $ParamPng
  if (-not $probe) { $probe = Get-ProvenancePng $OutJsonPath $ProvenanceKey }
  if (-not $probe) { $probe = Get-ConventionalMaskPng $AtlasJsonPath $Kind }
  $pngExists = [bool]($probe -and (Test-Path $probe))
  $cachePath = $null
  $cacheData = $null
  $cacheValid = $false
  if ($probe) {
    $cachePath = [System.IO.Path]::ChangeExtension($probe, '.scancache')
    if (Test-Path $cachePath) {
      try { $cacheData = Get-Content -Raw $cachePath | ConvertFrom-Json } catch { }
      if ($cacheData -and (Test-CacheFrameLayout $cacheData $FrameNames)) {
        $cacheValid = $true
        if ($pngExists) {
          $pngUtc = [string](Get-CacheProp $cacheData 'sourcePngLastWriteUtc')
          if ($pngUtc -and ((Get-Item $probe).LastWriteTimeUtc.ToString('o') -gt $pngUtc)) {
            Write-Warning ('{0} png is newer than its cache, rescanning: {1}' -f $Kind, $probe)
            $cacheValid = $false
          }
        }
      } else {
        Write-Warning ('{0} cache frame layout mismatch with atlas, rescanning: {1}' -f $Kind, $cachePath)
      }
    }
  }
  if ($cacheValid) { return [pscustomobject]@{ mode='cache'; png=$probe; cache=$cacheData } }
  if ($pngExists) {
    if (-not (Test-Path ([System.IO.Path]::ChangeExtension($probe, '.scancache'))) -or $cacheData) {
      Write-Warning ('{0}: no valid cache, scanning to create/refresh it: {1}' -f $Kind, $probe)
    }
    return [pscustomobject]@{ mode='scan'; png=$probe }
  }
  Write-Warning ('{0}: no param, no cache, no mask png found; output frames will contain no {0} data' -f $Kind)
  return [pscustomobject]@{ mode='none' }
}
function Write-ScanCache([string]$pngPath, [string]$cacheType, $frameNames, $framesData) {
  $cachePath = [System.IO.Path]::ChangeExtension($pngPath, '.scancache')
  $cache = [pscustomobject]@{
    cacheType = $cacheType
    sourcePng = $pngPath
    sourcePngLastWriteUtc = (Get-Item $pngPath).LastWriteTimeUtc.ToString('o')
    scannedAtUtc = [DateTime]::UtcNow.ToString('o')
    frameNames = @($frameNames)
    frames = $framesData
  }
  $cache | ConvertTo-Json -Depth 8 | Set-Content -Path $cachePath -Encoding UTF8
  Write-Host ('{0} scan cache updated: {1}' -f $cacheType, $cachePath)
}
$rootColor = '#7082C1'
$handColor = '#FF00FF'
# Trail marker points (weapon trail): cyan, no conflict with existing scan colors
$trailMarkerColor = '#00FFFF'
$collisionScanDefs = @(
  [pscustomobject]@{ key='hitbox'; type='hitbox'; subtype=$null; color='#FFFF00' },
  [pscustomobject]@{ key='weaponbox_strong_blade'; type='weaponbox'; subtype='strong_blade'; color='#FF0000' },
  [pscustomobject]@{ key='weaponbox_weak_blade'; type='weaponbox'; subtype='weak_blade'; color='#E37800' }
)
$pushboxScanDefs = @(
  [pscustomobject]@{ key='pushbox'; type='pushbox'; subtype=$null; color='#00FF88' }
)
$atlas = Get-Content -Raw $AtlasJson | ConvertFrom-Json
$frames = Get-OrderedFrames $atlas
$collisionBmp = [System.Drawing.Bitmap]::new($CollisionPng)
$rootBmp = [System.Drawing.Bitmap]::new($RootPng)

$pushboxBmp = $null
$hasPushBox = $false
if ($PushBoxPng -and (Test-Path $PushBoxPng)) {
  $pushboxBmp = [System.Drawing.Bitmap]::new($PushBoxPng)
  $hasPushBox = $true
}

$trailMarkerBmp = $null
$hasTrailMarker = $false
if ($TrailMarkerPng -and (Test-Path $TrailMarkerPng)) {
  $trailMarkerBmp = [System.Drawing.Bitmap]::new($TrailMarkerPng)
  $hasTrailMarker = $true
}

# Optional masks (pushbox / trailmarker): param given -> scan & refresh cache;
# param missing -> reuse last scan result from <mask>.scancache (provenance / convention probe);
# no cache but mask png found -> scan to create the cache.
$frameNames = @($frames | ForEach-Object { $_.name })
$pushboxScanFrames = @()
$trailMarkerScanFrames = @()
$pushboxCacheData = $null
$pushboxProbePng = $null
$trailMarkerCacheData = $null
$trailMarkerProbePng = $null
if (-not $hasPushBox) {
  $res = Resolve-OptionalMask -Kind 'PushBox' -ParamPng $PushBoxPng -ProvenanceKey 'pushboxPng' -AtlasJsonPath $AtlasJson -OutJsonPath $OutJson -FrameNames $frameNames
  if ($res.mode -eq 'scan') {
    $pushboxBmp = [System.Drawing.Bitmap]::new($res.png)
    $PushBoxPng = $res.png
    $hasPushBox = $true
  } elseif ($res.mode -eq 'cache') {
    $pushboxCacheData = $res.cache
    $pushboxProbePng = $res.png
  }
}
if (-not $hasTrailMarker) {
  $res = Resolve-OptionalMask -Kind 'TrailMarker' -ParamPng $TrailMarkerPng -ProvenanceKey 'trailMarkerPng' -AtlasJsonPath $AtlasJson -OutJsonPath $OutJson -FrameNames $frameNames
  if ($res.mode -eq 'scan') {
    $trailMarkerBmp = [System.Drawing.Bitmap]::new($res.png)
    $TrailMarkerPng = $res.png
    $hasTrailMarker = $true
  } elseif ($res.mode -eq 'cache') {
    $trailMarkerCacheData = $res.cache
    $trailMarkerProbePng = $res.png
  }
}

try {
  $tracks = @{}
  $outFrames = @()
  for ($i=0; $i -lt $frames.Count; $i++) {
    Write-Progress -Activity ('Scanning collider: {0}' -f $AtlasJson) -Status ('frame {0}/{1}' -f ($i + 1), $frames.Count) -PercentComplete ([int](100 * ($i + 1) / $frames.Count))
    $fr = $frames[$i].data.frame
    $boxes = @()
    foreach ($scanDef in $collisionScanDefs) {
      $target = Parse-HexColor $scanDef.color
      $regions = @(Extract-Regions $collisionBmp $fr $target | Where-Object { $_.Count -ge 6 })
      $regionIndex = 0
      foreach ($points in $regions) {
        $obb = Get-OrientedBox $points
        $trackKey = $scanDef.key
        if (-not $tracks.ContainsKey($trackKey)) { $tracks[$trackKey] = 0 }
        $id = '{0}_{1}' -f $trackKey, $tracks[$trackKey]
        $tracks[$trackKey] = [int]$tracks[$trackKey] + 1
        $boxes += [pscustomobject]@{
          id = $id
          type = $scanDef.type
          subtype = $scanDef.subtype
          cx = $obb.cx
          cy = $obb.cy
          w = $obb.w
          h = $obb.h
          angle = $obb.angle
          pixelCount = $points.Count
        }
        $regionIndex++
      }
    }
    if ($hasPushBox) {
      $pushboxFrameBoxes = @()
      foreach ($scanDef in $pushboxScanDefs) {
        $target = Parse-HexColor $scanDef.color
        $regions = @(Extract-Regions $pushboxBmp $fr $target | Where-Object { $_.Count -ge 6 })
        foreach ($points in $regions) {
          $obb = Get-OrientedBox $points
          $trackKey = $scanDef.key
          if (-not $tracks.ContainsKey($trackKey)) { $tracks[$trackKey] = 0 }
          $id = '{0}_{1}' -f $trackKey, $tracks[$trackKey]
          $tracks[$trackKey] = [int]$tracks[$trackKey] + 1
          $pushboxFrameBoxes += [pscustomobject]@{
            id = $id
            type = $scanDef.type
            subtype = $scanDef.subtype
            cx = $obb.cx
            cy = $obb.cy
            w = $obb.w
            h = $obb.h
            angle = $obb.angle
            pixelCount = $points.Count
          }
        }
      }
      $boxes += $pushboxFrameBoxes
      $pushboxScanFrames += [pscustomobject]@{ frameIndex = $i; frameName = $frames[$i].name; boxes = $pushboxFrameBoxes }
    } elseif ($pushboxCacheData) {
      $cachedFrames = @($pushboxCacheData.frames)
      if ($i -lt $cachedFrames.Count) {
        $boxes += @($cachedFrames[$i].boxes | Where-Object { $_ })
      }
    }
    $trailMarkers = @()
    if ($hasTrailMarker) {
      $trailMarkers = @(Extract-Markers $trailMarkerBmp $fr (Parse-HexColor $trailMarkerColor) 2)
      if ($trailMarkers.Count -gt 2) {
        Write-Warning ('Frame {0} ({1}) has {2} trail markers, expected at most 2' -f $i, $frames[$i].name, $trailMarkers.Count)
      }
    }
    $rootAnchor = Extract-Root $rootBmp $fr (Parse-HexColor $rootColor)
    $handAnchor = Extract-Root $rootBmp $fr (Parse-HexColor $handColor)
    $outFrames += [pscustomobject]@{
      frameIndex = $i
      frameName = $frames[$i].name
      frameRect = [pscustomobject]@{ x=$fr.x; y=$fr.y; w=$fr.w; h=$fr.h }
      boxes = $boxes
      trailMarkers = $trailMarkers
      anchors = [pscustomobject]@{ root = $rootAnchor; hand = $handAnchor }
    }
  }
  Write-Progress -Activity ('Scanning collider: {0}' -f $AtlasJson) -Completed
  if ($hasPushBox) {
    Write-ScanCache $PushBoxPng 'pushbox' $frameNames $pushboxScanFrames
  }
  if ($hasTrailMarker) {
    Write-ScanCache $TrailMarkerPng 'trailmarker' $frameNames $trailMarkerScanFrames
  }
  $result = [pscustomobject]@{
    source = [pscustomobject]@{
      atlasJson = $AtlasJson
      collisionPng = $CollisionPng
      rootPng = $RootPng
      pushboxPng = $(if ($hasPushBox) { $PushBoxPng } elseif ($pushboxProbePng) { $pushboxProbePng } else { $null })
      pushboxSource = $(if ($hasPushBox) { 'scan' } elseif ($pushboxCacheData) { 'cache' } else { 'none' })
      trailMarkerPng = $(if ($hasTrailMarker) { $TrailMarkerPng } elseif ($trailMarkerProbePng) { $trailMarkerProbePng } else { $null })
      trailMarkerSource = $(if ($hasTrailMarker) { 'scan' } elseif ($trailMarkerCacheData) { 'cache' } else { 'none' })
      collisionTypeColors = @($collisionScanDefs | ForEach-Object { [pscustomobject]@{ key=$_.key; type=$_.type; subtype=$_.subtype; color=$_.color } })
      pushboxColor = '#00FF88'
      trailMarkerColor = $trailMarkerColor
      rootColor = $rootColor
      handColor = $handColor
      colorTolerance = 0
      minPixels = 6
      minRootPixels = 1
      minTrailMarkerPixels = 2
      generatedAtUtc = [DateTime]::UtcNow.ToString('o')
    }
    frames = $outFrames
  }
  $result | ConvertTo-Json -Depth 8 | Set-Content -Path $OutJson -Encoding UTF8
} finally {
  $collisionBmp.Dispose()
  $rootBmp.Dispose()
  if ($pushboxBmp) { $pushboxBmp.Dispose() }
  if ($trailMarkerBmp) { $trailMarkerBmp.Dispose() }
}

