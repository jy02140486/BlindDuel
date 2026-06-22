# NPC 对话系统 — WorldState 驱动 实现设计

## 1. 目标

玩家靠近 NPC → greeting 动画 + 根据 WorldState 解析对话 → 气泡显示文本 → 超时自动消失 → 触发 action 修改 WorldState

> 注意：第一阶段完成后改为"靠近就对话"，不再需要按交互键。详见 §10.

## 2. 假设

- 单场景，但 WorldState 生命周期独立于 Scene
- 暂无双向多轮对话，只有"按交互键 → 显示一句 → 自动消失"
- 所有 WorldState 修改仅通过对话 action 触发
- 不配置对话的 NPC = 气氛组，不可交互
- 靠近气泡（greeting 时冒泡）是测试代码，本次移除

## 3. 架构变更

### 3.1 新增 Game 类

```
character_demo.js
    └── new Game(engine, canvas)
            ├── WorldState          (new)
            ├── QuestManager        (new)
            ├── InventoryManager    (从 Scene 移出)
            └── Scene               (原有，接收 worldState/questManager 引用)
```

Game 是入口层的薄封装，不参与主循环，只负责创建和持有这些长生命周期对象。

### 3.2 文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `scripts/Game.js` | **新建** | Game 类 |
| `scripts/WorldState.js` | **新建** | WorldState 数据类 |
| `scripts/Systems/QuestManager.js` | **新建** | QuestManager |
| `Data/NpcDefs.js` | **新建** | NPC 对话配置（硬编码） |
| `scripts/UI/DialogueBubble.js` | 修改 | 增加 setText() |
| `scripts/Systems/NpcController.js` | 修改 | 接入 WorldState 解析对话 |
| `scripts/Systems/Modes/ExploreMode.js` | 修改 | 交互流程调整 |
| `scripts/Scene.js` | 修改 | 接收 WorldState/QuestManager，移出 InventoryManager |
| `character_demo.js` | 修改 | 创建 Game 代替 Scene |

---

## 4. 新增模块详细设计

### 4.1 WorldState (`scripts/WorldState.js`)

纯数据类，无行为。

```js
export class WorldState {
    constructor() {
        this.scenario = 0;
        this.flags = {};
        this.quests = {};
    }

    getQuest(questId) {
        return this.quests[questId] ?? { stage: 0, completed: false };
    }
}
```

### 4.2 QuestManager (`scripts/Systems/QuestManager.js`)

只做一件事：修改 WorldState。

```js
export class QuestManager {
    constructor(worldState) {
        this.world = worldState;
    }

    setScenario(value) {
        this.world.scenario = value;
    }

    setFlag(key, value) {
        this.world.flags[key] = value;
    }

    startQuest(questId) {
        this.world.quests[questId] = { stage: 1, completed: false };
    }

    setQuestStage(questId, stage) {
        const q = this.world.quests[questId];
        if (q) q.stage = stage;
    }

    completeQuest(questId) {
        const q = this.world.quests[questId];
        if (q) {
            q.stage = q.stage + 1;
            q.completed = true;
        }
    }

    /** 执行 action 字符串，如 "completeHerbQuest" */
    executeAction(actionName) {
        if (typeof this[actionName] === "function") {
            this[actionName]();
        }
    }
}
```

### 4.3 NpcDefs (`Data/NpcDefs.js`)

参照 `Data/ItemDefs.js` 的模式。每个 NPC 按 id 索引，包含 dialogues 数组。

```js
export const NPC_DEFS = {
    npc_1: {
        id: "npc_1",
        name: "旅人",
        dialogues: [
            {
                priority: 100,
                condition: { quest: "herb", stage: 3 },
                text: "谢谢你的帮助！",
            },
            {
                priority: 90,
                condition: { quest: "herb", stage: 2 },
                text: "你找到药草了吗？",
                action: "completeHerbQuest",
            },
            {
                priority: 80,
                condition: { quest: "herb", stage: 1 },
                text: "帮我去找药草吧。",
            },
            {
                priority: 50,
                condition: { flag: "metTraveller" },
                text: "又见面了。",
            },
            {
                priority: 0,
                condition: {},
                text: "你好，旅行者。",
                action: "setMetTraveller",
            },
        ],
    },
};

export function getNpcDef(npcId) {
    return NPC_DEFS[npcId] ?? null;
}
```

**condition 匹配规则**（结构化对象）：

