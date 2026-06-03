# Camera Effects Pipeline Plan

> **Status**: 待实施

## 目标

为 `CameraManager` 补齐完整的镜头效果管线，支持 shake / flash / letterbox / fade 四种效果类型，同时接入正常 gameplay（命中反馈）和 sequence（演出编排）。

## 核心设计决策

1. **效果分两类，不全塞进相机矩阵**：
   - `shake`：camera-state effect，修改 `pos/target`
   - `flash / letterbox / fade`：screen-space effect，用 DOM overlay 实现，与 rig 完全解耦
2. **baseState vs finalState 分离**：`this.state` 存放 `baseState`（无 shake 的干净状态），`finalState`（baseState + shake）只用于写入 Babylon camera，不反馈进下一帧 rig/blend 的输入
3. **DOM overlay 随 CameraManager 持久存在**：`init()` 时创建一次，`dispose()` 时销毁，不反复增删 DOM
4. **letterbox 用位移动画**：上下黑边通过 `translateY()` 滑入/滑出，`speed` 控制速度
5. **flash 瞬时亮 + CSS 衰减**：JS 设 `opacity = maxAlpha`，CSS `transition` 自动衰减

## API 规范

```javascript
cameraManager.enqueueEffect({
    type: "shake",      // camera-state: 修改 pos/target
    durationMs: 180,
    params: { amplitude: 0.25, frequency: 35 }
});

cameraManager.enqueueEffect({
    type: "flash",      // screen-space: 瞬时亮 + CSS 衰减
    durationMs: 120,    // 衰减时长
    params: { color: "white", maxAlpha: 1.0 }
});

cameraManager.enqueueEffect({
    type: "letterbox",  // screen-space: 黑边滑入，停留，滑出
    durationMs: 3000,   // 总存活时间（含进出）。不传则一直停留直到 clearEffects()
    params: { height: 72, speed: 240 }  // height: 单条黑边高度(px); speed: 进出速度(px/s)
});

cameraManager.enqueueEffect({
    type: "fade",       // screen-space: 通用 from→to 淡入淡出
    durationMs: 800,
    params: { color: "black", from: 1, to: 0 }  // from:1→to:0 = fade out from black
});
```

### shake 叠加策略

多个 shake 同时活跃时，每帧计算每个 shake 的偏移量，取绝对值最大的（`maxX`、`maxY` 分别取 max）。不对偏移做加法，避免叠加导致相机飞出屏幕。

---

## 实施步骤

### Step 0：修复 `this.state` 污染（baseState / finalState 分离）

**改动范围**：仅 `CameraManager.update()`，约 3 行

**内容**：
- `update()` 末尾将 `this.state = baseState`（当前写的是 `this.state = finalState`）
- 确保 rig/blend 的 `prevState` 参数不受 shake 偏移污染

**验证方式**：
- 在 `_applyEffects` 中写一个硬编码的 shake 偏移（比如 `pos.x += 999`），运行游戏
- 观察：每帧相机确实偏移了 999，但下一帧 `compute()` 收到的 `prevState` 的 `pos.x` 不受影响
- 在浏览器 console 确认：`cameraManager.state.pos.x` 不包含 shake 偏移

**风险**：极低。已验证 DuelCameraRig / ExploreCameraRig / ScriptedCameraRig 的 `compute()` 都不依赖 `prevState` 做核心计算，仅用于 fallback。

---

### Step 1：创建 DOM overlay + flash 效果

**改动范围**：`CameraManager.init()` / `CameraManager._applyEffects()` / 新增 overlay 驱动逻辑

**内容**：
1. `init()` 中创建 overlay 容器，挂在 canvas 的 parent 下，结构：

```html
<div id="camera-overlay" style="position:fixed;inset:0;pointer-events:none;z-index:1">
    <div id="fx-flash"  style="position:absolute;inset:0;opacity:0;transition:opacity ...ms ease-out"></div>
    <div id="fx-fade"   style="position:absolute;inset:0;opacity:0;transition:opacity ...ms linear"></div>
    <div id="fx-letter-top"    style="position:absolute;left:0;right:0;top:0;transform:translateY(-100%);transition:transform ...ms linear"></div>
    <div id="fx-letter-bottom" style="position:absolute;left:0;right:0;bottom:0;transform:translateY(100%);transition:transform ...ms linear"></div>
</div>
```

