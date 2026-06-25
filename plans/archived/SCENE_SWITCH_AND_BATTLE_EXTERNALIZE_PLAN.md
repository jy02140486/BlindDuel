# 场景切换 + 战斗外部化 方案

> 状态：方案评审中 | 创建：2026-06-04

## 0. 目标

1. 定义 SceneDef（场景数据）和 BattleDef（战斗数据）的数据结构，先硬编码为 JS 对象
2. 用新数据结构构建现有场景 + 新建一个室内场景和一场新战斗，验证场景切换流程
3. 后续再考虑抽到外部 JSON 文件

---

## 1. 摸底：当前硬编码清单

### 1.1 Scene.init() 中写死的（`scripts/Scene.js`）

| 类别 | 硬编码内容 | 行号 |
|------|-----------|------|
| 实体创建 | `hero` 位置 `(-12, 0)`、`rabbleStick` 位置 `(3.2, 0)`、`npc` 位置 `(-14, -1)`、`merchant` 位置 `(-11, -0.9)` | L72-L99 |
| 触发器 | `battleTrigger` 在 `(-6, 0, 0)` 尺寸 `(4, 8, 4)`；`scriptedCameraTrigger` 在 `(-15, 1, 0)` | L82-L94 |
| StageBoundary | `minX: -8, maxX: 8` | L112 |
| WalkArea | `minX: -24, maxX: -7, minY: -1, maxY: 0.7` | L113 |
| DuelCameraRig | 全部 zoom/ortho/persp/height 参数 | L115-L125 |
| sharedContext | 直接引用 `character` / `rabbleStick` 实例 | L138-L173 |

### 1.2 BattleMode 中写死的（`scripts/Systems/Modes/BattleMode.js`）

| 类别 | 硬编码内容 |
|------|-----------|
| 战斗者 | `pushboxResolver.resolve([character, rabbleStick])` |
| 边界钳制 | `stageBoundary.clampCharacter(character)` + `rabbleStick` |
| 战斗 update | `combatSystem.fixedUpdate([character, rabbleStick], tickCount)` |
| 相机目标 | 二人 X 中点 |
| 退战 sequence | 整段硬编码在 `#checkBattleEnd()` 里 |

### 1.3 ExploreMode 中写死的（`scripts/Systems/Modes/ExploreMode.js`）

| 类别 | 硬编码内容 |
|------|-----------|
| 进战 sequence | 整段硬编码在 `#checkBattleTrigger()` 里 |
| 触发检查 | 只读 `context.scene.battleTrigger`（单个） |

---

## 2. 数据结构设计

### 2.1 SceneDef — 场景定义

```js
const SCENE_DEF_EXAMPLE = {
  id: "outdoor_village",                     // 场景唯一标识
  environment: DEFAULT_ENVIRONMENT_CONFIG,   // 复用 SceneVisualSystem 的 layers 配置
  camera: {
    defaultRig: "explore",                   // 进入该场景时的默认相机
  },
  entities: [
    {
      archetype: "hero_longsword",           // 工厂 archetype
      id: "hero",                            // 运行时 entity id
      name: "hero",
      pos: [-12, 0],                         // [x, y] 出生位置
      controller: "player",                  // controller 类型
      kind: "player",
    },
    {
      archetype: "rabble_stick",
      id: "enemy_1",
      name: "rabble_stick",
      pos: [3.2, 0],
      controller: "dummy",
      kind: "enemy",
    },
    {
      archetype: "npc_traveller",
      id: "npc_1",
      name: "npc",
      pos: [-14, -1],
      controller: "npc",
      kind: "npc",
    },
    {
      archetype: "npc_merchant",
      id: "merchant",
      name: "merchant",
      pos: [-11, -0.9],
      controller: "npc",
      kind: "npc",
    },
  ],
  walkArea: {
    minX: -24, maxX: -7,
    minY: -1,  maxY: 0.7,
  },
  triggers: [
    {
      type: "battle",
      id: "bt_field_1",
      pos: [-6, 0, 0],
      size: [4, 8, 4],                       // [width, height, depth]
      battleId: "battle_field_1",            // 引用 BattleDef.id
      debugColor: [0, 1, 0],                 // RGB
      debugVisible: false,
    },
    {
      type: "scriptedCamera",
      id: "sc_test_1",
      pos: [-15, 1, 0],
      size: [4, 8, 4],
      sequence: { /* ... */ },
      debugColor: [0, 0, 1],
      debugVisible: false,
    },
    {
      type: "sceneSwitch",
      id: "enter_house",
      pos: [4, 2.7, 0],
      size: [2, 4, 2],
      targetScene: "house_interior",
      targetSpawn: "door",                   // 目标场景中对齐的 spawn 点 id
    },
  ],
};
```

### 2.2 BattleDef — 战斗定义

