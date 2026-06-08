# 舞台遮罩管线计划（Stage Mask Pipeline Plan）

## 1. 背景与目标

在室内/多障碍物场景中，角色在 STAGE 层（`renderingGroupId: 1`）活动，需要三种区域数据：

| 用途 | 说明 |
|------|------|
| **行走区域（WalkArea）** | 角色可以走动的范围，由 `ExploreMode` 消费 |
| **物理碰撞（PushBox）** | 角色不可穿越的障碍区域（桌子、柱子、吧台等），由 `ExploreCollisionSystem` 消费 |
| **视觉遮挡（Depth Mask）** | 角色走到障碍物后面时，被遮挡的像素不渲染，由 `SceneVisualSystem` 用深度遮罩实现 |

三者在同一张遮罩图上用不同颜色绘制，一次扫描全部产出。

---

## 2. 颜色约定

在 LibreSprite 中绘制舞台遮罩图时，用三种颜色区分：

| 用途 | 扫描颜色 | 含义 |
|------|----------|------|
| 行走区域（WalkArea） | `#00FFFF` | 角色可以走动的区域 |
| 物理碰撞（PushBox） | `#00FF88` | 角色不能进入的区域 |
| 视觉遮挡（Depth Mask） | `#FF00FF` | 角色被该区域遮挡时，重叠像素不画 |

颜色选择依据：
- `#00FFFF`：青色，用于填充可走动区域（与现有 walkArea 多边形定义互补，可从遮罩图直接扫描生成）
- `#00FF88`：沿用项目 pushbox 现有约定（见 `PUSHBOX_INTEGRATION_PLAN.md`）
- `#FF00FF`：品红，与现有颜色均不冲突（现有：`#FFFF00` hitbox / `#E37800` strong_blade / `#FF0000` weak_blade / `#7082C1` root）

> 注意：视觉遮挡区域通常应 **严格包含或等于** 物理碰撞区域，避免出现"能走过去但视觉却被遮"的诡异情况。建议两色区域完全重叠绘制。

---

## 3. 制作流程

### 3.1 美术制作

在 LibreSprite 中新建与舞台同像素尺寸的遮罩图层。

**推荐方案：分图层导出（避免连通域合并导致的匹配错误）**

将三种数据分别导出到三个文件夹：
```
Data/StageMask/
├── walkarea/
│   └── Tavern_indoorstage.png      # 仅 #00FFFF（青色）
├── obstacle/
│   └── Tavern_indoorstage.png      # 仅 #00FF88（绿色）
├── depth/
│   └── Tavern_indoorstage.png      # 仅 #FF00FF（品红）
└── Tavern_indoorstage.mask.json    # 合并输出
```

**作图规范：**
- 图片尺寸与舞台背景对齐（用相同的 `pxToWorld` 比例换算）
- `#00FFFF` 填充整个可走动区域，剩余未着色区域视为不可走动
- `#00FF88` 标记物理碰撞区域
- `#FF00FF` 标记视觉遮挡区域
- **不同障碍物之间必须留 ≥1px 间隙**，避免扫描脚本将不相关区域识别为同一连通域
- 同一障碍物的 pushbox 和 depthMask 应对齐绘制，便于脚本匹配

### 3.2 扫描脚本

新脚本：`scripts/tools/extract_stage_masks.ps1`

**分图模式（推荐）：**
```powershell
param(
  [string]$WalkPng,       # WalkArea PNG 路径（仅 #00FFFF）
  [string]$ObstaclePng,   # Obstacle PNG 路径（仅 #00FF88）
  [string]$DepthPng,      # DepthMask PNG 路径（仅 #FF00FF）
  [string]$OutJson,       # 输出 JSON 路径
  [float]$PxToWorld = 0.03  # 像素→世界单位比例
)
```

**兼容旧版单图模式：**
```powershell
param(
  [string]$MaskPng,       # 单图模式：三色合一
  [string]$OutJson,
  [float]$PxToWorld = 0.03
)
```

逻辑：
1. 分图模式下，每个 PNG 只判断 alpha > 0（不判断颜色），提取连通域
2. WalkArea：提取边界多边形（顺时针顶点序列）→ 转世界坐标
3. Obstacle / DepthMask：每个连通域计算 AABB → 转世界坐标
4. 按中心点距离匹配（阈值 50px）合并同位置的 obstacle + depthMask 数据

### 3.3 输出格式

`Data/StageMask/Tavern_indoorstage.mask.json`：

