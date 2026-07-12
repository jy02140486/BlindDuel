# Scene 生命周期与稳定对象上移重构计划（方案 1）

> **状态：B1-B10 全部完成并验证通过（2026-06-30）。保留本文档供 Prologue 开发对照排查。**
>
> **实际实现路径与计划的偏差**（Prologue 排查时注意）：
> - Scene 构造仍是 `new Scene(engine, canvas, {worldState, questManager, inventoryManager, game})`，未改为 `(game, sceneDef)` —— game 通过 options 注入，sceneDef 仍由 init 参数传入
> - Scene 入口仍是 `async init(sceneDef, battleDefs)`，未改名为 `load(spawnId)` —— spawnId 由 sharedContext/trigger 传入
> - 首场景由 `Game.init()` 直接 `scene.init()` 创建，**不走 `_loadSceneInternal`** —— 首场景无 fade 包裹，Prologue 若需首场景 fade 需单独处理
> - CameraManager.rebind 的 oldSceneId log 在切场景时仍显示同 uid（旧 camera 随 scene.dispose 销毁，getScene 返回 null fallback 到新 uid）—— 只是 log 精度问题，不影响功能
>
> 目标：解决 CameraManager/稳定系统跟 Scene 私有化导致的 DOM 泄漏 + fade 跨场景不连续 + 稳定系统频繁重建问题，同时保留 babylon scene.dispose 的资源管理便利。
> 方案：保留 babylon scene 生灭（享受引擎资源管理），将不依赖 babylon scene 的稳定对象上移到 Game；强依赖 babylon scene 的对象跟 scene 生灭。
> 不在范围：prologue 内容实施（本计划完成后启动）；多 scene 缓存复用；bard action 字符串迁移（prologue 计划处理）。

---

## 0. 决策清单

| 项 | 决策 |
|----|------|
| babylon scene | 保留生灭，切场景 `new Scene → 按 SceneDef 填充 → 用完 dispose` |
| CameraManager | 上移到 Game，唯一，overlay DOM 唯一不泄漏；增 `rebind(newScene, newCamera)` 切 scene 时换 camera |
| rigs | 上移到 Game（已是纯 compute，零改动，切 scene 无需 rebind） |
| CombatSystem/QuestManager/InventoryManager/WorldState | 上移到 Game |
| UI DOM（InventoryBar/BuffBar/HpBar/DialogueBubble） | 上移到 Game，一次性创建，切场景 update 内容 |
| StageBoundary/WalkArea/SceneVisualSystem/entities/triggers | 跟 scene 生灭 |
| InputSystem | 上移到 Game，去 babylon GamepadManager 依赖，手柄连接/断开改用原生 window 事件 |
| PlayerController | 上移到 Game，切场景 setCharacter |
| GameModeManager/SceneSequencer | 上移到 Game |
| sharedContext | Game 维护，切场景只换"当前 scene 引用"字段 |
| assets | Game 持有，bootstrap 加载一次缓存 |
| 切场景流程 | outro(若有,末段叠 fade-out) → oldScene.dispose → new Scene + 填充 → CameraManager.rebind → fade-in/intro |

---

## 1. 现状问题

