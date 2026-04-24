param(
  [string]$CollisionAtlasJson,
  [string]$CollisionAtlasPng,
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
$scanDefs = @(
  [pscustomobject]@{ key='hitbox'; type='hitbox'; subtype=$null; color='#FFFF00' },
  [pscustomobject]@{ key='weaponbox_strong_blade'; type='weaponbox'; subtype='strong_blade'; color='#E37800' },
  [pscustomobject]@{ key='weaponbox_weak_blade'; type='weaponbox'; subtype='weak_blade'; color='#FF0000' }
)
$collisionAtlas = Get-Content -Raw $CollisionAtlasJson | ConvertFrom-Json
$rootAtlas = Get-Content -Raw $RootAtlasJson | ConvertFrom-Json
$collisionFrames = Get-OrderedFrames $collisionAtlas
$rootFrames = Get-OrderedFrames $rootAtlas
$collisionBmp = [System.Drawing.Bitmap]::new($CollisionAtlasPng)
$rootBmp = [System.Drawing.Bitmap]::new($RootAtlasPng)
try {
  $tracks = @{}
  $outFrames = @()
  for ($i=0; $i -lt $collisionFrames.Count; $i++) {
    $fr = $collisionFrames[$i].data.frame
    $boxes = @()
    foreach ($scanDef in $scanDefs) {
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
    $rootAnchor = Extract-Root $rootBmp $rootFrames[$i].data.frame (Parse-HexColor '#7082C1')
    $outFrames += [pscustomobject]@{
      frameIndex = $i
      frameName = $collisionFrames[$i].name
      frameRect = [pscustomobject]@{ x=$fr.x; y=$fr.y; w=$fr.w; h=$fr.h }
      boxes = $boxes
      anchors = [pscustomobject]@{ root = $rootAnchor }
    }
  }
  $result = [pscustomobject]@{
    source = [pscustomobject]@{
      collisionAtlasJson = $CollisionAtlasJson
      collisionAtlasPng = $CollisionAtlasPng
      rootAtlasJson = $RootAtlasJson
      rootAtlasPng = $RootAtlasPng
      collisionTypeColors = @($scanDefs | ForEach-Object { [pscustomobject]@{ key=$_.key; type=$_.type; subtype=$_.subtype; color=$_.color } })
      rootColor = '#7082C1'
      colorTolerance = 0
      minPixels = 6
      minRootPixels = 1
      generatedAtUtc = [DateTime]::UtcNow.ToString('o')
    }
    frames = $outFrames
  }
  $result | ConvertTo-Json -Depth 8 | Set-Content -Path $OutJson -Encoding UTF8
} finally { $collisionBmp.Dispose(); $rootBmp.Dispose() }
