# Timeline Sequencer 并发 Action 重构计划

> 目标：把当前“每个 action 顺序执行”的 sequence，重构为类似 UE Sequencer 的统一时间轴模型。每个 action 指定开始时间与持续时间，由同一个 fixedUpdate 时间轴推进，从而允许移动、动画命令、镜头、模式切换等并发编排。

---

## 1. 背景与现状

当前项目里有两类 sequence-like 逻辑：

1. `SceneSequencer`
   - 用于过场、模式切换、镜头切换、角色移动、输入锁定等。
   - 当前实现是 `steps[_stepIndex]`，一个 step 完成后才进入下一个 step。
   - `wait`、`moveActorTo`、`startCameraBlend`、`waitUntil` 都会阻塞后续 step。

2. `TestController`
   - 用于读取 `Data/TestScripts/*.json`，驱动测试敌人的命令与移动。
   - 当前也是 step 队列：进入 step 时发命令/设置移动，等待 `waitMs` 后进入下一步。
   - 无法表达“挥刀动画期间同时后退”这类重叠行为。

这两者的共同问题是：**时间表达是隐式累加的顺序队列，而不是显式时间轴**。

---

## 2. 核心目标

新增或扩展为 `TimelineSequencer` 模型：

- sequence 拥有统一 `currentTimeMs`。
- 每个 action/clip 显式声明 `atMs` 或 `startMs + durationMs`。
- 每帧由 `fixedUpdate(dtMs, tickCount)` 推进时间轴。
- Sequencer 找出当前应触发或正在执行的 clips，并调用对应 handler。
- 不同 track 可以并发执行。
- 同一 track 默认视为冲突边界，避免两个 clip 同时写同一个控制面。

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
            id: "hero",
            target: "hero",
            clips: [
                { type: "inputLock", atMs: 0, locked: true },
                { type: "command", atMs: 1500, command: "sheath" },
                { type: "facing", atMs: 2800, facing: -1 },
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
   - 示例：`command`、`switchMode`、`inputLock`、`facing`。

2. Interval clip
   - 在一段时间内持续更新。
   - 使用 `startMs + durationMs`。
   - 示例：`moveActorTo`、`setMoveIntent`、`cameraBlend`。

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

## 5. Track 冲突规则

第一版建议使用简单规则：

- 不同 track 可以并发。
- 同一 track 内默认不允许 interval clip 时间重叠。
- event clip 可以与 interval clip 同 track 重叠，但要谨慎。
- 如果检测到同 track interval 重叠，启动 sequence 时打印 warning。

推荐 track 划分：

- `hero.command`
- `hero.movement`
- `hero.facing`
- `hero.input`
- `enemy.command`
- `enemy.movement`
- `camera`
- `mode`

这样可以表达并发，又不会让多个 clip 同时争抢同一份状态。

---

## 6. Action Handler 第一版范围

### 6.1 `command`

瞬时事件：

```js
{ type: "command", atMs: 0, actorId: "enemy", command: "swing" }
```

行为：

- 找到 actor。
- 优先调用 `pushCommand(command)`。
- 如果只支持 `enterState(command)`，再 fallback。

### 6.2 `setMoveIntent`

持续动作：

```js
{ type: "setMoveIntent", startMs: 300, durationMs: 1500, actorId: "enemy", moveIntent: { x: 1, y: 0 } }
```

行为：

- active 期间每帧设置 actor/controller 的 moveIntent。
- `end()` 时归零 moveIntent。

### 6.3 `moveActorTo`

持续动作：

```js
{ type: "moveActorTo", startMs: 200, durationMs: 1200, actorId: "hero", x: -3.2, y: 0 }
```

行为：

- `start()` 捕获起点。
- `update()` 根据 `localMs / durationMs` 插值到目标。
- 可选支持 `easing`，第一版先用 linear。
- `end()` 强制落到目标点并清空 moveIntent。

注意：

- timeline 模型下优先使用 `durationMs`，不建议继续把 `speed` 作为主要 authoring 参数。
- 可以保留 `speed` 兼容旧数据，但新 timeline 应以 duration 为准。

### 6.4 `cameraBlend`

持续动作或开始后等待：

```js
{ type: "cameraBlend", startMs: 1400, durationMs: 3500, to: "duel" }
```

行为：

- `start()` 调用 `cameraManager.startBlend()`。
- `update()` 可以检查 `cameraManager.isBlending()`。
- 如果 timeline duration 与 cameraManager duration 不一致，第一版以 clip 的 `durationMs` 传给 cameraManager。

### 6.5 `inputLock`

瞬时事件：

```js
{ type: "inputLock", atMs: 0, actorId: "hero", locked: true }
```

行为：

- 当前可继续操作 `playerController.enabled`。
- 后续如果有更正式的 input lock 系统，再替换底层实现。

### 6.6 `switchMode`

瞬时事件：

```js
{ type: "switchMode", atMs: 5000, modeId: "battle" }
```

行为：

- 调用 `gameModeManager.switchMode(modeId, payload)`。

---

## 7. TestController 迁移示例

当前数据：

```json
{
  "name": "rabble_stick_swing_retreat_loop",
  "loop": true,
  "steps": [
    {
      "command": "swing",
      "waitMs": 1300
    },
    {
      "moveIntent": { "x": 1, "y": 0 },
      "waitMs": 1500
    }
  ]
}
```

建议改为：

```json
{
  "name": "rabble_stick_swing_retreat_loop",
  "loop": true,
  "durationMs": 1800,
  "tracks": [
    {
      "id": "commands",
      "clips": [
        { "type": "command", "atMs": 0, "command": "swing" }
      ]
    },
    {
      "id": "movement",
      "clips": [
        {
          "type": "setMoveIntent",
          "startMs": 300,
          "durationMs": 1500,
          "moveIntent": { "x": 1, "y": 0 }
        }
      ]
    }
  ]
}
```

效果：

- `0ms` 触发 `swing`。
- `300ms-1800ms` 期间同时后退。
- 循环时回到 `0ms`。

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
            target: "hero",
            clips: [
                { type: "inputLock", atMs: 0, locked: true },
                { type: "inputLock", atMs: 5100, locked: false }
            ]
        },
        {
            id: "hero.command",
            target: "hero",
            clips: [
                { type: "command", atMs: 1500, command: "sheath" }
            ]
        },
        {
            id: "hero.facing",
            target: "hero",
            clips: [
                { type: "facing", atMs: 2800, facing: -1 }
            ]
        },
        {
            id: "hero.movement",
            target: "hero",
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
   - 同 track interval 重叠时 warning。

验证：

- 旧 `enter_battle` / `exit_battle` 仍可运行。
- 人工构造一个小 timeline sequence，确认 event 与 interval 能并发。

### Phase 2：迁移 TestController

目标：

- 先用测试敌人脚本验证并发 action。
- 支持 `steps` 与 `tracks` 两种数据，降低迁移风险。

改动：

1. `TestController.setScript()` 检测 `scriptConfig.tracks`。
2. 若存在 `tracks`，用 timeline runner。
3. 迁移 `Data/TestScripts/rabble_stick_basic_sequence.json`。

验证：

- rabble stick 能在 swing 期间后退。
- loop 正常。
- 旧 steps 格式仍可运行。

### Phase 3：迁移 SceneSequencer 常用过场

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

### Phase 4：再考虑工具化与数据外置

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
4. action handlers：`command`、`setMoveIntent`、`moveActorTo`、`cameraBlend`、`inputLock`、`switchMode`、`facing`。
5. 先迁移 `TestController`，再迁移 `SceneSequencer` 的 enter/exit battle。

这条路线改动可控，并能直接解决“每个 action 顺序执行，无法重叠”的当前痛点。
