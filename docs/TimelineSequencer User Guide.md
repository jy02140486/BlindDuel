# TimelineSequencer 用户文档

> 演出 sequence 的数据驱动配置手册。读完本文可独立编写 sequence JSON，无需再读 sequencer 源码。

## 1. 概述

TimelineSequencer 是一个时间轴驱动的演出播放器，输入是 JSON 描述的 timeline 对象，输出是对场景内 actor / camera / mode / 回调的时序控制。

**调用入口**：`sharedContext.sceneSequencer.play(timeline)` → 内部转交 TimelineSequencer。

**核心特性**：
- 多 track 并行（每个 track 一组 clips）
- clip 分两类：**event clip**（瞬时触发，用 `atMs`）和 **interval clip**（持续区间，用 `startMs` + `durationMs`）
- 跨场景不重置（ TimelineSequencer 是单例）
- 通过 `sharedContext.sequenceHandlers: Map<String, Function>` 支持字符串名回调

## 2. Sequence 文件结构

```jsonc
{
  "id": "sequence_id",          // 必填，日志标识
  "durationMs": 7000,           // 必填，总时长；到点自动 _onComplete
  "loop": false,                // 可选，默认 false；true 时到 durationMs 后重置而非结束
  "tracks": [                   // 必填，track 数组
    {
      "id": "track_id",         // track 标识（日志用）
      "kind": "actor",          // track 类型：actor / camera / mode / callback / wait
      "binding": { ... },       // 可选，actor/camera 绑定（见 §4）
      "channel": "command",     // 可选，channel 标识（用于同 binding 防重叠校验）
      "clips": [ ... ]          // 必填，clip 数组
    }
  ]
}
```

## 3. Clip 通用字段

每个 clip 必须有 `type` 字段决定走哪个 handler。时间字段两种写法：

| 写法 | 字段 | 行为 |
|------|------|------|
| Event | `atMs` | 在 `atMs` 时刻触发一次 `start`，不进入 active 区 |
| Interval | `startMs` + `durationMs` | 进入区间时 `start`，区间内每帧 `update`，离开时 `end` |

**短命 clip 容错**：如果一个 interval clip 的 `startMs` 和 `endMs` 落在同一帧（dtMs 较大时常见），sequencer 会在同一帧内先 `start` 再 `end`，不会漏调用。

## 4. Binding（actor/camera 解析）

`track.binding` 用于定位目标对象，actor 解析顺序：

```jsonc
{ "actorId": "hero" }       // 先查 actorRegistry，再查 character/rabbleStick，最后查 entityPool
{ "actorId": "prop_faller" }
{ "actorId": "companion" }
```

- `actorId === "hero"` → `context.character`
- `actorId === "enemy"` → `context.rabbleStick`
- 其它 → 遍历 `context.entityPool` 匹配 `entity.id` 或 `entity.name`

camera binding 类似：`{ "cameraId": "duel" | "explore" | "scripted" }`。

## 5. 所有 Clip 类型

### 5.1 command（actor 指令）

给 actor 发状态切换指令。

```jsonc
{ "type": "command", "atMs": 500, "command": "fall" }
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `command` | string | 状态/clip 名（如 `idle` / `walk` / `draw` / `fall`） |

**行为**：先调 `actor.pushCommand(command)`；返回 `false` 时 fallback 调 `actor.enterState(command)`。这让无 transitions 的 actor（PropEntity、companion NPC）也能响应。

### 5.2 moveActorTo（actor 移动）

线性插值移动 actor 的 `root.position`。

```jsonc
{ "type": "moveActorTo", "startMs": 500, "durationMs": 1000, "x": -5, "y": 0, "speed": 8 }
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `x` | number | 目标世界 X（绝对坐标，不是相对） |
| `y` | number | 目标世界 Y（绝对坐标） |
| `durationMs` | number | 插值时长 |
| `speed` | number | **未使用**，留作未来扩展 |
| `easing` | string | 可选，目前只有 `"linear"`（默认） |

**行为**：`start` 记录起点并设 `actor.controlledBySequence = true`，`update` 按 `t = localMs / durationMs` 线性插值写 `root.position` + 同步写 `moveIntent`（方向归一化），`end` snap 到目标点、清 `moveIntent`、设 `controlledBySequence = false`。

**controlledBySequence 标记**（CombatCharacter 独有）：
- sequencer 驱动期间，`BaseController.applyToCharacter` 和 `CombatCharacter._consumeTransition` 检查此标记早退——防止 controller 覆盖 `moveIntent`、防止 moveMagnitude 触发的 walk transition 被切回 standing/idle
- NpcCharacter / PropEntity 不检查（无 transition 覆盖问题），标记无副作用
- sequence 被 `stop()` / 正常 `_onComplete` / `_onLoop` 时统一兜底清标记，防残留

