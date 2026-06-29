# Prologue 场景与数据流重构概要设计

> 目标：确立正式流程与结构，让主人公能在 prologue 场景里走起来。  
> 范围：WorldState / SceneDef registry / Game 入口解耦 / prologue.json 落地。  
> 不在范围：BattleDef 外部化、StageBoundary/DuelCameraRig 延迟创建（留待做战斗场景时再做）。

---

## 0. 决策清单（已拍板）

| 项 | 决策 |
|----|------|
| prologue 与 OUTDOOR_VILLAGE 关系 | **替换**。OUTDOOR_VILLAGE 基础功能已充分测试，prologue 接管为正式入口 |
| 存档体系 | **暂不做**。仅保留现有内存 `_checkpoint` |
| SceneDef registry 方案 | **方案 A**（最小改动）。SceneDefs.js 保留硬编码，但文件头注释说明为何保留 |
| prologue 配置 | **先照抄 HOUSE_INTERIOR 的 walkArea + spawn**，先不放实体，进去后再调位置 |
| prologue 战斗 | **有，但本次不做**。等流程/结构问题解决后再加 |
| StageBoundary / DuelCameraRig 延迟创建 | **留待做战斗时再加** |

---

## 1. 现状问题

### 1.1 入口硬编码场景
- [character_demo.js:10](file:///e:/se/BlindDuel/character_demo.js#L10) `await game.init(OUTDOOR_VILLAGE, BATTLE_DEFS)` —— 入口认识具体 SceneDef 对象，违反数据驱动原则（`PROJECT_CONTEXT.md §8.2`）
- [Game.init(sceneDef, battleDefs)](file:///e:/se/BlindDuel/scripts/Game.js#L29-L31) 让调用方决定起点，但 [Game.restoreCheckpoint()](file:///e:/se/BlindDuel/scripts/Game.js#L83-L99) 内部已用 `ALL_SCENES[cp.sceneId]` 反查 —— 两套路径不一致
- [WorldState.js](file:///e:/se/BlindDuel/scripts/WorldState.js) 无"当前场景"字段，重启游戏永远从同一场景进

### 1.2 BattleDef 全集耦合
- [SceneDefs.js:566](file:///e:/se/BlindDuel/scripts/SceneDefs.js#L566) `BATTLE_DEFS` 是全集中转对象，每个场景背着全集
- [Scene.js:174-175](file:///e:/se/BlindDuel/scripts/Scene.js#L174-L175) `defaultBattleDef = firstBattleTrigger ? battleDefs[...] : battleDefs["battle_field_1"]` —— 无战斗场景也强行依赖 `battle_field_1` 兜底，**prologue 无战斗也会被这条逻辑卡住**
- [SceneDefs.js:97,498](file:///e:/se/BlindDuel/scripts/SceneDefs.js#L97) `enterSequence: (battleDef) => ({...})` 是闭包函数，阻碍 JSON 化
- [ExploreMode.js:157](file:///e:/se/BlindDuel/scripts/Systems/Modes/ExploreMode.js#L157) 从 `context.battleDefs[triggerDef.battleId]` 取 BattleDef —— 全集挂在 sharedContext 上

### 1.3 StageBoundary / DuelCameraRig 生命周期错位
- [Scene.js:176,184](file:///e:/se/BlindDuel/scripts/Scene.js#L176) 在 Scene.init 时就建这两个组件（用 `defaultBattleDef` 配置）
- 但 [BattleMode.enter:25-26](file:///e:/se/BlindDuel/scripts/Systems/Modes/BattleMode.js#L25-L26) 会用 `setBounds` 覆盖 —— 提前建只是兜底
- DuelCameraRig 提前建是因为 [Scene.js:217](file:///e:/se/BlindDuel/scripts/Scene.js#L217) `cameraManager.registerRig("duel", ...)` 启动时就要注册

---

## 2. 目标架构

### 2.1 数据流（重构后）

### 2.2 WorldState 扩展

```js
export class WorldState {
    constructor() {
        this.scenario = 0;
        this.flags = {};
        this.quests = {};
        this.sceneStates = {};
        this.currentSceneId = "prologue";   // 新游戏默认起点
        this.currentSpawnId = null;          // null = SceneDef.spawns 第一个
    }
}
```

### 2.3 SceneDef registry（方案 A）

新增模块 `scripts/SceneDefRegistry.js`：

```js
// 内存索引：硬编码 SceneDef 直接注册
// 外部 JSON：按需 fetch，缓存
const _cache = new Map();
const _hardcoded = new Map();  // id → SceneDef 对象

export function registerScene(id, def) { _hardcoded.set(id, def); }
export function getSceneDefSync(id) { return _hardcoded.get(id) ?? _cache.get(id); }
export async function resolveSceneDef(id) {
    if (_hardcoded.has(id)) return _hardcoded.get(id);
    if (_cache.has(id)) return _cache.get(id);
    const res = await fetch(`Data/SceneDefs/${id}.json`);
    const def = await res.json();
    _cache.set(id, def);
    return def;
}
```

SceneDefs.js 文件头注释（用户要求）：
```js
/**
 * 硬编码 SceneDef/BattleDef 保留说明：
 * 本文件是数据外部化前的中间产物。新场景应放入 Data/SceneDefs/*.json，
 * 通过 SceneDefRegistry 加载。本文件保留是为了：
 * 1) 兼容已有的 outdoor_village / house_interior 测试场景（迁移成本未排期）
 * 2) 提供 createEntityFromDef 工厂函数（archetype → entity 实例化逻辑，本质是代码不是数据）
 * 3) BattleDef 因 enterSequence 仍是函数，暂无法 JSON 化（待战斗场景重构时处理）
 * 后续随外部化推进，本文件中的 SceneDef/BattleDef 常量应逐步迁移到 JSON，
 * 最终只保留工厂函数与 registry 注册逻辑。
 */
```

---

## 3. 分步实施

### Step 1：WorldState 增加 currentSceneId / currentSpawnId
- **文件**：[scripts/WorldState.js](file:///e:/se/BlindDuel/scripts/WorldState.js)
- **改动**：constructor 加两个字段（见 §2.2）
- **影响**：`resetWorldState()` 需同步重置 `currentSceneId = "prologue"`、`currentSpawnId = null`
- **风险**：无

### Step 2：SceneDefRegistry 模块 + SceneDefs.js 注册
- **新增**：`scripts/SceneDefRegistry.js`（见 §2.3）
- **改动**：[scripts/SceneDefs.js](file:///e:/se/BlindDuel/scripts/SceneDefs.js) 文件头加注释；末尾把 `ALL_SCENES` 改为通过 `registerScene` 注册
- **改动**：[scripts/Game.js:6](file:///e:/se/BlindDuel/scripts/Game.js#L6) `import { ALL_SCENES, OUTDOOR_VILLAGE }` 改为 `import { resolveSceneDef } from "./SceneDefRegistry.js"`
- **风险**：registry 是异步 fetch，需确认 Scene.init 调用链都能 await

### Step 3：Game.init / character_demo.js 解耦
- **改动**：[scripts/Game.js:29-31](file:///e:/se/BlindDuel/scripts/Game.js#L29-L31)
  ```js
  async init() {
      const sceneId = this.worldState.currentSceneId;
      const sceneDef = await resolveSceneDef(sceneId);
      await this.scene.init(sceneDef);
  }
  ```
- **改动**：[character_demo.js:2,10](file:///e:/se/BlindDuel/character_demo.js#L2-L10)
  ```js
  // 移除 OUTDOOR_VILLAGE / BATTLE_DEFS import
  await game.init();
  ```
- **改动**：[scripts/Game.js:16-23](file:///e:/se/BlindDuel/scripts/Game.js#L16-L23) `questManager.onStateChange` 里 spawnId 兜底改为读 `worldState.currentSpawnId`
- **风险**：`Game.restoreCheckpoint()` 仍用 `ALL_SCENES[cp.sceneId]`，要改成 `await resolveSceneDef(cp.sceneId)`

### Step 4：Scene.init 容错 + 移除 BATTLE_DEFS 参数
- **改动**：[scripts/Scene.js:62-63](file:///e:/se/BlindDuel/scripts/Scene.js#L62-L63) `init(sceneDef, battleDefs = {})` → `init(sceneDef)`，移除 `this._battleDefs`
- **改动**：[scripts/Scene.js:174-185](file:///e:/se/BlindDuel/scripts/Scene.js#L174-L185) 无 battle trigger 时用**默认配置**建 StageBoundary/DuelCameraRig，不再从 `battleDefs["battle_field_1"]` 取：
  ```js
  const DEFAULT_DUEL_CAMERA = {
      zoomMinDistance: 3.2, zoomMaxDistance: 6.4,
      orthoMinWidth: 16, orthoMaxWidth: 32,
      perspMinDistance: 15, perspMaxDistance: 35,
      minCameraHeight: 3.2, maxCameraHeight: 5.2,
      targetAspect: 16 / 9,
  };
  const DEFAULT_STAGE_BOUNDS = { minX: -8, maxX: 8, minY: -0.05, maxY: 0.05 };
  
  const firstBattleTrigger = sceneDef.triggers?.find(t => t.type === "battle");
  // 无战斗场景用默认配置；有战斗场景仍需 battleDefs（本次过渡期保留参数兼容）
  const duelCameraCfg = DEFAULT_DUEL_CAMERA;
  const stageBounds = DEFAULT_STAGE_BOUNDS;
  this.stageBoundary = new StageBoundary(this.scene, stageBounds);
  // ...
  this.cameraRig = new DuelCameraRig(duelCameraCfg);
  ```
- **改动**：[scripts/Scene.js:239](file:///e:/se/BlindDuel/scripts/Scene.js#L239) `sharedContext.battleDefs = battleDefs` —— 过渡期保留，但来源改为按需 resolve（见 Step 5 备注）
- **改动**：[scripts/Scene.js:431](file:///e:/se/BlindDuel/scripts/Scene.js#L431) `await this.init(sceneDef, this._battleDefs)` → `await this.init(sceneDef)`
- **过渡期策略**：prologue 无战斗触发器，走默认配置；outdoor/house 仍依赖 BATTLE_DEFS，故 Game.init 内部仍需把 BATTLE_DEFS 传给 Scene（**保留 `Game.init(battleDefs)` 一个参数**，Scene.init 仍收第二个参数作为过渡）
- **风险**：⚠️ 这一步需要平衡"prologue 不依赖 BATTLE_DEFS"与"现有场景仍能用"。最简方案是 Scene.init 加默认值 `battleDefs = {}`，无 battle trigger 时不查表

> **Step 4 备注**：用户说"StageBoundary/DuelCameraRig 延迟创建留待做战斗时再加"。Step 4 只做"容错"（无 battle trigger 时不崩），不做"延迟创建"（仍提前建组件，只是用默认配置）。真正的延迟创建留到 Step 6。

### Step 5：prologue.json 落地
- **新增**：`Data/SceneDefs/0_prologue.json`
- **配置**：
  - `id: "prologue"`
  - `camera: { defaultRig: "explore" }`
  - `entities: [{ hero_longsword, id: "hero", pos: [0, 0], controller: "player" }]` —— 仅 hero
  - `walkArea` / `spawns` 照抄 [HOUSE_INTERIOR](file:///e:/se/BlindDuel/scripts/SceneDefs.js#L364-L369)
  - `triggers: []` —— 暂无
  - `environment`：三层配置
    | layer | z | parallax | 内容 |
    |-------|---|----------|------|
    | BG_FAR | 40 | 0.15 | （可选，暂留空或 skybase） |
    | MID | 20 | 0.5 | `AcientRuin_layer1.png`（远）+ `AcientRuin_layer2.png`（近） |
    | STAGE | 10 | 1.0 | `grassbase`（动画瓦片）+ `grasstop`（动画瓦片）+ `AcientRuin.png`（single） |
  - ⚠️ layer1/layer2 谁远谁近需用户进游戏后确认，parallaxFactor 暂定 0.4/0.6
- **验证**：启动后 hero 在 prologue 出生，能用方向键走，相机跟随，三层视差正常

### Step 6（留待战斗场景）：BattleDef 外部化 + 组件延迟创建
- `enterSequence` 函数改数据化：`payload: { battleDefId: "xxx" }`，BattleMode.enter 时 `resolveBattleDef(id)`
- 新增 `Data/BattleDefs/*.json` + `BattleDefRegistry.js`
- `StageBoundary` / `DuelCameraRig` 延迟到 `BattleMode.enter` 创建/配置
- 移除 Scene.init 的 `battleDefs` 参数与 sharedContext.battleDefs
- ExploreMode.js:157 改为 `await resolveBattleDef(triggerDef.battleId)`

---

## 4. 影响面

| 文件 | Step 1 | Step 2 | Step 3 | Step 4 | Step 5 |
|------|--------|--------|--------|--------|--------|
| scripts/WorldState.js | ✓ | | | | |
| scripts/SceneDefRegistry.js（新） | | ✓ | | | |
| scripts/SceneDefs.js | | ✓（注释+注册）| | | |
| scripts/Game.js | | ✓（import）| ✓ | ✓（过渡期参数）| |
| character_demo.js | | | ✓ | | |
| scripts/Scene.js | | | | ✓ | |
| Data/SceneDefs/0_prologue.json（新）| | | | | ✓ |

---

## 5. 验证清单

### Step 1-4 完成后
- [ ] `window.game.worldState.currentSceneId === "prologue"` 默认值正确
- [ ] `window.resetWorldState()` 后 currentSceneId 重置为 "prologue"
- [ ] 不传参调用 `game.init()` 不报错

### Step 5 完成后
- [ ] 启动后场景为 prologue（AcientRuin 三层可见）
- [ ] hero 在 spawn 点出生，能走动
- [ ] 相机跟随正常
- [ ] 三层视差滚动正常（layer1/layer2 远近关系正确）
- [ ] 控制台无 `battleDefs["battle_field_1"]` 相关 warning
- [ ] 现有 outdoor_village / house_interior 场景切换仍能跑（回归测试）

---

## 6. 待确认事项

1. **AcientRuin_layer1 / layer2 谁远谁近**：需进游戏确认，parallaxFactor 初定 layer1=0.4、layer2=0.6
2. **Step 4 过渡期策略**：是否接受"Scene.init 保留 `battleDefs = {}` 默认参数"作为过渡，直到 Step 6 彻底移除
3. **prologue 的 skybase**：BG_FAR 层是否要放天空，还是留空让 clearColor 透出来