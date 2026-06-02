# Timeline Sequencer 并发 Action 重构计划

> 目标：把当前“每个 action 顺序执行”的 sequence，重构为类似 UE Sequencer 的统一时间轴模型。每个 action 指定开始时间与持续时间，由同一个 fixedUpdate 时间轴推进，从而允许移动、动画命令、镜头、模式切换等并发编排。

---

## 1. 背景与现状

当前计划只针对 `SceneSequencer` 的过场编排逻辑：

1. `SceneSequencer`
   - 用于过场、模式切换、镜头切换、角色移动、输入锁定等。
   - 当前实现是 `steps[_stepIndex]`，一个 step 完成后才进入下一个 step。
   - `wait`、`moveActorTo`、`startCameraBlend`、`waitUntil` 都会阻塞后续 step。

`TestController` 是测试/控制器系统，与过场 sequencer 是独立系统，不纳入本计划迁移范围。两者可以复用相似的时间轴思想，但不应在这次重构中被合并。

当前 `SceneSequencer` 的核心问题是：**时间表达是隐式累加的顺序队列，而不是显式时间轴**。

---

## 2. 核心目标

新增或扩展为 `TimelineSequencer` 模型：

- sequence 拥有统一 `currentTimeMs`。
- 每个 action/clip 显式声明 `atMs` 或 `startMs + durationMs`。
- 每帧由 `fixedUpdate(dtMs, tickCount)` 推进时间轴。
- Sequencer 找出当前应触发或正在执行的 clips，并调用对应 handler。
- 不同 track 可以并发执行。
- 冲突边界按 `binding + channel` 判断，避免两个 clip 同时写同一个 actor/controller/camera 控制面。
- `binding` 负责把通用 track 绑定到具体对象，例如 `{ actorId: "hero" }`、`{ actorId: "enemy" }` 或 `{ cameraId: "scripted" }`。系统提供的是 actor/camera/mode 等通用操作，具体操作谁属于 sequence 内容。
- `channel` 负责描述同一个 binding 下被控制的功能面，例如 `movement`、`command`、`facing`、`input`。它用于校验和调度冲突：同一 binding + channel 的持续 clip 默认不能重叠，不同 channel 可以并发。

---

## 3. 数据结构建议

### 3.1 Timeline Sequence

```js
{
    id: "exit_battle",
    durationMs: 5200,
    loop: false,
    tracks: [
        {
            id: "hero_actor",
            kind: "actor",
            binding: { actorId: "hero" },
            channel: "actor",
            clips: [
                { type: "inputLock", atMs: 0, locked: true },
                { type: "command", atMs: 1500, command: "sheath" },
                { type: "faceWorldX", atMs: 2800, direction: -1 },
                { type: "moveActorTo", startMs: 3000, durationMs: 1200, x: -6.4, y: 0 },
                { type: "inputLock", atMs: 5100, locked: false }
            ]
        },
        {
            id: "camera",
            clips: [
                { type: "cameraBlend", startMs: 3200, durationMs: 2000, to: "explore" }
            ]
        },
        {
            id: "mode",
            clips: [
                { type: "switchMode", atMs: 5000, modeId: "explore" }
            ]
        }
    ]
}
```

### 3.2 Clip 类型

建议第一版只区分三类：

1. Event clip
   - 只触发一次。
   - 使用 `atMs`。
   - 示例：`command`、`switchMode`、`inputLock`、`faceWorldX`。

2. Interval clip
   - 在一段时间内持续更新。
   - 使用 `startMs + durationMs`。
   - 示例：`moveActorTo`、`cameraBlend`。

3. Gate clip
   - 可选第一版。
   - 到达某个时间点后暂停时间轴，直到条件成立。
   - 示例：等待角色状态回到 `idle`。

---

## 4. Runtime 设计

### 4.1 Sequencer 状态

```js
class TimelineSequencer {
    constructor(context) {
        this.context = context;
        this.timeline = null;
        this.currentTimeMs = 0;
        this.busy = false;
        this.activeClipStates = new Map();
        this.firedEventClipIds = new Set();
    }

    play(timeline, payload) {}
    stop() {}
    fixedUpdate(dtMs, tickCount) {}
}
```

