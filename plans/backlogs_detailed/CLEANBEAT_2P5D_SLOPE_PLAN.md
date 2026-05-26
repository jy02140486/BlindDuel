# 2.5D 坡道方案（热血时代剧风格）

## 目标
- 在不引入真实 3D 地形系统的前提下，实现“可上下走位 + 局部坡道视觉”的清版体验。
- 保持战斗、碰撞、相机与 `SceneVisualSystem` 的稳定性。

## 坐标约定（建议）
- `x`: 左右移动轴。
- `y`: 上下走位轴（地面平面内的第二个移动维度）。
- `z`: 高度轴（跳跃/击飞/落地用；如暂不做跳跃可先固定 `z=0`）。

## 当前约束（本阶段）
- `x` 方向永远连续可走。
- 角色不会发生跳跃下落。
- 高低差主要用于视觉表达，不用于阻挡 `x` 连续移动。

## 硬规则（必须遵守）
- 高处必须在场景上方，低处必须在场景下方。
- 不允许出现“逻辑高度更高但画面位置更靠下”的布局。
- 坡道方案不能依赖全局俯角修正。
- 在坡区内，角色 `y` 方向移动不能超出坡定义范围。
- 超出坡范围时只做位置钳制（clamp），不做下落处理。

## 核心思路
- 角色逻辑移动、边界限制、碰撞判定主要基于 `x/y`。
- 坡道用二维分区（`slopeZones`）实现，不使用全局单轴 `f(x)` 或 `f(y)`。
- 每个 zone 可定义独立坡向（沿 `x`、沿 `y`、或自定义方向）。
- 这是一种 2.5D 假坡，不是实际网格地形或法线投影。

## 地图与移动边界
- 探索/战斗可统一为二维可行走区域：`walkArea(minX, maxX, minY, maxY)`。
- 角色每帧移动后做 clamp：
  - `x = clamp(x, minX, maxX)`
  - `y = clamp(y, minY, maxY)`
- 普通地面移动不直接改 `z`。

## 坡区内 Y 向限制（新增）
- 每个坡区必须定义可行走 `y` 范围（可直接复用 zone 的 `minY/maxY`，或单独给 `walkYRange`）。
- 角色在坡区中移动时，`y` 每帧强制限制在该范围内。
- 若同一 `x` 上有多个坡区分叉，进入哪个坡区由当前位置所属 zone 决定，不允许跨区“穿越”到非连接坡区。

伪代码：

```js
function clampYInSlopeZone(nextPos, activeZone) {
  if (!activeZone) return nextPos;
  const minY = activeZone.walkYRange?.min ?? activeZone.rect.minY;
  const maxY = activeZone.walkYRange?.max ?? activeZone.rect.maxY;
  nextPos.y = clamp(nextPos.y, minY, maxY);
  return nextPos;
}
```

## 坡道数据表示（推荐）

```json
{
  "walkArea": { "minX": -12, "maxX": 12, "minY": -5, "maxY": 6 },
  "slopeZones": [
    {
      "id": "flat_top",
      "shape": "rect",
      "rect": { "minX": -6, "maxX": 6, "minY": 1, "maxY": 5 },
      "walkYRange": { "min": 1, "max": 5 },
      "heightLevel": 2,
      "slope": { "type": "flat", "baseVisualZ": 1.2 }
    },
    {
      "id": "ramp_bottom",
      "shape": "rect",
      "rect": { "minX": -6, "maxX": 6, "minY": -3, "maxY": 1 },
      "walkYRange": { "min": -3, "max": 1 },
      "heightLevel": 1,
      "slope": {
        "type": "linear",
        "axis": "x",
        "origin": -6,
        "k": 0.25,
        "baseVisualZ": 0.0
      }
    }
  ]
}
```

说明：
- 同一段 `x` 内可通过不同 `y` 分区实现“部分平地 + 部分坡道/分叉”。
- `heightLevel` 用于校验“高处在上方”的关卡语义和渲染约束。

## 视觉高度计算

```js
function calcVisualZ(pos, zones) {
  const zone = findZone(pos.x, pos.y, zones);
  if (!zone) return 0;

  const s = zone.slope;
  if (s.type === "flat") return s.baseVisualZ || 0;

  if (s.type === "linear" && s.axis === "x") {
    return (s.baseVisualZ || 0) + (pos.x - s.origin) * s.k;
  }

  if (s.type === "linear" && s.axis === "y") {
    return (s.baseVisualZ || 0) + (pos.y - s.origin) * s.k;
  }

  return 0;
}
```

