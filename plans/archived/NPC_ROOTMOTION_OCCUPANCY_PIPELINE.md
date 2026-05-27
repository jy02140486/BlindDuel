# NPC RootMotion Occupancy 导出脚本设计

## 目标
- 新增一个独立脚本：`scripts/tools/extract_rootmotion_occupancy.ps1`
- 用于根据 LibreSprite 导出的 spritesheet atlas JSON 与 root 图，生成 NPC 用的轻量数据：
  - 每帧 `root` 位置
  - 每帧一个固定尺寸的 `AABB occupancy`
- 该数据只服务 NPC 的基础阻挡与接近判断，不服务战斗碰撞。

## 为什么单独写新脚本
- 现有 [extract_collision_boxes.ps1](/e:/se/BlindDuel/scripts/tools/extract_collision_boxes.ps1) 是战斗碰撞导向脚本。
- 它的主输出是 `boxes + anchors.root`，依赖 `CollisionAtlas`，不适合 NPC 的 root-only 流程。
- NPC 不需要 `.collider.json`、`PushBox`、hitbox / hurtbox，因此单独脚本更干净。

## 输入
- `RootAtlasJson`
- `RootAtlasPng`
- `OutJson`

建议参数形式：

```powershell
param(
  [string]$RootAtlasJson,
  [string]$RootAtlasPng,
  [string]$OutJson
)
```

## 输出目标
- 输出一个轻量 JSON 文件，例如：

```json
{
  "source": {
    "rootAtlasJson": "Data/RootMotion/traveller/traveller_idle.json",
    "rootAtlasPng": "Data/RootMotion/traveller/traveller_idle.png",
    "rootColor": "#7082C1",
    "occupancyWidthPx": 40,
    "occupancyHeightPx": 24,
    "generatedAtUtc": "2026-05-27T00:00:00.000Z"
  },
  "frames": [
    {
      "frameIndex": 0,
      "frameName": "traveller_idle_0",
      "frameRect": { "x": 0, "y": 0, "w": 64, "h": 64 },
      "anchors": {
        "root": { "cx": 31.5, "cy": 52.0 }
      },
      "occupancy": {
        "type": "aabb",
        "cx": 31.5,
        "cy": 52.0,
        "w": 40,
        "h": 24
      }
    }
  ]
}
```

## AABB 规则
- `occupancy` 的中心直接取 `root` 位置。
- 第一版固定尺寸：
  - `w = 40`
  - `h = 24`
- 这两个值先写死在脚本里即可，后续再参数化。

即：

```js
occupancy.cx = root.cx
occupancy.cy = root.cy
occupancy.w = 40
occupancy.h = 24
```

## Root 提取规则
- root 点提取可直接参考现有 [extract_collision_boxes.ps1](/e:/se/BlindDuel/scripts/tools/extract_collision_boxes.ps1) 的这些部分：
  - `Parse-HexColor`
  - `Match-Color`
  - `Get-OrderedFrames`
  - `Extract-Regions`
  - `Extract-Root`
- root 标记色继续沿用：
  - `#7082C1`

## 推荐算法流程
1. 读取 root atlas JSON
2. 按帧顺序排序
3. 读取 root atlas PNG
4. 对每一帧：
   - 找 root 颜色连通区域
   - 计算该区域中心点作为 `anchors.root`
   - 以该中心点生成固定尺寸 `occupancy.aabb`
5. 输出 JSON

## 关键约束
- 不需要读取 `CollisionAtlasJson/Png`
- 不需要读取 `PushBoxAtlasJson/Png`
- 不需要生成 `boxes`
- 不需要生成战斗碰撞类型
- 若某帧找不到 root，建议：
  - 先报 warning
  - 再回退到该帧中心下方默认点，或复用上一帧 root

第一版推荐回退顺序：
1. 复用上一帧 root
2. 若第一帧就缺失，则用默认点：

```js
cx = frameRect.w / 2
cy = frameRect.h * 0.8
```

## 建议输出字段
- `source.rootAtlasJson`
- `source.rootAtlasPng`
- `source.rootColor`
- `source.occupancyWidthPx`
- `source.occupancyHeightPx`
- `source.generatedAtUtc`
- `frames[].frameIndex`
- `frames[].frameName`
- `frames[].frameRect`
- `frames[].anchors.root`
- `frames[].occupancy`

## 与现有系统的对接建议
- 这份输出不要命名成战斗 `colliderData`，避免混淆。
- 推荐命名：
  - `rootMotionOccupancyData`
  - 或 `npcOccupancyData`
- 后续 NPC 角色可从这份数据读取：
  - `anchors.root`
  - `occupancy`

## 给免费 AI 的实现要求
- 新建脚本：
  - `scripts/tools/extract_rootmotion_occupancy.ps1`
- 不要修改现有 `extract_collision_boxes.ps1` 的行为。
- 可以直接复用/抄参考其中的颜色解析、连通区域提取、root 提取思路。
- 输出编码使用 UTF-8。
- 若 root atlas 帧数异常，输出明确错误。

## 最小验收标准
- 对只有 root atlas 的 NPC 资源可单独运行。
- 成功输出每帧 `anchors.root`。
- 成功输出每帧固定尺寸 `occupancy.aabb`。
- 不依赖任何 `.collider.json` 或战斗碰撞贴图。