### 4.2 Clip 生命周期

每个 handler 采用最小生命周期：

```js
const ACTION_HANDLERS = {
    command: {
        start(ctx, clip, state) {},
        update(ctx, clip, state, localMs, dtMs) { return true; },
        end(ctx, clip, state) {}
    }
};
```

约定：

- `start()`：clip 第一次进入 active 区间时调用。
- `update()`：active 区间内每个 fixed tick 调用。
- `end()`：clip 离开 active 区间或 sequence stop 时调用。
- event clip 可只实现 `start()`。

---

## 5. Track、Binding 与冲突规则

第一版建议使用简单规则：

- track 类型从功能角度定义，例如 `kind: "actor"`、`kind: "camera"`、`kind: "mode"`。
- 具体操作哪个对象由 `binding` 决定，例如 `binding: { actorId: "hero" }` 或 `binding: { actorId: "rabble_stick_01" }`。
- `channel` 表示同一个 binding 下的控制面，例如 `movement`、`command`、`facing`、`input`。
- 不同 binding 可以并发。
- 同一 binding + channel 内默认不允许 interval clip 时间重叠。
- event clip 可以与 interval clip 同 binding + channel 重叠，但要谨慎。
- 如果检测到同 binding + channel 的 interval clip 重叠，启动 sequence 时打印 warning。

示例：

```js
{
    id: "hero_movement",
    kind: "actor",
    binding: { actorId: "hero" },
    channel: "movement",
    clips: [
        { type: "moveActorTo", startMs: 3000, durationMs: 1200, x: -6.4, y: 0 }
    ]
}
```

这样系统层提供的是通用 actor 操作，`hero`、`enemy`、`merchant` 或其它对象都只是 sequence 内容绑定。

### 5.1 当前项目的硬编码问题

当前 `SceneSequencer` 仍然是特异性绑定：

```js
_getActor(actorId) {
    if (actorId === "hero") return this.context.character;
    if (actorId === "enemy") return this.context.rabbleStick;
    return null;
}
```

此外，当前 `lockInput` 也只特殊处理 `hero -> playerController`，不能通用锁住任意 actor/controller。

这意味着当前 sequence 系统实际只认识：

- `hero`
- `enemy`

Timeline 重构时应避免继承这个限制。建议新增统一 binding/registry：

```js
context.actorRegistry.get(actorId)
context.controllerRegistry.get(actorId)
```

短期也可以由 `entityPool` 构建索引：

```js
actorRegistry = new Map(entityPool.map((entity) => [entity.id || entity.name, entity]));
```

迁移目标：

- `SceneSequencer._getActor()` 不再写死 `hero/enemy`。
- actor clip 通过 `binding.actorId` 查找目标。
- controller 操作通过 `controllerRegistry` 或 actor/controller binding 查找。
- `hero`、`enemy` 仅作为当前 demo 内容里的 actor id，不作为系统能力边界。

---

## 6. Action Handler 第一版范围

### 6.1 `command`

瞬时事件：

```js
{ type: "command", atMs: 1500, command: "sheath" }
```

行为：

- 找到 actor（通过 track 的 `binding`）。
- 优先调用 `pushCommand(command)`。
- 如果只支持 `enterState(command)`，再 fallback。

### 6.2 `moveActorTo`

持续动作：

```js
{ type: "moveActorTo", startMs: 3000, durationMs: 1200, x: -6.4, y: 0 }
```

行为：

- `start()` 捕获起点。
- `update()` 根据 `localMs / durationMs` 插值到目标，**直接写 `actor.root.position`**。
- 同时每帧同步 `moveIntent`（归一化方向）给 actor，供动画/朝向系统读取。
- 可选支持 `easing`，第一版先用 linear。
- `end()` 强制落到目标点并清空 moveIntent。

注意：