2. `enqueueEffect()` 中，对 `type: "flash"` 立即触发 DOM：
   - 设 `fx-flash` 的 `background` 为 `color`
   - 设 `opacity = maxAlpha`（无过渡，瞬间亮）
   - CSS `transition: opacity ${durationMs}ms ease-out` 自动衰减到 0

3. `_applyEffects()` 中，shake 类型的处理逻辑留到 Step 2

**验证方式**：
- 在浏览器 console 中执行 `cameraManager.enqueueEffect({ type: "flash", durationMs: 200, params: { color: "white", maxAlpha: 1.0 } })`
- 观察：屏幕瞬间全白，然后 200ms 内衰减到透明
- 重复执行 3 次：每次都能正确触发（不堆积、不残留）

---

### Step 2：实现 shake 效果

**改动范围**：`CameraManager._applyEffects()`

**内容**：
1. 遍历 `_effects`，筛出 `type === "shake"` 且未过期的
2. 每个 shake 计算当前进度 `t = elapsedMs / durationMs`（带 decay 曲线）
3. 偏移公式：`offsetX = amplitude * sin(elapsedMs * frequency * 2π / 1000) * decay(t)`
4. 多个 shake 取 maxX / maxY
5. 将最终偏移加到 `finalState.pos` 和 `finalState.target` 上（XY 平面同向偏移）

**验证方式**：
- 在浏览器 console 执行 `cameraManager.enqueueEffect({ type: "shake", durationMs: 500, params: { amplitude: 0.3, frequency: 35 } })`
- 观察：画面抖动 0.5 秒后恢复平稳，抖动期间角色/地面位置关系正确
- 在抖动期间用鼠标点击 canvas 切换 focus：不应有位置跳变
- 连续执行 3 次：不应有累积偏移（证明 Step 0 的 baseState 分离有效）

---

### Step 3：实现 fade 效果

**改动范围**：`CameraManager.enqueueEffect()` / overlay CSS 驱动

**内容**：
1. `enqueueEffect()` 收到 `type: "fade"` 时：
   - 设 `fx-fade` 的 `background` 为 `color`
   - 瞬间设 `opacity = from`
   - 用 `requestAnimationFrame` 或 CSS `transition` 驱动 `opacity` 到 `to`，时长 = `durationMs`
2. fade 结束后 `fx-fade` 保持在 `to` 值（不自动清除），由 `clearEffects("fade")` 恢复默认

**验证方式**：
- console 执行 `cameraManager.enqueueEffect({ type: "fade", durationMs: 1000, params: { color: "black", from: 0, to: 1 } })`
  - 观察：屏幕从透明渐变为全黑，持续 1 秒
- console 执行 `cameraManager.enqueueEffect({ type: "fade", durationMs: 500, params: { color: "black", from: 1, to: 0 } })`
  - 观察：从全黑淡出到透明
- console 执行 `cameraManager.clearEffects()` 后，fade 层恢复透明（`opacity = 0`）

---

### Step 4：实现 letterbox 效果

**改动范围**：`CameraManager.enqueueEffect()` / overlay CSS 驱动 / `clearEffects()` 清理

**内容**：
1. `enqueueEffect()` 收到 `type: "letterbox"` 时：
   - 设 `fx-letter-top` 高度为 `height`，`background: black`
   - 设 `fx-letter-bottom` 高度为 `height`，`background: black`
   - 计算进场时长 `enterMs = (height / speed) * 1000`
   - 用 CSS `transition: transform ${enterMs}ms linear` 驱动：`translateY(-100%)` → `translateY(0)`（top bar），`translateY(100%)` → `translateY(0)`（bottom bar）
2. 进场完成后保持位置
3. 如果传了 `durationMs`，在 `durationMs - enterMs * 2` 后自动触发退场（反方向）
4. `clearEffects("letterbox")` 触发退场动画并恢复默认

**验证方式**：
- console 执行 `cameraManager.enqueueEffect({ type: "letterbox", durationMs: 3000, params: { height: 72, speed: 240 } })`
  - 观察：上下黑边在 0.3s 内滑入 → 停留约 2.4s → 在 0.3s 内滑出