```json
{
  "source": {
    "mode": "separate",
    "walkImage": "Data/StageMask/walkarea/Tavern_indoorstage.png",
    "obstacleImage": "Data/StageMask/obstacle/Tavern_indoorstage.png",
    "depthImage": "Data/StageMask/depth/Tavern_indoorstage.png",
    "pxToWorld": 0.03,
    "generatedAtUtc": "2026-06-06T..."
  },
  "walkArea": {
    "edges": [
      { "x": -20.0, "y": -3.2 },
      { "x":  20.0, "y": -3.2 },
      { "x":  20.0, "y":  3.0 },
      { "x": -20.0, "y":  3.0 }
    ]
  },
  "masks": [
    {
      "id": "mask_0",
      "pushbox": { "x": -18.2, "y": 0.85, "w": 5.1, "h": 2.4 },
      "depthMask": { "x": -18.2, "y": 0.85, "w": 5.1, "h": 2.4 }
    },
    {
      "id": "mask_1",
      "pushbox": { "x": -12.0, "y": 1.20, "w": 0.8, "h": 3.0 },
      "depthMask": { "x": -12.0, "y": 1.20, "w": 0.8, "h": 3.0 }
    }
  ]
}
```

每个 mask 条目包含两组数据：
- `pushbox`：物理碰撞 AABB（世界坐标）
- `depthMask`：视觉遮挡 AABB（世界坐标）

`walkArea.edges`：边界多边形顶点，顺时针排列，与现有 `EnvironmentConfig.walkArea` 格式兼容。

`source.mode`： `"separate"`（分图模式）或 `"legacy"`（单图模式）。

---

## 4. 数据目录

```
Data/
├── CollisionMask/        # 战斗碰撞盒（已有）
├── PushBox/              # 角色推挤盒（已有）
├── RootMotion/           # 根运动（已有）
├── StageMask/            # 舞台遮罩（新增）
│   ├── Tavern_StageMask.png
│   └── Tavern_StageMask.mask.json
├── StateGraphDef/        # 状态图定义（已有）
└── ...
```

---

## 5. 运行时加载链路

遵循项目现有的数据驱动模式：

```
AssetManifest.js                  → 注册 mask 资源路径
    ↓
DataLoader.js                    → 加载 .mask.json
    ↓
Scene.js / exploreSceneDef       → 场景定义中引用 mask 数据 ID
    ↓
SceneVisualSystem.init()         → 接收 mask 数据，创建 depthMask mesh
ExploreCollisionSystem           → 接收 pushbox 数据，加入静态碰撞检测
```

### 5.1 SceneVisualSystem 改动

新增：

- `maskRoot`：独立的 `TransformNode`，z 位置固定在 `-0.01`（比角色 `spritePlane.z = -0.02` 更靠近相机）
- `_createMaskFromData(maskData)`：遍历 `masks` 数组，为每个 `depthMask` 创建：
  - `Plane` mesh，尺寸 = `depthMask.w × depthMask.h`
  - 位置 = `(depthMask.x, depthMask.y, 0)`
  - `renderingGroupId: 1`（与角色同组）
  - `alphaIndex: 0`（最先渲染，在角色之前写深度）
  - Material：`disableColorWrite = true`，深度写入开启
- `update()` 中：maskRoot 跟随 STAGE 层的视差偏移

### 5.2 ExploreCollisionSystem 改动

在 `ExploreMode.fixedUpdate()` 中，将 mask 的 `pushbox` 数据作为静态 AABB 障碍物注册，角色移动时碰撞检测即可自动生效。

---

## 6. 深度遮罩渲染原理

**✅ 已解决：采用 Stencil Buffer 三步法**

参考 `occludingtest.js` 验证通过的方案，使用 WebGL 原生 `gl.colorMask` + `gl.stencilFunc` + `gl.stencilOp` 实现遮挡裁切，绕过 Babylon.js 高层 stencil API。

### 6.1 核心思路

| Mesh | 职责 | 关键属性 |
|------|------|----------|
| `depthMask` mesh | **只写 stencil**，不画颜色 | `gl.colorMask(false,...)` + `REPLACE` |
| 角色 spritePlane | **被裁切的底图** | 正常材质，受 stencil 测试影响 |

### 6.2 渲染顺序（按 renderingGroupId）

