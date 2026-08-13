# Explore 相机边界（Camera Boundary）设计

## 1. 背景与现状

- 探索模式相机由 `ExploreCameraRig` 驱动（`scripts/ExploreCameraRig.js`），正交投影下 `orthoWidth` 决定可视范围（X 方向半宽 = `orthoWidth/2`，Y 方向半高 = `orthoWidth/(2*aspect)`）。
- 当前相机无边界约束：玩家走到 walkArea 边缘时，相机继续跟随，可视范围会超出场景内容区，露出空白或相邻场景的视觉资源。
- 对照：玩家位置已由 `WalkArea.clampPosition` 约束（`scripts/Enties/WalkArea.js`），walkArea 定义在 `sceneDef.walkAreas` 数组，按 scenario 命中（`Scene._applyWalkArea`）。
- 已落地的 explore rig 场景级参数定制：`sceneDef.exploreCamera`（followDistance/followHeight/smoothing/orthoWidth），由 `Scene._loadSceneInternal` 在 `resetConfig()` 后 `Object.assign` 进 rig.config。本方案与之同层、同装配段。

## 2. 目标

- 给 explore 正交相机加"可视范围不超出指定矩形"的边界约束。
- 边界用 JSON 声明在场景定义里，按 scenario 命中，与 `walkAreas` 风格对称。
- 未声明 = 无约束；某方向未声明 = 该方向无约束；某 scenario 命中但不带任何 min/max = 该 scenario 无约束（用作 fallback 兜底）。
- 边界区间 < 相机 viewsize 时，该轴相机不移动（冻结），控制台打一次警告。
- 透视模式忽略边界计算。
- sequence 期间优先 sequence（enter 时若 sequence busy 则跳过初始 clamp）。

## 3. 非目标（本次不做）

- 不给 duel / scripted rig 加边界（duel 由 stageBounds 约束，scripted 由 sequence 帧控制）。
- 不做 debug 可视化（后续按需再加，可仿 walkArea plane 用 `renderingGroupId=3`）。
- 不引入 schema 校验：未知字段静默无效（与 `exploreCamera` / `walkAreas` 一致）。
- 不限制 Z 轴（2D 横版 Z 是深度，由 followDistance 决定）。

## 4. 数据结构

### 4.1 JSON 扩展

`sceneDef` 顶层新增 `cameraBoundaries` 数组，单条结构对齐 `walkAreas`：