| condition | 含义 |
|-----------|------|
| `{}` | 总是匹配（fallback） |
| `{ quest: "herb", stage: 2 }` | `world.quests.herb.stage === 2` |
| `{ flag: "metTraveller" }` | `world.flags.metTraveller === true` |
| `{ quest: "herb", completed: true }` | `world.quests.herb.completed === true` |
| `{ scenario: 100 }` | `world.scenario === 100` |
| `{ scenarioMin: 300 }` | `world.scenario >= 300` |

**优先级**：priority 越高越优先。找到第一条匹配的即返回。

**action**：可选字符串，对应 QuestManager 上的方法名（如 `"completeHerbQuest"`、`"setMetTraveller"`）。

### 4.4 Game (`scripts/Game.js`)

```js
export class Game {
    constructor(engine, canvas) {
        this.worldState = new WorldState();
        this.questManager = new QuestManager(this.worldState);
        this.inventoryManager = new InventoryManager();
        this.scene = new Scene(engine, canvas, {
            worldState: this.worldState,
            questManager: this.questManager,
            inventoryManager: this.inventoryManager,
        });
    }

    async init(sceneDef, battleDefs) {
        await this.scene.init(sceneDef, battleDefs);
    }

    // 透传主循环方法
    fixedUpdate(dtMs, tickCount) { this.scene.fixedUpdate(dtMs, tickCount); }
    updateRender(dtMs) { this.scene.updateRender(dtMs); }
    render() { this.scene.render(); }
    onResize() { this.scene.onResize(); }
    dispose() { this.scene.dispose(); }
    togglePause() { this.scene.togglePause(); }
    toggleCameraProjection() { this.scene.toggleCameraProjection(); }
}
```

---

## 5. 修改模块详细设计

### 5.1 DialogueBubble — 增加 setText()

```diff
  show(npc) {
      this._targetNpc = npc;
      if (this._bubble) this._bubble.style.display = "block";
  }
+
+ setText(text) {
+     if (this._bubble) this._bubble.textContent = text;
+ }
```

不需要 setName，气泡内容直接用 textContent 设置文本即可。

### 5.2 NpcController — 接入 WorldState

构造函数增加 `worldState` 和 `npcDef` 参数：

```diff
- constructor(options = {}) {
+ constructor(worldState, npcDef, options = {}) {
+     this.world = worldState;
+     this.npcDef = npcDef;
      this.state = "idle";
      ...
+     this._activeText = null;       // 当前解析出的对话文本
+     this._activeAction = null;     // 当前解析出的 action
+     this._dialogueTimerMs = 0;     // 对话显示计时
+     this._dialogueDurationMs = options.dialogueDurationMs ?? 3000;
  }
```

新增 `resolve()` 方法：

```js
resolve() {
    if (!this.npcDef?.dialogues) return null;
    const sorted = [...this.npcDef.dialogues].sort((a, b) => b.priority - a.priority);
    for (const entry of sorted) {
        if (this._matchCondition(entry.condition)) {
            return entry;
        }
    }
    return null;
}

_matchCondition(cond) {
    if (!cond || Object.keys(cond).length === 0) return true;
    if (cond.quest !== undefined) {
        const q = this.world.getQuest(cond.quest);
        if (cond.stage !== undefined && q.stage !== cond.stage) return false;
        if (cond.completed !== undefined && q.completed !== cond.completed) return false;
    }
    if (cond.flag !== undefined && !this.world.flags[cond.flag]) return false;
    if (cond.scenario !== undefined && this.world.scenario !== cond.scenario) return false;
    if (cond.scenarioMin !== undefined && this.world.scenario < cond.scenarioMin) return false;
    return true;
}
```

`enterAsk` 改为触发对话解析：

```diff
  enterAsk(npc, dialogueBubble) {
      this.state = "ask";
      this.stateElapsedMs = 0;
+     this._dialogueTimerMs = 0;
+     const entry = this.resolve();
+     if (entry) {
+         this._activeText = entry.text;
+         this._activeAction = entry.action ?? null;
+         if (dialogueBubble) {
+             dialogueBubble.setText(entry.text);
+             dialogueBubble.show(npc);
+         }
+     }
      if (npc.hasState("ask")) {
          npc.enterState("ask");
      }
  }
```

`update` 中增加对话超时处理：

```diff
  if (this.state === "ask") {
      this.stateElapsedMs += dtMs;
+     this._dialogueTimerMs += dtMs;
+     if (this._dialogueTimerMs >= this._dialogueDurationMs) {
+         // 触发 action 后回到 idle
+         this._triggerAction(context.questManager);
+         this.enterIdle(npc);
+         return;
+     }
      if (this.stateElapsedMs >= this.askDurationMs) {
          ...
      }
  }
```

新增 `_triggerAction`：

