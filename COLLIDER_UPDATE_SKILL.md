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
  -CollisionAtlasJson "Data/CollisionMask/{character}/{character}_{action}.json" `
  -CollisionAtlasPng "Data/CollisionMask/{character}/{character}_{action}.png" `
  -RootAtlasJson "Data/RootMotion/{character}/{character}_{action}.json" `
  -RootAtlasPng "Data/RootMotion/{character}/{character}_{action}.png" `
  -OutJson "Data/CollisionMask/{character}/{character}_{action}.collider.json"
```

### 批量处理所有 action

遍历每个 action 的 `{json, png}` 对，逐个执行上述命令。如果 action 缺少对应的 RootMotion 文件，跳过并报告。

### 示例：更新 longswordman 所有 collider

```powershell
$character = "longswordman"
$collisionDir = "Data/CollisionMask/$character"
$rootDir = "Data/RootMotion/$character"

Get-ChildItem "$collisionDir/*.json" -Exclude "*.collider.json" | ForEach-Object {
  $action = $_.BaseName -replace "${character}_", ""
  $collisionJson = "$collisionDir/$($_.BaseName).json"
  $collisionPng = "$collisionDir/$($_.BaseName).png"
  $rootJson = "$rootDir/$($_.BaseName).json"
  $rootPng = "$rootDir/$($_.BaseName).png"
  $outJson = "$collisionDir/$($_.BaseName).collider.json"

  if (-not (Test-Path $rootJson)) {
    Write-Warning "SKIP $action : missing root motion $rootJson"
    return
  }

  powershell -ExecutionPolicy Bypass -File scripts/tools/extract_collision_boxes.ps1 `
    -CollisionAtlasJson $collisionJson `
    -CollisionAtlasPng $collisionPng `
    -RootAtlasJson $rootJson `
    -RootAtlasPng $rootPng `
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
| `#E37800` | weaponbox + subtype = strong_blade |
| `#FF0000` | weaponbox + subtype = weak_blade |
| `#7082C1` | root（根锚点，两个脚本都扫描此颜色） |

---

## 常见问题

1. **ExecutionPolicy 拦截**：所有命令必须带 `-ExecutionPolicy Bypass`。
2. **同帧连通域合并**：若同帧多个同色矩形相互接触/重叠，会被合并为一个 box。绘制时留 1px 间隔。
3. **最小像素**：碰撞扫描要求连通域 ≥ 6 像素才计入（root 无此限制）。
4. **Root 缺失回退**：occupancy 脚本中，若某帧无 root 像素，会复用上一帧的 root 位置。
5. **旧脚本路径**：`scripts/extract_collision_boxes.ps1` 是旧文件（文件锁残留），请使用 `scripts/tools/` 下的版本。