```json
"cameraBoundaries": [
  { "if": { "scenarioMin": 105 }, "minX": -20, "maxX": 8, "minY": -1, "maxY": 5 },
  { "if": {}, "minX": -30, "maxX": -16 }
]
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `if` | object | 是 | 条件，复用 `_evaluateCondition`（scenario/scenarioMin/scenarioMax/flag 等）；空对象 = 总命中 |
| `minX` | number | 否 | 相机可视范围左边界下限（world space） |
| `maxX` | number | 否 | 相机可视范围右边界上限 |
| `minY` | number | 否 | 相机可视范围下边界下限 |
| `maxY` | number | 否 | 相机可视范围上边界上限 |

**"无限制"的三层表达（字段缺省法，不引入 `disabled` 标记）**：

| 层次 | 表达方式 |
|------|----------|
| 整个场景无边界 | `cameraBoundaries` 字段缺省，或空数组 `[]` |
| 某 scenario 无边界 | 命中条目 `{ "if": {...} }` 不带任何 min/max |
| 某方向无边界 | 条目里省略对应字段（如只写 `minX/maxX`） |

### 4.2 命中规则

- 复用 `Scene._evaluateCondition`，按数组顺序首个命中的条目生效（与 `_applyWalkArea` 一致）。
- 命中条目的 min/max 字段按"存在的才约束"原则读取，缺省字段对应方向不 clamp。

## 5. 行为规范

### 5.1 clamp 对象

**直接对 camera 可视范围（world space）做约束**，等价于 clamp `_cameraPosition`：

- 相机可视范围四边界（world space）：
  - `left = _cameraPosition.x + orthoLeft = _cameraPosition.x - halfWidth`
  - `right = _cameraPosition.x + orthoRight = _cameraPosition.x + halfWidth`
  - `bottom = _cameraPosition.y + orthoBottom = _cameraPosition.y - halfHeight`
  - `top = _cameraPosition.y + orthoTop = _cameraPosition.y + halfHeight`
- 约束：
  - `left >= boundary.minX` → `_cameraPosition.x >= boundary.minX + halfWidth`
  - `right <= boundary.maxX` → `_cameraPosition.x <= boundary.maxX - halfWidth`
  - `bottom >= boundary.minY` → `_cameraPosition.y >= boundary.minY + halfHeight`
  - `top <= boundary.maxY` → `_cameraPosition.y <= boundary.maxY - halfHeight`

> 注：由于当前 rig 里 `camera.x = target.x`（X 无偏移）、`camera.y = target.y + followHeight`（Y 固定偏移），clamp `_cameraPosition` 与 clamp `_targetPosition` 数学等价；选 `_cameraPosition` 表述更贴近"可视范围不越界"的语义。

### 5.2 clamp 时机与顺序

在 `compute()` 内：**先 smoothing 逼近 desired，再 clamp `_cameraPosition`**。

顺序反了会导致 smoothing 惯性短暂越界后弹回。

### 5.2.1 sequence 期间跳过 clamp

`compute()` 中 clamp 前检查 `context?.sceneSequencer?.isBusy()`，busy 时跳过 clamp。

**原因**：scenario 变化（如战斗胜利 → scenario=105）触发 `_onWorldStateChange` 同步切换 boundary，但 outro sequence 的 `isBusy()` 要等 sequence 真正 start 才返回 true，存在「boundary 已变但 sequence 未开始」的窗口期。窗口期内硬 clamp 会产生瞬移跳变。

注：cameraBlend 期间 `CameraManager.update` 走 blend 路径不调 `activeRig.compute`，无需额外处理；问题只出现在 sequence 里非 cameraBlend 段（纯 moveActorTo 等）。

### 5.2.2 clamp smoothing（软 clamp）

`#clampCameraPosition(dtMs)` 接受可选 dtMs 参数：

- **dtMs === null（enter 调用，硬 clamp）**：直接赋值。场景加载初始对齐，有 fade 遮挡。
- **dtMs 有值（compute 调用，软 clamp）**：按 `config.clampSmoothing` 平滑逼近 clamped 目标（未配置时回退到 `config.smoothing`）。

公式：`camera += (target - camera) * min(clampSmoothing * dt * 60, 1)`

**行为**：
- 正常情况（相机在范围内）：`target == camera`，无效果。
- boundary 突变收紧：相机平滑移向新边界（约 130ms 到达 70%，clampSmoothing=0.12）。
- 玩家走到边界：平滑拉到边界，与硬 clamp 视觉几乎一致。
- boundary 放宽：`target` 在范围外等于 `camera`，无动作。

**副作用**：smoothing 期间相机会短暂越界（收紧过程中），这是「平滑过渡而非跳变」的预期代价。越界时长取决于 `clampSmoothing` 系数。

**参数位置**：独立字段 `exploreCamera.clampSmoothing`，与 `exploreCamera.smoothing`（相机跟随）解耦。未配置时回退到 `smoothing`（向后兼容）。调大收敛更快、调小更平滑但越界更久。

### 5.3 viewsize 不足的处理

**per-axis 判定**（X/Y 独立）：

- 某轴 `min + viewsize > max`（即 `minX + halfWidth*2 > maxX`，X 轴）时，该轴跳过 clamp，相机保持当前位置（冻结该轴）。
- 检测到时打一次警告（`console.warn`），用 `_axisWarnedX/_axisWarnedY` 标志去重；`setBoundary()` 时重置标志。
- 另一轴不受影响，照常 clamp。

警告文案示例：
[ExploreCameraRig] camera boundary X 轴区间不足 (width=16 < viewsize=20)，X 轴 clamp 已跳过
### 5.4 透视模式

`this.projection === "perspective"` 时**整体跳过** clamp（不读 boundary、不打警告）。boundary 数据保留不清空，切回正交自动生效。

