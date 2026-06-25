# WorldState 扩展 + 场景切换 实现计划

> 参考：`NPC-Quest-WorldState 概要设计.md`、`Quest&Pickables.MD`

## 设计原则

**两层进度语义**：

```
scenario（粗粒度主线锚点）    flag（细粒度开关）
─────────────────────────    ───────────────────
Chapter1Start = 100          banditDead
Battle1Completed = 110       gateOpened
Battle2Completed = 120       metBlacksmith
Chapter1BossCompleted = 130
Chapter2Start = 200
```

- `scenario` 是单调递增的整数，一眼看清主线进度
- `flag` 控制具体事件，可以任意组合
- 日常逻辑用 `scenarioMin` / `scenarioMax` 判断，不查 sceneStates
- `sceneStates` 退居为纯持久化存储（存档用），不在运行时做判断

**为什么"某个东西没出现"一目了然**：

```
enemy_1.spawnIf: { scenarioMax: 109 }   → "scenario >= 110 我就不生成了"
exit_house.condition: { scenarioMin: 110 } → "scenario >= 110 我才激活"
```

---

## 写入权限

**QuestManager 是 WorldState 的唯一写入者**。所有系统通过 QuestManager 报告"发生了什么"，不直接决定"这会导致什么"。

```
BattleMode  NpcController  ExploreMode(pickup/give)
     │            │                │
     ▼            ▼                ▼
        QuestManager（唯一入口）
     │       │        │
     ▼       ▼        ▼
  scenario  flags   quests
```

| 系统 | 调什么 | 触发时机 |
|------|--------|---------|
| BattleMode | `questManager.advanceTo(v.scenario)` | 战斗胜利，读 `battleDef.onVictory.scenario` |
| BattleMode | `questManager.setFlag(flag, true)` | 战斗胜利，读 `battleDef.onVictory.flags` |
| NpcController | `questManager.executeAction(actionName)` | 对话结束，读 NpcDefs 的 `action` 字段 |
| ExploreMode | `questManager.setQuestStage()` / `setFlag()` | 拾取/give 序列 |

NpcDefs 的 `action` 目前只支持 QuestManager 上的无参方法。如果后续需要对话推进 scenario，在 QuestManager 上为每个 milestone 加一个便捷方法即可：

```js
advanceToBattle1Completed() {
    this.advanceTo(SCENARIO.BATTLE_1_COMPLETED);
}
```

---

## 当前状态

| 模块 | 状态 |
|------|------|
| WorldState（scenario / flags / quests） | 已有 |
| QuestManager（修改 WorldState） | 已有 |
| NpcController.resolve() | 已有 |
| 对话气泡 + action 触发 | 已有 |
| Pickable 拾取 + 背包 | 已有 |
| give 交任务序列 | 已有 |
| AABBTrigger（battle / sceneSwitch / scriptedCamera） | 已有 |
| **ScenarioMilestones 定义** | 缺失 |
| **WorldState.sceneStates**（持久化用） | 缺失 |
| **战斗胜利 → 改 scenario + flags** | 缺失 |
| **Entity spawnIf 过滤** | 缺失 |
| **Trigger condition 条件化** | 缺失 |
| **场景切换执行** | `_pendingSceneLoad` 设了但没人消费 |
| **控制台重置 WorldState** | 缺失 |

---

## 依赖关系总览

```
Step 1: ScenarioMilestones + WorldState.sceneStates + QuestManager 方法
  ├─→ Step 2: 控制台重置
  ├─→ Step 3: BattleMode 胜利回写（scenario + flags）
  └─→ Step 4: Entity spawnIf 过滤
          │
          └─→ Step 5: AABBTrigger enabled（独立）
                  │
                  └─→ Step 6: triggerDef condition + ExploreMode syncEnabled
                          │
                          └─→ Step 7: Scene._loadScene + spawns
                                  │
                                  └─→ Step 8: 端到端验证
```

---

## Step 1：ScenarioMilestones + sceneStates + QuestManager 方法

**依赖**：无

### 1.1 ScenarioMilestones 定义

**文件**：`Data/ScenarioMilestones.js`（新建）