**动画同步**：
- **CombatCharacter**（hero/rabble）：walk 动画靠 `moveMagnitude > 0.2` 触发，sequencer 写 moveIntent 自动驱动，无需额外 command clip
- **NpcCharacter / PropEntity**：无 transition，walk 动画需配 `command: "walk"` clip 直接 enterState

### 5.3 cameraBlend（相机切换）

切换 active rig 并做平滑过渡。

```jsonc
{ "type": "cameraBlend", "startMs": 0, "durationMs": 1800, "to": "duel" }
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `to` | string | 目标 rig id：`"duel"` / `"explore"` / `"scripted"` |
| `durationMs` | number | 混合时长，`0` 表示瞬切 |

**特殊处理**：
- `to: "duel"` 时自动算 hero+enemy 中点 + fighterDistance 作为 frameCtx
- `to: "explore"` 时自动用 hero 当前位置作为 target
- `to: "scripted"` 时需配合 `setCameraFrame` 设定画面框

**实现细节（重要）**：`cameraBlend` 在 `start` 时**一次性快照**目标 rig 的 `compute()` 结果作为 `toState`，整个 `durationMs` 期间不再重算，仅 lerp `fromState→toState`。同 track 内 clip 按数组顺序处理，因此当 `to: "scripted"` 时：
- `setCameraFrame` **必须写在 `cameraBlend` 之前**（同 tick 内），否则 blend 启动快照到的 `_center` 是 rig 残留的脏值，相机会先朝错误方向漂移再瞬移到正确位置
- blend 期间目标 rig 已 active，但 `_center` 不会被实时刷新；想"blend 期间目标跟随 actor 移动"做不到，应改用 `setCameraFollow` 接管后再让 `_center` 自己 lerp

### 5.4 setCameraFrame（scripted 相机框）

设定 scripted rig 的正交画面框（静态框，相机看向固定点）。

```jsonc
{ "type": "setCameraFrame", "atMs": 0, "center": [0, 0, 0], "height": 4.5, "orthoWidth": 20 }
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `center` | [x,y,z] | 画面中心世界坐标；`x/z` 决定相机看向的水平位置，`y` 决定 target 的 Y 高度（影响仰俯角） |
| `height` | number | **相机自身**的 Y 高度（写入 `pos.y`），与 `center.y` 独立 |
| `orthoWidth` | number | 正交视口宽度（世界单位） |
| `zOffset` | number | 可选，Z 轴偏移（默认 -25） |

**`center.y` 与 `height` 的区别（易混淆）**：
- `height` → `pos.y`（相机自己的高度）
- `center.y` → `target.y`（相机看向的 Y）
- 想让相机 Y 上下移动改 `height`，**不是** `center.y`；`center.y` 只影响俯仰角
- `pos.y > target.y` 时呈俯视，相等时平视

**前置**：目标 rig 需为 scripted。从其它 rig 切过来时，`setCameraFrame` 要写在 `cameraBlend to:"scripted"` **之前**（见 §5.3 实现细节）。

### 5.5 setCameraFollow（scripted 相机跟随）

让 scripted rig 的 `_center` lerp 跟随某个 actor 的 `root.position`（X/Y/Z 三轴都跟），用于横版跟拍。

```jsonc
{ "type": "setCameraFollow", "atMs": 1400, "actorId": "prop_faller", "offsetX": 0, "offsetY": 0, "offsetZ": 0, "lerp": 0.12, "height": 4.5, "orthoWidth": 20 }
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `actorId` | string | 跟随目标（clip 直填，不依赖 track.binding） |
| `offsetX/Y/Z` | number | 目标位置偏移：`_center` lerp 到 `actor.pos + offset` |
| `lerp` | number | 每帧 lerp 系数（默认 0.12），越大跟得越紧 |
| `height` | number | 相机自身 Y 高度（同 §5.4） |
| `orthoWidth` | number | 正交视口宽度 |

**行为细节**：
- 触发后 `_center` 按帧 lerp 到 `actor.root.position + offset`，X/Z 自然平滑过渡；这是从 `setCameraFrame` 接力到 follow 的关键——X/Z 不需要额外 blend
- `_height` 是**瞬间赋值**（不平滑），所以 `setCameraFrame` 终点的 `height` 应与 `setCameraFollow` 的 `height` 对齐，否则相机 Y 会瞬跳
- `center.y` 在 follow 期间被 `actor.y + offsetY` 接管覆盖，setFrame 写的 `center.y` 失效
- `setCameraFollow` 不影响 blend 队列；它只是改 rig 内部状态，下一帧 `compute()` 自然应用

### 5.6 cameraEffect（相机特效）

入队一个相机特效（fade / letterbox / shake / flash）。

```jsonc
{ "type": "cameraEffect", "atMs": 0, "effect": "fade", "durationMs": 1200, "color": "black", "from": 1, "to": 0 }
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `effect` | string | `"fade"` / `"letterbox"` / `"shake"` / `"flash"` |
| `durationMs` | number | 特效时长 |