- timeline 模型下优先使用 `durationMs`，不建议继续把 `speed` 作为主要 authoring 参数。
- 可以保留 `speed` 兼容旧数据，但新 timeline 应以 duration 为准。

### 6.3 `cameraBlend`

持续动作或开始后等待：

```js
{ type: "cameraBlend", startMs: 1400, durationMs: 3500, to: "duel" }
```

行为：

- `start()` 调用 `cameraManager.startBlend()`。
- `update()` 可以检查 `cameraManager.isBlending()`。
- 如果 timeline duration 与 cameraManager duration 不一致，第一版以 clip 的 `durationMs` 传给 cameraManager。

### 6.4 `inputLock`

瞬时事件：

```js
{ type: "inputLock", atMs: 0, locked: true }
```

行为：

- 当前可继续操作 `playerController.enabled`。
- 后续如果有更正式的 input lock 系统，再替换底层实现。

### 6.5 `faceWorldX`

瞬时事件：

```js
{ type: "faceWorldX", atMs: 2800, direction: -1 }
```

行为：

- 表达角色朝世界坐标 `-X` 或 `+X`，而不是直接表达 sprite 镜像值。
- 角色内部根据自身原始素材朝向转换成实际 `setFacing()` 需要的镜像值。

建议角色配置增加：

```js
nativeFacingX: 1   // 素材原图朝 +X
nativeFacingX: -1  // 素材原图朝 -X
```

转换规则：

```js
spriteFacing = worldFacingX === nativeFacingX ? 1 : -1;
```

这样 `rabble_stick` 这类原图朝 `-X` 的角色，也可以在 sequence 里自然写：

```js
{ type: "faceWorldX", direction: -1 }
```

而不需要 sequence 作者关心素材是否已经朝左。

### 6.6 `switchMode`

瞬时事件：

```js
{ type: "switchMode", atMs: 5000, modeId: "battle" }
```

行为：

- 调用 `gameModeManager.switchMode(modeId, payload)`。

---

## 7. Scope：不迁移 TestController

`TestController` 和 `SceneSequencer` 是两个独立系统：

- `SceneSequencer` 负责过场、镜头、模式切换、输入锁定等演出编排。
- `TestController` 负责测试脚本驱动角色行为，属于控制器/测试工具链。

本计划不迁移 `TestController`，也不把 `Data/TestScripts/*.json` 收进 timeline sequencer。后续如果测试脚本也需要并发动作，可以单独设计测试控制器自己的时间轴格式，或抽取很小的通用 timeline runner，但那应作为独立计划处理。

---

## 8. SceneSequencer 迁移示例

`exit_battle` 可从顺序 steps：

```js
steps: [
    { type: "lockInput", actorId: "hero" },
    { type: "wait", durationMs: 1500 },
    { type: "sendCommand", actorId: "hero", command: "sheath" },
    { type: "wait", durationMs: 1500 },
    { type: "moveActorTo", actorId: "hero", x: -6.4, y: 0, tolerance: 0.1 },
    { type: "wait", durationMs: 1500 },
    { type: "startCameraBlend", to: "explore", durationMs: 2000 },
    { type: "switchMode", modeId: "explore" },
    { type: "unlockInput", actorId: "hero" }
]
```

改为 timeline：

```js
{
    id: "exit_battle",
    durationMs: 5200,
    tracks: [
        {
            id: "hero.input",
            kind: "actor",
            binding: { actorId: "hero" },
            channel: "input",
            clips: [
                { type: "inputLock", atMs: 0, locked: true },
                { type: "inputLock", atMs: 5100, locked: false }
            ]
        },
        {
            id: "hero.command",
            kind: "actor",
            binding: { actorId: "hero" },
            channel: "command",
            clips: [
                { type: "command", atMs: 1500, command: "sheath" }
            ]
        },
        {
            id: "hero.facing",
            kind: "actor",
            binding: { actorId: "hero" },
            channel: "facing",
            clips: [
                { type: "faceWorldX", atMs: 2800, direction: -1 }
            ]
        },
        {
            id: "hero.movement",
            kind: "actor",
            binding: { actorId: "hero" },
            channel: "movement",
            clips: [
                { type: "moveActorTo", startMs: 3000, durationMs: 1200, x: -6.4, y: 0 }
            ]
        },
        {
            id: "camera",
            clips: [
                { type: "cameraBlend", startMs: 3200, durationMs: 2000, to: "explore" }
            ]
        },
        {
            id: "mode",
            clips: [
                { type: "switchMode", atMs: 5000, modeId: "explore" }
            ]
        }
    ]
}
```

