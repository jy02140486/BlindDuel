# Odinlike 2D+3D 多层卷轴方案（SceneVisualSystem）

更新时间：2026-04-25

> ⚠️ **本文档已归档**（2026-04-29）。相机 Zoom 与高度联动功能已落地，后续视觉层迭代请基于最新代码。

> 变更记录：
> - 2026-04-29：相机 zoom 配置重构——`DuelCameraRig` 改为以角色间距为自变量的端点映射配置：`zoomMinDistance`/`zoomMaxDistance` 定义输入范围，`orthoMinWidth`/`orthoMaxWidth`、`perspMinDistance`/`perspMaxDistance`、`minCameraHeight`/`maxCameraHeight` 分别定义正交/透视/高度的输出端点，中间线性插值。
> - 2026-04-29：`fighterDistance` 平滑——`Scene.update()` 中对原始角色间距做指数平滑 + Smoothstep 缓动，避免出招时 root 位移导致 zoom 抖动。
> - 2026-04-29：相机高度随 zoom 联动——透视/正交模式下相机 Y 轴高度均随角色间距变化：间距大（zoom out）→ 高度高；间距小（zoom in）→ 高度低。
> - 2026-04-29：渲染层重构——`renderingGroupId` 压缩为 3 层：背景层 group 0（BG_FAR + BG_MID）、舞台层 group 1（STAGE + 角色）、前景层 group 2（FG_DECOR），解决 group 4 超出 Babylon 默认范围导致不可见的问题。
> - 2026-04-29：`alphaIndex` 完整化——同 renderingGroupId 内所有元素必须显式设置 `alphaIndex`，`undefined` 会导致排序异常。角色 `alphaIndex = 1`，STAGE ground `alphaIndex = 1`（同值时按深度排序，角色更靠近相机故在上）。
> - 2026-04-29：FG_DECOR 落地——新增 `Art/Environment/FG_Fence.png` 作为前景装饰，验证前景层可见性与视差。
> - 2026-04-29：CDN 切换——`babylon_demo.html` 从 `unpkg.com` 切换至 `cdn.jsdelivr.net`，解决 Babylon.js 加载失败导致的渲染异常。
> - 2026-04-28：角色渲染层级——`Character` 构造函数默认设置 `spritePlane.renderingGroupId = 1`，位于 STAGE（group 1）同层，通过 `alphaIndex` 区分前后。
> - 2026-04-28：`renderingGroupId` 修复——从 `material.renderingGroupId` 改为 `mesh.renderingGroupId`，解决层间遮挡失效问题。
> - 2026-04-28：`alphaIndex` 支持——同层内元素可通过 `alphaIndex` 精细控制渲染顺序（数值大的在前）。
> - 2026-04-28：普通 tile wrap——`kind: "tile"` 的 PNG 支持 `wrapU/V` 和 `uScale/vScale` 重复平铺。
> - 2026-04-28：元素级视差——`VisualElementConfig` 支持可选的 `parallaxFactor`，允许同一层内不同元素（如云与山）拥有独立视差速度。
> - 2026-04-25：相机基类从 `ArcRotateCamera` 迁移至 `UniversalCamera`；`SceneVisualSystem` 视差锚点从 `camera.target.x` 改为 `camera.position.x` 以兼容 UniversalCamera。
> - 2026-04-25：Phase D 落地——DuelCameraRig 支持透视/正交投影切换（O 键），正交模式根据实际窗口比例动态调整 `orthoLeft/Right/Top/Bottom`。
> - 2026-04-25：Scene 负责计算相机基准位置（basePosition）和 target，DuelCameraRig 只负责平滑移动和 zoom/ortho 范围调整。
> - 2026-04-25：添加 AnimatedTileComponent 支持 spritesheet 帧动画地面（grassbase-sheet.png）。

目标：在 Babylon 中以 3D 场景承载 2D 资产，做出类似《奥丁领域》的多层卷轴视觉效果，并保持当前项目的分层架构（Scene 负责编排，System 负责运行时逻辑）。

## 1. 设计目标与边界
- 目标风格：2.5D 舞台感，强调层次纵深、前后景差速移动、前景遮挡。
- 技术边界：本轮只做视觉层方案，不引入玩法逻辑耦合，不改角色状态机与战斗判定。
- 架构边界：CameraRig 只负责镜头；SceneVisualSystem 负责环境层更新与视差。

## 2. 坐标与镜头约定
- 世界坐标约定：
  - `X`：战斗主轴（左右移动）。
  - `Y`：高度。
  - `Z`：视觉景深层级（远近层）。
