# Collider / Occupancy 更新 Skill

## 何时触发

用户提到以下任一关键词时，按本文件规则执行：
- "更新 collider" / "更新碰撞盒" / "重新扫描碰撞"
- "更新 occupancy" / "更新 NPC 占用盒"
- "重新生成 collider.json" / "重新生成 occupancy.json"
- 指定角色名 + 上述意图（如 "更新 longswordman 的 collider"）

## 两个脚本，两条路线

| 脚本 | 适用角色 | 输出格式 |
|---|---|---|
| `scripts/tools/extract_collision_boxes.ps1` | 战斗角色：`longswordman`、`rabble_stick` | `.collider.json` |
| `scripts/tools/extract_rootmotion_occupancy.ps1` | NPC：`traveller`、`merchant`、`merchant2` | `.occupancy.json` |

---

## 路线 A：更新战斗角色 Collider

### 目录约定

```
Data/CollisionMask/{character}/       ← 碰撞遮罩（输入）
Data/RootMotion/{character}/          ← 根运动数据（输入）
Data/PushBox/{character}/             ← pushbox 遮罩（输入，可选）
Data/TrailMarker/{character}/         ← 刀光 marker 遮罩（输入，可选；rabble 用 `rabblestick` 无下划线目录名）
Data/CollisionMask/{character}/       ← .collider.json 输出到这里
```

### 识别需要处理的 action

进入 `Data/CollisionMask/{character}/`，找到所有 `*.json` 文件，**排除** `*.collider.json`（那是输出），剩下的就是各个 action 的碰撞图集。

每个 action 的输入文件：
- `Data/CollisionMask/{character}/{character}_{action}.json` + `.png`
- `Data/RootMotion/{character}/{character}_{action}.json` + `.png`

### 单 action 命令模板

```powershell
powershell -ExecutionPolicy Bypass -File scripts/tools/extract_collision_boxes.ps1 `
  -AtlasJson "Data/CollisionMask/{character}/{character}_{action}.json" `
  -CollisionPng "Data/CollisionMask/{character}/{character}_{action}.png" `
  -RootPng "Data/RootMotion/{character}/{character}_{action}.png" `
  -PushBoxPng "Data/PushBox/{character}/{character}_{action}.png" `
  -TrailMarkerPng "Data/TrailMarker/{character}/{character}_{action}.png" `
  -OutJson "Data/CollisionMask/{character}/{character}_{action}.collider.json"
```

> **扫描缓存（.scancache）**：传了 `-PushBoxPng` / `-TrailMarkerPng` 时正常重扫，并把结果就地写入 mask PNG 同目录同名 `.scancache` 文件（如 `longswordman_clash.scancache`）。没传时自动回退：按上次产物 `source.pushboxPng` / `source.trailMarkerPng` 反查，或按目录约定探测（`Data/{PushBox|TrailMarker}/{character}` 及去下划线目录，文件名同 atlas basename）。有有效缓存读缓存；PNG 比缓存新 → 自动重扫刷新缓存；无缓存 → 自动扫描建缓存；只有连 mask PNG 都找不到才 WARNING（该 clip 真无此类数据）。扫描过程逐帧显示进度条。`.scancache` 与 PNG 一起入库；只重扫某类 mask 时其余参数可以不传。

### 批量处理所有 action

遍历每个 action 的 `{json, png}` 对，逐个执行上述命令。如果 action 缺少对应的 RootMotion 文件，跳过并报告。

### 示例：更新 longswordman 所有 collider