---

## 9. waitUntil / gate 的处理

`waitUntil` 与绝对时间轴存在天然冲突。

第一版建议不要急着做复杂 gate。可选方案：

### 方案 A：作者手填时间

例如 `draw` 动画预计 900ms 后结束，就直接安排后续 clip：

```js
{ type: "command", atMs: 0, command: "draw" }
{ type: "cameraBlend", startMs: 900, durationMs: 1800, to: "duel" }
```

优点：

- 数据简单。
- 纯时间轴。

缺点：

- 动画时长变更时需要手动更新 sequence。

### 方案 B：Gate clip 暂停时间轴

```js
{ type: "gate", atMs: 900, condition: (ctx) => ctx.character.currentStateName === "idle" }
```

优点：

- 保留现有 `waitUntil` 的安全性。

缺点：

- 时间轴会暂停，不再是纯绝对时间。
- 外部 JSON 无法直接保存 function，需要额外条件注册表。

短期建议：

- Scene 内部 JS sequence 可以先支持 gate。
- 外部 JSON sequence 第一版先不支持 function condition。

---

## 10. 实施阶段

### Phase 1：新增 TimelineSequencer 能力，保留旧 steps

目标：

- 不破坏现有 `SceneSequencer`。
- 如果 sequence 有 `steps`，继续走旧逻辑。
- 如果 sequence 有 `tracks`，走新 timeline 逻辑。

改动：

1. 在 `SceneSequencer` 内部增加 timeline 分支，或新增 `TimelineSequencer` 类。
2. 增加 action handlers。
3. 增加基本校验：
   - `durationMs` 合法。
   - clip 时间合法。
   - 同 binding + channel interval 重叠时 warning。
4. 增加 actor/controller binding 查询，避免 timeline runner 继续写死 `hero/enemy`。

验证：

- 旧 `enter_battle` / `exit_battle` 仍可运行。
- 人工构造一个小 timeline sequence，确认 event 与 interval 能并发。

### Phase 2：迁移 SceneSequencer 常用过场

目标：

- 将 `enter_battle` / `exit_battle` 改为 timeline。
- 允许镜头 blend、角色移动、命令、朝向并发。

改动：

1. 改写 `ExploreMode` 中的 `enterBattleSequence`。
2. 改写 `BattleMode` 中的 `exitBattleSequence`。
3. 保留旧 step runner 一段时间，直到新 timeline 稳定。

验证：

- Explore -> Battle 过场仍稳定。
- Battle -> Explore 过场中镜头和角色移动能重叠。
- 输入锁定开始/结束准确。
- mode 切换点准确。

### Phase 3：再考虑工具化与数据外置

目标：

- 让 timeline JSON 更适合作为可编辑资源。

可能改动：

1. 增加 sequence schema 文档。
2. 增加 condition registry，替代 JS function gate。
3. 增加 debug overlay：当前 sequence id、time、active clips。
4. 增加简单 validation 工具。

---

## 11. 设计取舍

### 为什么不用 Promise 并发

项目主循环已经是固定 tick，动画、碰撞、输入也都依赖 fixedUpdate。Promise/async 会把 sequence 时间推进从主循环里拆出去，容易造成暂停、hitstop、慢动作、tick 同步等问题。

因此应使用 fixedUpdate 驱动的 timeline，而不是异步任务并发。

### 为什么 track 是必要的

如果所有 action 都自由并发，很快会出现多个 clip 同时写：

- 同一个 actor 的 position。
- 同一个 actor 的 moveIntent。
- 同一个 controller 的 enabled。
- 同一个 camera rig。