- 角色移动与碰撞仍以 `X/Y` 为主，`Z` 仅用于视觉分层。
- 镜头约定：
  - DuelCameraRig 使用 `UniversalCamera` 作为基类（原 `ArcRotateCamera` 已迁移）。
  - Scene 负责计算相机基准位置（basePosition）和 target（人物连线中点），传递给 DuelCameraRig。
  - DuelCameraRig 负责平滑移动、透视 zoom、正交范围调整、相机高度调整。
  - SceneVisualSystem 读取镜头状态（`camera.position.x`）驱动视差。

### 2.1 相机 Zoom 与高度配置（DuelCameraRig）

以角色间距（`fighterDistance`）为自变量，采用端点映射 + 线性插值：

```ts
{
  // 共用输入范围
  zoomMinDistance: number;   // 角色间距最小时（贴脸）
  zoomMaxDistance: number;   // 角色间距最大时（最远）

  // 正交模式输出
  orthoMinWidth: number;     // 间距最小时的 ortho width（最大 zoom in）
  orthoMaxWidth: number;     // 间距最大时的 ortho width（最大 zoom out）

  // 透视模式输出
  perspMinDistance: number;  // 间距最小时的 camera distance（最近）
  perspMaxDistance: number;  // 间距最大时的 camera distance（最远）

  // 高度输出（共用同一套 t）
  minCameraHeight: number;   // 间距最小时的高度（最低）
  maxCameraHeight: number;   // 间距最大时的高度（最高）
}
```

计算：
```
t = Clamp((fighterDistance - zoomMinDistance) / (zoomMaxDistance - zoomMinDistance), 0, 1)
desiredWidth      = Lerp(orthoMinWidth, orthoMaxWidth, t)        // 正交
desiredDistance   = Lerp(perspMinDistance, perspMaxDistance, t)  // 透视
desiredHeight     = Lerp(minCameraHeight, maxCameraHeight, t)    // 高度
```

**当前配置**（Scene.js）：
```js
zoomMinDistance: 3.2,   zoomMaxDistance: 6.4,
orthoMinWidth: 16,      orthoMaxWidth: 46,
perspMinDistance: 15,   perspMaxDistance: 35,
minCameraHeight: 3,     maxCameraHeight: 12
```

### 2.2 FighterDistance 平滑

出招时角色 `root.position.x` 会瞬间变化（突进/后退），导致 `fighterDistance` 抖动。Scene.js 中对原始间距做指数平滑 + Smoothstep 缓动：

```js
const rawDistance = Math.abs(opponentPos.x - heroPos.x);
const distanceBlend = 1 - Math.exp((-this.cameraRig.smoothing * dtMs) / 1000);
const smoothBlend = distanceBlend * distanceBlend * (3 - 2 * distanceBlend);  // Smoothstep
this._smoothedFighterDistance += (rawDistance - this._smoothedFighterDistance) * smoothBlend;
```

平滑后的 `_smoothedFighterDistance` 传给 `DuelCameraRig.update()`，避免 zoom 抖动。

## 3. 视觉分层模型（5 层 → 3 个 renderingGroup）
- `BG_FAR`：天空/远山/远建筑，最慢视差。`renderingGroupId: 0`
- `BG_MID`：中景树群/建筑群，中慢视差。`renderingGroupId: 0`（与 BG_FAR 同层，靠 `z` 深度区分）
- `STAGE`：地面与可玩舞台，基准层（parallax=1.0）。`renderingGroupId: 1`
- `FG_DECOR`：前景草木/栏杆/碎片，中快视差。`renderingGroupId: 2`
- `FG_OCCLUDER`：可遮挡角色的前景物（树干、柱子、黑影），最快或单独控制。`renderingGroupId: 2`（未来）

推荐初始视差系数：
- `BG_FAR`: `0.15`
- `BG_MID`: `0.45`
- `STAGE`: `1.0`
- `FG_DECOR`: `1.35`
- `FG_OCCLUDER`: `1.65`

**渲染组限制**：Babylon.js 默认仅支持 `renderingGroupId: 0~3`。超出此范围（如 group 4）会导致该层不可见。当前方案压缩为 3 个 group，同 group 内用 `alphaIndex` 细分排序。