### 5.5 enter() 时的初始 clamp

- 通过 `ctx.sceneSequencer?.isBusy()` 检查 sequence 状态（CameraManager.context 已含 sceneSequencer，无需扩展 ctx）。
- **硬 clamp（无论 seqBusy）**：对 `_cameraPosition` 做一次纯几何 clamp（不依赖 weight），保证 enter 后 `_cameraPosition` 立即对齐 clamped 位置。
- **setClampEnabled（仅 !seqBusy）**：seqBusy=false 时调 `setClampEnabled(true, 0)` 把 weight 瞬时设为 1；seqBusy=true 时**不调**（weight 由 cameraBlend START 手工设 target=1，enter 不覆盖，保留纯手工控制语义）。

**为什么 seqBusy=true 也要硬 clamp**：enter 用 `hero.root.position`（desired）重置 `_cameraPosition`，而 cameraBlend 终值（toState）是 `explore.compute` 算的 clamped 位置。若 enter 不 clamp，`_cameraPosition` 会停在 desired，与 blend 终值（clamped）不一致，后续 compute 的 followBlend 会慢慢把 `_cameraPosition` 从 desired 拉到 clamped，视觉表现为「blend 结束 → 瞬间跳到未 clamp 位置 → 再慢慢拉回 clamp」的抖动。硬 clamp 是纯几何操作，不读不写 weight，对 weight 状态无影响。

**历史回归（2026-08-11 修复）**：曾因 seqBusy=true 分支跳过 `#clampCameraPositionHard()`，导致 flee sequence 结束后相机抖动（hero 在 boundary 边缘时，desired 与 clamped 差值明显）。

### 5.6 resize

`compute()` 每帧重算 `halfWidth/halfHeight`（基于 `window.innerWidth/innerHeight` 与 `orthoWidth`），resize 后自动适配，无需在 `onResize` 里额外处理。

### 5.7 相机四角 debug 面板

**开关**：`X` 键，与 collision/walkArea/stageBoundary/triggers/npc 同步切换（`Scene.js` 的 `onKeyDown` 回调里调 `exploreCameraRig.setDebugVisible(nextVisible)`）。

**显示**：4 个 DOM div 固定在屏幕四角（TL/TR/BL/BR），每个显示该角对应的 world space 坐标 `(x, y)`。

**计算**：
- TL = `(camera.x - halfWidth, camera.y + halfHeight)`
- TR = `(camera.x + halfWidth, camera.y + halfHeight)`
- BL = `(camera.x - halfWidth, camera.y - halfHeight)`
- BR = `(camera.x + halfWidth, camera.y - halfHeight)`

**样式**：对齐 `CharacterBase.#createDebugPanel`（深色半透背景 + 等宽字体 + 边框），`position:fixed` 固定四角（不跟随世界坐标投影）。

**更新时机**：`compute()` 末尾调 `#updateCornerPanels()`，与 clamp 后的 `_cameraPosition` 同步。

**透视模式**：隐藏四角面板（坐标无意义）。

**懒创建**：首次 `setDebugVisible(true)` 时创建 4 个 div，`dispose()` 时清理。

## 6. 实现方案

### 6.1 ExploreCameraRig 改造

新增字段与方法：

```js
constructor(config = {}) {
    // ... 现有 ...
    this._boundary = null;          // { minX?, maxX?, minY?, maxY? } | null
    this._axisWarnedX = false;
    this._axisWarnedY = false;
}

setBoundary(def) {
    // def 为 null/undefined 或 {} → 清空（无约束）
    // def 带 min/max 字段 → 提取存在的字段存入 _boundary
    if (!def || Object.keys(def).length === 0) {
        this._boundary = null;
    } else {
        this._boundary = {};
        for (const k of ["minX","maxX","minY","maxY"]) {
            if (def[k] !== undefined) this._boundary[k] = def[k];
        }
        // 全部字段都缺省 = 无约束
        if (Object.keys(this._boundary).length === 0) this._boundary = null;
    }
    this._axisWarnedX = false;
    this._axisWarnedY = false;
}
```

