# Prologue 内容与演出流程实施计划

> **状态：已完成并归档（2026-07-15）。** 主体 Step 1-9 均已实施，详录在 `commits_detailed/26.7.4 ~ 26.7.14` 各份提交文档。后续补丁另立归档：[Sequencer 期间门控修复（NPC 气泡 + walkArea clamp）.MD](./Sequencer%20期间门控修复（NPC%20气泡%20+%20walkArea%20clamp）.MD) 覆盖本计划 §1.10（clamp 旁路）与 sequencer 期间 ExploreMode 子系统门控的最终方案。
> 目标：在 prologue 场景落地完整流程——intro 演出 → 捡道具 → 交 NPC（派/交任务）→ prop 播片 → 同伴气泡 → 同伴跟随 → 战斗 → outro 演出 → 切 outdoor_village。
> 范围：场景切换 fade 包裹、intro/outro sequence 触发机制、同伴跟随 NPC、PropEntity（一次性播片角色）、QuestManager 数据化 directives、prologue.json 配置、prologue 专用 BattleDef。
> 不在范围：同伴 NPC 美术资源（待补，先用 traveller 占位）、prop 人物美术（待补，先用 traveller 占位）、bard 现有 action 字符串迁移（留下一章处理）、第一章另两场景的 intro/outro（不做）。

---

## 0. 决策清单（已拍板）

| 项 | 决策 |
|----|------|
| 同伴 NPC | 新做 archetype `npc_companion`，资源待补，先用 Charlotte atlas 占位（`Art/RawAssets/Charlotte.ase`，png 待导出） |
| 拾取道具 | dagger 占位（复用现有 itemDef） |
| 同伴动画 | 至少 idle + walk（资源待补，先用 Charlotte 的 idle 凑合，walk 缺失时回退 idle） |
| quest 命名 | `prologue_pickup_quest`（不叫 prologue_dagger） |
| dialogueBubble | Game.bootstrap 实例化（Scene 重构遗留未做，bard give-item 已 latent 崩溃） |
| callback handler | 挂 TimelineSequencer.ACTION_HANDLERS（§2.5/§2.6 走 tracks+clips 路径，非 SceneSequencer steps） |
| 战斗 | rabble_stick × 1，1 场，prologue 专用 BattleDef |
| intro | hero + 同伴从左侧（walkarea 外）走入，MGS 风格 fade-in 渐显与走位叠播 |
| outro | 右侧 trigger → outdoor_village，本章结束，outro 与 fade-out 叠播（MGS 风格，outro 长度 > fade 时间） |
| 播片人物 | 独立 PropEntity 类，无状态图，clip 切换由 sequence 的 SEND_COMMAND 驱动，含"下落 + 向右跑"两段，跑出画面销毁 |
| 第一章三场景转换 | outdoor_village / house_interior / 未来场景 之间：fade 包裹，无 intro/outro |
| intro 锁定 | 全锁（移动 + 交互） |
| 同伴角色合一 | intro 登场人 = 派/交任务人 = 跟随者，同一个 NPC |
| 同伴等待期行为 | 固定在等待点，复用 bard 式 NpcController 派/交任务机制 |
| 同伴战斗期间 | 站在场边不动（不参战、不消失） |
| outro trigger | 复用 sceneSwitch 类型 + condition 锁，不好用再解耦 |
| 战斗定义 | 另作 prologue 专用 BattleDef，onVictory 用 `scenario` 字段（BattleMode 已支持） |
| intro/outro 相机 | scripted 相机做不严格跟随 |
| clamp 旁路 | sequence busy 期间 ExploreMode 跳过 resolveMovement |
| 播片优先 | sequence busy 期间：玩家输入锁、moveActorTo 照常驱动、NpcController.following 跳过 |
| 同伴跟随参数 | 停下距离 1.5，开始距离 2.5，速度 1.1，目标固定 offset hero 右侧 1.0 |
| 场景切换流程 | outro(若有，末段叠 fade-out) → dispose+init → intro(若有，首步 fade-in 渐显与走位叠播) → 自由探索；无 intro/outro 时纯 fade 包裹 |
| prop 演出时序 | 交任务触发一条串行 sequence：prop 下落+跑+销毁 → 同伴气泡 → 切跟随；prop 与气泡不叠播 |
| QuestManager 数据化 | action 字段从方法名字符串改为指令数组；新增 `executeDirectives(directives)`；bard 留债 |
| prop 实现 | 独立 PropEntity 类，最小接口适配 SceneSequencer 现有 step type（零新增 step type） |
| prop 触发时机 | 交任务后立即播，flag 锁一次性 |
| walkArea | 不扩展，靠 clamp 旁路 |

---

## 1. 现状缺口

