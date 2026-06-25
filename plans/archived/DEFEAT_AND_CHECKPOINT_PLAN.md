# 战败与检查点实施方案

> **状态：已完成（2026-06-25）**

## 目标

玩家被击败后，通过检查点快照将游戏状态回退到最近的安全点，重新加载场景。

---

## 设计决策

### 1. 检查点包含哪些数据

| 数据 | 来源 | 恢复方式 |
|------|------|----------|
| `scenario` | `WorldState.scenario` | 直接写回 |
| `flags` | `WorldState.flags` | 深拷贝写回 |
| `quests` | `WorldState.quests` | 深拷贝写回 |
| `sceneStates` | `WorldState.sceneStates` | 深拷贝写回（敌人复活、物品重新出现） |
| `inventory` | `InventoryManager.items[]` | 深拷贝写回 |
| `buffs` | `PlayerController.buffs[]` | 深拷贝写回（在 `_loadScene` 中恢复） |
| `hp` | `CombatCharacter.combat.hp` | 值写回（在 `_loadScene` 中恢复） |
| `sceneId` | 当前场景 ID | 用于 reload |
| `spawnId` | 场景中的复活点 | hero 放置位置 |

### 2. 检查点存储位置

检查点存储在 `Game` 上（`Game._checkpoint`），因为 `Game` 持有所有顶层状态对象（`WorldState`、`InventoryManager`），且 `Scene` 在 reload 时会被 dispose 重建。

检查点的 `save` 和 `restore` 作为 `Game` 的方法实现。不引入新的 Manager 类——当前逻辑量不足以支撑一个独立类，后续如需序列化/多槽位再提取。

### 3. 检查点写入时机

| 时机 | 触发位置 | 理由 |
|------|----------|------|
| 战斗前（进入 battle trigger） | `ExploreMode.#checkBattleTrigger()` | 战败后回到战斗前状态 |
| 战斗胜利后 | `BattleMode.#checkBattleEnd()` 的 victory 分支 | 固化胜利成果 |
| 任务状态变更后 | `QuestManager.setFlag()` / `advanceTo()` / `setQuestStage()` 调用后 | 防止对话后意外死亡 |

不在场景切换时自动保存。场景切换前已有战斗胜利/任务交付触发保存，无需额外冗余。

### 4. 战败 vs 胜利的分支

当前 `BattleMode.#checkBattleEnd()` 不区分胜败——只要有人死就走 exitSequence 并写 victory flag。需要拆为两条路径：

- **hero 胜利**（`rabbleStick.isDead`）：走现有 `exitBattleSequence`，写 `onVictory`，保存检查点
- **hero 战败**（`character.isDead`）：走新的 `defeatSequence`，不写 `onVictory`，恢复检查点

### 5. 战败流程

```
1. hero HP 归零 → enterState("defeated") → 播放倒地动画（已自动触发）
2. BattleMode 检测 hero.isDead → 播放 defeatSequence
3. defeatSequence: WAIT 2.5s → CALLBACK 恢复检查点
4. 检查点恢复 → 设置 _pendingSceneLoad → 场景 reload
5. 新场景 hero 放置在检查点记录的 spawnId
```

不在此版本加入 fade 效果。场景 reload 足够快，后续 polish 再补。

### 6. 首次游戏（无检查点）

如果玩家在从未保存检查点的情况下战败（例如第一次战斗就输了），`restoreCheckpoint` 回退到 `resetWorldState()` + 初始场景 `OUTDOOR_VILLAGE` + `house_door` spawn。

---

## 实施步骤

### Step 1: Game 层检查点 save/restore 方法

**依赖**：无（纯 Game 层新增逻辑）

**实现**：

1. 在 `Game` 上新增 `saveCheckpoint(sceneId, spawnId)` 方法：
   - 深拷贝 `worldState.scenario`、`flags`、`quests`、`sceneStates`
   - 深拷贝 `inventoryManager.items`
   - 读取当前 hero 的 `hp`、`maxHp`（从 `scene.entityPool` 中找 `id === "hero"`）
   - 读取当前 `playerController.buffs`（从 `scene.playerController`）
   - 存入 `this._checkpoint`