`resetConfig()` 同步清空 boundary（"恢复默认"语义上等于无边界）：

```js
resetConfig() {
    this.config = { ...this._defaultConfig };
    this.setBoundary(null);   // 新增
}
```

`enter(ctx)` 末尾追加初始 clamp（sequence 优先）：

```js
enter(ctx) {
    // ... 现有初始化 ...
    if (this.projection === "orthographic" && this._boundary) {
        const seqBusy = ctx?.sceneSequencer?.isBusy?.() ?? false;
        if (!seqBusy) {
            this.#clampCameraPosition(null);   // 硬 clamp
        }
    }
}
```

`compute()` 在 smoothing 逼近 desired 之后、return 之前追加 clamp（软 clamp，传入 dtMs）：

```js
compute(dtMs, context, prevState) {
    // ... 现有 target/desired/smoothing 逻辑 ...

    if (this.projection === "orthographic" && this._boundary) {
        const seqBusy = context?.sceneSequencer?.isBusy?.() ?? false;
        if (!seqBusy) {
            this.#clampCameraPosition(dtMs);   // 软 clamp
        }
    }

    this.#updateCornerPanels();   // 四角 debug 面板

    // ... 现有 state 构造与 return ...
}
```

私有 clamp 方法（dtMs === null 硬 clamp，有值软 clamp）：

```js
#clampCameraPosition(dtMs = null) {
    const b = this._boundary;
    if (!b) return;

    const windowAspect = window.innerWidth / window.innerHeight;
    const halfWidth = this.config.orthoWidth / 2;
    const halfHeight = (this.config.orthoWidth / windowAspect) / 2;

    let targetX = this._cameraPosition.x;
    let targetY = this._cameraPosition.y;

    // X 轴：计算 clamped target
    if (b.minX !== undefined || b.maxX !== undefined) {
        const minCamX = b.minX !== undefined ? b.minX + halfWidth : -Infinity;
        const maxCamX = b.maxX !== undefined ? b.maxX - halfWidth : Infinity;
        if (minCamX > maxCamX) {
            if (!this._axisWarnedX) { /* warn */ this._axisWarnedX = true; }
        } else {
            targetX = Math.max(minCamX, Math.min(maxCamX, this._cameraPosition.x));
        }
    }

    // Y 轴（同构）
    if (b.minY !== undefined || b.maxY !== undefined) {
        const minCamY = b.minY !== undefined ? b.minY + halfHeight : -Infinity;
        const maxCamY = b.maxY !== undefined ? b.maxY - halfHeight : Infinity;
        if (minCamY > maxCamY) {
            if (!this._axisWarnedY) { /* warn */ this._axisWarnedY = true; }
        } else {
            targetY = Math.max(minCamY, Math.min(maxCamY, this._cameraPosition.y));
        }
    }

    // 硬 clamp vs 软 clamp
    if (dtMs === null) {
        this._cameraPosition.x = targetX;
        this._cameraPosition.y = targetY;
    } else {
        const dt = dtMs / 1000;
        const clampSmoothing = this.config.clampSmoothing ?? this.config.smoothing;
        const blend = Math.min(clampSmoothing * dt * 60, 1);
        this._cameraPosition.x += (targetX - this._cameraPosition.x) * blend;
        this._cameraPosition.y += (targetY - this._cameraPosition.y) * blend;
    }
}
```

四角 debug 面板方法：

```js
setDebugVisible(value) {
    this._debugVisible = !!value;
    if (this._debugVisible && !this._cornerPanels) this.#createCornerPanels();
    if (this._cornerPanels) {
        for (const p of this._cornerPanels) p.style.display = this._debugVisible ? "block" : "none";
    }
}

#createCornerPanels() {
    // 创建 4 个 div：position:fixed 固定在屏幕 TL/TR/BL/BR
    // 样式对齐 CharacterBase debug panel
}

#updateCornerPanels() {
    // 每帧 compute 末尾调用：
    // - 透视模式隐藏
    // - 正交模式显示 4 角 world space 坐标 (camera.x ± halfWidth, camera.y ± halfHeight)
}
```
    }
}
```

> 注：`#clampCameraPosition` 只动 `_cameraPosition`，不动 `_targetPosition`。当前 rig 输出 `state.target = _targetPosition`（玩家位置），clamp camera 后 target 仍在玩家身上，相机会有轻微 pitch——这与现有 smoothing 行为一致（玩家走到 walkArea 边缘时 camera 停、target 继续跟玩家的经典横版表现）。