```js
_triggerAction(questManager) {
    if (this._activeAction && questManager) {
        questManager.executeAction(this._activeAction);
    }
    this._activeText = null;
    this._activeAction = null;
}
```

**移除** `greeting` 状态下的气泡逻辑（气泡由 ExploreMode 的 `#updateDialogueBubble` 控制，该函数会被修改）。

### 5.3 ExploreMode — 交互流程调整

**`#updateDialogueBubble`**：只对 `ask` 状态显示气泡（greeting 不再显示气泡）：

```diff
  #updateDialogueBubble() {
      const { dialogueBubble } = this.context;
      if (!dialogueBubble) return;

      for (const npc of this.interactables) {
          const controller = npc.npcController;
-         if (controller && (controller.state === "greeting" || controller.state === "ask")) {
+         if (controller && controller.state === "ask") {
              dialogueBubble.show(npc);
              return;
          }
      }
      dialogueBubble.hide();
  }
```

**`#checkInteraction`**：`enterAsk` 时传入 dialogueBubble：

```diff
  if (distSq <= interactRadius * interactRadius) {
-     controller.enterAsk(npc);
+     controller.enterAsk(npc, this.context.dialogueBubble);
      return;
  }
```

**`fixedUpdate`**：NpcController.update 需要传入 questManager：

```diff
  controller.update(dtMs, npc, {
      player: character,
+     questManager: this.context.questManager,
  });
```

### 5.4 Scene.js — 接收 WorldState/QuestManager，移出 InventoryManager

构造函数增加 `gameContext` 参数：

```diff
- constructor(engine, canvas) {
+ constructor(engine, canvas, gameContext = {}) {
      this.engine = engine;
      this.canvas = canvas;
+     this.worldState = gameContext.worldState ?? null;
+     this.questManager = gameContext.questManager ?? null;
+     this.inventoryManager = gameContext.inventoryManager ?? new InventoryManager();
      ...
-     this.inventoryManager = null;
```

NPC 控制器创建时传入 WorldState 和 npcDef：

```diff
  for (const entityDef of sceneDef.entities) {
      if (entityDef.controller === "npc") {
          const npc = entityById.get(entityDef.id);
          if (npc) {
-             npc.npcController = new NpcController();
+             const npcDef = getNpcDef(entityDef.id);
+             npc.npcController = new NpcController(this.worldState, npcDef);
              npc.npcController.setupDebugVisual(this.scene, npc.root);
          }
      }
  }
```

移除 `this.inventoryManager = new InventoryManager()`，改为使用构造函数传入的。

sharedContext 增加 questManager：

```diff
  sharedContext = {
      ...
      inventoryManager: this.inventoryManager,
+     questManager: this.questManager,
      ...
  };
```

### 5.5 character_demo.js — 创建 Game

```diff
- import { Scene } from "./scripts/Scene.js";
+ import { Game } from "./scripts/Game.js";

  async function start() {
      const canvas = document.getElementById("renderCanvas");
      const engine = new BABYLON.Engine(canvas, true, { stencil: true });
-     const scene = new Scene(engine, canvas);
+     const game = new Game(engine, canvas);
-     await scene.init(HOUSE_INTERIOR, BATTLE_DEFS);
+     await game.init(HOUSE_INTERIOR, BATTLE_DEFS);

-     window.gameScene = scene;
+     window.game = game;
```

主循环中 `scene.xxx` 改为 `game.xxx`。

---

## 6. 数据流

```
玩家靠近 NPC
      ↓
NpcController.enterGreeting → resolve() ← 读取 WorldState
      ↓
命中一条 DialogueEntry
      ↓
dialogueBubble.setText(text) + show(npc)
      ↓
超时 _dialogueTimerMs
      ↓
（如有 giveItem）→ ExploreMode 启动 give 序列 → 播放 give 动画
      ↓
questManager.executeAction(action)
      ↓
WorldState 被修改
      ↓
下次 resolve() 返回不同结果
```

---

## 7. 验证标准

1. 靠近 bard → greeting 动画 + 气泡显示 🗡️ → 3 秒后消失 → `world.quests.dagger` 变为 `{ stage: 1, completed: false }`
2. 离开 bard 范围再回来 → 气泡再次显示 🗡️（无匕首时）
3. 捡匕首后再靠近 bard → 气泡显示 👍 + 角色播放 give 动画 → 匕首从背包移除 → `world.quests.dagger` 变为 `{ stage: 2, completed: true }`
4. 再次靠近 bard → 气氛组，无 greeting，无气泡，只播 idle 动画
5. 靠近 merchant → 无反应（未配置 NPC_DEFS）
6. 控制台输入 `window.game.worldState` 可查看当前世界状态
7. 现有功能（战斗触发、拾取、相机）不受影响

