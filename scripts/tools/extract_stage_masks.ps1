param(
  [Parameter(Mandatory=$true)][string]$OutJson,
  [float]$PxToWorld = 0.03,
  # 兼容旧版：单图模式
  [string]$MaskPng = $null,
  # 新版：三图分离模式
  [string]$WalkPng = $null,
  [string]$ObstaclePng = $null,
  [string]$DepthPng = $null
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

# ── 颜色定义 ──
$WALK_AREA_COLOR  = '#00FFFF'
$PUSHBOX_COLOR    = '#00FF88'
$DEPTH_MASK_COLOR = '#FF00FF'

# ══════════════════════════════════════════════
# 工具函数
# ══════════════════════════════════════════════

function Parse-HexColor([string]$hex) {
  $clean = $hex.Trim().TrimStart('#')
  return [pscustomobject]@{
    R = [Convert]::ToInt32($clean.Substring(0, 2), 16)
    G = [Convert]::ToInt32($clean.Substring(2, 2), 16)
    B = [Convert]::ToInt32($clean.Substring(4, 2), 16)
  }
}

function Match-Color([System.Drawing.Color]$c, $t) {
  return $c.A -ne 0 -and $c.R -eq $t.R -and $c.G -eq $t.G -and $c.B -eq $t.B
}

# 将 Bitmap 锁定并读取为字节数组 [R,G,B,A, R,G,B,A, ...]
function Lock-BitmapData($bmp) {
  $rect = [System.Drawing.Rectangle]::new(0, 0, $bmp.Width, $bmp.Height)
  $flags = [System.Drawing.Imaging.ImageLockMode]::ReadOnly
  $format = [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
  $data = $bmp.LockBits($rect, $flags, $format)
  $bytes = New-Object byte[] ($data.Stride * $data.Height)
  [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
  $bmp.UnlockBits($data)
  return [pscustomobject]@{
    bytes = $bytes
    stride = $data.Stride
    width = $bmp.Width
    height = $bmp.Height
  }
}

function Get-PixelColor($imgData, $x, $y) {
  $idx = $y * $imgData.stride + $x * 4
  $b = $imgData.bytes[$idx]
  $g = $imgData.bytes[$idx + 1]
  $r = $imgData.bytes[$idx + 2]
  $a = $imgData.bytes[$idx + 3]
  return [System.Drawing.Color]::FromArgb($a, $r, $g, $b)
}

# 提取指定颜色的所有连通域（基于内存字节数组，性能优化版）
function Extract-Regions($imgData, $fr, $target) {
  $fw = [int]$fr.w; $fh = [int]$fr.h; $fx = [int]$fr.x; $fy = [int]$fr.y
  $visited = New-Object 'bool[,]' $fw, $fh
  $dirs = @(@(-1,0),@(1,0),@(0,-1),@(0,1))  # 4连通，减少扫描量
  $regions = [System.Collections.Generic.List[object]]::new()

  for ($ly = 0; $ly -lt $fh; $ly++) {
    for ($lx = 0; $lx -lt $fw; $lx++) {
      if ($visited[$lx, $ly]) { continue }
      $c = Get-PixelColor $imgData ($fx + $lx) ($fy + $ly)
      if (-not (Match-Color $c $target)) { $visited[$lx, $ly] = $true; continue }

      $queue = [System.Collections.Generic.Queue[object]]::new()
      $points = [System.Collections.Generic.List[object]]::new()
      $queue.Enqueue([pscustomobject]@{ X = $lx; Y = $ly })
      $visited[$lx, $ly] = $true

      while ($queue.Count -gt 0) {
        $p = $queue.Dequeue()
        [void]$points.Add($p)
        foreach ($d in $dirs) {
          $nx = $p.X + $d[0]; $ny = $p.Y + $d[1]
          if ($nx -lt 0 -or $ny -lt 0 -or $nx -ge $fw -or $ny -ge $fh) { continue }
          if ($visited[$nx, $ny]) { continue }
          $nc = Get-PixelColor $imgData ($fx + $nx) ($fy + $ny)
          if (Match-Color $nc $target) {
            $visited[$nx, $ny] = $true
            $queue.Enqueue([pscustomobject]@{ X = $nx; Y = $ny })
          }
          else {
            $visited[$nx, $ny] = $true
          }
        }
      }
      $regions.Add($points)
    }
  }
  return $regions
}

# 从点集计算 AABB（像素坐标，min/max）
function Get-AABB($points) {
  $minX = [int]::MaxValue; $minY = [int]::MaxValue
  $maxX = [int]::MinValue; $maxY = [int]::MinValue
  foreach ($p in $points) {
    if ($p.X -lt $minX) { $minX = $p.X }
    if ($p.Y -lt $minY) { $minY = $p.Y }
    if ($p.X -gt $maxX) { $maxX = $p.X }
    if ($p.Y -gt $maxY) { $maxY = $p.Y }
  }
  return [pscustomobject]@{ minX = $minX; minY = $minY; maxX = $maxX; maxY = $maxY }
}

# 像素坐标 → 世界坐标（以图像中心为原点）
function PxToWorld($px, $py, $imgW, $imgH) {
  return [pscustomobject]@{
    x = [Math]::Round(($px - $imgW / 2.0) * $script:PxToWorld, 3)
    y = [Math]::Round(($imgH / 2.0 - $py) * $script:PxToWorld, 3)
  }
}

# AABB 像素 → AABB 世界坐标
function AABB-ToWorld($aabb, $imgW, $imgH) {
  $tl = PxToWorld $aabb.minX $aabb.minY $imgW $imgH
  $br = PxToWorld $aabb.maxX $aabb.maxY $imgW $imgH
  return [pscustomobject]@{
    x = [Math]::Round($tl.x, 3)
    y = [Math]::Round($br.y, 3)
    w = [Math]::Round($br.x - $tl.x, 3)
    h = [Math]::Round($tl.y - $br.y, 3)
  }
}

# ══════════════════════════════════════════════
# 主逻辑
# ══════════════════════════════════════════════

# 判断模式：旧版单图 或 新版三图分离
$useSeparate = $WalkPng -and $ObstaclePng -and $DepthPng

if ($useSeparate) {
  if (-not (Test-Path $WalkPng)) { Write-Error "Walk PNG not found: $WalkPng"; exit 1 }
  if (-not (Test-Path $ObstaclePng)) { Write-Error "Obstacle PNG not found: $ObstaclePng"; exit 1 }
  if (-not (Test-Path $DepthPng)) { Write-Error "Depth PNG not found: $DepthPng"; exit 1 }
} else {
  if (-not $MaskPng) { Write-Error "Must provide either -MaskPng (legacy) or all three: -WalkPng, -ObstaclePng, -DepthPng"; exit 1 }
  if (-not (Test-Path $MaskPng)) { Write-Error "Mask PNG not found: $MaskPng"; exit 1 }
}

# ── 辅助：从单图提取指定颜色的 AABB ──
function Extract-ColorAABBs($pngPath, $colorHex) {
  $bmp = [System.Drawing.Bitmap]::new($pngPath)
  try {
    $imgW = $bmp.Width; $imgH = $bmp.Height
    $imgData = Lock-BitmapData $bmp
    $fullFrame = [pscustomobject]@{ x = 0; y = 0; w = $imgW; h = $imgH }
    $target = Parse-HexColor $colorHex
    $regions = @(Extract-Regions $imgData $fullFrame $target | Where-Object { $_.Count -ge 4 })
    $aabbs = @()
    foreach ($region in $regions) {
      $aabb = Get-AABB $region
      $aabbs += [pscustomobject]@{
        pixelAABB = $aabb
        world = AABB-ToWorld $aabb $imgW $imgH
        pixelCount = $region.Count
      }
    }
    return [pscustomobject]@{ imgW = $imgW; imgH = $imgH; aabbs = $aabbs }
  } finally {
    $bmp.Dispose()
  }
}

# ── 辅助：从独立 PNG 提取所有非透明像素（单通道模式） ──
function Extract-AllAABBs($pngPath) {
  $bmp = [System.Drawing.Bitmap]::new($pngPath)
  try {
    $imgW = $bmp.Width; $imgH = $bmp.Height
    $imgData = Lock-BitmapData $bmp
    $fullFrame = [pscustomobject]@{ x = 0; y = 0; w = $imgW; h = $imgH }
    # 使用一个虚拟目标颜色，实际只判断 alpha > 0
    $regions = @(Extract-RegionsAny $imgData $fullFrame | Where-Object { $_.Count -ge 4 })
    $aabbs = @()
    foreach ($region in $regions) {
      $aabb = Get-AABB $region
      $aabbs += [pscustomobject]@{
        pixelAABB = $aabb
        world = AABB-ToWorld $aabb $imgW $imgH
        pixelCount = $region.Count
      }
    }
    return [pscustomobject]@{ imgW = $imgW; imgH = $imgH; aabbs = $aabbs }
  } finally {
    $bmp.Dispose()
  }
}

# 提取任意非透明像素连通域（用于独立图层）
function Extract-RegionsAny($imgData, $fr) {
  $fw = [int]$fr.w; $fh = [int]$fr.h; $fx = [int]$fr.x; $fy = [int]$fr.y
  $visited = New-Object 'bool[,]' $fw, $fh
  $dirs = @(@(-1,0),@(1,0),@(0,-1),@(0,1))
  $regions = [System.Collections.Generic.List[object]]::new()

  for ($ly = 0; $ly -lt $fh; $ly++) {
    for ($lx = 0; $lx -lt $fw; $lx++) {
      if ($visited[$lx, $ly]) { continue }
      $c = Get-PixelColor $imgData ($fx + $lx) ($fy + $ly)
      if ($c.A -eq 0) { $visited[$lx, $ly] = $true; continue }

      $queue = [System.Collections.Generic.Queue[object]]::new()
      $points = [System.Collections.Generic.List[object]]::new()
      $queue.Enqueue([pscustomobject]@{ X = $lx; Y = $ly })
      $visited[$lx, $ly] = $true

      while ($queue.Count -gt 0) {
        $p = $queue.Dequeue()
        [void]$points.Add($p)
        foreach ($d in $dirs) {
          $nx = $p.X + $d[0]; $ny = $p.Y + $d[1]
          if ($nx -lt 0 -or $ny -lt 0 -or $nx -ge $fw -or $ny -ge $fh) { continue }
          if ($visited[$nx, $ny]) { continue }
          $nc = Get-PixelColor $imgData ($fx + $nx) ($fy + $ny)
          if ($nc.A -gt 0) {
            $visited[$nx, $ny] = $true
            $queue.Enqueue([pscustomobject]@{ X = $nx; Y = $ny })
          } else {
            $visited[$nx, $ny] = $true
          }
        }
      }
      $regions.Add($points)
    }
  }
  return $regions
}

# ══════════════════════════════════════════════
# 提取数据
# ══════════════════════════════════════════════

if ($useSeparate) {
  # 三图分离模式
  Write-Host "Mode: separate PNGs"
  Write-Host "  walk: $WalkPng"
  Write-Host "  obstacle: $ObstaclePng"
  Write-Host "  depth: $DepthPng"

  $walkResult = Extract-AllAABBs $WalkPng
  $obstacleResult = Extract-AllAABBs $ObstaclePng
  $depthResult = Extract-AllAABBs $DepthPng

  if (-not $walkResult) { Write-Error "Failed to extract walk area"; exit 1 }
  if (-not $obstacleResult) { Write-Error "Failed to extract obstacles"; exit 1 }
  if (-not $depthResult) { Write-Error "Failed to extract depth masks"; exit 1 }

  $imgW = $walkResult.imgW; $imgH = $walkResult.imgH
  Write-Host "Image: ${imgW}x${imgH}, pxToWorld=$PxToWorld"

  $walkAABBs = @($walkResult.aabbs)
  $pushboxAABBs = @($obstacleResult.aabbs)
  $depthAABBs = @($depthResult.aabbs)

  Write-Host "WalkArea regions: $($walkAABBs.Length)"
  Write-Host "PushBox regions: $($pushboxAABBs.Length)"
  Write-Host "DepthMask regions: $($depthAABBs.Length)"

  # 合并：按中心点距离匹配（分离模式下 pushbox 和 depthMask 应该对齐）
  $masks = @()
  $matchedDepth = @{}

  for ($pi = 0; $pi -lt $pushboxAABBs.Length; $pi++) {
    $pb = $pushboxAABBs[$pi]
    $pbCx = $pb.pixelAABB.minX + ($pb.pixelAABB.maxX - $pb.pixelAABB.minX) / 2
    $pbCy = $pb.pixelAABB.minY + ($pb.pixelAABB.maxY - $pb.pixelAABB.minY) / 2

    $bestDi = -1
    $bestDist = [double]::MaxValue

    for ($di = 0; $di -lt $depthAABBs.Length; $di++) {
      if ($matchedDepth.ContainsKey($di)) { continue }
      $dm = $depthAABBs[$di]
      $dmCx = $dm.pixelAABB.minX + ($dm.pixelAABB.maxX - $dm.pixelAABB.minX) / 2
      $dmCy = $dm.pixelAABB.minY + ($dm.pixelAABB.maxY - $dm.pixelAABB.minY) / 2
      $dist = [Math]::Sqrt(($pbCx - $dmCx) * ($pbCx - $dmCx) + ($pbCy - $dmCy) * ($pbCy - $dmCy))
      if ($dist -lt $bestDist) {
        $bestDist = $dist
        $bestDi = $di
      }
    }

    $maskEntry = [pscustomobject]@{
      id = 'mask_' + $pi
      pushbox = $pb.world
      depthMask = $null
    }

    # 距离阈值：超过 50 像素认为不是同一障碍物
    if ($bestDi -ge 0 -and $bestDist -lt 50) {
      $maskEntry.depthMask = $depthAABBs[$bestDi].world
      $matchedDepth[$bestDi] = $true
    }

    $masks += $maskEntry
  }

  # 未匹配的 depthMask
  $unmatchedId = $pushboxAABBs.Length
  for ($di = 0; $di -lt $depthAABBs.Length; $di++) {
    if (-not $matchedDepth.ContainsKey($di)) {
      $masks += [pscustomobject]@{
        id = 'mask_' + $unmatchedId
        pushbox = $null
        depthMask = $depthAABBs[$di].world
      }
      $unmatchedId++
    }
  }

  Write-Host "Merged masks: $($masks.Count)"

  $result = [pscustomobject]@{
    source = [pscustomobject]@{
      mode = 'separate'
      walkImage = $WalkPng
      obstacleImage = $ObstaclePng
      depthImage = $DepthPng
      pxToWorld = $PxToWorld
      imageWidth = $imgW
      imageHeight = $imgH
      generatedAtUtc = [DateTime]::UtcNow.ToString('o')
    }
    walkArea = $walkAABBs | ForEach-Object { $_.world }
    masks = $masks
  }

} else {
  # 旧版单图模式（保留原有逻辑）
  $bmp = [System.Drawing.Bitmap]::new($MaskPng)
  $imgW = $bmp.Width; $imgH = $bmp.Height
  Write-Host "Image: ${imgW}x${imgH}, pxToWorld=$PxToWorld"

  try {
    $imgData = Lock-BitmapData $bmp
    $fullFrame = [pscustomobject]@{ x = 0; y = 0; w = $imgW; h = $imgH }

    $walkTarget = Parse-HexColor $WALK_AREA_COLOR
    $walkRegions = @(Extract-Regions $imgData $fullFrame $walkTarget | Where-Object { $_.Count -ge 4 })
    Write-Host "WalkArea regions: $($walkRegions.Count)"

    $walkAABBs = @()
    foreach ($region in $walkRegions) {
      $aabb = Get-AABB $region
      $walkAABBs += [pscustomobject]@{
        pixelAABB = $aabb
        world = AABB-ToWorld $aabb $imgW $imgH
        pixelCount = $region.Count
      }
    }

    $pushboxTarget = Parse-HexColor $PUSHBOX_COLOR
    $pushboxRegions = @(Extract-Regions $imgData $fullFrame $pushboxTarget | Where-Object { $_.Count -ge 4 })
    Write-Host "PushBox regions: $($pushboxRegions.Count)"

    $pushboxAABBs = @()
    foreach ($region in $pushboxRegions) {
      $aabb = Get-AABB $region
      $pushboxAABBs += [pscustomobject]@{
        pixelAABB = $aabb
        world = AABB-ToWorld $aabb $imgW $imgH
        pixelCount = $region.Count
      }
    }

    $depthTarget = Parse-HexColor $DEPTH_MASK_COLOR
    $depthRegions = @(Extract-Regions $imgData $fullFrame $depthTarget | Where-Object { $_.Count -ge 4 })
    Write-Host "DepthMask regions: $($depthRegions.Count)"

    $depthAABBs = @()
    foreach ($region in $depthRegions) {
      $aabb = Get-AABB $region
      $depthAABBs += [pscustomobject]@{
        pixelAABB = $aabb
        world = AABB-ToWorld $aabb $imgW $imgH
        pixelCount = $region.Count
      }
    }

    # 合并 PushBox 与 DepthMask（按 AABB 重叠匹配）
    $masks = @()
    $matchedDepth = @{}

    for ($pi = 0; $pi -lt $pushboxAABBs.Count; $pi++) {
      $pb = $pushboxAABBs[$pi]
      $bestDi = -1
      $bestOverlap = 0

      for ($di = 0; $di -lt $depthAABBs.Count; $di++) {
        if ($matchedDepth.ContainsKey($di)) { continue }
        $dm = $depthAABBs[$di]
        $ox = [Math]::Max(0, [Math]::Min($pb.pixelAABB.maxX, $dm.pixelAABB.maxX) - [Math]::Max($pb.pixelAABB.minX, $dm.pixelAABB.minX))
        $oy = [Math]::Max(0, [Math]::Min($pb.pixelAABB.maxY, $dm.pixelAABB.maxY) - [Math]::Max($pb.pixelAABB.minY, $dm.pixelAABB.minY))
        $overlap = $ox * $oy
        if ($overlap -gt $bestOverlap) {
          $bestOverlap = $overlap
          $bestDi = $di
        }
      }

      $maskEntry = [pscustomobject]@{
        id = 'mask_' + $pi
        pushbox = $pb.world
        depthMask = $null
      }

      if ($bestDi -ge 0 -and $bestOverlap -gt 0) {
        $maskEntry.depthMask = $depthAABBs[$bestDi].world
        $matchedDepth[$bestDi] = $true
      }

      $masks += $maskEntry
    }

    $unmatchedId = $pushboxAABBs.Count
    for ($di = 0; $di -lt $depthAABBs.Count; $di++) {
      if (-not $matchedDepth.ContainsKey($di)) {
        $masks += [pscustomobject]@{
          id = 'mask_' + $unmatchedId
          pushbox = $null
          depthMask = $depthAABBs[$di].world
        }
        $unmatchedId++
      }
    }

    Write-Host "Merged masks: $($masks.Count)"

    $result = [pscustomobject]@{
      source = [pscustomobject]@{
        mode = 'legacy'
        image = $MaskPng
        pxToWorld = $PxToWorld
        imageWidth = $imgW
        imageHeight = $imgH
        generatedAtUtc = [DateTime]::UtcNow.ToString('o')
      }
      walkArea = $walkAABBs | ForEach-Object { $_.world }
      masks = $masks
    }
  } finally {
    $bmp.Dispose()
  }
}

# ── 输出 JSON ──
$outDir = Split-Path $OutJson -Parent
if ($outDir -and -not (Test-Path $outDir)) {
  New-Item -ItemType Directory -Path $outDir -Force | Out-Null
}

$result | ConvertTo-Json -Depth 8 | Set-Content -Path $OutJson -Encoding UTF8
  $maskCount = if ($result.masks -is [array]) { $result.masks.Length } else { 1 }
  $walkCount = if ($result.walkArea -is [array]) { $result.walkArea.Length } else { if ($result.walkArea) { 1 } else { 0 } }
  Write-Host "OK: wrote $maskCount masks, $walkCount walkArea regions → $OutJson"