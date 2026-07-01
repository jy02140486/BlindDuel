# Prologue 内容与演出流程实施计划

> 目标：在 prologue 场景落地完整流程——intro 演出 → 捡道具 → 交 NPC（派/交任务）→ prop 播片 → 同伴气泡 → 同伴跟随 → 战斗 → outro 演出 → 切 outdoor_village。
> 范围：场景切换 fade 包裹、intro/outro sequence 触发机制、同伴跟随 NPC、PropEntity（一次性播片角色）、QuestManager 数据化 directives、prologue.json 配置、prologue 专用 BattleDef。
> 不在范围：同伴 NPC 美术资源（待补，先用 traveller 占位）、prop 人物美术（待补，先用 traveller 占位）、bard 现有 action 字符串迁移（留下一章处理）、第一章另两场景的 intro/outro（不做）。

---

## 0. 决策清单（已拍板）

| 项 | 决策 |
|----|------|
| 同伴 NPC | 新做 archetype `npc_companion`，资源待补，先用 traveller atlas 占位 |
| 拾取道具 | dagger 占位（复用现有 itemDef） |
| 同伴动画 | 至少 idle + walk（资源待补，先用 traveller 的 idle 凑合，walk 缺失时回退 idle） |
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
- traveller atlas 只有 idle/greeting/ask 三 clip（[createNpcCharacter](file:///e:/se/BlindDuel/scripts/CharacterFactory.js#L218)）
- 无 walk 动画，跟随态先用 idle 滑动凑合（视觉妥协，待美术补 walk）

### 1.7 BattleMode onVictory 链路（已确认就绪）
- [BattleMode.#checkBattleEnd](file:///e:/se/BlindDuel/scripts/Systems/Modes/BattleMode.js#L139-153) 已支持 `onVictory.scenario` / `onVictory.flags` / `onVictory.questStages`
- BattleDef 只需配对字段，无需改 BattleMode

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
  "condition": { "quest": "prologue_dagger", "stage": 1, "hasItem": "dagger" },
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

### Step 1：ScenarioMilestones 补充中间值
- **文件**：[Data/ScenarioMilestones.js](file:///e:/se/BlindDuel/Data/ScenarioMilestones.js)
- **改动**：增加 `PROLOGUE_TRAVELER_JOIN: 105`
- **影响**：无

### Step 2：场景切换 fade 包裹 + intro/outro 钩子
- **文件**：[scripts/Scene.js](file:///e:/se/BlindDuel/scripts/Scene.js)
- **改动**：
  - 新增 `requestSceneSwitch(sceneDef, spawnId)`：若有 outroSequence 则 play（末段叠 fade-out），await 播完；无则直接 enqueueEffect(fade-out) + 等
  - `_loadScene` 改 async：`等 fade-out → dispose+init → 若有 introSequence 则 play（首步自带 fade-in）；无则 enqueueEffect(fade-in)`
  - `_fadeOutMs` / `_fadeInMs` 从 sceneDef.transition 读，默认 400/600
  - intro/outro 时序：outro 末段（最后 fadeOutMs）叠 fade-out；intro 首步 = fade-in 渐显与走位叠播
- **风险**：
  - `_loading` 期间 updateRender return，fade-in 的 fx 对象 elapsedMs 不推进——但 CSS transition 仍走，视觉能播完。fx 残留无害
  - outroSequence 在旧 scene 上播，需保证 dispose 在 outro + fade-out 都完成后才调
  - `_loadScene` 改 async 后，`fixedUpdate` 里的 `_pendingSceneLoad` 消费要适配（标记 loading 后 await，期间 fixedUpdate 跳过）
  - outro 与 fade-out 叠播要求 outro 总时长 > fade-out 时长，配置时注意

### Step 3：ExploreMode sceneSwitch trigger 接 outro + clamp 旁路 + 播片优先
- **文件**：[scripts/Systems/Modes/ExploreMode.js](file:///e:/se/BlindDuel/scripts/Systems/Modes/ExploreMode.js)
- **改动**：
  - `#updateSceneSwitchTrigger`：trigger 命中 + 交互键后，改调 `scene.requestSceneSwitch(targetDef, spawnId)`（不直接赋 `_pendingSceneLoad`）
  - `fixedUpdate`：`if (sceneSequencer.isBusy())` 跳过 `_collisionSystem.resolveMovement`（clamp 旁路，moveActorTo 直接改 root.position 不查 blocker）
  - `fixedUpdate`：`if (sceneSequencer.isBusy())` 跳过 companion 的 `npcController.update`（播片优先，避免 following 与 moveActorTo 冲突）
- **风险**：clamp 旁路期间 hero 可走出 walkarea——intro/outro 期间这是预期行为；正常探索期间 sequence 不 busy，无影响

### Step 4：QuestManager 数据化 directives
- **文件**：[scripts/Systems/QuestManager.js](file:///e:/se/BlindDuel/scripts/Systems/QuestManager.js)
- **改动**：
  - 新增 `executeDirectives(directives)`（见 §2.7）
  - 保留 `executeAction(actionName)` 兼容 bard 旧路径
- **文件**：[scripts/Systems/NpcController.js](file:///e:/se/BlindDuel/scripts/Systems/NpcController.js)
- **改动**：`_triggerAction` 兼容字符串（旧，调 executeAction）和数组（新，调 executeDirectives）两种格式
- **风险**：bard 仍走旧路径，下一章迁移

### Step 5：同伴 NPC（npc_companion）+ 跟随行为
- **新增**：[CharacterFactory.js](file:///e:/se/BlindDuel/scripts/CharacterFactory.js) 加 `createCompanionNpc`，先用 traveller atlas 占位（idle + walk 缺失时回退 idle）
- **新增 archetype**：`npc_companion` 进 `ARCHETYPE_FACTORY`
- **改动**：[NpcController.js](file:///e:/se/BlindDuel/scripts/Systems/NpcController.js) 加 `following` 状态：
  - 进入方式：由 sequence 末尾 callback 显式调 `npcController.enterFollowing()`（不靠 NpcController 自己判 scenario）
  - 行为：每帧算与 hero 距离，> 2.5 朝 hero 右侧 offset 1.0 走（速度 1.1），<= 1.5 归零
  - 战斗期间（context.modeId === "battle"）切 idle、停 setMoveIntent
  - sequence busy 期间 ExploreMode 跳过 update（见 Step 3），following 不冲突
- **改动**：[ExploreMode.js](file:///e:/se/BlindDuel/scripts/Systems/Modes/ExploreMode.js) `_buildIndices`：companion 进 `interactables`（可交 dagger）但不进 `staticBlockers`（blocksMovement=false）
- **改动**：[Data/NpcDefs.js](file:///e:/se/BlindDuel/Data/NpcDefs.js) 加 companion 定义（dialogue 结构同 bard，action 用指令数组）：
  - condition: quest=prologue_dagger stage=1 hasItem=dagger → 接收 dagger，action=[removeItem(dagger), advanceScenario(105)]
  - condition: scenario>=105 → 空对话或简短回应
  - condition: {} → 派任务 startQuest(prologue_dagger)
- **风险**：traveller 无 walk atlas，跟随态视觉是 idle 滑动——待美术补

### Step 6：PropEntity + prop 演出 sequence
- **新增**：[scripts/Enties/PropEntity.js](file:///e:/se/BlindDuel/scripts/Enties/PropEntity.js)（见 §2.4）
- **新增 archetype**：`npc_prop` 进 `ARCHETYPE_FACTORY`，工厂调 `new PropEntity(scene, config)`
- **改动**：[SceneSequencer.js](file:///e:/se/BlindDuel/scripts/Systems/SceneSequencer.js) CALLBACK step 支持按字符串名查 handler：
  - sharedContext 新增 `sequenceHandlers: Map<string, Function>`
  - CALLBACK step：若 `step.fn` 是字符串，从 `context.sequenceHandlers.get(step.fn)` 查；是函数则直接调
  - ExploreMode 注册 handler：`disposeProp` / `showCompanionBubble` / `hideCompanionBubble` / `enterCompanionFollowing` / `triggerSceneSwitch`
- **新增**：prop 演出 sequence（见 §2.6），由 ExploreMode 检测 scenario===105 且 flag `prologue_prop_played` 未置位时触发，触发后立即 setFlag
- **风险**：prop 资源待补，下落+跑动画先用 traveller idle 占位，视觉是"传送+滑动"

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

### Step 1-3 完成后
- [ ] scenario=105 常量存在
- [ ] 切场景时画面 fade-out → 黑屏 → fade-in，无闪烁
- [ ] prologue 加 introSequence 后，进场景自动播 intro，hero 锁定
- [ ] intro 期间 hero 不被 walkArea clamp
- [ ] sceneSwitch trigger 命中后播 outro（末段叠 fade-out），outro 末尾自动切场景

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

- **批次 A（基础设施）**：Step 1 + Step 2 + Step 3
  - 先跑通 fade 包裹 + intro/outro 钩子 + clamp 旁路，prologue 加个最小 introSequence（纯 fade-in + letterbox）验证
- **批次 B（任务系统数据化）**：Step 4
  - QuestManager.executeDirectives + NpcController 兼容，单独验证 bard 不破
- **批次 C（同伴 + prop 演出）**：Step 5 + Step 6
  - companion 驻留 + 派/交任务 + prop 演出 + 气泡 + 切跟随，整条 sequence 串通
- **批次 D（战斗 + 配置落地）**：Step 7 + Step 8
  - BattleDef + prologue.json 完整配置，端到端跑通
- **批次 E（回归）**：Step 9
  - 第一章三场景 fade-only 验证

每批次结束做一次手动验证再进下一批，避免问题堆积。

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