- 渲染高度建议：`renderZ = physicsZ + visualZ`。
- `visualZ` 仅用于显示，不直接参与地面移动逻辑。

## 地面显示与断面表示
- 不再用“一整张大平面”表达全部地面。
- 改为三类可视元素：
  - 顶面：各 zone 的 walkable top（可分片）。
  - 屏幕平行壁面：对应高度边界的前视立面条带（台阶正面）。
  - 坡连接条：需要可通行过渡的区域。

### 屏幕平行壁面数据（最小）

```json
{
  "faceEdges": [
    {
      "id": "step_front_01",
      "from": [-6, 1],
      "to": [6, 1],
      "upperZone": "flat_top",
      "lowerZone": "ramp_bottom",
      "faceSprite": "Art/Environment/step_face_01.png",
      "occlusionRule": "character_behind_if_y_less_than_edge"
    }
  ]
}
```

### 关于 quad 是否足够
- 直线斜边：单个 `quad` 通常可用。
- 轻微复杂边：建议分段 `quad` 拼接。
- 弯曲/锯齿/复杂轮廓：用多边形 mesh（triangulate）或手绘遮罩层。

结论：本项目第一版采用“分段 quads”为默认策略。

## 判定规则（第一版建议）
- 命中/受击范围：按 `x/y` 距离判断。
- 当前阶段无跳跃下落，不引入额外高度判定门槛。

## 渲染排序与遮挡
- 角色前后关系按统一排序键（建议以 `y` 为主）。
- 场景前景遮挡与 zone 高度语义一致：高处区域要画在上方并匹配遮挡关系。
- 壁面遮挡规则与 `faceEdges.occlusionRule` 保持一致。
- 关键点：排序变量和更新时机全局一致，避免闪烁换层。

## 与当前 Camera/SceneVisual 的关系
- 不依赖全局俯角方案。
- 坡道效果由 `slopeZones + visualZ + faceEdges + 排序` 实现，避免相机副作用。
- `SceneVisualSystem` 读取统一显示位置即可。

## 第一阶段落地清单
- [ ] 输入与移动：把探索移动改为 `x/y` 双轴。
- [ ] 边界：`walkArea` 接入 `minX/maxX/minY/maxY` clamp。
- [ ] 坡内限制：接入坡区 `walkYRange` 钳制，不做下落处理。
- [ ] 视觉：接入 `slopeZones` 与 `visualZ` 映射。
- [ ] 壁面：接入 `faceEdges`，先支持分段 quad 渲染。
- [ ] 排序：按统一排序键处理角色层级。
- [ ] 规则校验：加“高处必须在场景上方”的关卡检查。
- [ ] 调参：探索速度提高（仅探索，战斗速度不变）。
- [ ] 回归：确认 `Explore -> Battle -> Explore` 流程无回归。

## 参数建议（初始）
- `k`: `0.15 ~ 0.35`（按美术尺寸调）。
- zone 先用矩形，后续再扩展多边形。
- `faceEdges` 每段长度先控制在中等范围，避免单段过长拉伸。
- 探索移动速度：当前值基础上 `1.25x ~ 1.6x` 试配。

## 风险与规避
- 风险：视觉高度与判定高度混用，导致“看着打中但判不到”。
- 规避：明确区分
  - 逻辑：`x/y/(真实z)`
  - 视觉：`visualZ`
- 风险：zone 边界高度跳变。
- 规避：边界过渡带（blend 区）或邻区 baseVisualZ 对齐。
- 风险：复杂边缘使用单 quad 失真。
- 规避：分段 quad 或改用多边形/遮罩。
- 风险：关卡布局违反“高处在上方”。
- 规避：加自动校验和手工 review。

## 验收标准
- 角色可在 `x/y` 平面自由走位，边界有效。
- 坡区内 `y` 移动不能越界（越界会被 clamp，且无下落）。
- 同一段 `x` 内可出现“部分平地 + 部分坡道/分叉”并表现正确。
- 高处区域稳定显示在画面上方。
- 屏幕平行壁面显示稳定，无明显拉伸破图。
- 不引入相机相关副作用（尤其 `SceneVisualSystem` 稳定）。
- 探索移动速度明显快于当前版本，战斗速度不受影响。