```js
export const SCENARIO = {
    CHAPTER_1_START: 100,
    BATTLE_1_COMPLETED: 110,   // 酒馆 bandit 击败
    BATTLE_2_COMPLETED: 120,   // 预留
    CHAPTER_1_BOSS_COMPLETED: 130,
    CHAPTER_2_START: 200,
};
```

### 1.2 WorldState 加 sceneStates（持久化用）

**文件**：`scripts/WorldState.js`

```js
// 新增 sceneStates 字段（纯持久化用，不在运行时逻辑中判断）
this.sceneStates = {};

ensureScene(sceneId) {
    if (!this.sceneStates[sceneId]) {
        this.sceneStates[sceneId] = { encounters: {}, pickables: {} };
    }
    return this.sceneStates[sceneId];
}
```

### 1.3 QuestManager 加方法

**文件**：`scripts/Systems/QuestManager.js`

```js
// scenario 推进
advanceTo(milestone) {
    if (milestone > this.world.scenario) {
        this.world.scenario = milestone;
    }
}

// sceneStates 持久化（存档用，日常逻辑不查这些）
markEncounterDefeated(sceneId, encounterId) {
    this.world.ensureScene(sceneId).encounters[encounterId] = true;
}

isEncounterDefeated(sceneId, encounterId) {
    return !!this.world.sceneStates[sceneId]?.encounters[encounterId];
}

markPickableCollected(sceneId, pickableId) {
    this.world.ensureScene(sceneId).pickables[pickableId] = true;
}

isPickableCollected(sceneId, pickableId) {
    return !!this.world.sceneStates[sceneId]?.pickables[pickableId];
}
```

### 验证

- 控制台 `window.game.questManager.advanceTo(110)` → `worldState.scenario === 110`
- 控制台 `window.game.questManager.markEncounterDefeated("test", "bt_1")` → `sceneStates.test.encounters.bt_1 === true`

---

## Step 2：控制台重置 WorldState

**依赖**：Step 1

### 文件：`scripts/Game.js`

```js
import { SCENARIO } from "../Data/ScenarioMilestones.js";

resetWorldState() {
    this.worldState.scenario = SCENARIO.CHAPTER_1_START;
    this.worldState.flags = {};
    this.worldState.quests = {};
    this.worldState.sceneStates = {};
    console.log('[Game] WorldState reset to scenario', this.worldState.scenario);
}
```

### 文件：`character_demo.js`

```js
import { SCENARIO } from "./Data/ScenarioMilestones.js";
window.resetWorldState = () => game.resetWorldState();
window.SCENARIO = SCENARIO;  // 方便控制台查看
```

### 验证

- 控制台 `resetWorldState()` → scenario 回到 100，flags/quests/sceneStates 清空

---

## Step 3：BattleMode 胜利回写（scenario + flags）

**依赖**：Step 1（QuestManager 方法）

### 文件：`scripts/Systems/Modes/BattleMode.js`

在 `#checkBattleEnd` 中，`exitSequence` 播放前加：

```js
const { questManager } = this.context;
if (questManager && this._battleDef?.onVictory) {
    const v = this._battleDef.onVictory;
    if (v.scenario) questManager.advanceTo(v.scenario);
    for (const flag of v.flags ?? []) {
        questManager.setFlag(flag, true);
    }
    for (const q of v.questStages ?? []) {
        questManager.setQuestStage(q.id, q.stage);
    }
}
```

### 文件：`scripts/SceneDefs.js` — battleDef 加 `onVictory`

```js
import { SCENARIO } from "../Data/ScenarioMilestones.js";

// battle_field_2 加 onVictory
onVictory: {
    scenario: SCENARIO.BATTLE_1_COMPLETED,
    flags: ["banditDead"],
    questStages: [{ id: "dagger", stage: 2 }],
},
```

### 验证

- 进酒馆触发战斗 → 打赢 → 控制台 `window.game.worldState.scenario === 110`
- `window.game.worldState.flags.banditDead === true`

---

## Step 4：Entity spawnIf 过滤

**依赖**：Step 1（scenario 体系）

不再用 `beatOnce`。entityDef 统一用 `spawnIf` 条件，和 trigger 的 `condition` 同格式。Scene.init 遍历 entities 时评估 `spawnIf`。

