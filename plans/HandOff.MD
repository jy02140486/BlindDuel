# 单场景多战斗重构交接

日期：2026-10-16  
目标：在 `prologue` 场景 `x=-25.5` 增加一场额外的 `rabble_stick` 战斗，并由此把当前“单场景单战斗”运行时假设重构为“单场景多 BattleDef / 多 Trigger / 多敌人实体”。

## 1. 结论

不能只新增一个 trigger 和 enemy。

当前数据层已经部分支持多条战斗触发器：`triggers` 是数组，`battleId` 也会从 `BATTLE_DEFS` 查表；但运行时仍大量使用全局唯一的 `rabbleStick` / `rabbleController` / `enemy` 别名。直接加第二名敌人会导致 AI 不更新、相机取错对手、入场序列走位错误，或复用第一场战斗的边界与 checkpoint。

建议引入明确的 `BattleSession`，以本次触发的 BattleDef 为唯一战斗上下文，而不是在战斗开始前临时切换全局别名。

## 2. 已具备的基础

- `Data/SceneDefs/prologue.json` 的 `triggers` 已支持多个 battle trigger。
- trigger 已支持 `battleId`、`checkpointSpawn`、`condition.flagNot/scenarioMin`。
- `scripts/SceneDefs.js` 中 `BATTLE_DEFS` 是按 id 注册的 map。
- BattleDef 已支持 `combatants`、`combatantConfig`、`stageBounds`、`battleYBaseline`、`duelCamera`、`onVictory.flags`。
- `actorRegistry` 已可按实体 id 查找角色，显式 actorId（如 `enemy_2`）能解析到实体。

## 3. 当前缺口与证据

### 3.1 Scene 只初始化一个敌人 controller

- `scripts/Scene.js:98` 固定读取 `enemy_1`。
- `scripts/Scene.js:139-142` 只为该实体初始化 `rabbleController`。
- `scripts/Scene.js:581-631` 使用 `_rabbleControllerBound`，动态生成的第二个 enemy 不会再绑定 controller。
- `_initRabbleController()` 还会从所有 def 中 `find` 第一个 enemy，而不是使用传入的当前 enemyDef。
- `sharedContext.rabbleController`、`sharedContext.rabbleStick` 是单值字段；`actorRegistry.set("enemy", entity)` 也是单对手别名。

### 3.2 Trigger 只解析 BattleDef，没有形成 BattleSession

位置：`scripts/Systems/Modes/ExploreMode.js:204-271`。

缺口：
- 命中后只取出 `pendingBattleDef`，没有保存 triggerId、参战者、checkpoint、入场/退场序列。
- BattleDef 缺失时直接 return，没有显式告警。
- 不校验 BattleDef 中的 combatants 是否存在、是否存活。
- 多个 trigger 重叠时按 JSON 顺序选第一个，缺少 nearest/priority 规则。
- `enterBattleSequence` 固定读取场景级单例：`sceneDef.enterBattleSequence`，无法按战斗区分。

### 3.3 BattleMode 仍依赖全局 rabbleController

- `scripts/Systems/Modes/BattleMode.js:154-171` 从 context 解构唯一 `rabbleController` 并驱动。
- `scripts/Systems/Modes/BattleMode.js:374-379` 假定 `combatants[0]` 是玩家、`combatants[1]` 是唯一敌人。
- `scripts/Systems/Modes/BattleMode.js:425-432` 胜利后 checkpoint 取 `Object.keys(sceneDef.spawns)[0]`，没有使用本次 trigger 的 `checkpointSpawn`。
- 战斗结束逻辑只判断两个角色，未定义“所有敌方参战者死亡才胜利”的通用规则。

### 3.4 Timeline / 相机取全局对手

- `scripts/Systems/TimelineSequencer.js:631-648` 的 duel blend 读取 `ctx.character` + `ctx.rabbleStick`。
- `scripts/Systems/TimelineSequencer.js:757-765` 计算 `fighterDistance` 也读取同一全局别名。
- `scripts/Systems/TimelineSequencer.js:374` 与旧 `SceneSequencer.js:255` 把通用 actorId `enemy` 映射到 `context.rabbleStick`。
- 显式 actorId 已可通过 `actorRegistry` 解析，但相机 frame 尚未按 BattleDef.combatants 解析。

### 3.5 场景初始化取第一场战斗的边界和相机配置

`scripts/Scene.js:153-167` 使用 `sceneDef.triggers.find(t => t.type === "battle")`，即第一个 battle trigger：
- 初始 `StageBoundary` 取第一场 BattleDef 的 `stageBounds`。
- 初始 duel camera 配置取第一场 BattleDef 的 `duelCamera`。

`BattleMode.enter()` 会重新 `setBounds()`，但仍需确认/补齐 DuelCameraRig 在每次战斗进入时应用当前 BattleDef 的 `duelCamera`。

### 3.6 Prologue 的入场/退场序列是场景级单例

`Data/SceneDefs/prologue.json:13-102` 的 `enterBattleSequence/exitBattleSequence` 会被所有战斗复用。

其中 companion retreat 被写死为移动到 `x=-9`。左侧 `x=-25.5` 的战斗需要独立入场序列，例如让 Charlotte 撤到左侧安全位置；否则镜头、同伴位置和战斗站位都会错位。

### 3.7 敌人生命周期需要明确

- `spawnIf.flagNot` 只在场景加载时过滤，或在条件变 true 后动态 spawn。
- 胜利写入 flag 后，当前场景中的死亡实体不会立即从 entityPool 移除，要重载场景才消失；这与现有战斗一致，但多战斗后必须确认其它敌人不会误入下一场战斗。
- 非本次 BattleDef.combatants 的敌人，在 BattleMode 中不应更新 AI，也不应进入 CombatSystem。