```powershell
$character = "longswordman"
$collisionDir = "Data/CollisionMask/$character"
$rootDir = "Data/RootMotion/$character"

Get-ChildItem "$collisionDir/*.json" -Exclude "*.collider.json" | ForEach-Object {
  $action = $_.BaseName -replace "${character}_", ""
  $atlasJson = "$collisionDir/$($_.BaseName).json"
  $collisionPng = "$collisionDir/$($_.BaseName).png"
  $rootPng = "$rootDir/$($_.BaseName).png"
  $outJson = "$collisionDir/$($_.BaseName).collider.json"

  if (-not (Test-Path $rootPng)) {
    Write-Warning "SKIP $action : missing root motion png $rootPng"
    return
  }

  $pushPng = "Data/PushBox/$character/$($_.BaseName).png"
  $trailPng = "Data/TrailMarker/$character/$($_.BaseName).png"

  powershell -ExecutionPolicy Bypass -File scripts/tools/extract_collision_boxes.ps1 `
    -AtlasJson $atlasJson `
    -CollisionPng $collisionPng `
    -RootPng $rootPng `
    -PushBoxPng $(if (Test-Path $pushPng) { $pushPng }) `
    -TrailMarkerPng $(if (Test-Path $trailPng) { $trailPng }) `
    -OutJson $outJson

  Write-Host "OK: $action -> $outJson"
}
```

---

## 路线 B：更新 NPC Occupancy

### 目录约定

```
Data/RootMotion/NPCs/                ← 根运动数据（输入）
Data/RootMotion/NPCs/                ← .occupancy.json 输出到这里
```

### 单 NPC 命令模板

```powershell
powershell -ExecutionPolicy Bypass -File scripts/tools/extract_rootmotion_occupancy.ps1 `
  -RootAtlasJson "Data/RootMotion/NPCs/{npc}.json" `
  -RootAtlasPng "Data/RootMotion/NPCs/{npc}.png" `
  -OutJson "Data/RootMotion/NPCs/{npc}.occupancy.json"
```

### 示例：更新 traveller 的 occupancy

```powershell
powershell -ExecutionPolicy Bypass -File scripts/tools/extract_rootmotion_occupancy.ps1 `
  -RootAtlasJson "Data/RootMotion/NPCs/traveller.json" `
  -RootAtlasPng "Data/RootMotion/NPCs/traveller.png" `
  -OutJson "Data/RootMotion/NPCs/traveller.occupancy.json"
```

---

## 颜色约定（绘制碰撞遮罩时参考）

| 颜色 | 含义 |
|---|---|
| `#FFFF00` | hitbox（受击框） |
| `#FF0000` | weaponbox + subtype = strong_blade（防御侧/刀背） |
| `#E37800` | weaponbox + subtype = weak_blade（攻击侧/刀刃） |
| `#7082C1` | root（根锚点，两个脚本都扫描此颜色） |
| `#00FF88` | pushbox（`-PushBoxPng` 输入，以脚本内 `PushBoxColor` 为准） |
| `#00FFFF` | trailmarker（`-TrailMarkerPng` 输入，点位非盒，每帧最多 2 个） |

---

## 常见问题

1. **ExecutionPolicy 拦截**：所有命令必须带 `-ExecutionPolicy Bypass`。
2. **同帧连通域合并**：若同帧多个同色矩形相互接触/重叠，会被合并为一个 box。绘制时留 1px 间隔。
3. **最小像素**：碰撞扫描要求连通域 ≥ 6 像素才计入（root 无此限制）。
4. **Root 缺失回退**：occupancy 脚本中，若某帧无 root 像素，会复用上一帧的 root 位置。
5. **旧脚本路径**：`scripts/extract_collision_boxes.ps1` 是旧文件（文件锁残留），请使用 `scripts/tools/` 下的版本。
6. **可选输入参数遗漏与缓存回退**：漏传参数时脚本会回退读 `.scancache` 缓存，无缓存则按目录约定探测 PNG 自动扫描建缓存（产物 `source.pushboxSource` / `trailMarkerSource` 记录 scan/cache/none 来源）；只有连 mask PNG 都找不到才 WARNING。旧版 `.collider.json` 若是特性上线前扫的，可能连字段都没有（如 `trailMarkers`），判数据过期时按此排查。
7. **目录命名不一致**：TrailMarker/PushBox 下 rabble 的目录是 `rabblestick`（无下划线），而 CollisionMask/RootMotion 是 `rabble_stick`，命令里三处路径要分别核对。