**各 effect 专属参数**：

| effect | 参数 |
|--------|------|
| `fade` | `color`（默认 black）、`from`（0~1，起始不透明度）、`to`（0~1，结束不透明度） |
| `letterbox` | `height`（默认 72，黑边像素高度）、`speed`（默认 240，展开速度） |
| `shake` | `amplitude`（必填，振幅）、`frequency`（默认 35） |
| `flash` | `color`（默认 white） |

**注意**：`letterbox` 和 `fade` 在 clip `end` 时会调 `clearEffects` 清掉同类特效；`shake` / `flash` 不会主动清（到 durationMs 自然结束）。

### 5.7 inputLock（输入锁）

锁定/解锁玩家输入。

```jsonc
{ "type": "inputLock", "atMs": 0, "locked": true }
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `locked` | boolean | `true` 锁定（controller.enabled = false），`false` 解锁 |

**解析**：通过 `track.binding.actorId` 找 controller（默认查 `playerController`）。

**与 controlledBySequence 的关系**：`inputLock` 锁 controller.enabled，`controlledBySequence` 标记让 controller.applyToCharacter 早退。两者作用相似但层次不同：moveActorTo 期间自动设 controlledBySequence（细粒度，仅禁 moveIntent 写入和 transition 评估），inputLock 是粗粒度全锁（含 command 队列）。多数 sequencer 场景只需 moveActorTo 自带的 controlledBySequence，无需再配 inputLock。

### 5.8 faceWorldX（朝向）

设置 actor 朝向。

```jsonc
{ "type": "faceWorldX", "atMs": 0, "direction": 1 }
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `direction` | number | 世界朝向：`1` 朝右，`-1` 朝左 |

**行为**：考虑 actor 的 `nativeFacingX`（默认 1），自动转成 sprite facing。

### 5.9 switchMode（模式切换）

切换 GameMode（explore ↔ battle）。

```jsonc
{ "type": "switchMode", "atMs": 2000, "modeId": "battle", "payload": { "battleDef": {} } }
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `modeId` | string | `"battle"` / `"explore"` |
| `payload` | object | 传给 mode.enter() 的 payload（battle 需带 `battleDef`） |

### 5.10 callback（自定义回调）

调一个注册在 `sharedContext.sequenceHandlers` 里的具名函数。

```jsonc
{ "type": "callback", "atMs": 4000, "fn": "disposeProp" }
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `fn` | string \| Function | 字符串则查 `ctx.sequenceHandlers.get(fn)`；函数则直接调 |

**handler 签名**：`(ctx, clip) => void`

**当前已注册的 handler**（ExploreMode enter 时注册，exit 时注销）：

| fn 名 | 作用 |
|-------|------|
| `disposeProp` | 销毁所有 kind="prop" 实体（清 props + renderables，dispose sprite） |
| `enterCompanionFollowing` | Charlotte 切 following 态（调 NpcController.enterFollowing） |
| `enterCompanionIdle` | Charlotte 切回 idle 态（调 NpcController.enterIdle） |

**气泡控制已迁出 callback**：旧版 `showCompanionBubble` / `hideCompanionBubble` 两个写死 Charlotte 的 callback 已删，改用通用 `dialogueBubble` clip（见 §5.12）。

**扩展新 handler**：在 ExploreMode `_registerSequenceHandlers()` 里加 `handlers.set("yourFn", (ctx, clip) => this.#handleYourFn(ctx, clip))`。

### 5.11 wait（占位等待）

无副作用，仅占用时间。用于在 track 里制造等待间隔（让同 track 后续 clip 的 atMs 拉开距离）。

```jsonc
{ "type": "wait", "atMs": 4200, "durationMs": 2000 }
```

**注意**：wait 是 interval clip，`start`/`end` 都是空实现。多数场景下其实不需要 wait track——多 track 已天然并行。wait 主要用于"同 track 内想要串行等待"的语义化表达。

### 5.12 dialogueBubble（对话气泡）

控制 DialogueBubble 的显示/隐藏，支持指定 NPC 与文本。