## 4. 资产形态策略
- 主要使用 `Plane + PNG 透明贴图`（2D 资产放在 3D 空间）。
- 不把所有内容都做成 Babylon Sprite，避免排序与遮挡控制受限。
- Tile 与单件混合：
- 可重复纹理层（如远山带、草带）采用 tile 思路。
- 独特资产（大树、雕像、断桥）采用单件摆放。

## 5. SceneVisualSystem 职责
- 初始化：
- 创建各层 root 节点（TransformNode）。
- 按配置生成贴片（tile strip 或单件装饰）。
- 维护层级元数据（parallax、loop、bounds、render group）。
- 每帧更新：
- 基于镜头 `x` 计算各层偏移。
- 处理可循环层的“无缝回卷”。
- 处理前景遮挡层可见性与排序微调。
- 释放：
- 统一销毁层 root、mesh、材质引用。

## 6. 与 Scene / Camera 的关系
- `Scene`：
- `init()` 创建并初始化 `SceneVisualSystem`。
- `update()` 先更新 `cameraRig`，再更新 `sceneVisualSystem`。
- `dispose()` 负责系统销毁。
- `CameraRig`：
- 只输出镜头结果，不承担视觉层节点移动职责。

更新顺序建议：
1. `cameraRig.update(dt, context)`
2. `sceneVisualSystem.update(dt, { camera })`
3. `scene.render()`

## 7. 配置驱动（EnvironmentConfig）建议
建议新增环境配置（json 或 js 常量），至少包含：