### 6.2 Scene 装配路径

在 `_loadSceneInternal` 现有 exploreCamera 段之后（`resetConfig` + `Object.assign` 之后），加 boundary 装配：

```js
// --- explore rig 场景级参数（无声明则用默认）---
exploreCameraRig.resetConfig();
const exploreCfg = sceneDef.exploreCamera;
if (exploreCfg) {
    Object.assign(exploreCameraRig.config, exploreCfg);
}

// --- explore 相机边界（无声明则无约束）---
this._cameraBoundaryDefs = Array.isArray(sceneDef.cameraBoundaries)
    ? sceneDef.cameraBoundaries : [];
this._applyCameraBoundary();
```

新增 `_applyCameraBoundary`（仿 `_applyWalkArea`，但 boundary 是纯数据无需 dispose/recreate）：

```js
_applyCameraBoundary() {
    if (!this._cameraBoundaryDefs?.length) {
        this._game.exploreCameraRig.setBoundary(null);
        return;
    }
    for (const def of this._cameraBoundaryDefs) {
        if (this._evaluateCondition(def.if, this.worldState)) {
            this._game.exploreCameraRig.setBoundary(def);
            return;
        }
    }
    // 全部不命中 = 无约束
    this._game.exploreCameraRig.setBoundary(null);
}
```

### 6.3 重新评估时机

仿 `_applyWalkArea`：

| 时机 | 调用 |
|------|------|
| `Scene._loadSceneInternal` | 构造 `_cameraBoundaryDefs` + `_applyCameraBoundary()` |
| `Scene._onWorldStateChange` | scenario 变化后调 `_applyCameraBoundary()`（与 `_applyWalkArea()` 同段） |

### 6.4 生命周期与场景切换

| 时机 | 行为 |
|------|------|
| Game.bootstrap | `new ExploreCameraRig()`，`_boundary = null` |
| Scene 加载 | `resetConfig()`（清 boundary）→ 按 sceneDef 覆写 config → `_applyCameraBoundary()` |
| sequence 期间 | scripted rig active，explore rig 的 `compute` 不被调，boundary 不生效 |
| sequence 结束 switchMode → explore | `enter(ctx)` 检查 seqBusy（此时已 false）→ 初始 clamp |
| cameraBlend to:"explore" | rig id 不变，blend 期间 explore.compute 作为参与方照常 clamp（保持一致性） |
| 场景 dispose | rig 是 game 级不 dispose；下次 Scene 加载 reset 时清 boundary |

## 7. 不改的部分（显式列出，避免误改）

- rig id `"explore"`、`ExploreMode.enter` 的 `switchRig("explore")`、`TimelineSequencer.cameraBlend` 的 `to:"explore"` 分支：不变。
- `ExploreCameraRig.enter` 的 `this.projection = "orthographic"` 硬编码：不变。
- `ExploreCameraRig.toggleProjection`：不变（切透视后 boundary 自动失效，切回自动生效）。
- `WalkArea` / `walkAreas`：完全独立，不互相引用。
- `CameraManager`：不改（context 已含 sceneSequencer，rig 直接读）。

## 8. 代码改动清单