```jsonc
// 显示气泡（单行文本）
{ "type": "dialogueBubble", "atMs": 4200, "actorId": "companion", "text": "!" }

// 显示气泡（多行/富文本，传 segments 数组）
{ "type": "dialogueBubble", "atMs": 4200, "actorId": "companion",
  "content": [{ "type": "text", "value": "第一行" }, { "type": "image", "src": "icon.png", "width": 16, "height": 16 }] }

// 隐藏气泡（actorId 可省，省略则 hide 全局）
{ "type": "dialogueBubble", "atMs": 6200, "action": "hide" }
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `actorId` | string | 目标 NPC（查 `interactables`/`entityPool`）。show 必填；可从 `track.binding.actorId` fallback；hide 可省，省则 hide 全局 |
| `text` | string | 单行文本（与 `content` 二选一） |
| `content` | object[] | 富文本片段数组（与 `text` 二选一）：`{ type:"text", value:"..." }` 或 `{ type:"image", src, width, height, alt, style }` |
| `action` | string | `"show"`（默认） / `"hide"` |

**行为细节**：
- `show` 调 `bubble.show(actor)` + `setText`/`setContent`；随后**立即调一次 `bubble.update(scene)`** 算初始投影坐标，避免 sequencer 期间气泡 `left`/`top` 为空导致 CSS auto 定位偏移出屏幕
- `hide` 调 `bubble.hide()`
- **DialogueBubble 是单例**：同时只能显示一个气泡，多 NPC 同时 show 会覆盖前一个
- **视锥剔除照常生效**：气泡位置每帧由 `ExploreMode.#updateDialogueBubblePosition` 更新，NPC 出相机视锥时气泡 `display:none` 自动隐藏（详见§9.2 sequencer 期间气泡说明）
- **sequencer busy 期间 ExploreMode 不接管气泡生命周期**：`#updateDialogueBubble` 加了 sequencer busy 守卫，避免 ExploreMode 的 hide 把 sequencer 显式 show 的气泡误关；气泡显隐完全由 `dialogueBubble` clip 控制

**依赖**：`ctx.dialogueBubble` 必须存在（`sharedContext.dialogueBubble`，Game.bootstrap 实例化）；通常只在 ExploreMode 期间可用（BattleMode 未注入）。

## 6. Track 并行与重叠

**多 track 天然并行**：每个 track 独立推进，互不阻塞。

**同 track 内 clip 重叠**：允许，但同 `binding + channel` 的 interval clip 重叠会打 warn（`_validateTimeline` 校验）。Event clip 不受此限。

**典型并行结构**（prologue_intro.json 节选）：

```jsonc
"tracks": [
  { "id": "fx.fadein",   "kind": "camera", "channel": "fx",      "clips": [...] },  // 淡入
  { "id": "fx.letterbox","kind": "camera", "channel": "fx",      "clips": [...] },  // 黑边
  { "id": "hero.walk",   "kind": "actor",  "binding": {"actorId":"hero"}, "channel": "movement", "clips": [...] },
  { "id": "companion.walk","kind": "actor","binding": {"actorId":"companion"}, "channel": "movement", "clips": [...] }
]
```

4 个 track 并行，hero 和 companion 同时走、相机同时做 fade+letterbox+blend。

## 7. 触发方式

### 7.1 场景进入/离开自动播