### 4.1 entityDef 加 spawnIf

**文件**：`scripts/SceneDefs.js`

```js
// HOUSE_INTERIOR 的 enemy_1：scenario >= 110 后不再生成
{
    archetype: "rabble_stick",
    id: "enemy_1",
    name: "rabble_stick",
    kind: "enemy",
    spawnIf: { scenarioMax: 109 },  // scenario < 110 时才生成
    pos: [2.47, -4.90],
    controller: "dummy",
},
```

### 4.2 Scene.init 统一条件评估

**文件**：`scripts/Scene.js`

```js
// 提取条件评估为独立方法，Entity 和 Trigger 共用
_evaluateCondition(cond, worldState) {
    if (!cond || Object.keys(cond).length === 0) return true;
    if (cond.flag !== undefined && !worldState.flags[cond.flag]) return false;
    if (cond.scenario !== undefined && worldState.scenario !== cond.scenario) return false;
    if (cond.scenarioMin !== undefined && worldState.scenario < cond.scenarioMin) return false;
    if (cond.scenarioMax !== undefined && worldState.scenario > cond.scenarioMax) return false;
    if (cond.quest !== undefined) {
        const q = worldState.getQuest(cond.quest);
        if (cond.stage !== undefined && q.stage !== cond.stage) return false;
        if (cond.completed !== undefined && q.completed !== cond.completed) return false;
    }
    return true;
}

// init 中实体创建循环
for (const entityDef of sceneDef.entities) {
    if (!this._evaluateCondition(entityDef.spawnIf, this.worldState)) {
        continue;
    }
    const entity = createEntityFromDef(this.scene, assets, entityDef);
    // ... 现有代码 ...
}
```

### 验证

- 控制台 `questManager.advanceTo(110)` → 切场景再回来 → enemy_1 不在 entityPool 中
- 控制台 `resetWorldState()` → 切场景 → enemy_1 重新出现

---

## Step 5：AABBTrigger 加 enabled

**依赖**：无

### 文件：`scripts/Enties/AABBTrigger.js`

```js
constructor(scene, position, size, options = {}) {
    // ... 现有代码 ...
    this._enabled = options.enabled ?? true;
}

setEnabled(value) {
    this._enabled = value;
    if (!value) this.triggered = false;  // 禁用时重置，防止重新启用后立即触发
}

check(entity) {
    if (!this._enabled) return false;  // 新增
    if (this.triggered) return false;
    // ... 现有碰撞检测 ...
}
```

### 验证

- 控制台 `scene.triggers.get("bt_field_2").setEnabled(false)` → 走近战斗区域不触发

---

## Step 6：triggerDef condition + ExploreMode syncEnabled

**依赖**：Step 1（scenario + flags）、Step 3（战斗回写）、Step 5（AABBTrigger enabled）

### 6.1 triggerDef 加 condition

**文件**：`scripts/SceneDefs.js`

```js
// exit_house：scenario >= 110 后才激活
{
    type: "sceneSwitch",
    id: "exit_house",
    pos: [0, -1, 0],
    size: [2, 2, 2],
    targetScene: "outdoor_village",
    targetSpawn: "house_door",
    condition: { scenarioMin: 110 },
},
```

### 6.2 ExploreMode 每帧同步 trigger enabled

**文件**：`scripts/Systems/Modes/ExploreMode.js`

在 `fixedUpdate` 开头加 `this.#syncTriggerEnabled()`：

```js
#syncTriggerEnabled() {
    const { sceneDef, worldState, scene } = this.context;
    if (!sceneDef?.triggers || !worldState || !scene?.triggers) return;

    for (const triggerDef of sceneDef.triggers) {
        const trigger = scene.triggers.get(triggerDef.id);
        if (!trigger) continue;

        const enabled = scene._evaluateCondition(triggerDef.condition, worldState);
        trigger.setEnabled(enabled);
    }
}
```

> 注意：条件评估复用 `Scene._evaluateCondition`，不重复实现。

### 验证