- console 执行 `cameraManager.enqueueEffect({ type: "letterbox", params: { height: 72, speed: 240 } })`（不传 durationMs）
  - 观察：黑边滑入后一直停留
  - 执行 `cameraManager.clearEffects()` → 黑边滑出

---

### Step 5：接入战斗反馈（shake + flash on hit/guard/clash）

**改动范围**：`CombatSystem.js`（加 `cameraManager` 引用）、`character_demo.js`（传参）

**内容**：
1. `CombatSystem` 构造函数增加 `options.cameraManager`
2. 在效果处理循环中，根据 `effect.type` 调用 `cameraManager.enqueueEffect()`：

| 战斗事件 | 效果 | 参数 |
|---|---|---|
| `hit` (takeDamage) | shake + flash | shake(amplitude:0.25, durationMs:180) + flash(durationMs:80) |
| `clash` | shake | shake(amplitude:0.18, durationMs:120) |
| `blockstun` (guard) | shake | shake(amplitude:0.12, durationMs:100) |
| `parryBonus` (just guard) | shake + flash | shake(amplitude:0.35, durationMs:250) + flash(durationMs:100) |

**验证方式**：
- 进入战斗，双方互相攻击
- 命中时：画面抖动 + 白闪
- 格挡时：轻微抖动
- 弹刀/拼刀时：双方抖动
- Just Guard 时：较大抖动 + 白闪
- 所有情况下，战斗结束后相机位置无漂移

---

### Step 6：接入 Timeline Sequence（cameraEffect clip handler）

**改动范围**：`TimelineSequencer.js`（ACTION_HANDLERS）、`SceneSequencer.js`（STEP_TYPE）

**内容**：

1. **TimelineSequencer - `cameraEffect` handler**：
   - 支持事件型 clip（`atMs`）：`start()` 中调用 `cameraManager.enqueueEffect()`
   - 支持区间型 clip（`startMs + durationMs`）：`start()` 中开始效果，`end()` 中清理
   - 参数映射：clip 的 `effect` / `durationMs` / `params` 字段映射到 `enqueueEffect()` 参数

2. **SceneSequencer - `STEP_TYPE.CAMERA_EFFECT`**：
   - `_startCurrentStep()` 中调用 `cameraManager.enqueueEffect(step)`
   - `_updateStep()` 中直接返回 `true`（瞬时完成）

**验证方式**：
- 写一个测试 timeline：

```javascript
{
    id: "test.fx",
    tracks: [{
        id: "camera.fx",
        kind: "camera",
        channel: "fx",
        clips: [
            { type: "cameraEffect", atMs: 500, effect: "flash", durationMs: 120, params: { color: "white", maxAlpha: 1.0 } },
            { type: "cameraEffect", atMs: 500, effect: "shake", durationMs: 220, params: { amplitude: 0.22, frequency: 35 } },
            { type: "cameraEffect", startMs: 0, durationMs: 800, effect: "letterbox", params: { height: 64, speed: 240 } }
        ]
    }],
    durationMs: 3000
}
```

- 执行后观察：0.5s 时同时闪白 + 抖动，全程有黑边
- timeline 结束或 `stop()` 后：letterbox 自动滑出
- 旧 step sequence 用 `STEP_TYPE.CAMERA_EFFECT` 同理可测

---

## 优先级与实施顺序

```
Step 0 (baseState fix)     ← 必须先做，否则后续 shake 测试会漂移
Step 1 (overlay + flash)   ← 验证 DOM overlay 方案可行
Step 2 (shake)             ← 验证 camera-state effect 管线 + 叠加策略
Step 3 (fade)              ← 补充 screen-space 效果
Step 4 (letterbox)         ← 最复杂（进出动画 + 持续状态 + 清理）
Step 5 (combat 接入)       ← 验证 gameplay 集成
Step 6 (sequence 接入)     ← 验证演出集成
```

Step 0-4 完成后，效果管线本身完全可用。Step 5-6 是集成验证。

## 不做的事

- 不做 Babylon GUI / PostProcess 实现（当前 DOM overlay 方案足够原型阶段使用）
- 不做 `CombatPresentationSystem` 抽象（过早抽象，Step 5 直接挂在 CombatSystem 中）
- 不做 shake 的 Perlin noise（正弦波足够原型阶段使用）
- 不做 letterbox 的 easing 曲线（原型阶段 linear 即可）