| 文件 | 位置 | 改动 |
|------|------|------|
| `scripts/ExploreCameraRig.js` | 构造 | 加 `_boundary`/`_axisWarnedX/Y`/`_debugVisible`/`_cornerPanels` 字段 |
| `scripts/ExploreCameraRig.js` | `setBoundary(def)` | 新增：提取存在的 min/max 字段，全缺省视为无约束；重置 warn 标志 |
| `scripts/ExploreCameraRig.js` | `resetConfig()` | 末尾调 `setBoundary(null)` |
| `scripts/ExploreCameraRig.js` | `enter(ctx)` | 末尾：正交+有 boundary+seq 不 busy 时硬 clamp（`#clampCameraPosition(null)`） |
| `scripts/ExploreCameraRig.js` | `compute()` | smoothing 后：正交+有 boundary+seq 不 busy 时软 clamp（`#clampCameraPosition(dtMs)`）；末尾调 `#updateCornerPanels()` |
| `scripts/ExploreCameraRig.js` | `#clampCameraPosition(dtMs)` | 新增：dtMs=null 硬 clamp，有值按 `config.smoothing` 软 clamp；per-axis 区间不足警告 |
| `scripts/ExploreCameraRig.js` | `setDebugVisible`/`#createCornerPanels`/`#updateCornerPanels` | 新增：四角 debug 面板，`X` 键开关 |
| `scripts/ExploreCameraRig.js` | `dispose()` | 清理 4 个 div |
| `scripts/Scene.js` | `_loadSceneInternal` exploreCamera 段之后 | 加 `_cameraBoundaryDefs` 构造 + `_applyCameraBoundary()` 调用 |
| `scripts/Scene.js` | `_onWorldStateChange` | 加 `_applyCameraBoundary()` 调用（与 `_applyWalkArea()` 同段） |
| `scripts/Scene.js` | 新增 `_applyCameraBoundary()` | 按 scenario 首个命中条目调 `rig.setBoundary(def)`，空数组/全不命中调 `setBoundary(null)` |
| `scripts/Scene.js` | `onKeyDown` X 键回调 | 追加 `exploreCameraRig.setDebugVisible(nextVisible)` |
| `Data/SceneDefs/prologue.json` | 顶层 `walkAreas` 后 | 加 `cameraBoundaries` 数组 |

共 2 个代码文件 + 1 个数据文件。

## 9. 验证方案

1. **基础 clamp**：prologue 配一组紧凑 boundary（如 `minX:-20,maxX:8`），玩家走到 walkArea 左/右边缘，确认相机可视范围不越界（左边界停在 -20，右边界停在 8）。
2. **viewsize 不足警告**：临时配 `minX:0, maxX:5`（< orthoWidth 20），加载场景，确认控制台打一次 X 轴警告，X 轴相机不移动，Y 轴照常 clamp。
3. **per-direction 缺省**：只配 `minX/maxX` 不配 Y，确认 Y 方向相机自由跟随，无 Y 轴警告。
4. **scenario 切换**：prologue 配两条 `cameraBoundaries`（scenarioMin 105 前后不同范围），完成 prologue_battle 后 scenario 变化，确认 boundary 自动切换（无需重新加载场景）。
5. **无声明**：outdoor_village 不配 `cameraBoundaries`，确认相机无任何 clamp，行为与改动前一致。
6. **透视跳过**：prologue 加载后按开发键 `toggleProjection()` 切透视，确认 boundary 不生效（相机可自由移动到 boundary 外）；切回正交确认恢复 clamp。
7. **sequence 优先**：prologue_intro 期间触发 switchMode → explore（如果有此路径），确认 enter 时不 clamp，相机保留 sequence 终值；待 sequence 完全结束后下一帧 compute 自然 clamp。
8. **场景切换不泄漏**：从 prologue（有 boundary）切到 outdoor_village（无 boundary），确认 outdoor_village 相机无 clamp 行为（`_boundary` 已被 `resetConfig()` 清空）。
9. **resize**：运行时拖动浏览器窗口改变 aspect，确认 boundary clamp 的 halfWidth/halfHeight 自动适配（X/Y 范围随 aspect 变化）。

## 10. 风险与边界