## 4. 建议目标设计

### 4.1 新增 BattleSession

触发战斗时由 ExploreMode 创建：

```js
{
  triggerId,
  battleId,
  battleDef,
  combatantIds,
  playerId,
  opponentIds,
  checkpointSpawnId,
  enterSequence,
  exitSequence,
}
```

流转：
1. AABB 命中并通过 condition。
2. 从 `BATTLE_DEFS[battleId]` 取 BattleDef。
3. 用 `actorRegistry` 校验所有 combatants 存在、未 dispose、未死亡。
4. 解析本次战斗的 enter/exit sequence 与 checkpoint。
5. 写入 `context.pendingBattleSession`，再播放入场序列。
6. `switchMode("battle")` payload 携带 session。
7. BattleMode 保存为 `this._session`，相机、AI、结算、checkpoint 全部从 session 取数。

### 4.2 Scene 支持多个敌人及独立 controller

- 每个 `kind: "enemy"` 实体 spawn 时，基于它自己的 entityDef 创建 controller，并赋给 `entity.controller`。
- Scene 维护 `enemyControllers: Map<entityId, controller>`，移除 `_rabbleControllerBound`。
- `AIController(entity, { opponent: hero })` 可继续以 hero 为固定对手；关键是 BattleMode 只驱动本次战斗的 opponent controller。
- 过渡期可保留 `context.rabbleStick/rabbleController` 兼容旧 sequence，但新逻辑不得再依赖它们；后续删除通用 `enemy` 别名，序列统一写显式 `enemy_1/enemy_2`。

### 4.3 每场战斗独立序列

建议解析优先级：

1. trigger 覆盖：`enterSequenceUrl/exitSequenceUrl`
2. BattleDef 覆盖：`enterSequenceUrl/exitSequenceUrl` 或现有函数
3. sceneDef 共享默认序列
4. 代码 fallback

序列引用应预加载或在 trigger 命中后异步加载并处理失败；不能在 fixedUpdate 中假设数据已存在。

Prologue 可新增左侧专用 enter sequence；exit sequence 如果同伴恢复跟随逻辑一致，可继续共享。

### 4.4 相机与战斗边界

- 增加统一 helper：按 session.combatantIds 从 actorRegistry 取玩家与敌人。
- TimelineSequencer 的 duel frame 与 `fighterDistance` 改为从 pending/active BattleSession 计算。
- BattleMode.enter 使用当前 BattleDef：`stageBoundary.setBounds(battleDef.stageBounds)`，并应用/传递 `battleDef.duelCamera`。
- StageBoundary 初始值只作安全默认，不再从第一个 trigger 推断。

### 4.5 结算与 checkpoint

- 玩家死亡：defeat，恢复 session.checkpointSpawnId。
- 玩家存活且所有敌方 combatants 死亡：victory。
- 胜利后保存本次 trigger 的 checkpoint，而非第一个 spawn。
- 额外战斗只写独立 flag，例如 `prologue_extra_battle`，不推进 `SCENARIO.BATTLE_1_COMPLETED`，避免影响主线。

## 5. Prologue 数据草案

- 新敌人：`enemy_2`，`archetype: "rabble_stick"`，`controller: "ai"`。
- 新 trigger：`bt_prologue_extra`，`pos: [-25.5, 0, 0]`，`battleId: "prologue_extra_battle"`。
- 新 checkpoint：建议 `[-27, 0, 0]`，位于 trigger 半宽之外，也需确认不与 altar blocker 重叠。
- 敌人初始站位需结合左侧场地与 altar 调整，例如 `[-22, 0, 0]`，具体以镜头和 stageBounds 实测为准。
- 左侧战斗 bounds 可先按 `[-28, -20]` 评估，必须检查 altar 碰撞盒和 walkArea。
- `spawnIf/condition` 使用 `{ "scenarioMin": 105, "flagNot": "prologue_extra_battle" }`。

## 6. 建议实施顺序

1. 重构 Scene：多敌人 controller map，移除单敌人初始化路径。
2. 引入 BattleSession，改 ExploreMode 触发与校验。
3. 改 BattleMode：按 session 驱动 controller、结算、checkpoint。
4. 改 TimelineSequencer/旧 SceneSequencer：相机和 fighterDistance 从 session 取参战者。
5. 确认 DuelCameraRig 支持每场战斗应用独立 camera config。
6. 支持 per-battle enter/exit sequence。
7. 最后添加 prologue 额外战斗数据与左侧专用入场序列。
8. 全量回归现有 `prologue_battle`、`battle_field_1/2`、tavern room。

## 7. 验收清单

- scenario < 105：左侧额外战斗 trigger 与 enemy_2 均不可用。
- scenario >= 105：enemy_1/enemy_2 都存在，两个 trigger 按 flag 独立启用/禁用。
- 走到 `x=-25.5`：只开启 enemy_2 战斗，镜头框住 hero/enemy_2，AI 正常行动。
- 右侧原 trigger：仍开启 enemy_1 主线战斗，胜利后 scenario 推进到 110。
- 左侧额外战斗胜利：只写 `prologue_extra_battle`，不推进主线 scenario。
- 任一战斗战败：恢复到该 trigger 对应的安全 checkpoint，不立即重入 AABB。
- 非当前战斗的敌人不更新 AI、不进入 Pushbox/CombatSystem。
- 胜利后重载场景：已完成战斗的敌人不再 spawn，未完成战斗仍可触发。
- 无 `battleDef missing`、`actor missing`、`rabbleController undefined`、相机距离 NaN/跳变等告警。
- 全局调试开关仍能统一显隐所有敌人的 AI/collider 调试信息。