### 1.1 场景切换无 fade 包裹
- [Scene._loadScene](file:///e:/se/BlindDuel/scripts/Scene.js#L451) 是 `dispose() → init() → 放 hero`，中间无黑屏过渡
- `_loading=true` 期间 `updateRender` 直接 return，CameraManager 不更新（但 CSS transition 仍走，视觉能播完）
- 坑：dispose 销毁旧 cameraManager + overlay DOM，init 新建。fade-out 必须用旧 manager，fade-in 必须用新 manager

### 1.2 无 intro / outro 触发钩子
- SceneSequencer 已就绪，但 Scene.init 末尾不会自动播 intro
- ExploreMode 的 sceneSwitch trigger 直接赋值 `_pendingSceneLoad`，无 outro 演出空间

### 1.3 NPC 无跟随行为
- [NpcController](file:///e:/se/BlindDuel/scripts/Systems/NpcController.js) 只有 idle / greeting 两态
- NpcCharacter 默认 `blocksMovement=true`，会挡路

### 1.4 无 PropEntity
- CharacterBase 体系假设长期存在 + stateGraph 驱动，不适合"一次性播片角色"
- 每个新 cutscene 都为 prop 写 stateGraph 是过度设计

### 1.5 QuestManager action 字段耦合具体任务名
- [QuestManager.executeAction(actionName)](file:///e:/se/BlindDuel/scripts/Systems/QuestManager.js#L65) 用 `this[actionName]()` 反射调具体方法（如 `startDaggerQuest`）
- 基础系统不该知道"哪章哪个任务"，应改为数据化指令数组

### 1.6 同伴资源缺失
- Charlotte atlas 待导出（`Art/RawAssets/Charlotte.ase`），先用 traveller atlas 临时占位验证流程；Charlotte png 就绪后替换
- 无 walk 动画，跟随态先用 idle 滑动凑合（视觉妥协，待 Charlotte png 导出后补 walk clip）

### 1.7 BattleMode onVictory 链路（已确认就绪）
- [BattleMode.#checkBattleEnd](file:///e:/se/BlindDuel/scripts/Systems/Modes/BattleMode.js#L139-153) 已支持 `onVictory.scenario` / `onVictory.flags` / `onVictory.questStages`
- BattleDef 只需配对字段，无需改 BattleMode

### 1.8 dialogueBubble 从未实例化（Scene 重构遗留，Step 0 修）
- [Scene.js:277](file:///e:/se/BlindDuel/scripts/Scene.js#L277) 读 `game.sharedContext.dialogueBubble`，但 [Game.bootstrap()](file:///e:/se/BlindDuel/scripts/Game.js#L62) 未 `new DialogueBubble`
- `sharedContext.dialogueBubble` 恒 undefined；bard give-item 路径已 latent 崩溃（[ExploreMode.js:691](file:///e:/se/BlindDuel/scripts/Systems/Modes/ExploreMode.js#L691) 调 `.show` 会崩），只是没人真交 dagger 回 bard
- Prologue 同伴气泡（§2.6 `showCompanionBubble`）同样无对象可调

### 1.9 TimelineSequencer 无 callback handler（§2.6 静默失效，Step 6 修）
- §2.5 intro/outro 与 §2.6 prop 演出走 tracks+clips（[TimelineSequencer.js](file:///e:/se/BlindDuel/scripts/Systems/TimelineSequencer.js) 路径），不是 steps 数组
- ACTION_HANDLERS 注册了 command/moveActorTo/cameraBlend/inputLock/faceWorldX/switchMode/setCameraFrame/cameraEffect，**无 callback handler**
- 后果：§2.6 的 `disposeProp`/`showCompanionBubble`/`hideCompanionBubble`/`enterCompanionFollowing` 全部静默失效
- **注意**：原计划 Step 6 把 callback 修订挂在 SceneSequencer.CALLBACK step 上是错的，必须改 TimelineSequencer.ACTION_HANDLERS

### 1.10 _loading 阻塞 CameraManager.update（fade-in fx 不推进，Step 2 修）
- [Scene.js:355](file:///e:/se/BlindDuel/scripts/Scene.js#L355) `_loading` 时 updateRender 直接 return，`cameraManager.update` 在 return 之后
- 切场景 `newScene._loading=true → await init → _loading=false` 期间主循环仍跑，但 CameraManager 不更新 → fade-in/letterbox/shake/flash 的 fx 状态机不推进
- 原计划 Step 2 风险"CSS transition 仍走，视觉能播完"只对纯 CSS fade 成立，对 fx 状态机驱动的 effect 不成立

### 1.11 首场景 init 期间主循环未启动（根因 blocker，Step 2 修）
- [character_demo.js:9](file:///e:/se/BlindDuel/character_demo.js#L9) `await game.init()` 在 [character_demo.js:30](file:///e:/se/BlindDuel/character_demo.js#L30) `engine.runRenderLoop` 之前
- intro 在 `game.init()` 内部播，主循环还没注册，`sceneSequencer.fixedUpdate` / `cameraManager.update` 都不跑 → fade/letterbox/blend/moveActorTo 全部不推进，intro 卡死
- 与 §1.10 区别：§1.10 是"切场景期间 newScene._loading=true 拦截 update"，本条是"首场景 init 期间主循环根本没注册"——更深一层
- 上个会话轮询补丁（_awaitSequenceAndEffects）即因此而生，越修越崩，已废弃
- **决策**：采用方案 W——分离引擎 init（`Game.bootstrap`）与游戏 init（`Game.init`），`engine.runRenderLoop` 在 bootstrap 后、`game.init` 前启动，让主循环在 init 期间也跑；废弃轮询主动推进方案（备选：方案 X 直接把 runRenderLoop 挪到 game.init 之前，但违反引擎惯例，半初始化状态风险大）

### 1.12 Scene 重构遗留架构债（不阻塞 Step 2，单独清理）
- B1-B10 重构已达成“稳定对象上移”核心目标，**无双重创建、无孤儿、无 DOM 泄漏**（早期误判已纠正）
- 遗留整洁性问题：Scene 持稳定对象别名（cameraManager/rigs/UI）、Scene.init rigs 幂等冗余、dispose 死代码、sharedContext 重复赋值
- 潜在窗口期问题（§2.5）：切场景 `oldScene.dispose()` 后 `await newScene.init()` 期间，sharedContext 的 Scene 局部字段指向已 dispose 对象——当前靠 `_loading` 早退屏蔽，方案 W 需验证 _loading 期被放行的子系统不访问脏字段
- **详见**：[Scene 生命周期与稳定对象上移重构-回归.MD](file:///e:/se/BlindDuel/plans/Scene%20生命周期与稳定对象上移重构-回归.MD)
- **处理时机**：不在 Step 2 之前动；Step 2 完成后做 §2.1+§2.4 清理，用 Step 2 分层验证当回归

### 1.13 intro 一次性播放（per-scene flag 跟踪）
- 游戏有 3 个场景入口：`Game.init`（程序首启动）、`requestSceneSwitch→_loadSceneInternal`（切场景/读档）、`restoreCheckpoint→requestSceneSwitch`（读档恢复）
- **intro 触发条件**：`worldState.flags["intro_played_" + sceneDef.id]` 未置位时播，播完置 true。避免以下场景误播：
  - 未来持久化后，玩家中途退出再进，不重播已看过的 intro
  - 切场景各场景独立跟踪（prologue/outdoor_village/house_interior 互不干扰）
- **flags 天然持久化友好**：已在 [Game.js:210/236](file:///e:/se/BlindDuel/scripts/Game.js#L210) checkpoint 深拷贝，未来 localStorage 持久化 worldState 时自动带上
- **outro 不走此机制**：outro 是“离开场景时播”，语义不同（可能每次离开都播或也一次性），2f 再定
- **2f 需注意**：实现 `_loadSceneInternal` 的 intro 触发时复用同一 flag 机制；给 `requestSceneSwitch(sceneDef, spawnId, options)` 加 `options.skipIntro` 参数，`restoreCheckpoint` 传 `{ skipIntro: true }` 避免读档复活走 _loadSceneInternal 时误播（虽然 flag 会拦住，但 skipIntro 更明确）

---

## 2. 目标架构

### 2.1 场景切换流程（标准化）

关键：fade-out 用旧 manager（dispose 前），fade-in 用新 manager（init 后新 overlay）。outro 与 fade-out 叠播要求 outro 总时长 > fade-out 时长。

### 2.2 SceneDef 扩展字段

```jsonc
{
  "id": "prologue",
  "camera": { "defaultRig": "explore" },
  "transition": {
    "fade": true,
    "fadeOutMs": 400,
    "fadeInMs": 600
  },
  "introSequence": { /* 见 §2.5 */ },
  "outroSequence": { /* 见 §2.5 */ },
  "entities": [...],
  "walkArea": {...},
  "spawns": {...},
  "triggers": [...],
  "environment": {...}
}
```

### 2.3 同伴 NPC 流程（修正）

NpcDefs.js 里 companion 的 dialogue 跟 bard 结构一样（priority + condition + giveItem + action），只是 action 字段从字符串改成指令数组。

### 2.4 PropEntity（独立类，无状态图）

> **状态：已实施（2026-07-07/08）。** 详见 [commits_detailed/26.7.7 新增同伴和场景中rabblestick的flee cutscene.MD](commits_detailed/26.7.7%20新增同伴和场景中rabblestick的flee%20cutscene.MD)。下文为原始设计，保留作历史参考。

```js
export class PropEntity {
    constructor(scene, config) {
        this.scene = scene;
        this.id = config.id ?? `prop_${Date.now()}`;
        this.name = config.name ?? this.id;
        this.kind = "npc";
        this.root = new BABYLON.TransformNode(this.name, scene);

        // sprite plane（同 PickableEntity 思路）
        // clips: { fall: {textureUrl, atlasData, frameW, frameH}, run: {...} }
        this.clips = config.clips;
        this._currentClip = null;
        this._buildSpritePlane(config);

        // 适配 SceneSequencer 的最小接口
        this.facing = 1;
        this.facingMode = "locked";
    }

    // 适配 SEND_COMMAND step：clip 名当 state 名
    enterState(clipName) { this._setClip(clipName); }
    pushCommand(clipName) { this._setClip(clipName); }
    hasState(name) { return Boolean(this.clips?.[name]); }

    // 适配 MOVE_ACTOR_TO step：直接读 root.position
    setMoveIntent(_intent) { /* 空实现，prop 不用 intent 驱动 */ }
    setFacing(facing) { this.facing = facing >= 0 ? 1 : -1; /* 同步 sprite scaling */ }
    setFacingMode(_mode) { /* 空实现 */ }

    _setClip(name) {
        if (!this.clips?.[name] || this._currentClip === name) return;
        this._currentClip = name;
        // 切 texture + atlas UV + plane scaling
    }

    dispose() { /* 销毁 plane/material/root */ }
}
```

注册进 actorRegistry 后，SceneSequencer 的 `_getActor` / `SEND_COMMAND` / `MOVE_ACTOR_TO` / `CALLBACK` 全部复用，**零新增 step type**。

### 2.5 intro / outro sequence（prologue 专用）

> **状态：已实施（2026-07-08）。** sequence 文件见 `Data/Sequences/prologue_intro.json` / `prologue_outro.json`；落地细节见 [commits_detailed/26.7.8 pologue 正式制作part2.MD](commits_detailed/26.7.8%20pologue%20正式制作part2.MD)。下文为原始设计，保留作历史参考。

**intro**（MGS 风格，fade-in 与走位叠播）：
```jsonc
{
  "id": "prologue_intro",
  "durationMs": 6000,
  "tracks": [
    {
      "id": "fx.fadein",
      "kind": "camera",
      "channel": "fx",
      "clips": [
        { "type": "cameraEffect", "atMs": 0, "effect": "fade", "durationMs": 1200, "color": "black", "from": 1, "to": 0 }
      ]
    },
    {
      "id": "fx.letterbox",
      "kind": "camera",
      "channel": "fx",
      "clips": [
        { "type": "cameraEffect", "atMs": 0, "effect": "letterbox", "durationMs": 5500, "height": 72, "speed": 240 }
      ]
    },
    {
      "id": "camera.scripted",
      "kind": "camera",
      "binding": { "cameraId": "scripted" },
      "channel": "blend",
      "clips": [
        { "type": "cameraBlend", "startMs": 0, "durationMs": 0, "to": "scripted" },
        { "type": "setCameraFrame", "atMs": 0, "center": [0, 0, 0], "height": 4.5, "orthoWidth": 20 }
      ]
    },
    {
      "id": "hero.walk",
      "kind": "actor",
      "binding": { "actorId": "hero" },
      "channel": "movement",
      "clips": [
        { "type": "inputLock", "atMs": 0, "locked": true },
        { "type": "moveActorTo", "startMs": 200, "durationMs": 3000, "x": 0, "y": 0, "speed": 1.5 },
        { "type": "inputLock", "atMs": 5500, "locked": false }
      ]
    },
    {
      "id": "companion.walk",
      "kind": "actor",
      "binding": { "actorId": "companion" },
      "channel": "movement",
      "clips": [
        { "type": "moveActorTo", "startMs": 600, "durationMs": 3000, "x": -2, "y": 0, "speed": 1.4 }
      ]
    },
    {
      "id": "camera.back",
      "kind": "camera",
      "binding": { "cameraId": "explore" },
      "channel": "blend",
      "clips": [
        { "type": "cameraBlend", "startMs": 5000, "durationMs": 1000, "to": "explore" }
      ]
    }
  ]
}
```

**outro**（hero + 同伴走出右侧，末段叠 fade-out）：
```jsonc
{
  "id": "prologue_outro",
  "durationMs": 2000,
  "tracks": [
    {
      "id": "fx.letterbox",
      "kind": "camera",
      "channel": "fx",
      "clips": [
        { "type": "cameraEffect", "atMs": 0, "effect": "letterbox", "durationMs": 2000, "height": 72, "speed": 240 }
      ]
    },
    {
      "id": "fx.fadeout",
      "kind": "camera",
      "channel": "fx",
      "clips": [
        { "type": "cameraEffect", "atMs": 1600, "effect": "fade", "durationMs": 400, "color": "black", "from": 0, "to": 1 }
      ]
    },
    {
      "id": "camera.scripted",
      "kind": "camera",
      "binding": { "cameraId": "scripted" },
      "channel": "blend",
      "clips": [
        { "type": "cameraBlend", "startMs": 0, "durationMs": 0, "to": "scripted" },
        { "type": "setCameraFrame", "atMs": 0, "center": [8, 0, 0], "height": 4.5, "orthoWidth": 20 }
      ]
    },
    {
      "id": "hero.walk",
      "kind": "actor",
      "binding": { "actorId": "hero" },
      "channel": "movement",
      "clips": [
        { "type": "inputLock", "atMs": 0, "locked": true },
        { "type": "moveActorTo", "startMs": 0, "durationMs": 1800, "x": 20, "y": 0, "speed": 1.5 }
      ]
    },
    {
      "id": "companion.walk",
      "kind": "actor",
      "binding": { "actorId": "companion" },
      "channel": "movement",
      "clips": [
        { "type": "moveActorTo", "startMs": 200, "durationMs": 1800, "x": 19, "y": 0, "speed": 1.4 }
      ]
    },
    {
      "id": "trigger.exit",
      "kind": "callback",
      "clips": [
        { "type": "callback", "atMs": 2000, "fn": "triggerSceneSwitch" }
      ]
    }
  ]
}
```

### 2.6 prop 演出 + 同伴气泡 + 切跟随（串行 sequence）

> **状态：已实施（2026-07-07/08）。** 详见 [commits_detailed/26.7.7 新增同伴和场景中rabblestick的flee cutscene.MD](commits_detailed/26.7.7%20新增同伴和场景中rabblestick的flee%20cutscene.MD)（PropEntity + cutsceneInvokers + callback handler）与 [commits_detailed/26.7.8 pologue 正式制作part2.MD](commits_detailed/26.7.8%20pologue%20正式制作part2.MD)（PropEntity dispose 三层防御）。下文为原始设计，保留作历史参考。

交任务后由 ExploreMode 检测 scenario=105 触发，flag `prologue_prop_played` 锁一次性：

```jsonc
{
  "id": "prologue_prop_and_follow",
  "durationMs": 7000,
  "tracks": [
    {
      "id": "prop.fall",
      "kind": "actor",
      "binding": { "actorId": "prop_faller" },
      "channel": "command",
      "clips": [
        { "type": "command", "atMs": 0, "command": "fall" },
        { "type": "moveActorTo", "startMs": 0, "durationMs": 1000, "x": -5, "y": 0, "speed": 8 }
      ]
    },
    {
      "id": "prop.run",
      "kind": "actor",
      "binding": { "actorId": "prop_faller" },
      "channel": "command",
      "clips": [
        { "type": "command", "atMs": 1000, "command": "run" },
        { "type": "moveActorTo", "startMs": 1000, "durationMs": 2000, "x": 15, "y": 0, "speed": 4 }
      ]
    },
    {
      "id": "prop.dispose",
      "kind": "callback",
      "clips": [
        { "type": "callback", "atMs": 3000, "fn": "disposeProp" }
      ]
    },
    {
      "id": "companion.bubble_show",
      "kind": "callback",
      "clips": [
        { "type": "callback", "atMs": 3200, "fn": "showCompanionBubble" }
      ]
    },
    {
      "id": "companion.bubble_wait",
      "kind": "wait",
      "clips": [
        { "type": "wait", "atMs": 3200, "durationMs": 2000 }
      ]
    },
    {
      "id": "companion.bubble_hide",
      "kind": "callback",
      "clips": [
        { "type": "callback", "atMs": 5200, "fn": "hideCompanionBubble" }
      ]
    },
    {
      "id": "companion.follow",
      "kind": "callback",
      "clips": [
        { "type": "callback", "atMs": 5400, "fn": "enterCompanionFollowing" }
      ]
    }
  ]
}
```

注：上述 callback fn 名为示意，实际由 ExploreMode 注册一组具名 handler 进 sharedContext，SceneSequencer 的 CALLBACK step 通过 `step.fn(context, payload)` 调用。需要扩 CALLBACK step 支持按名字查 handler（当前是直接传 fn 函数对象，数据化 sequence 要支持字符串名 → handler 映射）。

### 2.7 QuestManager 数据化 directives

```js
// QuestManager 新增
executeDirectives(directives) {
    if (!Array.isArray(directives)) return;
    for (const d of directives) {
        switch (d.type) {
            case "advanceScenario": this.advanceTo(d.value); break;
            case "setScenario": this.setScenario(d.value); break;
            case "setFlag": this.setFlag(d.key, d.value ?? true); break;
            case "clearFlag": this.setFlag(d.key, false); break;
            case "startQuest": this.startQuest(d.id); break;
            case "setQuestStage": this.setQuestStage(d.id, d.stage); break;
            case "completeQuest": this.completeQuest(d.id); break;
            case "removeItem": this.inventory?.removeItem(d.item); break;
            case "addItem": this.inventory?.addItem(d.item); break;
            default: console.warn(`[QuestManager] unknown directive: ${d.type}`);
        }
    }
}
```

NpcDef 的 action 字段从字符串改为指令数组：
```jsonc
// companion（prologue）
{
  "priority": 90,
  "condition": { "quest": "prologue_pickup_quest", "stage": 1, "hasItem": "dagger" },
  "text": "👍",
  "action": [
    { "type": "removeItem", "item": "dagger" },
    { "type": "advanceScenario", "value": 105 }
  ],
  "giveItem": "dagger"
}
```

NpcController._triggerAction 改调 `questManager.executeDirectives(this._activeAction)`。
bard 的 `action: "startDaggerQuest"` 暂留旧路径（_triggerAction 兼容字符串和数组两种格式），下一章迁移。

### 2.8 prologue 专用 BattleDef

```js
export const PROLOGUE_BATTLE = {
    id: "prologue_battle",
    combatants: ["hero", "enemy_1"],
    stageBounds: { minX: -8, maxX: 8, minY: -0.05, maxY: 0.05 },
    battleYBaseline: 0,
    onVictory: {
        scenario: SCENARIO.BATTLE_1_COMPLETED,  // = 110
        flags: ["prologue_battle"],
    },
    duelCamera: { /* 同 BATTLE_FIELD_1 */ },
    enterSequence: (battleDef) => ({ /* 复用 BATTLE_FIELD_1.enterSequence 结构 */ }),
    exitSequence: { /* 复用 BATTLE_FIELD_1.exitSequence 结构 */ },
};
```

BattleMode.onVictory 已支持 `scenario` / `flags` 字段，无需改 BattleMode。

---

## 3. 分步实施

### Step 0：dialogueBubble 实例化（前置 blocker，§1.8）
- **文件**：[scripts/Game.js](file:///e:/se/BlindDuel/scripts/Game.js)、`babylon_demo.html` / `index.html`
- **改动**：
  - `Game.bootstrap()` 加 `this.dialogueBubble = new DialogueBubble(document.getElementById("dialogue-bubble"))` + `this.sharedContext.dialogueBubble = this.dialogueBubble`，并 import DialogueBubble
  - HTML 加 `<div id="dialogue-bubble"></div>` 容器
- **影响**：修复 bard give-item latent 崩溃；为 Prologue 同伴气泡铺路
- **验证**：控制台 `game.sharedContext.dialogueBubble` 非空

### Step 1：ScenarioMilestones 补充中间值
- **文件**：[Data/ScenarioMilestones.js](file:///e:/se/BlindDuel/Data/ScenarioMilestones.js)
- **改动**：增加 `PROLOGUE_CHARLOTTE_JOIN: 105`
- **影响**：无

### Step 2：场景切换 fade 包裹 + intro/outro 钩子（按 Layer 0-7 分层验证）

> **核心原则**：废弃轮询主动推进（_awaitSequenceAndEffects 已回退）。采用方案 W（§1.11）：分离引擎 init（`Game.bootstrap`）与游戏 init（`Game.init`），`engine.runRenderLoop` 在 bootstrap 后、`game.init` 前启动，让主循环在 init 期间也跑，所有系统由单一执行路径驱动。符合 Unity/Unreal 引擎惯例，无半初始化状态。
> 每子步前层未通过不进下一层；每子步有明确的"通过信号"。临时验证 sequence 通过后删除。
> **架构债**：Step 2 期间若发现 §1.12/§2.5 窗口期问题，单独记录不展开修。

#### Step 2a（Layer 0）：主循环时序修正（方案 W）
- **文件**：[character_demo.js](file:///e:/se/BlindDuel/character_demo.js)、[scripts/Game.js](file:///e:/se/BlindDuel/scripts/Game.js)
- **当前状态**：`Game.init()` 内部第一行 `await this.bootstrap()`（[Game.js:143-148](file:///e:/se/BlindDuel/scripts/Game.js#L143-148)），`character_demo.js` 是 `await game.init()` → `engine.runRenderLoop()`（[character_demo.js:9,30](file:///e:/se/BlindDuel/character_demo.js#L9)）
- **改动**：
  - `character_demo.js`：拆成 `await game.bootstrap()` → `engine.runRenderLoop(...)` → `await game.init()` → `game.playOpening()`（playOpening 可选，见 2e）
  - `Game.init`：去掉内部首行 `await this.bootstrap()`（bootstrap 已在外部调过），init 变纯游戏层：`resolveSceneDef` + `scene.init`
  - `Game.bootstrap`：保持现状（已含 CameraManager/UI/rigs/sceneSequencer 等所有稳定对象，[Game.js:65-138](file:///e:/se/BlindDuel/scripts/Game.js#L65-138)）
  - `Game.fixedUpdate`/`Game.updateRender`：当前转发给 `this.scene.fixedUpdate/updateRender`（[Game.js:150-156](file:///e:/se/BlindDuel/scripts/Game.js#L150-156)），Scene 内部 `_loading` 早退——需在 Scene 层放行 §1.10/§1.11 子系统（见下）
  - `Scene.updateRender`（[Scene.js:355](file:///e:/se/BlindDuel/scripts/Scene.js#L355)）：`_loading` 时不再整段 return，改为"放行 cameraManager.update（推进 fx/blend），其余早退"——修 §1.10
  - `Scene.fixedUpdate`（[Scene.js:344](file:///e:/se/BlindDuel/scripts/Scene.js#L344)）：`_loading` 时不再整段 return，改为"放行 sceneSequencer.fixedUpdate（推进 intro clips），其余早退"——修 §1.11
- **验证 §1.12/§2.5 窗口期**：bootstrap 后 scene.init 前主循环跑，此时 `scene.cameraManager` 是 null（Scene 构造时设 null，[Scene.js:37](file:///e:/se/BlindDuel/scripts/Scene.js#L37)），[Scene.js:358](file:///e:/se/BlindDuel/scripts/Scene.js#L358) `if (this.cameraManager)` null-safe。但若 §1.12 把别名改成 `this._game.cameraManager`，则 bootstrap 后即非空，update 会被调——需确认 update 内部不访问脏 sharedContext.sceneVisualSystem 等字段
- **通过信号**：临时 log 在 `Scene.fixedUpdate`/`updateRender` 开头，能看到 `await game.init()` 期间主循环在跑（_loading=true 时放行子系统也跑）；`game.init()` 返回前主循环 tick 数 > 0；无报错

#### Step 2b（Layer 1）：SceneSequencer 单独走通（无 fx、无 blend）
- **改动**：临时配一条最小 sequence（一条 actor track，一个 `moveActorTo` clip，无 camera track），在 `Scene.init` 末尾或 `Game.init` 末尾手动 enqueue
- **隔离验证**：`sceneSequencer.fixedUpdate` + MOVE_ACTOR_TO handler
- **通过信号**：`hero.root.position` 从 A 变到 B；`sceneSequencer.isBusy()` true→false；无 fx 干扰
- **通过后删除临时 sequence**

#### Step 2c（Layer 2）：单个 cameraEffect 走通（无 blend、无 move）
- **改动**：临时配一条只含 `cameraEffect`（letterbox 或 fade）clip 的 sequence
- **隔离验证**：`enqueueEffect` + `_applyEffects` + `_updateLetterbox`/`_triggerFade`
- **通过信号**：letterbox DOM 高度 0→72 / fade overlay opacity 1→0；effect 从 `_effects` 数组移除；`[CameraManager]` 相关 log
- **通过后删除临时 sequence**

#### Step 2d（Layer 3）：cameraBlend 单独走通（无 fx、无 move）⚠️ 关键
- **改动**：临时配一条只含 `cameraBlend` clip [0,1000] 切到另一 rig 的 sequence
- **隔离验证**：`startBlend` + `_updateBlend`
- **重点验证**：**blend 在 effects 队列空时仍能推进**——这正是上个会话问题2 的雷区。确认 `_updateBlend` 不依赖 `hasActiveEffects`，仅靠 `_blend.active`（[CameraManager.js:131-144](file:///e:/se/BlindDuel/scripts/Systems/CameraManager.js#L131-144) 已确认是同一 update 入口，主循环正常调时无需额外条件）
- **通过信号**：已有 log `[CameraManager] blend COMPLETE elapsed=... → switchRig "..."`
- **通过后删除临时 sequence**

#### Step 2e（Layer 4+5）：effect + blend 叠播 → 完整 intro
- **改动**：先用 Layer 2 + Layer 3 合并 sequence 验证叠播（Layer 4）；通过后接入真实 `prologue_intro.json`（Layer 5）
- **intro 触发点**：`Game.init` 末尾或新增 `Game.playOpening()`，读 `sceneDef.introSequenceUrl` 加载并 enqueue。不阻塞 `await game.init()` 返回（intro 借主循环驱动，无需 await 完成）
- **验证**：Layer 2 和 Layer 3 的信号都触发，两者独立完成
- **通过信号**：所有 track 按序完成，末尾 blend 到 explore；`sceneSequencer.isBusy()` true→false；hero 锁定→解锁

#### Step 2f（Layer 6+7）：fade 包裹场景切换 + outro 叠 fade-out
- **文件**：[scripts/Game.js](file:///e:/se/BlindDuel/scripts/Game.js)（入口已迁移到 `Game._loadSceneInternal`，CameraManager 跨场景稳定）
- **当前 `_loadSceneInternal`**（[Game.js:225-258](file:///e:/se/BlindDuel/scripts/Game.js#L225-258)）是先切 `this.scene=newScene` 再 dispose，outro 在 oldScene 上播不动——顺序要倒
- **改动**：`_loadSceneInternal` 流程改：
    1. oldScene 上 enqueue outro + 末段叠 fade-out（oldScene 仍是 `this.scene`，主循环驱动 fixedUpdate → SceneSequencer）
    2. `await` 直到 `sceneSequencer.isBusy()` 为 false 且 `cameraManager` effects/blend 都空——**因主循环驱动，await 用 Promise + fixedUpdate 末尾检查 resolve，不再用轮询**
    3. `newScene._loading=true; this.scene=newScene; oldScene.dispose()`
    4. `await newScene.init()`
    5. `_loading=false`
    6. 播 intro（Step 2e 已验证）或 enqueueEffect(fade-in)
  - `_fadeOutMs` / `_fadeInMs` 从 sceneDef.transition 读，默认 400/600
  - intro/outro 时序：outro 末段（最后 fadeOutMs）叠 fade-out；intro 首步 = fade-in 渐显与走位叠播
- **通过信号**：黑屏出现 → 场景切换 → 黑屏淡出；outro clips 全完成 + fade 到 1.0 + 场景切换

- **风险（合并）**：
  - outro 必须在 `this.scene` 仍指向 oldScene 时播完，再切引用再 dispose（流程顺序是本步核心难点）
  - outro 与 fade-out 叠播要求 outro 总时长 > fade-out 时长，配置时注意
  - Step 2a 的 Scene._loading 放行逻辑要稳定，否则切场景期间崩
  - §1.12/§2.5 窗口期：`oldScene.dispose()` 后 `await newScene.init()` 期间 sharedContext 的 Scene 局部字段指向已 dispose 对象——需确认 _loading 期被放行的 cameraManager/sceneSequencer 不访问脏字段，访问处加 null check
  - **备忘（数值类）**：prologue.json hero 初始 `pos` 与 `spawns.house_door` 不一致（[prologue.json](file:///e:/se/BlindDuel/Data/SceneDefs/prologue.json) pos=[0,0] vs spawn=[-1,-1,0]），intro 期间会被 moveActorTo 覆盖，配 prologue.json 时把 hero 初始 pos 放 walkarea 外即可
  - **备忘（验证后定）**：scripted rig 的 frame 切场景后是否需重置——intro 用 scripted rig 设的 frame 在切 explore 后保留，再切回 prologue 时 frame 仍是上次的值
  - **备忘（验证后定）**：Scene.init 末尾 `gameModeManager.start("explore")` 每次切场景都触发 ExploreMode.enter（设 AUTO_FROM_MOVE + _buildIndices），intro 期间可能与其副作用冲突

### Step 3：ExploreMode clamp 旁路 + 播片优先（sceneSwitch trigger 已接 game.requestSceneSwitch，无需改）
- **文件**：[scripts/Systems/Modes/ExploreMode.js](file:///e:/se/BlindDuel/scripts/Systems/Modes/ExploreMode.js)
- **背景**：原计划的 `#updateSceneSwitchTrigger` 改调 `scene.requestSceneSwitch` 已在 Scene 重构 B9 完成（[ExploreMode.js:97-100](file:///e:/se/BlindDuel/scripts/Systems/Modes/ExploreMode.js#L97-100) 调 `game.requestSceneSwitch`），本步只剩 clamp 旁路 + 播片优先
- **改动**：
  - `fixedUpdate`：`if (sceneSequencer.isBusy())` 跳过 `_collisionSystem.resolveMovement`（clamp 旁路，moveActorTo 直接改 root.position 不查 blocker）
  - `fixedUpdate`：`if (sceneSequencer.isBusy())` 跳过 companion 的 `npcController.update`（播片优先，避免 following 与 moveActorTo 冲突）
- **风险**：clamp 旁路期间 hero 可走出 walkarea——intro/outro 期间这是预期行为；正常探索期间 sequence 不 busy，无影响

> **实施备注（2026-07-04 验证 Step 2f-2 时发现）**：上述 clamp 旁路代码 **当前不需要写**。outro 期间 clamp 不生效是 `_loading=true` 短路 ExploreMode 的副作用，天然免费：
> - **outro 路径**：[Game.js:252](file:///e:/se/BlindDuel/scripts/Game.js#L252) `requestSceneSwitch` 第一行即 `this.scene._loading = true`，随后 `await _loadSceneInternal` 内部 `await _playOutro`。outro 播放期间 [Scene.js:349-352](file:///e:/se/BlindDuel/scripts/Scene.js#L349-352) `if (this._loading) { sceneSequencer.fixedUpdate; return; }` 提前 return，`gameModeManager.fixedUpdate` 不被调 → ExploreMode.fixedUpdate 不跑 → `resolveMovement`（clamp）不执行。moveActorTo 在 `sceneSequencer.fixedUpdate` 里写 `hero.root.position` 无人 clamp，hero 能走出 walkArea。
> - **intro 路径**：[Game.js:316](file:///e:/se/BlindDuel/scripts/Game.js#L316) `newScene._loading = false` 在 `_playIntro` **之后**，所以 intro 播放期间 `_loading=false`，ExploreMode 会跑，clamp 生效。当前 prologue 配置下 hero spawn 在 `house_door(-1,-1)`、intro 走位目标 `(0,0)`，全在 walkArea 内（minX=-6.75, maxX=9.98）→ clamp 无影响。**未来若 intro 要让 hero 从 walkArea 外走入（如计划 §2.5 原设计 hero 从 x=-20 走入），需另外处理**：要么把 `newScene._loading = false` 挪到 intro 播完之后，要么补上原计划的 `if (sceneSequencer.isBusy())` clamp 旁路。
> - **架构债标记**：这是"巧合正确"——clamp 旁路的正确性依赖 `_loading` 短路时序，而非显式语义。未来若重构 `_loadSceneInternal` 时序（如把 `_loading=false` 提前），outro 期间 clamp 会突然生效导致 hero 卡边界。建议在 [Scene 生命周期回归文档](file:///e:/se/BlindDuel/plans/Scene%20生命周期与稳定对象上移重构-回归.MD) §2.5 窗口期问题清单里登记此依赖。

### Step 4：QuestManager 数据化 directives
- **文件**：[scripts/Systems/QuestManager.js](file:///e:/se/BlindDuel/scripts/Systems/QuestManager.js)
- **改动**：
  - 新增 `executeDirectives(directives)`（见 §2.7）
  - 保留 `executeAction(actionName)` 兼容 bard 旧路径
- **文件**：[scripts/Systems/NpcController.js](file:///e:/se/BlindDuel/scripts/Systems/NpcController.js)
- **改动**：`_triggerAction` 兼容字符串（旧，调 executeAction）和数组（新，调 executeDirectives）两种格式
- **风险**：bard 仍走旧路径，下一章迁移

### Step 5：同伴 NPC（npc_companion）+ 跟随行为
- **新增**：[CharacterFactory.js](file:///e:/se/BlindDuel/scripts/CharacterFactory.js) 加 `createCompanionNpc`，先用 Charlotte atlas 占位（png 待导出，导出前临时用 traveller atlas 验证流程；idle + walk 缺失时回退 idle）
- **新增 archetype**：`npc_companion` 进 `ARCHETYPE_FACTORY`
- **备忘（易抄错）**：现有 NPC 工厂（createNpcCharacter/createBardNpc 等）都硬编码 `blocksMovement:true`，companion 必须显式传 `blocksMovement:false`，否则会挡 hero 路
- **改动**：[NpcController.js](file:///e:/se/BlindDuel/scripts/Systems/NpcController.js) 加 `following` 状态：
  - 进入方式：由 sequence 末尾 callback 显式调 `npcController.enterFollowing()`（不靠 NpcController 自己判 scenario）
  - 行为：每帧算与 hero 距离，> 2.5 朝 hero 右侧 offset 1.0 走（速度 1.1），<= 1.5 归零
  - 战斗期间（context.modeId === "battle"）切 idle、停 setMoveIntent
  - sequence busy 期间 ExploreMode 跳过 update（见 Step 3），following 不冲突
- **改动**：[ExploreMode.js](file:///e:/se/BlindDuel/scripts/Systems/Modes/ExploreMode.js) `_buildIndices`：companion 进 `interactables`（可交 dagger）但不进 `staticBlockers`（blocksMovement=false）
- **改动**：[Data/NpcDefs.js](file:///e:/se/BlindDuel/Data/NpcDefs.js) 加 companion 定义（dialogue 结构同 bard，action 用指令数组）：
  - condition: quest=prologue_pickup_quest stage=1 hasItem=dagger → 接收 dagger，action=[removeItem(dagger), advanceScenario(105)]
  - condition: scenario>=105 → 空对话或简短回应
  - condition: {} → 派任务 startQuest(prologue_pickup_quest)
- **风险**：Charlotte 无 walk atlas，跟随态视觉是 idle 滑动——待 Charlotte png 导出后补 walk

> **实施备注（2026-07-04 讨论问题 1）**：cutscene 期间 Charlotte 的 idle 滑步不是 bug，是 sequence 播片的固有特性——`moveActorTo` 直接写 `root.position`（[TimelineSequencer.js:336-337](file:///e:/se/BlindDuel/scripts/Systems/TimelineSequencer.js#L336-337)），完全绕过 `moveIntent` / stateGraph / `_applyMovement`，state 只管动画帧不管位移。hero 在 intro 里走 moveActorTo 也有同样行为。若要 cutscene 期间走路动画对得上位移，sequence clip 需先 `SEND_COMMAND walk` 再 `moveActorTo`——属 sequence 配置问题。**本备注所提问题留到 §2.6 系统性梳理 sequencer 与 character/controller 交互职责时一起处理**，不在 Step 5/6 范围。

### Step 6：PropEntity + prop 演出 sequence
- **新增**：[scripts/Enties/PropEntity.js](file:///e:/se/BlindDuel/scripts/Enties/PropEntity.js)（见 §2.4）
- **新增 archetype**：`npc_prop` 进 `ARCHETYPE_FACTORY`，工厂调 `new PropEntity(scene, config)`
- **改动**：[TimelineSequencer.js](file:///e:/se/BlindDuel/scripts/Systems/TimelineSequencer.js) ACTION_HANDLERS 新增 `callback` handler（§1.9，**注意是 TimelineSequencer 不是原计划写的 SceneSequencer**——§2.5/§2.6 走 tracks+clips 路径，原计划 Step 6 错挂在 SceneSequencer.CALLBACK step 上）：
  - sharedContext 新增 `sequenceHandlers: Map<string, Function>`
  - `callback` clip：`clip.fn` 为字符串则从 `context.sequenceHandlers.get(clip.fn)` 查；为函数则直接调
  - ExploreMode 注册 handler：`disposeProp` / `showCompanionBubble` / `hideCompanionBubble` / `enterCompanionFollowing` / `triggerSceneSwitch`
- **补充修复（2026-07-04 讨论问题 5）**：修 `SEND_COMMAND` handler 的 pushCommand fallback bug。当前 [TimelineSequencer.js:301-309](file:///e:/se/BlindDuel/scripts/Systems/TimelineSequencer.js#L301-309) 在 `actor.pushCommand(command)` 返回 `false` 时只打注释掉的 warn，**不 fallback 到 `enterState`**。Charlotte/companion 这类无 transitions 的 NPC 永远 pushCommand 失败 → SEND_COMMAND 完全无效。修法：pushCommand 返回 false 时 fallback 调 `enterState(command)`。修完后 intro sequence 末尾可加 `SEND_COMMAND observe` clip 让 Charlotte 切到 observe 状态（用户需求：sequence 播完后 Charlotte 播 observe）。
- **新增**：prop 演出 sequence（见 §2.6），由 ExploreMode 检测 scenario===105 且 flag `prologue_prop_played` 未置位时触发，触发后立即 setFlag
- **风险**：prop 资源待补，下落+跑动画先用 Charlotte idle 占位，视觉是"传送+滑动"

### Step 7：prologue 专用 BattleDef
- **文件**：[scripts/SceneDefs.js](file:///e:/se/BlindDuel/scripts/SceneDefs.js)
- **改动**：新增 `PROLOGUE_BATTLE`（见 §2.8），注册进 `BATTLE_DEFS`
- **影响**：BattleMode 无需改（onVictory 已支持 scenario 字段）

### Step 8：prologue.json 落地配置
- **文件**：[Data/SceneDefs/prologue.json](file:///e:/se/BlindDuel/Data/SceneDefs/prologue.json)
- **改动**：
  - entities 加：
    - companion（pos 在 walkarea 外左侧，如 [-20, 0]）
    - prop_faller（pos 高处，如 [-5, 8]，spawnIf: { flagNot: "prologue_prop_played" }）
    - enemy_1（archetype: rabble_stick，pos 如 [8, 0]，spawnIf: { scenarioMin: 105 }）
    - dagger pickable（pos 如 [4, 0]）
  - triggers 加：
    - battle trigger（type: battle, battleId: "prologue_battle", condition: { scenarioMin: 105 }）
    - sceneSwitch trigger 到 outdoor_village（condition: { scenarioMin: 110 }, targetSpawn: 对应 outdoor_village 左侧入口）
  - spawns 加 `intro_start: [-20, 0, 0]`（intro 用，hero 出生点）
  - 加 `introSequence` / `outroSequence` / `transition` 字段（见 §2.5 / §2.2）
- **风险**：walkArea 不扩展，intro 期间 clamp 旁路让 hero 能从 walkarea 外走入

### Step 9（验证用）：第一章三场景 fade-only 切换
- outdoor_village / house_interior 的 SceneDef 加 `transition: { fade: true }`（不加 intro/outro）
- 验证三场景切换只有 fade，无演出

---

## 4. 影响面

| 文件 | S1 | S2 | S3 | S4 | S5 | S6 | S7 | S8 |
|------|----|----|----|----|----|----|----|----|
| Data/ScenarioMilestones.js | ✓ | | | | | | | |
| scripts/Scene.js | | ✓ | | | | | | |
| scripts/Systems/Modes/ExploreMode.js | | | ✓ | | ✓ | ✓ | | |
| scripts/Systems/QuestManager.js | | | | ✓ | | | | |
| scripts/Systems/NpcController.js | | | | ✓ | ✓ | | | |
| scripts/CharacterFactory.js | | | | | ✓ | ✓ | | |
| scripts/Enties/PropEntity.js（新） | | | | | | ✓ | | |
| scripts/Systems/SceneSequencer.js | | | | | | ✓ | | |
| Data/NpcDefs.js | | | | | ✓ | | | |
| scripts/SceneDefs.js | | | | | | | ✓ | |
| Data/SceneDefs/prologue.json | | | | | | | | ✓ |

---

## 5. 验证清单

### Step 1 + Step 2a 完成后（Layer 0：主循环时序）
- [ ] scenario=105 常量存在
- [ ] `character_demo.js` 顺序为 `bootstrap` → `runRenderLoop` → `init` → `playOpening`
- [ ] `Game.init` 内部不再调 `bootstrap`
- [ ] 临时 log 显示 `await game.init()` 期间主循环 tick 数 > 0
- [ ] `_loading=true` 时 `sceneSequencer.fixedUpdate` 仍被调（§1.11 放行）
- [ ] `_loading=true` 时 `cameraManager.update` 仍被调（§1.10 放行）
- [ ] 无报错；§1.12/§2.5 窗口期不崩

### Step 2b 完成后（Layer 1：SceneSequencer 原语）
- [ ] 临时最小 sequence（单个 moveActorTo）执行后 `hero.root.position` 从 A 变到 B
- [ ] `sceneSequencer.isBusy()` true→false
- [ ] 无 fx/blend 干扰

### Step 2c 完成后（Layer 2：cameraEffect 原语）
- [ ] 临时 sequence（单个 letterbox 或 fade）执行后 DOM/overlay 状态变化
- [ ] effect 从 `_effects` 数组移除
- [ ] `[CameraManager]` 相关 log 正常

### Step 2d 完成后（Layer 3：cameraBlend 原语）⚠️ 关键
- [ ] 临时 sequence（单个 cameraBlend）执行后 log 显示 `[CameraManager] blend COMPLETE ... → switchRig`
- [ ] **blend 在 effects 队列空时仍推进**（问题2 雷区验证）

### Step 2e 完成后（Layer 4+5：叠播 + 完整 intro）
- [ ] effect + blend 叠播两者独立完成
- [ ] 接入真实 `prologue_intro.json` 后所有 track 按序完成
- [ ] 末尾 blend 到 explore；hero 锁定→解锁
- [ ] `sceneSequencer.isBusy()` true→false

### Step 2f + Step 3 完成后（Layer 6+7：fade 包裹 + outro）
- [ ] 切场景时画面 fade-out → 黑屏 → fade-in，无闪烁
- [ ] prologue 加 introSequence 后，进场景自动播 intro，hero 锁定
- [ ] intro 期间 hero 不被 walkArea clamp（Step 3 clamp 旁路生效）
- [ ] sceneSwitch trigger 命中后播 outro（末段叠 fade-out），outro 末尾自动切场景
- [ ] await outro 不用轮询，用 Promise + fixedUpdate 末尾 resolve

### Step 4-5 完成后
- [ ] companion 在 intro 中从左侧走入，到等待点驻留
- [ ] 与 companion 交互接任务，quest=prologue_dagger stage=1
- [ ] 捡起 dagger 后交给 companion，scenario 推进到 105，dagger 从背包移除
- [ ] scenario=105 后 prop 演出 sequence 触发（一次性）
- [ ] prop 下落 + 跑出画面后销毁，entityPool 中无残留
- [ ] 同伴气泡弹出 → 等 2s → 隐藏
- [ ] 气泡结束后 companion 切 following 态，开始跟随 hero（距离 > 2.5 追，<= 1.5 停）
- [ ] 战斗期间 companion 站场边不动
- [ ] companion 不挡路（blocksMovement=false 生效）

### Step 6-8 完成后
- [ ] scenario=105 后 enemy_1 生成，battle trigger 可触发
- [ ] 战斗胜利后 scenario=110，离开 trigger 解锁
- [ ] 离开 trigger 触发 outro（hero + companion 走出右侧，末段 fade-out）
- [ ] outro 末尾切到 outdoor_village
- [ ] outdoor_village 进场景 fade-in，无 intro

### 回归测试
- [ ] outdoor_village / house_interior 切换仍正常（fade-only，无 intro/outro）
- [ ] bard 现有派/交任务流程仍正常（_triggerAction 兼容字符串 action）
- [ ] resetWorldState 后 scenario=100，prologue 从头开始

---

## 6. 实施顺序建议

按依赖关系分批：

- **批次 A（基础设施，Step 2 严格串行）**：Step 1 + Step 2a + Step 2b + Step 2c + Step 2d + Step 2e + Step 2f + Step 3
  - Step 2 内部 **2a→2b→2c→2d→2e→2f 严格串行**，前层未通过不进下层
  - 2a 先修主循环时序（方案 W）+ §1.10/§1.11 放行，这是地基
  - 2b/2c/2d 用临时最小 sequence 验证三个原语（moveActorTo/cameraEffect/cameraBlend），通过后删除临时 sequence
  - 2e 验证叠播 + 接入真实 prologue_intro.json
  - 2f 实现 fade 包裹场景切换 + outro 叠 fade-out
  - Step 3（clamp 旁路）在 2f 验证 intro 期间 clamp 不卡 hero 时加
- **批次 B（任务系统数据化）**：Step 4
  - QuestManager.executeDirectives + NpcController 兼容，单独验证 bard 不破
- **批次 C（同伴 + prop 演出）**：Step 5 + Step 6
  - companion 驻留 + 派/交任务 + prop 演出 + 气泡 + 切跟随，整条 sequence 串通
- **批次 D（战斗 + 配置落地）**：Step 7 + Step 8
  - BattleDef + prologue.json 完整配置，端到端跑通
- **批次 E（回归）**：Step 9
  - 第一章三场景 fade-only 验证

每批次结束做一次手动验证再进下一批，避免问题堆叠。

**架构债清理（批次 A 完成后）**：依 [Scene 生命周期与稳定对象上移重构-回归.MD](file:///e:/se/BlindDuel/plans/Scene%20生命周期与稳定对象上移重构-回归.MD) §3，批次 A 跑通后做 §2.1+§2.4 清理，用 Step 2a-2f 分层验证当回归。

---

## 7. 已确认关闭的历史待确认项

1. ~~BattleMode.onVictory 链路~~：已读 [BattleMode.js:139-153](file:///e:/se/BlindDuel/scripts/Systems/Modes/BattleMode.js#L139-153)，支持 `onVictory.scenario` / `flags` / `questStages`，无需改 BattleMode
2. ~~walkArea 扩展~~：不扩展，靠 clamp 旁路
3. ~~prop 触发时机~~：交任务后立即播，flag 锁一次性
4. ~~outro 与 fade-out 叠播~~：已采纳，outro 末段叠 fade-out，要求 outro 时长 > fade-out 时长
5. ~~prop 实现~~：独立 PropEntity 类，无状态图，clip 切换复用 SEND_COMMAND
6. ~~QuestManager 命名~~：数据化 directives，bard 留债下一章
7. ~~同伴流程~~：intro 走入 → 等待点驻留（bard 式）→ 交任务 → prop 演出 → 气泡 → 跟随
8. ~~播片优先模型~~：sequence busy 时玩家输入锁但 moveActorTo 驱动，NpcController.following 跳过