```js
const BATTLE_DEF_EXAMPLE = {
  id: "battle_field_1",
  combatants: ["hero", "enemy_1"],           // entity id 列表（至少 2 个）
  stageBounds: { minX: -8, maxX: 8 },
  duelCamera: {                              // DuelCameraRig 构造参数
    zoomMinDistance: 3.2,
    zoomMaxDistance: 6.4,
    orthoMinWidth: 16,
    orthoMaxWidth: 32,
    perspMinDistance: 15,
    perspMaxDistance: 35,
    minCameraHeight: 3.2,
    maxCameraHeight: 5.2,
    targetAspect: 16 / 9,
  },
  enterSequence: {
    // Timeline sequence，从 ExploreMode.#checkBattleTrigger 搬出
    // 沿用现有 tracks 格式
  },
  exitSequence: {
    // Timeline sequence，从 BattleMode.#checkBattleEnd 搬出
  },
};
```

### 2.3 新增测试数据

#### HOUSE_ENVIRONMENT_CONFIG（室内环境配置）

```js
export const HOUSE_ENVIRONMENT_CONFIG = {
    layers: [
        {
            id: "BG_FAR",    // 复用 skybase
            z: 40,
            parallaxFactor: 0.15,
            renderingGroupId: 0,
            loopX: true,
            loopWidth: 40,
            elements: [ /* skybase tile */ ]
        },
        {
            id: "STAGE",     // 室内地板
            z: 10,
            parallaxFactor: 1.0,
            renderingGroupId: 1,
            loopX: false,
            elements: [
                {
                    id: "indoor_floor",
                    texture: "Art/Environment/Tavern_indoorstage.png",
                    kind: "single",
                    x: 0, y: -4.0,          // 调整后让地板顶部对齐行走高度
                    width: 30.72,           // 1024 * 0.03
                    height: 9.6,            // 320 * 0.03
                    alphaIndex: 1
                }
            ]
        }
    ]
};
```

#### HOUSE_INTERIOR（室内场景）

```js
export const HOUSE_INTERIOR = {
    id: "house_interior",
    environment: HOUSE_ENVIRONMENT_CONFIG,
    camera: { defaultRig: "explore" },
    entities: [
        {
            archetype: "hero_longsword",
            id: "hero",
            name: "hero",
            kind: "player",
            pos: [0, 0],
            controller: "player",
        },
        // 临时注释：单实体调试模式，后续恢复 enemy_1
    ],
    walkArea: {
        minX: -6.75, maxX: 13.98,    // 来自 Tavern_indoorstage.mask.json
        minY: -4.77, maxY: -1.65,
    },
    triggers: [
        {
            type: "sceneSwitch",
            id: "exit_house",
            pos: [0, -1, 0],
            size: [2, 2, 2],
            targetScene: "outdoor_village",
            targetSpawn: "house_door",
            debugColor: [1, 0.5, 0],
            debugVisible: false,
        },
        {
            type: "battle",
            id: "bt_field_2",
            pos: [2, 0, 0],
            size: [3, 6, 3],
            battleId: "battle_field_2",
            debugColor: [0, 1, 0],
            debugVisible: false,
        },
    ],
};
```

#### BATTLE_FIELD_2（第二场战斗）

```js
export const BATTLE_FIELD_2 = {
    id: "battle_field_2",
    combatants: ["hero", "enemy_1"],    // 临时用 rabble_stick 测试
    stageBounds: { minX: -5, maxX: 5 },
    duelCamera: {
        zoomMinDistance: 2.4,
        zoomMaxDistance: 5.0,
        orthoMinWidth: 12,
        orthoMaxWidth: 24,
        perspMinDistance: 12,
        perspMaxDistance: 28,
        minCameraHeight: 2.8,
        maxCameraHeight: 4.5,
        targetAspect: 16 / 9,
    },
    // enterSequence / exitSequence 待外部化
};
```

> **关联产出**：`Data/StageMask/Tavern_indoorstage.mask.json`（由 `extract_stage_masks.ps1` 扫描生成）
> - walkArea: AABB 数组
> - masks: pushbox + depthMask 合并数据（待 SceneVisualSystem / ExploreCollisionSystem 接入）

---

## 3. 改动范围

| 文件 | 改动摘要 |
|------|----------|
| `Scene.js` | `init(sceneDef, battleDefs)` — 从数据构建一切；新增 `loadScene(sceneDef)` — 场景切换 |
| `BattleMode.js` | `enter(battleDef)` — 从 battleDef 读 combatants / bounds / 相机参数；不再硬引用 `character` / `rabbleStick` |
| `ExploreMode.js` | 触发器列表改为遍历 `sceneDef.triggers`；进战 sequence 从 battleDef 读取 |
| `Systems/CombatSystem.js` | 可能需要微小调整（当前已接受 `characters[]`，问题不大） |
| `Systems/StageBoundary.js` | 支持动态更新边界范围（或按需重建） |
| `Systems/CameraManager.js` | 确认 `switchRig("duel")` 时能用新的 DuelCameraRig 参数 |
| **新增** `SceneDefs.js` | 存放所有 SceneDef 和 BattleDef 硬编码数据 + `HOUSE_ENVIRONMENT_CONFIG` |
| `sharedContext` | `character` / `rabbleStick` 等直接引用改为通过 `entityRegistry` 动态查找 |