track 可以作为最小冲突边界，让并发可控。

### 为什么 `moveActorTo` 应优先 duration-based

UE Sequencer 式 authoring 的核心是“某个时间点发生某件事”。  
如果 `moveActorTo` 继续主要依赖 speed，就会变成“什么时候到达取决于距离和速度”，很难与镜头和动画对齐。

因此新 timeline 中应优先使用 `durationMs` 插值。

### 为什么暂不急着做完整 SequenceMode

目前需求核心是 sequence action 并发，不是新增一套独立玩法 update pipeline。  
`SequenceMode` 只有在需要统一冻结/替换 BattleMode 或 ExploreMode 大部分系统时才值得引入。

---

## 12. 最小结论

建议先实现：

1. fixedUpdate 驱动的 `TimelineSequencer`。
2. `tracks + clips` 数据格式。
3. event / interval 两类 clip。
4. action handlers：`command`、`moveActorTo`、`cameraBlend`、`inputLock`、`switchMode`、`faceWorldX`。
5. 只迁移 `SceneSequencer` 的 enter/exit battle；`TestController` 保持独立，不纳入本计划。

这条路线改动可控，并能直接解决“每个 action 顺序执行，无法重叠”的当前痛点。

---

## 13. Phase 1 实施记录

### 13.1 已完成

- `TimelineSequencer` 类，fixedUpdate 驱动，event / interval 两类 clip 生命周期。
- `SceneSequencer` 双分支：`steps` 走旧逻辑，`tracks` 走新 timeline。
- Action handler：`command`、`moveActorTo`、`cameraBlend`、`inputLock`、`switchMode`、`faceWorldX`。
- `setCameraFrame` event handler：直接调用 `ScriptedCameraRig.setFrame()`。
- `actorRegistry` / `controllerRegistry` 替代硬编码 `hero`/`enemy`。
- 冲突检测：同 binding + channel 的 interval clip 重叠时打印 warning。
- `ExploreMode` 中 `scriptedCameraTrigger` 的 timeline sequence 已改为 tracks 格式。

### 13.2 验证中发现的 Bug 及修复

#### Bug 1：atMs=0 的 event clip 不触发

**现象**：`setCameraFrame`、`inputLock` 等 `atMs: 0` 的事件在第一帧丢失。

**根因**：`_updateClip` 中 `justCrossedStart = prevTimeMs < startMs && currentTimeMs >= startMs`，当 `prevTimeMs=0`、`startMs=0` 时 `0 < 0` 为 false。

**修复**：改为 `prevTimeMs <= startMs && currentTimeMs > startMs`。

#### Bug 2：startMs=0 且 durationMs 极短的 interval clip 被跳过

**现象**：`cameraBlend` with `durationMs: 10` 在第一帧 `currentTimeMs≈16.67ms` 已超过 `endMs=10ms`，`isNowActive` 为 false，`start()` 从未调用。

**修复**：新增 `INTERVAL SHORT-LIVED` 路径——当 `justCrossedStart` 为 true 但 `isNowActive` 为 false 且 `currentTimeMs >= endMs`，立即执行 `start()` + `end()`。

#### Bug 3：cameraBlend durationMs=0 被当作默认 1500ms

**现象**：`{ type: "cameraBlend", startMs: 0, durationMs: 0, to: "scripted" }` 期望瞬时切镜，实际仍缓慢 blend。

**根因**：`CameraManager.startBlend` 中 `blend.durationMs = durationMs || 1500`，`0` 是 falsy 被回退到默认值。

**修复**：`durationMs != null && durationMs <= 0` 时直接调用 `switchRig` 做瞬时切镜，不走 blend 流程。

#### Bug 4：blend 回 explore 时终点是 rig 的旧内部状态

**现象**：sequence 结束时 `cameraBlend` to `"explore"`，相机 blend 到角色进入 trigger 前的旧位置，而非角色当前位置。

