# 任务编写指南（Quest Authoring Guide）

> 基于 prologue 的 dagger 任务（静止 NPC）和 altar_gem 任务（动态 NPC）总结的"如何添加一个交物任务"的完整流程。
> 适用：原型阶段的数据驱动任务系统（NpcDefs + QuestManager + ExploreMode + Sequence）。

---

## 0. 任务系统的核心模型

一个"交物任务"由三个数据 + 两个流程组成：

| 组成 | 文件 | 作用 |
|---|---|---|
| 物品定义 | [Data/ItemDefs.js](file:///e:/se/BlindDuel/Data/ItemDefs.js) | give 序列靠 `getItemDef(id)` 取 textureUrl，未注册则 give 序列直接 return |
| 拾取物 | [Data/SceneDefs/*.json](file:///e:/se/BlindDuel/Data/SceneDefs) | 场景里的可拾取实体，内联 `itemDef`（不查 ItemDefs） |
| NPC 对话 | [Data/NpcDefs.js](file:///e:/se/BlindDuel/Data/NpcDefs.js) | 按 priority 排序的 dialogue 数组，条件驱动分支 |
| 任务逻辑 | [scripts/Systems/QuestManager.js](file:///e:/se/BlindDuel/scripts/Systems/QuestManager.js) | scenario/quest/flag/inventory 的唯一写入入口 |
| 交物演出 | [scripts/Systems/Modes/ExploreMode.js](file:///e:/se/BlindDuel/scripts/Systems/Modes/ExploreMode.js) | `_startGiveSequence` + `#updateGiveSequence` 驱动 give 动画 + 气泡 + action 执行 |

**关键认知**：交物任务不是"自动播完气泡就给"，而是分两种路径：

- **有 giveItem 的 dialogue**：`enterGreeting` 只设 `_needsInteract=true` 然后直接 return（不走气泡计时），**等玩家按交互键（J/手柄X）才触发 `_startGiveSequence`**。
- **无 giveItem 的 dialogue**：走气泡计时（默认 3 秒）→ 计时结束 `_triggerAction` 执行 action → `_checkPendingGive` 重查 giveItem（用于"先派任务、同一次 greeting 气泡结束后无缝衔接交物"）。

---

## 1. 基准案例：dagger 任务（静止 NPC bard）

### 1.1 完整链路
```
玩家靠近 bard（greetingRadius 内，首次）
→ NpcController.update 检测 inGreetingRange && !hasGreetedInRange
→ enterGreeting() → resolve() 命中 priority 0（无 giveItem）
→ state=greeting, 气泡显示 "🗡️", _activeAction="startDaggerQuest"
→ hasGreetedInRange=true

气泡计时 3 秒
→ _triggerAction() → questManager.executeAction("startDaggerQuest")
→ startQuest("dagger") → world.quests.dagger = {stage:1, completed:false}
→ _checkPendingGive() → resolve() 此时手里没 dagger，命中 priority 0（无 giveItem）
→ enterIdle()

玩家捡起 dagger（ExploreMode pickup 链路，itemDef 内联在 SceneDef）

玩家再靠近 bard
→ hasGreetedInRange 因离开已重置为 false
→ enterGreeting() → resolve() 命中 priority 90（有 giveItem=dagger）
→ _needsInteract=true, _pendingGiveItem="dagger", _pendingAction="completeDaggerQuest"
→ state=greeting（但走 giveItem 分支，不显示气泡，不等计时）
→ return

玩家按 J
→ ExploreMode.#checkInteraction → 遍历 interactables，找到 bard._needsInteract=true
→ _startGiveSequence()
→ getItemDef("dagger") 取 textureUrl（必须已注册）
→ 建 give item plane 挂 hero.root
→ hero.enterState("give")

give 动画播完（currentStateName !== "give"）
→ #updateGiveSequence phase=bubble1 → 气泡 "👍" 2 秒
→ phase=bubble2 → 气泡 "👋👊" 2 秒
→ 执行 _pendingAction → executeAction("completeDaggerQuest")
→ inventory.removeItem("dagger") → completeQuest("dagger")
→ 清理 _needsInteract / plane / _pending*

### 1.2 数据配置（bard）

[Data/NpcDefs.js](file:///e:/se/BlindDuel/Data/NpcDefs.js)：
```js
bard: {
    id: "bard",
    name: "吟游诗人",
    idle: { clip: "Play" },
    dialogues: [
        {
            priority: 100,
            condition: { quest: "dagger", completed: true },
            text: "👋👊",                    // 完成后闲聊
        },
        {
            priority: 90,
            condition: { quest: "dagger", stage: 1, hasItem: "dagger" },
            text: "👍",
            action: "completeDaggerQuest",   // 旧式字符串 action
            giveItem: "dagger",              // 触发 give 动画序列
        },
        {
            priority: 0,
            condition: {},                   // 默认分支
            text: "🗡️",
            action: "startDaggerQuest",      // 派任务
        },
    ],
},
```

[Data/ItemDefs.js](file:///e:/se/BlindDuel/Data/ItemDefs.js)：
```js
dagger: {
    id: "dagger",
    name: "匕首",
    consumeType: "pocket",
    atlasKey: "dagger",
    textureUrl: "./Art/Sprite/items/dagger.png",
},
```

拾取物在 SceneDef 里（内联 itemDef，不查 ItemDefs）：
```jsonc
{
    "archetype": "pickable",
    "id": "dagger_01",
    "kind": "pickable",
    "pos": [...],
    "itemDef": {
        "id": "dagger",
        "name": "匕首",
        "consumeType": "pocket",
        "atlasKey": "dagger",
        "textureUrl": "./Art/Sprite/items/dagger.png"
    }
}
```

### 1.3 旧式 action vs 新式 directives

bard 用旧式字符串 action（`"startDaggerQuest"`），需要在 [QuestManager](file:///e:/se/BlindDuel/scripts/Systems/QuestManager.js) 写对应方法：
```js
startDaggerQuest() { this.startQuest("dagger"); }
completeDaggerQuest() { this.inventory.removeItem("dagger"); this.completeQuest("dagger"); }
```

新任务**推荐用 directives 数组**（无需写 QuestManager 方法）：
```js
action: [
    { type: "removeItem", item: "dagger" },
    { type: "completeQuest", id: "dagger" }
]
```

支持的 directive type 见 [QuestManager.executeDirectives](file:///e:/se/BlindDuel/scripts/Systems/QuestManager.js)：`advanceScenario` / `setScenario` / `setFlag` / `clearFlag` / `startQuest` / `setQuestStage` / `completeQuest` / `removeItem` / `addItem`。

---

## 2. 对照案例：altar_gem 任务（动态 NPC Charlotte）

### 2.1 与 dagger 的差异

Charlotte 是同伴 NPC，会经历 `idle → following` 状态转换（由 sequence callback 驱动）。配置上几乎一致，但有**一个关键设计限制**。

[Data/NpcDefs.js](file:///e:/se/BlindDuel/Data/NpcDefs.js)：
```js
companion: {
    id: "companion",
    name: "Charlotte",
    idle: { clip: "observe" },
    dialogues: [
        {
            priority: 100,
            condition: { scenarioMin: 105 },
            text: "👍"
        },
        {
            priority: 90,
            condition: { quest: "prologue_pickup_quest", stage: 1, hasItem: "altar_gem" },
            text: "👍",
            giveItem: "altar_gem",
            action: [
                { type: "removeItem", item: "altar_gem" },
                { type: "advanceScenario", value: 105 }
            ],
        },
        {
            priority: 0,
            condition: {},
            text: "🗡️",
            action: [{ type: "startQuest", id: "prologue_pickup_quest" }]
        }
    ]
},
```

### 2.2 ⚠️ 设计限制：任务物品不要放在交付 NPC 的 greetingRadius 内

**症状**：如果玩家能在不离开 NPC greetingRadius 的情况下捡到任务物品并折返，交物会失败（按 J 无反应）。

**根因**：
1. 玩家首次靠近 NPC → `enterGreeting`（priority 0，派任务）→ `hasGreetedInRange=true`
2. greeting 气泡计时期间，若 NPC 是动态的（如 Charlotte），其 state 可能被 sequence callback（如 `enterCompanionIdle`）设回 idle，**打断 greeting 计时**
3. greeting 计时没跑完 → `_triggerAction` 不触发 → `_checkPendingGive` 不触发 → `needsInteract` 永远 false
4. `hasGreetedInRange=true` 不重置（没出范围）→ 不再 `enterGreeting`
5. 即便捡了物品回来，也不会重新 resolve → 按 J 无反应

**规避**：任务物品的拾取点必须离交付 NPC 足够远，确保玩家**必然离开 greetingRadius 再回来**。这样 `hasGreetedInRange` 会重置，重新 `enterGreeting` 时会以最新 WorldState resolve，命中 priority 90。

**逻辑上的合理性**：任务物品和交付点放得太近本身就不合理（玩家没机会"接到任务"就完成了）。dagger 任务天然满足（dagger 在远处，bard 在酒馆）。

### 2.3 动态 NPC 的状态转换时机

Charlotte 的 idle↔following 转换由 sequence callback 驱动，不在 NpcController 自己判 scenario：

- **intro 播完进 idle**：[prologue_intro.json](file:///e:/se/BlindDuel/Data/Sequences/prologue_intro.json) 的 `enterCompanionIdle` callback（atMs 3600）→ [ExploreMode.#handleEnterCompanionIdle](file:///e:/se/BlindDuel/scripts/Systems/Modes/ExploreMode.js)
- **交物后进 following**：[prologue_cs_rabble_flee.json](file:///e:/se/BlindDuel/Data/Sequences/prologue_cs_rabble_flee.json) 的 `enterCompanionFollowing` callback（atMs 6400）→ [ExploreMode.#handleEnterCompanionFollowing](file:///e:/se/BlindDuel/scripts/Systems/Modes/ExploreMode.js)

**关键**：交物任务必须在 NPC 进 following **之前**完成。一旦进 following，`NpcController.update` 会早退（`_behavior` 非空），greeting 逻辑完全不跑。

---

## 3. 添加一个新交物任务的 Checklist

以"给 NPC X 交物品 Y"为例：

### 3.1 资源准备
- [ ] 物品贴图：`Art/Sprite/items/Y.png` + `Y.json`（atlas，参照 [dagger.json](file:///e:/se/BlindDuel/Art/Sprite/items/dagger.json)）
- [ ] 在 [scripts/AssetManifest.js](file:///e:/se/BlindDuel/scripts/AssetManifest.js) 的 `items` 注册 atlas 路径
- [ ] NPC 的 give 动画：hero stateGraph 必须有 `give` 态（[LongSwordMan.json](file:///e:/se/BlindDuel/Data/StateGraphDef/LongSwordMan.json)），否则 `_startGiveSequence` 调 `enterState("give")` 无效

### 3.2 数据配置
- [ ] [Data/ItemDefs.js](file:///e:/se/BlindDuel/Data/ItemDefs.js) 注册 Y（**必须**，否则 give 序列 `getItemDef` 返回 null 直接 return）
- [ ] [Data/SceneDefs/你的场景.json](file:///e:/se/BlindDuel/Data/SceneDefs) 加 pickable 实体（内联 itemDef）
- [ ] [Data/NpcDefs.js](file:///e:/se/BlindDuel/Data/NpcDefs.js) 在目标 NPC 的 dialogues 加三条：
  - priority 100：完成后闲聊（condition: quest completed / scenarioMin）
  - priority 90：交物分支（condition: quest stage + hasItem，giveItem: Y，action: directives 数组）
  - priority 0：派任务分支（condition: {}，action: startQuest）
- [ ] 若任务推进 scenario，在 [Data/ScenarioMilestones.js](file:///e:/se/BlindDuel/Data/ScenarioMilestones.js) 加里程碑常量

### 3.3 布局约束
- [ ] **任务物品拾取点离交付 NPC 至少 > greetingRadius（默认 1.6）+ 缓冲**，确保玩家必离开范围
- [ ] 若交付 NPC 是动态的（会进 following），确保交物在进 following 之前

### 3.4 action 写法选择
- 新任务**一律用 directives 数组**（`action: [{type:..., ...}]`），不要在 QuestManager 加方法
- 仅当 action 逻辑复杂（多步、有条件分支）才考虑写 QuestManager 方法 + 旧式字符串 action

### 3.5 验证
- [ ] 首次靠近 NPC：气泡显示派任务文案，3 秒后气泡消失，quest 启动
- [ ] 捡物品：物品进背包（[InventoryBar](file:///e:/se/BlindDuel/scripts/UI/InventoryBar.js) 显示）
- [ ] 离开 NPC 范围再回来：气泡不显示（直接进 giveItem 待交互态）或显示交物文案
- [ ] 按 J：hero 播 give 动画，物品 sprite 出现在 hero 手部 anchor，2 秒气泡 + 2 秒气泡，物品从背包移除，scenario/quest 推进
- [ ] 再次靠近：显示完成闲聊文案

---

## 4. 常见坑

| 现象 | 原因 | 解决 |
|---|---|---|
| 按 J 无反应 | NPC `_needsInteract=false` | 确认 priority 90 的 condition 真的命中（quest.stage、hasItem）；确认走过一次范围外 |
| give 动画不播 | hero stateGraph 无 `give` 态 | 检查 [LongSwordMan.json](file:///e:/se/BlindDuel/Data/StateGraphDef/LongSwordMan.json) |
| give 序列启动但无物品 sprite | ItemDefs 未注册该物品 | 在 [Data/ItemDefs.js](file:///e:/se/BlindDuel/Data/ItemDefs.js) 加 def |
| 气泡一直显示派任务文案 | priority 90 condition 没命中 | 检查 quest 是否真启动（stage=1）、hasItem 检查的物品 id 是否和背包里一致 |
| 交物后 NPC 不进 following | sequence callback 未触发 | 检查 cutscene invoker 的 condition（[prologue.json cutsceneInvokers](file:///e:/se/BlindDuel/Data/SceneDefs/prologue.json)），scenario 是否推进到位 |
| 动态 NPC 交物失败 | 交物发生在 NPC 进 following 之后 | 调整 sequence 时序，确保交物在 enterFollowing 之前 |

---

## 5. 相关源码索引

| 职责 | 文件 |
|---|---|
| NPC 对话 resolve / greeting / giveItem 标记 | [NpcController.js](file:///e:/se/BlindDuel/scripts/Systems/NpcController.js) |
| 交互键检测 / give 序列驱动 | [ExploreMode.js](file:///e:/se/BlindDuel/scripts/Systems/Modes/ExploreMode.js) |
| scenario/quest/flag/inventory 写入 | [QuestManager.js](file:///e:/se/BlindDuel/scripts/Systems/QuestManager.js) |
| 世界状态（观察者模式） | [WorldState.js](file:///e:/se/BlindDuel/scripts/WorldState.js) |
| 物品定义表 | [Data/ItemDefs.js](file:///e:/se/BlindDuel/Data/ItemDefs.js) |
| NPC 对话定义 | [Data/NpcDefs.js](file:///e:/se/BlindDuel/Data/NpcDefs.js) |
| 场景拾取物定义 | [Data/SceneDefs/*.json](file:///e:/se/BlindDuel/Data/SceneDefs) |
| 资源清单 | [scripts/AssetManifest.js](file:///e:/se/BlindDuel/scripts/AssetManifest.js) |
| scenario 里程碑 | [Data/ScenarioMilestones.js](file:///e:/se/BlindDuel/Data/ScenarioMilestones.js) |
| sequence callback handler | [ExploreMode._registerSequenceHandlers](file:///e:/se/BlindDuel/scripts/Systems/Modes/ExploreMode.js) |