---

## 4. 实施步骤

### Step A: 定义数据结构（不改行为）

- [x] 创建 `scripts/SceneDefs.js`，定义 `OUTDOOR_VILLAGE` + `BATTLE_FIELD_1`（复现当前场景）
- [x] 创建 `HOUSE_INTERIOR` + `HOUSE_ENVIRONMENT_CONFIG` + `BATTLE_FIELD_2`
- [x] 验证数据结构能完整表达当前所有功能

### Step B: 重构 Scene.init() 读 SceneDef ✅

- [x] `init()` 改为接收 `sceneDef, battleDefs` 参数
- [x] 实体创建：遍历 `entities[]`，根据 `archetype` 调用对应工厂函数
- [x] 触发器创建：遍历 `triggers[]`，按 `type` 创建 AABBTrigger
- [x] WalkArea、环境等从 sceneDef 读取
- [x] 环境配置：`sceneVisualSystem.init(sceneDef.environment ?? DEFAULT_ENVIRONMENT_CONFIG)`
- [x] 使用 `OUTDOOR_VILLAGE` 作为默认场景，回归验证行为不变
- [ ] `sharedContext` 完全改为通过 `entityRegistry` 动态查找（`character`/`rabbleStick` 直接引用仍保留，待场景切换时清理）

### Step C: 重构 BattleMode 读 BattleDef ✅

- [x] `enter(payload)` — 从 `payload.battleDef` 读取 combatants 列表
- [x] combatants 通过 `actorRegistry` 查找实例
- [x] StageBoundary 从 `battleDef.stageBounds` 读取（Scene.init 中已外部化）
- [x] DuelCameraRig 参数从 `battleDef.duelCamera` 读取（Scene.init 中已外部化）
- [x] 遍历 `this._combatants` 替代硬编码 `character`/`rabbleStick`（ExploreMode / sharedContext 已改为 entityRegistry 查找，character/rabbleStick 保留为 fallback）
- [x] enter/exit sequence 从 battleDef 读取（已搬入 BATTLE_FIELD_1 / BATTLE_FIELD_2，ExploreMode / BattleMode 改为读取）
- [x] 回归验证：现有单场战斗行为不变（户外 `OUTDOOR_VILLAGE` + `BATTLE_FIELD_1` 已验证 ✅）
- [ ] 回归验证：室内战斗 `HOUSE_INTERIOR` + `BATTLE_FIELD_2`（`enemy_1` 临时注释，待恢复后验证）

> **2026-06-14 备注**：Step C 全部完成。户外战斗流程（enter/exit）验证通过。室内战斗 `BATTLE_FIELD_2` 待 `enemy_1` 恢复后验证。

### Step D: 实现场景切换

- [ ] `Scene.loadScene(sceneDef)`：
  - 卸载当前 `entityPool` 中所有实体（dispose mesh、清理引用）
  - 清除当前 triggers
  - 根据新 sceneDef 重建实体、环境、触发器
  - 更新 `sharedContext` 引用
- [ ] ExploreMode 中 `type: "sceneSwitch"` 触发器的处理
- [ ] spawn 点对齐：`targetSpawn` 匹配目标场景中某实体位置

### Step E: 接入第二个场景测试

- [ ] 用 `HOUSE_INTERIOR` + `BATTLE_FIELD_2` 跑通完整流程：
  户外 → 走进屋子（场景切换）→ 室内战斗（新战斗）→ 出屋子（切回户外）
- [ ] 回归：户外原战斗仍可正常触发

---

## 5. 不确定项 / 待决策

1. **DuelCameraRig 替换时机**：当前 CameraManager 在 init 时注册 rig 实例，如果不同战斗有不同的 DuelCameraRig 参数，是每次进入战斗时新建 rig 实例，还是让 DuelCameraRig 支持 `updateOptions()`？

2. **sharedContext 瘦身**：当前 sharedContext 有 20+ 个字段，场景切换后需要批量替换。是继续维护这个大对象还是在 Scene 上提供 `getEntity(id)` / `getActiveBattle()` 等方法？

3. **hero 跨场景保持**：hero 从户外进入室内时，是销毁旧实例、新建实例（但保持 HP/状态），还是直接移动现有 hero 实例到新场景坐标？（后者更简单，但需要确保 hero 的 mesh 不被 unload 误销毁）

4. **环境视觉切换**：`SceneVisualSystem.init()` 当前只调一次。如果场景切换需要不同环境，是 `dispose()` 后重新 `init(newConfig)`，还是让 SceneVisualSystem 支持 `switchConfig()`？