```ts
type VisualLayerConfig = {
  id: "BG_FAR" | "BG_MID" | "STAGE" | "FG_DECOR" | "FG_OCCLUDER";
  z: number;
  parallaxFactor: number;   // 层基础视差系数
  renderingGroupId: number;
  loopX?: boolean;
  loopWidth?: number;
  elements: VisualElementConfig[];
};

```ts
type VisualElementConfig = {
  id: string;
  texture: string;
  atlas?: string;           // spritesheet atlas json（仅 animated_tile）
  kind: "tile" | "single" | "animated_tile";
  x: number;
  y: number;
  zOffset?: number;
  width: number;
  height: number;
  tileSize?: { width: number; height: number };  // 单 tile 尺寸（仅 animated_tile）
  loop?: boolean;           // 是否循环播放（仅 animated_tile）
  frameDurationMs?: number; // 强制帧时长（仅 animated_tile）
  alphaIndex?: number;
  flipX?: boolean;
  parallaxFactor?: number;  // 【可选】元素独立视差，覆盖层默认值
};
```

### 7.1 元素级视差（同层多速度）

同一层内可放置多个元素，并为每个元素指定独立的 `parallaxFactor`。不指定时继承层默认值。

**用途示例**：
- `BG_FAR` 层内：远山（`parallaxFactor: 0.12`）移动较慢，云（`parallaxFactor: 0.06`）移动更慢，产生相对漂移。
- `BG_MID` 层内：建筑群统一速度，但某棵大树可单独调慢以突出厚重感。

**计算方式**：
```
layerOffsetX  = cameraAnchorX * (1 - layer.parallaxFactor)
elementOffset = cameraAnchorX * (1 - element.parallaxFactor) - layerOffsetX
finalX        = element.config.x + elementOffset
```

层根节点仍按层系数整体移动；元素若有自己的系数，则在层偏移基础上叠加额外偏移。

## 8. 视差计算与循环策略
- 层偏移公式（横向）：
  - `layerOffsetX = cameraAnchorX * (1 - layer.parallaxFactor)`
  - 每层 root 的基础位置 + `layerOffsetX`。
- 元素级偏移（可选）：
  - 若元素配置了 `parallaxFactor`，则额外计算 `elementOffsetX = cameraAnchorX * (1 - element.parallaxFactor) - layerOffsetX`。
  - 元素最终位置 = `config.x + elementOffsetX`。
- 循环层（tile）：
  - 使用 2~3 段条带拼接。
  - 当某段超出可视阈值时平移到队尾，形成无缝循环。

## 9. 排序、遮挡、透明建议
- 大层顺序：用 `renderingGroupId` 固化（**仅限 0~3**）。
- 同层细节：用 `alphaIndex` 微调。
- **关键规则**：同 `renderingGroupId` 内的**所有 mesh 必须显式设置 `alphaIndex`**。若部分元素有 `alphaIndex`、部分为 `undefined`，Babylon 排序行为异常，可能导致遮挡关系错误。
- 透明边缘控制：
- 素材导出时做干净 alpha（避免白边）。
- 尽量统一预乘 alpha 策略，减少边缘发灰。
- 与地面重叠时给轻微 `y` 抬升避免闪烁。

## 10. 分阶段落地（建议）
1. Phase A：最小可见层 ✅
   - 接入 `BG_FAR + BG_MID + STAGE` 三层。
   - 验证 parallax 稳定、不抖动。
   - 添加 AnimatedTileComponent 支持 spritesheet 帧动画地面。

2. Phase B：元素级视差 + 循环与遮挡 ✅
   - 支持同一层内不同元素的独立 `parallaxFactor`（如 BG_FAR 的云与山）。
   - 给 `BG_FAR/FG_DECOR` 增加 loop。
   - 加 `FG_OCCLUDER` 并验证角色遮挡关系。
   - `alphaIndex` 支持同层内精细排序。
   - `renderingGroupId` 修复，层间遮挡可靠。
   - **渲染层重构**：group 0（背景）、group 1（舞台+角色）、group 2（前景），解决 group 4 超范围问题。

3. Phase C：资产管线稳态
   - 统一贴图命名、尺寸、pivot 约定。
   - 配置化摆放，Scene 不再写死视觉元素。

4. Phase D：相机投影切换 ✅
   - DuelCameraRig 基类迁移至 `UniversalCamera`。
   - Scene 计算 basePosition 和 target，Rig 负责平滑和 zoom。
   - 支持透视/正交投影切换（O 键切换）。
   - 正交模式根据实际窗口比例动态调整 `orthoLeft/Right/Top/Bottom`。
   - 窗口缩放时保持正交比例。

5. Phase E：相机 Zoom 与高度联动 ✅
   - Zoom 配置改为以角色间距为自变量的端点映射（`zoomMinDistance`/`zoomMaxDistance` → `orthoMinWidth`/`orthoMaxWidth`/`perspMinDistance`/`perspMaxDistance`）。
   - 相机高度随 zoom 同步变化：间距大（zoom out）→ 高度高；间距小（zoom in）→ 高度低。
   - `fighterDistance` 指数平滑 + Smoothstep，避免出招抖动。

## 11. 验收清单（视觉向）
- [x] 相机左右移动时，远景明显慢于舞台，前景明显快于舞台。
- [x] 层间无突兀跳变，无明显抖动。
- [ ] 循环层无接缝闪断。
- [x] 前景遮挡不穿帮（角色经过时前后关系正确）。
- [x] Scene 不直接持有大段视觉摆放细节（配置与系统接管）。
- [x] 同层内元素可通过 `alphaIndex` 精细排序。
- [x] 角色位于独立渲染层，不被背景/前景错误遮挡。
- [x] 渲染组控制在 Babylon 默认范围（0~3）内。

## 12. 已知问题与排查记录
- **`renderingGroupId` 超范围导致不可见**：设置 `renderingGroupId: 4` 超出 Babylon 默认范围（0~3），FG_DECOR 层完全不可见。解决：压缩为 3 层（group 0/1/2）。
- **`alphaIndex: undefined` 导致排序异常**：同 group 内部分元素有 `alphaIndex`、部分为 `undefined` 时，Babylon 排序行为不可预期，导致角色被 ground 遮挡。解决：所有元素显式设置 `alphaIndex`。
- **CDN 版本差异导致渲染异常**：`unpkg.com/babylonjs@5.37.0` 加载失败或返回损坏文件，导致部分 Babylon 功能异常。解决：切换至 `cdn.jsdelivr.net/npm/babylonjs@5.37.0`。
- **GPU 内存占用高**： GPU 专用内存约 422MB/496MB，可能导致系统整体性能下降。
- **卡顿异常**：运行一段时间后出现系统级卡顿，Ctrl+F5 刷新无法恢复。
- **临时缓解**：Firefox Performance Profile Capture 后卡顿消失，原因待查（可能与 GPU 缓存重置或 JIT 重新编译有关）。

## 13. 风险与规避
- 风险：层级太多导致 draw call 上升。
- 规避：同层可合批资产统一材质与纹理图集。
- 风险：透明排序冲突。
- 规避：固定 renderingGroup + alphaIndex，关键遮挡物单独层。
- 风险：镜头抖动放大视差抖动。
- 规避：相机平滑参数优先稳定，视差读取使用平滑后的 camera anchor。

---

结论：采用 `SceneVisualSystem + EnvironmentConfig + Plane 贴片层` 的方案，能最大化复用你当前 Scene/Camera 分层成果，同时最接近 Odinlike 的多层卷轴表现，并为后续 AI 控制器接入保留清晰边界。