`SceneDef` 配字段：
- `introSequenceUrl`：进场景后自动播（flag `intro_played_<sceneId>` 锁一次性）
- `outroSequenceUrl`：场景切换前播（[Game.js `_playOutro`](file:///e:/se/BlindDuel/scripts/Game.js)）

### 7.2 数据驱动 cutscene（Step 6 新增）

`SceneDef.cutsceneInvokers` 数组，ExploreMode.fixedUpdate 每帧检查：

```jsonc
"cutsceneInvokers": [
  {
    "id": "prologue_prop_and_follow",
    "sequenceUrl": "Data/Sequences/prologue_cs_rabble_flee.json",
    "armDelayMs": 500,                          // 条件满足后延时多久才播
    "flagOnPlay": "prologue_prop_played",       // 播放时置位的 flag（双保险）
    "condition": {                              // 复用 SceneDef._evaluateCondition 语义
      "scenarioMin": 105,
      "flagNot": "prologue_prop_played"
    }
  }
]
```

**condition DSL**（与 trigger / spawnIf 共用）：
- `scenarioMin` / `scenarioMax`：scenario 区间
- `scenario`：精确值
- `flag`：flag 必须为 true
- `flagNot`：flag 必须为 false（未置位）

### 7.3 代码手动触发

```js
sceneSequencer.play(timelineObject);
sceneSequencer.isBusy();  // 查询
sceneSequencer.stop();    // 强制停
```

## 8. 完整示例

### 8.1 简单 cutscene（prop 演出 + 气泡 + 回调链）

见 [prologue_cs_rabble_flee.json](file:///e:/se/BlindDuel/Data/Sequences/prologue_cs_rabble_flee.json)：
- prop 走 idle → fall（moveActorTo 下落）→ land → run（moveActorTo 跑开）
- 4000ms callback `disposeProp` 销毁 prop
- 4500ms `dialogueBubble` clip show → 2500ms 后 hide（替代旧的 showCompanionBubble/hideCompanionBubble callback）
- 末尾 callback `enterCompanionFollowing` 切跟随态

### 8.2 进战斗序列（cameraBlend + switchMode）

见 [SceneDefs.js BATTLE_FIELD_1.enterSequence](file:///e:/se/BlindDuel/scripts/SceneDefs.js)：
- `command: "draw"` 让 hero 拔剑
- `cameraBlend to: "duel"` 切决斗相机
- 末尾 `switchMode modeId: "battle"` 切战斗模式

### 8.3 intro 序列（叠播 + scripted 相机）

见 [prologue_intro.json](file:///e:/se/BlindDuel/Data/Sequences/prologue_intro.json)：
- fade + letterbox 叠播
- scripted 相机框定中心
- hero + companion 同步走 moveActorTo
- 末尾 cameraBlend 回 explore

## 9. 调试技巧

### 9.1 关键日志

播放后会打：
- `[TimelineSequencer] start timeline: <id>` — 开始
- `[TimelineSeq] EVENT FIRE <clipId> type=<type> atMs=<ms>` — event clip 触发
- `[TimelineSeq] INTERVAL START <clipId> type=<type> [start, end]` — interval clip 进入
- `[TimelineSeq] INTERVAL END (crossedEnd) <clipId>` — interval clip 离开
- `[TimelineSequencer] sequence complete: <id>` — 结束

### 9.2 常见问题

| 现象 | 排查 |
|------|------|
| clip 没触发 | 检查 `atMs` / `startMs` 是否超出 `durationMs`（会被 warn） |
| callback 静默失效 | handler 没注册——检查 ExploreMode.enter 是否调了 `_registerSequenceHandlers` |
| moveActorTo 不动 | binding.actorId 找不到 actor——看日志 `actor not found` |
| sequencer 结束后角色不能控制 | controlledBySequence 未被清——检查是否走了 stop 路径（兜底清标记）|
| cameraBlend 卡住 | 目标 rig 没注册——看 `unknown rig` warn |
| 短命 clip 漏调 | 不会漏，sequencer 有 same-frame start+end 容错 |

### 9.3 校验

`_validateTimeline` 会检查：
- `durationMs` 合法
- clip 时间不越界（atMs/startMs 超出会 warn 但不阻塞）
- 同 binding+channel 的 interval clip 重叠会 warn

写完 sequence 后看控制台有无 warn 即可。

## 10. 已知限制

1. `moveActorTo.speed` 字段未实现，实际按 `durationMs` 线性插值
2. `easing` 只有 `linear`，无缓动函数库
3. callback handler 只能注册在 ExploreMode（BattleMode 未注册）—— 战斗内 sequence 不能用 callback
4. `dialogueBubble` clip 依赖 `ctx.dialogueBubble`，通常只在 ExploreMode 期间可用（与 callback handler 同样限制）
5. 同一时刻多个 cameraEffect 叠播靠 CameraManager 内部队列，无显式优先级
6. `wait` clip 目前几乎无实际用途（多 track 已并行），保留作语义占位
7. DialogueBubble 是单例，同时只能显示一个气泡

## 11. 扩展指南

### 新增 clip type

1. 在 [TimelineSequencer.js ACTION_HANDLERS](file:///e:/se/BlindDuel/scripts/Systems/TimelineSequencer.js) 加对象：`{ start(ctx, clip, state/track), update?(ctx, clip, state, localMs, dtMs), end?(ctx, clip, state) }`
2. event clip 只需 `start`；interval clip 三者都可选
3. `update` 返回 `false` 可提前结束 interval clip

### 新增 callback handler

1. ExploreMode `_registerSequenceHandlers` 加 `handlers.set("fnName", (ctx, clip) => this.#handleFn(ctx, clip))`
2. `_unregisterSequenceHandlers` 加 `handlers.delete("fnName")`
3. sequence JSON 里 `{ "type": "callback", "atMs": N, "fn": "fnName" }`