2. 在 `Game` 上新增 `restoreCheckpoint()` 方法：
   - 若 `this._checkpoint` 为空，调用 `resetWorldState()` + 设置默认场景 `OUTDOOR_VILLAGE` + `house_door`，return
   - 深拷贝写回 `worldState` 全部字段
   - 深拷贝写回 `inventoryManager.items`
   - 将 `hp`、`maxHp`、`buffs` 暂存到 `this._pendingRestore`（供 `Scene._loadScene` 消费）
   - 设置 `this.scene._pendingSceneLoad = { sceneDef: ALL_SCENES[cp.sceneId], spawnId: cp.spawnId }`

3. 在 `Game` 上新增 `hasCheckpoint()` 方法（供外部判断）。

**涉及文件**：
- `scripts/Game.js`：新增 `saveCheckpoint`、`restoreCheckpoint`、`hasCheckpoint` 方法

**验证**：
- 在控制台调用 `game.saveCheckpoint("outdoor_village", "house_door")` → 修改 WorldState/inventory → 调用 `game.restoreCheckpoint()` → 确认场景 reload 且状态正确回退

---

### Step 2: Scene._loadScene 恢复 hero HP/buffs

**依赖**：Step 1

**实现**：

1. 修改 `Scene._loadScene()`：在 `newHero` 创建后，检查 `game._pendingRestore`：
   - 若存在 `hp` / `maxHp`：写回 `newHero.combat.hp`、`newHero.combat.maxHp`
   - 若存在 `buffs`：写回 `this.playerController.buffs` 并更新 `buffBar`
   - 消费后清空 `game._pendingRestore = null`

2. 同时保持现有的 `savedHp` 逻辑不变（场景切换时 hero hp 保持），但 checkpoint 恢复时优先使用 checkpoint 的 hp。

**注意**：`_loadScene` 中已通过 `this.inventoryBar.update()` 和 `this.buffBar.update()` 刷新 UI。checkpoint 恢复的 buffs 也需要触发 UI 刷新。

**涉及文件**：
- `scripts/Scene.js`：修改 `_loadScene()`

**验证**：
- 保存检查点（含 buffs + 非满 HP）→ 手动修改 HP/buffs → restore → 确认 HP 和 buffs 都恢复到检查点值

---

### Step 3: 关键时机写入检查点

**依赖**：Step 1

#### 3a. 战斗前保存

**实现**：在 `ExploreMode.#checkBattleTrigger()` 中，`sceneSequencer.play(enterBattleSequence)` 之前，调用 `context.game.saveCheckpoint(sceneDef.id, nearestSpawnId)`。

`nearestSpawnId` 取当前场景 `sceneDef.spawns` 中距离 hero 最近的 spawn 点（或固定使用主 spawn 点 `"house_door"` — 简化处理）。

**涉及文件**：
- `scripts/Systems/Modes/ExploreMode.js`：修改 `#checkBattleTrigger()`

#### 3b. 战斗胜利后保存

**实现**：在 `BattleMode.#checkBattleEnd()` 的 victory 分支（现有 `onVictory` 写完后），调用 `context.game.saveCheckpoint(sceneDef.id, nearestSpawnId)`。

`sceneDef` 从 `sharedContext.sceneDef` 获取。`nearestSpawnId` 同 3a 逻辑。

**涉及文件**：
- `scripts/Systems/Modes/BattleMode.js`：修改 `#checkBattleEnd()`

#### 3c. 任务状态变更后保存

**实现**：在 `QuestManager` 中，`setFlag()`、`advanceTo()`、`setQuestStage()` 三个方法需要在写入后触发检查点保存。但 `QuestManager` 没有 `Game` 引用。

**方案**：给 `QuestManager` 增加一个 `onStateChange` 回调。在 `Game` 构造时注入：

```js
this.questManager.onStateChange = () => {
    // 自动保存，使用当前场景的默认 spawn
    const sceneId = this.scene?.sharedContext?.sceneDef?.id;
    const spawnId = "house_door"; // 或遍历 spawns 取第一个
    if (sceneId) this.saveCheckpoint(sceneId, spawnId);
};
```