---

## 8. 不在本次范围

- 多轮对话（对话树）
- 数据外部化（JSON 文件）
- 气氛组 NPC 的默认闲话
- 非对话触发的 WorldState 修改（trigger zone、战斗胜利等）
- Merchant 的 greeting/ask 状态（保持现状）

---

## 9. 实施顺序

依赖关系决定顺序，自底向上。

### 第一轮：新建文件（零依赖，无运行时影响）

| 步骤 | 文件 | 说明 |
|------|------|------|
| 1 | `scripts/WorldState.js` | 纯数据类，零依赖 |
| 2 | `scripts/Systems/QuestManager.js` | 只依赖 WorldState |
| 3 | `Data/NpcDefs.js` | 纯数据，零依赖 |

### 第二轮：小修改 + 新建 Game

| 步骤 | 文件 | 说明 |
|------|------|------|
| 4 | `scripts/UI/DialogueBubble.js` | 加 `setText()`，向后兼容 |
| 5 | `scripts/Game.js` | 新建，组装所有模块 |

### 第三轮：核心改造（互相依赖，需一起改）

| 步骤 | 文件 | 说明 |
|------|------|------|
| 6 | `scripts/Systems/NpcController.js` | 构造函数加 WorldState/npcDef，加 resolve，改 enterAsk |
| 7 | `scripts/Scene.js` | 构造函数加 gameContext，NPC 创建时传入 WorldState/npcDef，移出 InventoryManager |
| 8 | `scripts/Systems/Modes/ExploreMode.js` | greeting 不冒泡，传 questManager，传 dialogueBubble |

### 第四轮：入口

| 步骤 | 文件 | 说明 |
|------|------|------|
| 9 | `character_demo.js` | `new Game` 代替 `new Scene` |

### 验证时机

- 步骤 1-4 完成后可单独验证：`DialogueBubble.setText()` 可以手动调用测试
- 步骤 5-9 必须一口气完成，中间代码处于不可运行状态。完成后统一验证 7 条标准

---

## 10. Polish 阶段

基于第一阶段完成后的三个打磨项。

### 10.1 靠近就谈气泡（替代按交互键）

**当前行为**：靠近 → greeting 动画 → 按交互键 → ask 状态 → resolve → 气泡

**目标行为**：靠近 → greeting 动画 + resolve → 气泡 → 超时触发 action

**改动**：
- `NpcController.enterGreeting`：调用 `resolve()`，设置 `_activeText` / `_activeAction`；通过 `dialogueBubble.setText()` + `show()` 显示
- `NpcController.update`：greeting 状态下处理对话超时，触发 `_triggerAction`
- `ExploreMode.#updateDialogueBubble`：恢复对 `greeting` 状态显示气泡
- `ExploreMode.#checkInteraction`：移除 NPC 交互键检测
- 移除 `ask` 状态（不再需要）

### 10.2 交任务动画（give 序列）

**目标**：交任务时角色播放动画，物品精灵显示在手上。

**方案**：
- 状态图新增 `give` 状态（`clip: "pickup"`, `allowMoveInput: false`, `loop: false`）
- 不使用 SceneSequencer，在 ExploreMode 内用简单 phase 状态机

**流程**：

```
对话超时 → NpcController 设置 _pendingGiveItem / _pendingAction
    ↓
ExploreMode 检测到 → 创建临时 sprite（从 itemDef）→ 角色进 give 状态
    ↓
每帧跟踪 action anchor 移动 sprite
    ↓
give 动画播完 → questManager.executeAction → 移除临时 sprite
```

**涉及文件**：
- `NpcController`：`_triggerAction` 检测 action 是否为 give 类型，设置 `_pendingGiveItem` / `_pendingAction`
- `ExploreMode`：`_giveSequence` 状态机（`_startGiveSequence` / `#updateGiveSequence`）
- `Data/StateGraphDef/LongSwordMan.json`：新增 `give` 状态

### 10.3 任务完成后变成气氛组

**目标**：`quest.completed === true` 的 NPC 不再触发 greeting，只播 idle 动画。

**改动**：
- `NpcController.update`：idle 状态下检测到 `completed` → 跳过 greeting，直接返回

### 10.4 Polish 实施顺序

| 顺序 | 项 | 复杂度 | 涉及文件 |
|------|-----|--------|----------|
| 1 | 靠近就谈气泡 | 小 | NpcController + ExploreMode |
| 2 | 气氛组 | 极小 | NpcController |
| 3 | 交任务动画 | 中 | NpcController + ExploreMode + LongSwordMan.json |

建议按 1 → 2 → 3 顺序，逐项验证。