**根因**：`CameraManager.startBlend` 调用 `targetRig.compute(0, computeCtx, fromState)` 获取 `toState`。`ExploreCameraRig` 内部有平滑逻辑 `smoothing * dt * 60`，`dt=0` 导致 smoothing factor=0，`_cameraPosition` 不更新，返回的 `toState.pos` 是 rig 的旧内部状态。

**修复**：`compute(0, ...)` 改为 `compute(1000, ...)`，`dt=1` → factor=1，rig 内部状态 snap 到 `frameCtx.target`（角色当前最新位置）。

### 13.3 设计决策记录

- **`cameraBlend` durationMs=0 语义**：正式定义为「瞬时切镜」，等价于 `switchRig`。
- **`compute(dtMs)` 用于 blend 目标快照**：必须使用足够大的 `dtMs` 确保 rig 内部状态 snap 到当前 frameCtx 目标，而非依赖平滑插值。
- **WalkArea clamp**：sequence 期间 `moveActorTo` 直接写 `actor.root.position`，但 `ExploreMode.updateRender` 仍调用 `collisionSystem.resolveMovement` → `walkArea.clampPosition`，导致角色被 clamp 回 walkArea 范围时产生跳变。需要在 sequence 期间跳过碰撞/边界 clamp，或确保 target 在 walkArea 范围内。

---

## 14. Phase 2 实施记录

### 14.1 已完成

- `ExploreMode` 中 `enterBattleSequence` 改为 timeline tracks 格式。
- `BattleMode` 中 `exitBattleSequence` 改为 timeline tracks 格式。
- 旧 step runner 保留，`SceneSequencer` 根据 `steps`/`tracks` 自动分派。

### 14.2 验证中发现的 Bug 及修复

#### Bug 5：command clip 不执行 — 命令名与状态图 transition 不匹配

**现象**：`{ type: "command", atMs: 3500, command: "draw" }` 不触发 draw 动画，`{ type: "command", atMs: 2500, command: "sheath" }` 不触发 sheath 动画。

**根因**：`LongSwordMan.json` 状态图中，standing/walk → draw 的 transition 条件是 `{ "command": "enterBattle" }`，idle → sheath 的 transition 条件是 `{ "command": "exitBattle" }`。`"draw"` 和 `"sheath"` 是状态名，不是命令名。`pushCommand("draw")` 在 `#canAcceptCommand` 中找不到匹配的 transition，静默返回 false。

**修复**：
1. `LongSwordMan.json` 中命令名统一为动作名：`"enterBattle"` → `"draw"`，`"exitBattle"` → `"sheath"`。与其他命令（`thrust`、`quart`、`zornhut`、`guard`）命名逻辑一致。
2. `TimelineSequencer.js` 的 `command` handler 在 `pushCommand` 返回 false 时打印 `console.error`，明确指出当前状态不接受该命令。

#### Bug 6：move 状态缺少 sheath transition

**现象**：战斗结束后若玩家按住移动键，hero 处于 `move` 状态，sequencer 发 `pushCommand("sheath")` 被拒绝。

**根因**：`LongSwordMan.json` 的 `move` 状态有 `thrust`/`quart`/`zornhut`/`guard` 的 transition，但没有 `sheath`。而 `idle` 状态有。

**修复**：给 `move` 状态补上 `{ "to": "sheath", "when": [{ "command": "sheath" }] }`，与 `idle` 保持一致。

**备注**：`hit` 由 `takeDamage()` → `enterState("hit")` 直接跳转，绕过 transition 系统，因此不受此限制。`sheath` 走 `pushCommand` → `_consumeTransition` 路径，必须当前状态有对应 transition。

### 14.3 设计决策记录

- **命令命名统一为动作名**：状态图中的 command 应与角色动作名一致（`draw`、`sheath`），而非游戏规则名（`enterBattle`、`exitBattle`）。保持与 `thrust`、`quart` 等命令的命名一致性。
- **sequencer 命令错误应报错而非静默 fallback**：`pushCommand` 被拒时应打印 `console.error`，让作者能立刻发现命令名不匹配。不应尝试 `enterState` fallback（会绕过 cooldown 等 transition 条件）。