### 1.1 CameraManager 私有化 + overlay DOM 泄漏
- [Scene.init:217](file:///e:/se/BlindDuel/scripts/Scene.js#L217) `new CameraManager` 是 Scene 私有
- [CameraManager._createOverlay](file:///e:/se/BlindDuel/scripts/Systems/CameraManager.js#L329) 每次 insertBefore 新 overlay
- [Scene.dispose](file:///e:/se/BlindDuel/scripts/Scene.js#L326) 不清 overlay DOM —— DOM 泄漏
- fade 必须"旧 manager fade-out + 新 manager fade-in"妥协，effects 状态不连续

### 1.2 rigs 频繁重建 + debug panel 泄漏
- [Scene.init:214-216](file:///e:/se/BlindDuel/scripts/Scene.js#L214) 每次切场景 new rigs
- [DuelCameraRig](file:///e:/se/BlindDuel/scripts/DuelCameraRig.js#L40) 构造往 document.body 塞 pre 元素，Scene.dispose 不清

### 1.3 纯逻辑系统/UI 频繁重建
- CombatSystem/UI DOM 切场景重建，旧 DOM 不清

### 1.4 InputSystem 跟 babylon scene 耦合
- [InputSystem:47](file:///e:/se/BlindDuel/scripts/Systems/InputSystem.js#L47) `new BABYLON.GamepadManager(scene)` —— 唯一耦合
- 键盘已绑 window、手柄状态读取走 navigator.getGamepads() —— 唯一耦合是 GamepadManager 的连接/断开通知
- 切场景 GamepadManager 跟 scene.dispose 销毁，新 scene 不重发 connected 事件 —— connected 状态可能丢失（潜在 bug）

### 1.5 Game 形同薄壳
- [Game.js:23-29](file:///e:/se/BlindDuel/scripts/Game.js#L23-29) Game 只持 WorldState/QuestManager/InventoryManager/Scene
- babylon scene/CameraManager/rigs/稳定系统全是 Scene 私有

### 1.6 assets 每次切场景重载
- [Scene.init:79](file:///e:/se/BlindDuel/scripts/Scene.js#L79) 每次切场景都 loadDataAssets

---

## 2. 目标架构

### 2.1 新分层

- **Game（跨场景稳定）**：WorldState/QuestManager/InventoryManager、CameraManager(+rigs)、CombatSystem、InputSystem、PlayerController、GameModeManager(+BattleMode/ExploreMode)、SceneSequencer、UI DOM、assets、sharedContext
- **Scene（轻量，切场景 new）**：babylon Scene、light/camera、StageBoundary/WalkArea/SceneVisualSystem、entities/actorRegistry/controllerRegistry/entityPool、triggers/stageMaskData、currentSceneDef

### 2.2 sharedContext 字段归属

- **稳定（Game 创建一次）**：game, cameraManager, cameraRig, exploreCameraRig, scriptedCameraRig, combatSystem, inputSystem, playerController, gameModeManager, sceneSequencer, inventoryManager, questManager, worldState, inventoryBar, buffBar, hpBar, dialogueBubble, cameraBasePosition, cameraTarget, smoothedFighterDistance, assets
- **跟 scene（切场景重建）**：scene, babylonScene, character, rabbleStick, actorRegistry, entityPool, triggers, stageMaskData, walkArea, stageBoundary, sceneVisualSystem, camera

### 2.3 切场景流程

1. requestSceneSwitch 收到请求
2. 若当前 SceneDef 有 outroSequence → 播 outro，末段叠 fade-out；否则直接 enqueueEffect(fade-out)
3. 等 CSS transition 播完
4. oldScene.dispose()（scene.dispose 一行清所有跟 scene 资源）
5. new Scene(game, sceneDef) → load(spawnId)（new babylon scene + light + camera + 按 SceneDef 填 StageBoundary/WalkArea/SceneVisualSystem/entities/triggers）
6. cameraManager.rebind(newScene.babylonScene, newScene.camera)（InputSystem 无需 rebind，已去 babylon 依赖）
7. 更新 sharedContext 跟 scene 字段
8. hero 放 spawn + 恢复 hp/buffs/inventory
9. 若 newSceneDef 有 introSequence → 播 intro（首步 fade-in）；否则 enqueueEffect(fade-in)

### 2.4 关键接口契约（仅签名，不写实现）

- `CameraManager.rebind(newScene, newCamera)`：换绑定的 scene/camera，overlay 不动，rigs 不动
- `CameraManager.dispose()`：清 overlay DOM、rigs、effects
- `InputSystem` 构造签名从 `(scene, options)` 改为 `(options)`，删 `BABYLON.GamepadManager`，改用 `window.addEventListener("gamepadconnected"/"gamepaddisconnected")`
- `Scene` 构造接 `(game, sceneDef)`，`async load(spawnId)` 建 babylon scene + 填充，`dispose()` 调 babylonScene.dispose
- `Game.bootstrap()`：一次性建所有稳定对象 + 加载 assets
- `Game.requestSceneSwitch(sceneDef, spawnId)`：执行 §2.3 流程
- `Game._loadSceneInternal(sceneDef, spawnId, { withFadeIn })`：dispose 旧 + new Scene + rebind + 更新 sharedContext + hero spawn + fade-in/intro

---

## 3. 分步实施

> **验证原则**：每步只验证"改动本身的功能"（log/控制台可观察），不要求游戏逻辑完整。中间步骤允许游戏功能暂时失效，所有步骤完成后游戏逻辑完整性恢复即算成功。

### 阶段一：建新路径（Game 侧增量，Scene 完全不动，游戏正常）

| 步骤 | 文件 | 改动 | 验证（log/控制台） | 状态 |
|------|------|------|------|------|
| B1 | Game.js | 加 `bootstrap()`，创建稳定对象（CameraManager/InputSystem/rigs/UI/CombatSystem/PlayerController/GameModeManager/SceneSequencer），不接入；Scene 仍用私有实例 | log 打印创建成功；`game.cameraManager` 非空 | ✅ |
| B2 | Game.js | bootstrap 中 `loadDataAssets` 一次存 `game.assets`；Scene.init 仍自己加载（双加载） | log 打印加载完成；`game.assets` 非空 | ✅ |
| B3 | CameraManager.js | 加 `rebind(newScene,newCamera)` + `dispose()`，不改 init | `game.cameraManager.rebind` 为 function；手动调不报错 | ✅ |
| B4 | InputSystem.js | 已完成（`(options)` 签名 + 原生 window 事件），仅验证 | `new InputSystem({debugEnabled:true})` 不报错；gamepadconnected log | ✅ |

### 阶段二：切换接管（逐系统，允许过渡期功能失效）

| 步骤 | 文件 | 改动 | 验证（log/控制台） | 状态 |
|------|------|------|------|------|
| B5 | Scene.js | init/load 从 `game.assets` 取，删自己的 `loadDataAssets` | 日志确认 assets 不再重复加载 | ✅ |
| B6 | Scene.js | 不再 `new CameraManager`，改用 `game.cameraManager`；load 末尾调 `rebind(scene,camera)` | log 打印 rebind 调用；切场景前后 body 下 overlay div 数量不增 | ✅ |
| B7 | Scene.js | 不再 `new InputSystem`，改用 `game.inputSystem`（删 scene 参数） | 键盘/手柄事件 log；切场景后手柄仍可用 | ✅ |
| B8 | Scene.js | rigs/CombatSystem/UI/PlayerController/GameModeManager/SceneSequencer 改用 game 实例；sharedContext 由 game 维护 | 各系统初始化 log；三场景切换尝试 | ✅ |

### 阶段三：场景切换接管 + 清理

| 步骤 | 文件 | 改动 | 验证（log/控制台） | 状态 |
|------|------|------|------|------|
| B9 | Game.js, Scene.js | Game 加 `requestSceneSwitch`/`_loadSceneInternal`；Scene.`_loadScene` 转发到 game | 切场景走 Game 路径 log；oldScene.dispose 后 newScene 创建 log | ✅ |
| B10 | Scene.js, character_demo.js, Game.js | 删 Scene 废弃私有字段/import；character_demo 改 `game.bootstrap()`；Game.init 改调 bootstrap | **完整性恢复**：三场景切换正常、DOM 不泄漏、hp/buffs/inventory 跨场景保持、手柄跨场景可用 | ✅ |

---

## 4. 影响面

| 文件 | B1 | B2 | B3 | B4 | B5 | B6 | B7 | B8 | B9 | B10 |
|------|----|----|----|----|----|----|----|----|----|-----|
| scripts/Game.js | ✓ | ✓ | | | | | | ✓ | ✓ | ✓ |
| scripts/Systems/CameraManager.js | | | ✓ | | | ✓ | | | | |
| scripts/Systems/InputSystem.js | | | | ✓ | | | ✓ | | | |
| scripts/Scene.js | | | | | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| assets 加载（DataLoader/AssetManifest） | | ✓ | | | ✓ | | | | | |
| scripts/Systems/Modes/ExploreMode.js | | | | | | | | ✓ | | |
| scripts/Systems/Modes/BattleMode.js | | | | | | | | ✓ | | |
| scripts/Systems/SceneSequencer.js | | | | | | | | ✓ | | |
| character_demo.js | | | | | | | | | | ✓ |

---

## 5. 验证清单

> 原则：每步只验证"改动本身的功能"（log/控制台可观察），不要求游戏逻辑完整。中间步骤允许游戏功能暂时失效，B10 恢复完整性。

### B1 完成后（Game 建影子）
- [x] log 打印稳定对象创建成功
- [x] `game.cameraManager`/`game.inputSystem`/`game.combatSystem` 等非空
- [x] Scene 仍用私有实例，游戏行为零变化

### B2 完成后（assets 上移到 game）
- [x] log 打印 assets 加载完成
- [x] `game.assets` 非空
- [x] Scene 仍自己加载 assets（双加载），游戏行为零变化

### B3 完成后（CameraManager 加 rebind/dispose）
- [x] `game.cameraManager.rebind` 为 function
- [x] `game.cameraManager.dispose` 为 function
- [x] 手动调 rebind/dispose 不报错

### B4 完成后（InputSystem 去 babylon）
- [x] `new InputSystem({debugEnabled:true})` 不报错
- [x] 原生 gamepadconnected/gamepaddisconnected 事件能收到，connected/id/index 正确更新
- [x] 手柄 axes/buttons 状态读取正常
- [x] 键盘事件正常

### B5 完成后（assets 切换）
- [x] 日志确认 Scene 不再调用 loadDataAssets
- [x] Scene 从 `game.assets` 取到资源

### B6 完成后（CameraManager 切换）
- [x] log 打印 rebind 调用
- [x] 切场景前后 body 下 overlay div 数量不增
- [x] 相机画面正常

### B7 完成后（InputSystem 切换）
- [x] log 打印使用 game.inputSystem
- [x] 切场景后手柄仍可用
- [x] 键盘事件正常

### B8 完成后（其余稳定对象切换）
- [x] 各系统初始化 log 正常
- [x] rigs/UI DOM 全程同一组（body 下 pre/div 不增加）
- [x] GameModeManager/SceneSequencer 指向 game 实例

### B9 完成后（场景切换接管）
- [x] 切场景走 Game.requestSceneSwitch 路径 log
- [x] oldScene.dispose 后 newScene 创建 log
- [x] CameraManager.rebind 在切场景时被调用

### B10 完成后（完整性恢复）
- [x] character_demo.js 启动正常，无报错
- [x] outdoor_village / house_interior / prologue 三场景切换正常
- [x] CameraManager 全程同一个（overlay div 只有 1 个）
- [x] DuelCameraRig debug panel 全程同一个（body 下 pre 元素不增加）
- [x] InputSystem 全程同一个（切场景后手柄仍可用）
- [x] assets 只加载一次
- [x] babylon scene 切场景时确实 dispose（debugLayer 不累积）
- [x] 切场景 entities/triggers/walkArea/environment 重建
- [x] hp/buffs/inventory 跨场景保持
- [ ] 战斗触发 + 胜利 + 场景切换正常（Prologue 阶段验证）
- [ ] resetWorldState 后从 prologue 重启（Prologue 阶段验证）

---

## 6. 实施顺序建议

- **阶段一（B1-B4）**：纯增量，Scene 不动，每步独立验证
- **阶段二（B5-B8）**：逐系统切换，允许过渡期功能异常，每步 log/DOM 验证
- **阶段三（B9-B10）**：场景切换接管 + 清理，B10 恢复完整性

每步结束做一次验证再进下一步。阶段二中间步骤游戏可能跑不顺，是预期行为，B10 完成后恢复。

---

## 7. Prologue 开发排查对照

重构已按 B1-B10 完成。Prologue 开发若遇到场景/相机/UI 相关问题，先对照以下实际实现点（与 §2 目标架构的偏差）：

### 7.1 实际入口与命名
- `Scene` 构造仍为 `new Scene(engine, canvas, {worldState, questManager, inventoryManager, game})`，**未改为 `(game, sceneDef)`** —— game 通过 options 注入
- `Scene` 入口仍为 `async init(sceneDef, battleDefs)`，**未改名为 `load(spawnId)`** —— spawnId 由 sharedContext/trigger 传入
- `character_demo.js` 仍调 `game.init()`（内部调 `bootstrap()`），**未改为直接 `game.bootstrap()`**

### 7.2 首场景的特殊路径
- 首场景由 `Game.init()` 直接 `await this.scene.init(sceneDef, BATTLE_DEFS)` 创建，**不走 `_loadSceneInternal`**
- 因此首场景：
  - 无 fade-out/fade-in 包裹
  - 无 `_loading` 保护（首场景 init 时渲染循环尚未启动或 scene 已就绪）
  - 无 hp 恢复逻辑（首场景 hero 用 SceneDef 默认 hp）
- **Prologue 若需首场景 fade-in/intro**：需在 `Game.init()` 调 `scene.init` 后补 fade 包裹，或让首场景也走 `_loadSceneInternal`

### 7.3 切场景流程（B9 实现）
- 触发点：`ExploreMode` 调 `game.requestSceneSwitch(sceneDef, spawnId)`
- `requestSceneSwitch` → `_loadSceneInternal`：
  1. 创建 newScene，设 `_loading = true`，`this.scene = newScene`（先切引用再 dispose old）
  2. `oldScene.dispose()`
  3. `await newScene.init(sceneDef, BATTLE_DEFS)`
  4. `_loading = false`
  5. 恢复 hp（从 savedHp）、buffs、inventory
- **未实现 fade 包裹**（原计划 §2.3 的 outro/fade-out/fade-in 未做）—— Prologue 若需 fade，需在此处补

### 7.4 已知 log 精度问题
- `CameraManager.rebind` 的 oldSceneId log 在切场景时显示同 uid（旧 camera 随 scene.dispose 销毁，`getScene()` 返回 null fallback 到新 uid）—— 不影响功能，排查时勿被误导

### 7.5 dispose 验证盲点
- 网页游戏关页面时浏览器自动回收 DOM/事件监听，`Game.dispose()` 的清理逻辑无法在控制台观察
- `Game.dispose()` 是防御性代码（供热重载/重开用），日常运行不触发，无需专门验证

### 7.6 待 Prologue 验证的项
- 战斗触发 + 胜利 + 场景切换联动
- resetWorldState 后从 prologue 重启
- fade 跨场景连续性（需先实现 fade 包裹）

---

## 8. 已知架构债（本次不处理）

1. 多 scene 缓存复用（未来若性能瓶颈再做）
2. bard action 字符串迁移（prologue 计划 Step 4 处理）
3. ExploreMode/BattleMode 缓存引用排查（Step 6 逐 mode 排查，可能有遗漏）

---

## 8. 与 prologue 内容计划的衔接

本计划完成后，prologue 内容计划的 Step 2（场景切换 fade 包裹）大幅简化——CameraManager 跨场景稳定，fade-out/fade-in 同一个 manager 接管，rebind 切 camera 即可。Step 3（clamp 旁路/播片优先）基于 sceneSequencer.isBusy() 判断，与本重构无冲突。其余 Step 基本不受影响。

建议本重构完成、回归验证通过后，再启动 prologue 内容计划。