**涉及文件**：
- `scripts/Systems/QuestManager.js`：新增 `onStateChange` 回调，在 `setFlag`/`advanceTo`/`setQuestStage` 末尾调用
- `scripts/Game.js`：构造时注入回调

**验证**：
- 进入战斗 → 确认控制台输出 checkpoint 保存日志
- 战斗胜利 → 确认保存日志
- 与 NPC 对话触发 flag 变更 → 确认保存日志

---

### Step 4: 战败检测 + 战败序列

**依赖**：Step 1, Step 2, Step 3a（战斗前保存确保有检查点可回退）

**实现**：

1. 修改 `BattleMode.#checkBattleEnd()` 拆分为两条路径：
   - 若 `character.isDead`（hero 战败）→ 走 `#handleDefeat()`
   - 若 `rabbleStick.isDead`（hero 胜利）→ 走现有逻辑（含 Step 3b 的保存）

2. 新增 `BattleMode.#handleDefeat(sceneSequencer)`：
   ```js
   const defeatSequence = {
       id: "defeat",
       steps: [
           { type: STEP_TYPE.LOCK_INPUT, actorId: "hero" },
           { type: STEP_TYPE.WAIT, durationMs: 2500 },
           { type: STEP_TYPE.CALLBACK, fn: (ctx) => ctx.game.restoreCheckpoint() },
       ]
   };
   sceneSequencer.play(defeatSequence);
   ```

3. 确保 `sharedContext` 中有 `game` 引用。当前 `sharedContext` 在 `Scene.init()` 中构建，需要添加 `game: gameContext` 或类似引用。

**注意**：`restoreCheckpoint()` 内部会设置 `_pendingSceneLoad`，Scene 在下一帧的 `fixedUpdate` 中处理。`defeatSequence` 的 CALLBACK 步骤执行后，Scene 会被 dispose 重建，sequence 自然终止 — 这符合预期。

**涉及文件**：
- `scripts/Systems/Modes/BattleMode.js`：新增 `#handleDefeat`，修改 `#checkBattleEnd`
- `scripts/Scene.js`：在 `sharedContext` 中传入 `game` 引用

**验证**：
- 进入战斗 → 让 hero 被击败 → 确认：
  1. defeated 动画播放
  2. 约 2.5s 后场景 reload
  3. 状态回退到战斗前（flags 未写、敌人复活、HP/buffs/inventory 恢复）
  4. 输入正常可用

---

### Step 5: 首次游戏无检查点边界情况

**依赖**：Step 4

**实现**：在 `Game.restoreCheckpoint()` 中，当 `this._checkpoint` 为 null/undefined 时，执行：
```js
this.resetWorldState();
this.inventoryManager.items = [];
this._pendingRestore = { hp: 3, maxHp: 3, buffs: [] };
this.scene._pendingSceneLoad = {
    sceneDef: OUTDOOR_VILLAGE,
    spawnId: "house_door"
};
```

**涉及文件**：
- `scripts/Game.js`：修改 `restoreCheckpoint()`

**验证**：
- 新游戏不触发任何 checkpoint → 直接进入战斗并战败 → 确认回退到初始状态（OUTDOOR_VILLAGE，满 HP，空背包）

---

## 步骤依赖关系

```
Step 1 (save/restore 方法)
 ├── Step 2 (HP/buffs 恢复)
 ├── Step 3a (战斗前保存)
 ├── Step 3b (战斗胜利后保存)
 └── Step 3c (任务状态变更后保存)
      └── Step 4 (战败检测 + 序列) ← 依赖 Step 1, 2, 3a
           └── Step 5 (无检查点边界) ← 依赖 Step 4
```

---

## 实施中修复的额外问题

- rabble controller 硬编码 `DummyController` → 读取 entity def 的 `controller` 字段，支持 `test` 类型
- 战败恢复后不能移动 → `Scene.init()` 强制 `playerController.enabled = true`
- 战败期间仍能触发场景切换 → `ExploreMode.#updateSceneSwitchTrigger()` 检查 `playerController.enabled`

## 不在此版本实现

- 多检查点槽位（手动存档/读档）
- 检查点序列化到 localStorage
- 战败序列中的 fade 相机效果
- 战败后"重试"vs"放弃"选择 UI
- 检查点数据格式外部化（JSON schema）