- 初始 scenario=100：走到门口没反应（`exit_house` condition `scenarioMin: 110` 不满足）
- 打赢战斗 scenario=110：走到门口 → trigger 激活 → 触发场景切换
- 打赢后走近战斗区域 → 战斗不再触发（trigger 的 condition 评估 `scenarioMax` 或 `flag`）

---

## Step 7：场景切换落地

**依赖**：Step 6（trigger 条件化）、Step 4（entity spawnIf 过滤）

### 7.1 Scene._loadScene + 保存 battleDefs

**文件**：`scripts/Scene.js`

```js
// init 中保存 battleDefs
async init(sceneDef, battleDefs = {}) {
    this._battleDefs = battleDefs;
    // ... 现有代码 ...
}

// fixedUpdate 中消费 _pendingSceneLoad
fixedUpdate(dtMs, tickCount) {
    this.tickCount = tickCount;
    if (this.paused) return;

    if (this._pendingSceneLoad) {
        const { sceneDef, spawnId } = this._pendingSceneLoad;
        this._pendingSceneLoad = null;
        this._loadScene(sceneDef, spawnId);
        return;
    }

    this.sceneSequencer.fixedUpdate(dtMs, tickCount);
    this.gameModeManager.fixedUpdate(dtMs, tickCount);
}

async _loadScene(sceneDef, spawnId) {
    const hero = this.entityPool.find(e => e.id === "hero");
    const savedHp = hero?.hp ?? 3;

    this.dispose();
    await this.init(sceneDef, this._battleDefs);

    const newHero = this.entityPool.find(e => e.id === "hero");
    if (newHero) {
        newHero.hp = savedHp;
    }

    const spawnPoint = sceneDef.spawns?.[spawnId];
    if (spawnPoint && newHero) {
        newHero.root.position.set(spawnPoint[0], spawnPoint[1], spawnPoint[2] ?? 0);
    }
}
```

### 7.2 SceneDef 加 spawns + 双向 trigger

**文件**：`scripts/SceneDefs.js`

```js
// HOUSE_INTERIOR
spawns: {
    house_door: [0, 2.5, 0],
},

// OUTDOOR_VILLAGE
spawns: {
    house_door: [-4, -1, 0],
},
// OUTDOOR_VILLAGE.triggers 加
{
    type: "sceneSwitch",
    id: "enter_house",
    pos: [-4, -1, 0],
    size: [2, 2, 2],
    targetScene: "HOUSE_INTERIOR",
    targetSpawn: "house_door",
},
```

### 验证

- 酒馆走到门口 → 切到户外 → hero 在 `house_door` 位置
- 户外走回门口 → 切回酒馆 → hero 在酒馆门口
- 往返切换后 HP 保持、enemy_1 不再出现

---

## Step 8：端到端验证

```
scenario = 100（初始）
    ↓
进入酒馆 → 触发战斗 bt_field_2
    ↓
打赢 → scenario = 110, flags.banditDead = true
    ↓
走近战斗区域 → 不再触发（trigger 被 condition 禁用）
    ↓
走到门口 → exit_house 因 scenarioMin: 110 激活
    ↓
切到户外场景 → hero 在 house_door
    ↓
走回酒馆 → enemy_1 不再生成（spawnIf scenarioMax: 109）
    ↓
控制台 resetWorldState() → scenario 回到 100
    ↓
enemy_1 重新生成 + 战斗重新可触发
```

---

## 调试指南

**"为什么 enemy_1 没生成？"**

```
→ 看 enemy_1.spawnIf: { scenarioMax: 109 }
→ 当前 scenario = 110
→ 110 > 109 → 不满足，不生成
```

**"为什么 exit_house 不触发？"**

```
→ 看 exit_house.condition: { scenarioMin: 110 }
→ 当前 scenario = 100
→ 100 < 110 → 不满足，禁用
```

**全局状态一览**：控制台 `window.SCENARIO` + `window.game.worldState`

---

## 不在本次范围

- 存档/读档（WorldState 序列化 → sceneStates 届时发挥作用）
- pickable 的 spawnIf 过滤（机制已就绪，后续补数据）
- 战斗失败处理
- 户外场景的 encounter 和 pickable 配置
- SceneBuilder 独立模块（当前 Scene.init 足够）