```
Group 0（背景层）:
  → indoor_floor / sky / mountain 等背景元素先绘制
  → Group 0→1 切换时 Babylon clear stencil（无影响，group 0 未写 stencil）

Group 1（STAGE 层 — 角色与遮罩）:
  Opaque 队列:
    → depthMask mesh（不透明 material，无 texture）
      onBeforeRender:  gl.colorMask(false,false,false,false)
                       gl.enable(STENCIL_TEST)
                       gl.stencilFunc(ALWAYS, 1, 0xFF)
                       gl.stencilOp(KEEP, KEEP, REPLACE)
      → 框内区域 stencil=1
      onAfterRender:   gl.colorMask(true,true,true,true)
                       gl.stencilFunc(NOTEQUAL, 1, 0xFF)
  Transparent 队列:
    → 角色 spritePlane（hasAlpha=true）
      → stencil≠1 的像素才绘制（框内被遮挡）

Group 2+（前景层）:
  → FG_DECOR 等前景元素
  → ExploreMode.updateRender() 最后统一 gl.disable(STENCIL_TEST)
```

### 6.3 关键代码

```javascript
// depthMask mesh（SceneVisualSystem.createDepthMasks）
plane.onBeforeRenderObservable.add(() => {
    gl.colorMask(false, false, false, false);
    gl.enable(gl.STENCIL_TEST);
    gl.stencilFunc(gl.ALWAYS, 1, 0xFF);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
});
plane.onAfterRenderObservable.add(() => {
    gl.colorMask(true, true, true, true);
    gl.stencilFunc(gl.NOTEQUAL, 1, 0xFF);
});

// 角色绘制后不再单独关闭 stencil（CharacterBase.js 已移除）
// 改为 ExploreMode.updateRender() 最后统一关闭
```

### 6.4 踩坑记录

| 坑 | 现象 | 原因 | 解决 |
|---|---|---|---|
| renderingGroup 切换 clear stencil | depthMask 在 group 1 写 stencil，角色也在 group 1，但 stencil 不生效 | 背景层（group 0）与 group 1 之间切换理论上会 clear，但本方案中 depthMask 和角色**同 group**，不受此影响 | 确保 depthMask 和角色在同一个 renderingGroupId |
| 背景图覆盖角色 | indoor_floor 挡住角色 | indoor_floor 与角色同 group 1，transparent 队列中 alphaIndex 小的后画，indoor_floor 覆盖角色 | **背景图单独放在 group 0**，角色和 depthMask 留在 group 1 |
| 多角色时 stencil 提前关闭 | 第一个角色画完后后续角色不受遮挡 | `CharacterBase.js` 中每个 spritePlane 的 `onAfterRender` 都 `gl.disable(STENCIL_TEST)` | **移除每个角色的关闭逻辑**，改为 `ExploreMode.updateRender()` 最后统一关闭 |
| depthMask alphaIndex 太小 | 角色在 depthMask 之前画 | depthMask `alphaIndex=2`，角色动态 `alphaIndex≈102` | depthMask `alphaIndex` 设为 **10000**（transparent 队列中数值大的先画，但 depthMask 实际在不透明队列，此修改保险起见） |

---

## 7. 实现步骤

| Step | 内容 | 状态 | 产出 |
|------|------|------|------|
| 0 | 新建 `scripts/tools/extract_stage_masks.ps1`（支持分图/单图两种模式） | ✅ 完成 | 扫描脚本 |
| 1 | 新建 `Data/StageMask/{walkarea,obstacle,depth}/` 目录，分图层导出 PNG | ✅ 完成 | 数据管线 |
| 2 | `AssetManifest.js` / `DataLoader.js` 注册 mask 资源 | ✅ 完成 | 加载管线 |
| 3 | `SceneVisualSystem` 新增 `maskRoot` + `createDepthMasks()` + `disposeDepthMasks()` | ✅ 完成（位置正确） | 渲染管线框架 |
| 4 | **深度遮罩实际生效**（角色走到障碍物后面时被遮挡） | ✅ 完成 | Stencil Buffer 三步法，见第 6 节 |
| 5 | `ExploreCollisionSystem` 消费 pushbox 数据；`ExploreMode` 消费 walkArea 数据 | ✅ 完成 | 碰撞/行走管线 |
| 6 | 室内场景端到端验证 | ✅ 完成 | 集成测试 |

---

## 8. 待确认项

- [x] `#FF00FF` / `#00FFFF` 是否与现有美术资产冲突？ → 无冲突，分图层导出避免颜色干扰
- [x] WalkArea 边界提取算法 → 使用连通域轮廓 + 多边形简化（`SimplifyPolygon`）
- [x] StageMask 数据挂载方式 → 挂在 `SceneDef` 的 `stageMask` 字段，通过 `AssetManifest` 注册
- [x] 障碍物美术放在哪个渲染组？ → **背景图放 group 0，depthMask + 角色放 group 1，前景放 group 2**
- [x] **深度遮罩渲染方案选型** → **Stencil Buffer 三步法**（见第 6 节）