- **boundary 范围配错**：若 boundary 比 walkArea 还小，玩家在 walkArea 内但相机 viewport 超出 boundary，相机会被 clamp 在 boundary 边缘，玩家可能走出画面边缘——属预期行为（经典横版「相机锁」），需策划确保 boundary >= walkArea + viewsize。
- **Y 轴 pitch**：clamp `_cameraPosition.y` 后 target 仍跟随玩家 Y，相机会有轻微 pitch。当前 explore 场景 Y 范围通常很小（prologue walkArea Y: -1~0.7），pitch 不明显；若后续场景 Y 范围大且 followHeight 大，可能需要单独处理（本次不做）。
- **scenario→sequence 窗口期**：scenario 变化（如战斗胜利 → 105）触发 `_onWorldStateChange` 同步切换 boundary，但 outro sequence 的 `isBusy()` 要等 sequence 真正 start 才返回 true，存在「boundary 已变但 sequence 未开始」的窗口期。窗口期内 `compute` 会被调且 `seqBusy=false`，clamp 生效。**缓解**：clamp 采用软 clamp（按 `config.smoothing` 平滑逼近），窗口期内相机不会瞬间跳变而是平滑过渡；sequence 真正 start 后 `isBusy()` 返回 true，clamp 被跳过，相机交由 sequence 接管，之前的过渡不会干扰 sequence。
- **软 clamp 越界**：smoothing 期间相机会短暂越界（boundary 收紧过程中）。这是「平滑过渡而非跳变」的预期代价，越界时长取决于 `smoothing` 系数。玩家走到边界时的越界极短（玩家移动速度 << smoothing 收敛速度）。
- **cameraBlend 期间**：`CameraManager.update` 在 `_blend.active` 时走 blend 路径不调 `activeRig.compute`，explore rig 的 clamp 不生效，无需额外处理。
- **boundary 与 walkArea 解耦**：两者独立声明，不互查。若 boundary < walkArea，玩家可走到相机看不到的位置（黑屏边缘），属配置错误，靠策划保证。
- **`_axisWarned*` 标志**：只在 `setBoundary()` 时重置，场景内 scenario 切换若新 boundary 仍不合法会再打一次（合理行为，避免漏报）。
- **四角 debug 面板懒创建**：div 首次 `setDebugVisible(true)` 时创建，`dispose()` 时清理。场景切换不会自动 dispose rig（game 级单例），div 跨场景复用，无泄漏风险。

### 10.1 代码层踩坑（非 clamp 风险，但曾导致相机不动回归）

- **TimelineSequencer ACTION_HANDLERS 内禁止用 `this.context`**：handler 是 plain object 方法，`_updateClip` 以普通函数方式调 `handler.start(this.context, clip, state)`（[L255](file:///e/se/BlindDuel/scripts/Systems/TimelineSequencer.js#L255)），`this` 指向 handler object 而非 TimelineSequencer 实例，`this.context` 为 `undefined`。必须用第一个参数 `ctx`（如 `ctx.game?.exploreCameraRig?.setClampEnabled?.(...)`）。
- **历史回归（2026-08-11 修复）**：cameraBlend 的 `to==="explore"` 分支误用 `this.context.game`（[L611](file:///e/se/BlindDuel/scripts/Systems/TimelineSequencer.js#L611)），抛 `TypeError` 被 try-catch 静默吞掉，导致 `setClampEnabled` / `startBlend` / `state.cameraManager` 全部未执行，END handler 拿到 `cm=undefined` 不进任何分支，`switchRig("explore")` 未调，相机停在 scripted rig 最后 follow 位置。表现与 clamp 机制很像（相机不动），但与 clamp 无关。
- **诊断教训**：加 log 必须覆盖整条调用链入口/出口（TimelineSequencer handler 的 start/end），不能只在下游 rig 上加 log，否则 handler crash 被静默吞掉后只表现为「下游没被调」，难以定位。

## 11. 可选后续（不在本次 scope）

- debug 可视化：用 `BABYLON.MeshBuilder.CreateLines` 画 boundary 矩形框，`renderingGroupId=3` 与 walkArea 一致，按某个 debug 开关键控。
- boundary 与 walkArea 联动校验：加载时检查 boundary 是否 >= walkArea + viewsize，不足打配置警告。
- Y 轴 pitch 抑制：若 Y 范围大场景出现明显 pitch，可考虑 clamp target.y 而非 camera.y（牺牲 followHeight 精度换正视）。