# 项目上下文（Project Context）
## 0. 前置工作
- 读andrej-karpathy-skills-CLAUDE.MD，所有的工作都要遵守里面的规则
## 1. 项目概况
- 项目名：`GeminiPrototype-BlindBattle`
- 当前目标：构建 2D 角色在 Babylon 中的战斗 + 探索双模式原型（动画播放 + 碰撞盒可视化 + 帧同步 + NPC 交互 + 场景探索）
- 当前阶段：原型验证阶段（先保证"看得见、对得上、能迭代"）

## 2. 技术与运行环境
- 核心语言：`HTML / CSS / JavaScript`
- 渲染引擎：`Babylon.js`（CDN）
- 资源制作：`LibreSprite 1.1-dev`
- 本地运行方式：必须走本地 HTTP 服务（不能直接双击 html）

推荐启动命令：
```powershell
cd .\
py -m http.server 9000 --bind 127.0.0.1
```
访问：`http://127.0.0.1:9000/babylon_demo.html`

## 3. 当前目录与关键文件
- 演示入口：`index.html` / `babylon_demo.html`
- 角色演示主逻辑：`character_demo.js`
- 资源清单：`scripts/AssetManifest.js`
- 资源加载器：`scripts/DataLoader.js`
- 场景主类：`scripts/Scene.js`
- 基础实体类：`scripts/Enties/CharacterBase.js`
- 战斗角色类：`scripts/Enties/CombatCharacter.js`
- NPC 实体类：`scripts/Enties/NpcCharacter.js`
- 道具实体：`scripts/Enties/PropEntity.js`（过场动画用，hold/loop 双模式，不进 NpcController）
- 场景视觉系统：`scripts/Enties/SceneVisualSystem.js`
- AABB 触发器：`scripts/Enties/AABBTrigger.js`
- 行走区域：`scripts/Enties/WalkArea.js`
- 动画组件：`scripts/Components/FrameAnimationComponent.js`
- NPC 帧动画组件：`scripts/Components/NpcFrameComponent.js`（支持多帧 tag 循环播放）
- 动画瓦片组件：`scripts/Components/AnimatedTileComponent.js`
- 碰撞组件：`scripts/Components/CollisionComponent.js`
- 时间控制组件：`scripts/Components/TimeControlComponent.js`
- 状态图定义：`Data/StateGraphDef/LongSwordMan.json`
- Rabble Stick 状态图：`Data/StateGraphDef/RabbleStick.json`
- Merchant 状态图：`Data/StateGraphDef/Merchant.json`
- 战斗接触解析：`scripts/Systems/ContactResolver.js`
- 战斗系统编排：`scripts/Systems/CombatSystem.js`
- NPC 控制器：`scripts/Systems/NpcController.js`
- NPC 行为基类：`scripts/Systems/NpcBehaviors/NpcBehavior.js`（策略模式）
- 跟随行为：`scripts/Systems/NpcBehaviors/FollowingBehavior.js`（同伴跟随）
- 时间控制系统：`scripts/Systems/TimeControlSystem.js`
- 游戏模式管理器：`scripts/Systems/GameModeManager.js`
- 场景序列器：`scripts/Systems/SceneSequencer.js`（支持 `STEP_TYPE` 整数枚举 step）
- 时间轴序列器：`scripts/Systems/TimelineSequencer.js`（多 track + clip + callback handler，文档见 `docs/TimelineSequencer.md`）
- 过场序列文件：`Data/Sequences/*.json`（prologue_intro / prologue_outro / prologue_cs_rabble_flee）
- TimelineSequencer 用户文档：`docs/TimelineSequencer User Guide.md`
- 相机管理器：`scripts/Systems/CameraManager.js`
- 决斗相机：`scripts/DuelCameraRig.js`
- 探索相机：`scripts/ExploreCameraRig.js`
- 演出相机：`scripts/ScriptedCameraRig.js`（正交固定画幅，sequence 专用）
- 舞台边界：`scripts/Systems/StageBoundary.js`
- 推盒解析器：`scripts/Systems/PushboxResolver.js`
- 探索碰撞系统：`scripts/Systems/ExploreCollisionSystem.js`
- 角色工厂：`scripts/CharacterFactory.js`（四条装配路径：hero / rabble / traveller / merchant）
- 场景/战斗定义：`scripts/SceneDefs.js`（SceneDef + BattleDef 硬编码数据 + `createEntityFromDef` 工厂）
- 场景定义注册表：`scripts/SceneDefRegistry.js`（硬编码 SceneDef 注册 + 异步 fetch JSON 缓存 + 同步查表 fallback）
- Prologue 场景定义：`Data/SceneDefs/prologue.json`（首个外部化 SceneDef，三层视差环境）
- 场景里程碑定义：`Data/ScenarioMilestones.js`（scenario 枚举常量）
- 世界状态：`scripts/WorldState.js`（scenario / flags / quests / sceneStates）
- 任务管理器：`scripts/Systems/QuestManager.js`（WorldState 唯一写入入口）
- 背包管理器：`scripts/Systems/InventoryManager.js`
- 玩家控制器：`scripts/Systems/PlayerController.js`（输入 → 移动 + 指令队列 + buff 管理）
- 可拾取实体：`scripts/Enties/PickableEntity.js`（轻量实体，不继承 CharacterBase）
- UI 组件：`scripts/UI/InventoryBar.js`、`scripts/UI/BuffBar.js`、`scripts/UI/HpBar.js`
- 游戏入口：`scripts/Game.js`（WorldState / QuestManager / InventoryManager / Scene 的顶层组装）
- 计划文档：`plans/` 目录（已完成计划归档在 `plans/archived/`）

资源：
- 动画图集：`Art/Sprite/longswordman/`、`Art/Sprite/rabble_stick/`、`Art/Sprite/NPCs/`
- 碰撞蒙版图集：`Data/CollisionMask/longswordman/`、`Data/CollisionMask/rabble_stick/`
- 根运动数据：`Data/RootMotion/longswordman/`、`Data/RootMotion/rabble_stick/`、`Data/RootMotion/NPCs/`
- NPC 占用盒数据：`Data/RootMotion/NPCs/*.occupancy.json`
- 碰撞扫描输出：`Data/CollisionMask/**/*.collider.json`

离线工具：
- 碰撞扫描脚本：`scripts/tools/extract_collision_boxes.ps1`
- NPC 占用盒提取脚本：`scripts/tools/extract_rootmotion_occupancy.ps1`
- 注意：旧路径 `scripts/extract_collision_boxes.ps1` 可能仍存在（文件锁），后续可再清理

## 4. 动态状态
> 当前进行中的计划、已完成事项与最近归档（含 Update Log）统一见 [plans/INDEX.md](plans/INDEX.md)，不再在此重复维护，避免双份不同步。

## 5. 当前碰撞数据与约定
1. 扫描颜色约定：
   - `#FFFF00`：`hitbox`
   - `#E37800`：`weaponbox` + `subtype = strong_blade`
   - `#FF0000`：`weaponbox` + `subtype = weak_blade`
   - `#7082C1`：`root`
2. 每帧可有多个矩形，导出为 OBB：`cx, cy, w, h, angle`。
3. 跨帧 `id` 采用跟踪分配（位置连续性优先，尺寸变化允许）。
4. 碰撞盒厚度约定：`40`（2D 数据无厚度，先固定）。
5. 当前扫描脚本会将 `CollisionMask` 与 `RootMotion` 汇总导出为单个 `.collider.json`。
6. `.collider.json` 中约定：
   - `frames[].boxes[]`：碰撞盒
   - `frames[].anchors.root`：root 锚点
7. 当前 `pushbox` 概念仍保留，但本轮尚未新增其扫描颜色与运行时逻辑。
8. 当前 `weaponbox` 采用 `type = weaponbox` + `subtype = strong_blade / weak_blade`，不新增独立顶层 type。
9. NPC 使用独立的轻量碰撞数据格式（`rootMotionOccupancyData`），由 `scripts/tools/extract_rootmotion_occupancy.ps1` 生成，仅含每帧 `anchors.root` + 固定尺寸 `occupancy.aabb`，不依赖 `.collider.json`。

## 6. 当前已知限制与注意点
1. LibreSprite 1.1-dev 不便直接写文本标签，当前主要走"颜色 + 几何扫描 + 外置 JSON"方案。
2. 若同帧多个矩形相互接触/重叠，会在连通域阶段被合并，需要绘制时留间隔。
3. 直接执行 `.ps1` 可能被本机 PowerShell `ExecutionPolicy` 拦截；必要时可通过 `powershell -ExecutionPolicy Bypass -File ...` 运行离线扫描脚本。
4. `weaponbox` 的 debug 显示由 `CollisionComponent` 负责；`root` 点的 debug 显示由 `Character` 负责，二者统一跟随 `C` 键显隐。
5. 当前项目尚未在 sprite 资源中增加额外"方向数据"字段；阶段性约定建议以运行时 `facing` 为主，默认资源原始朝向视为"面向右"，左向优先通过镜像获得。
6. `ContactResolver` 当前碰撞判定使用 AABB 简化（忽略 OBB 旋转角），属于原型阶段实现。
7. 攻击结束当前按"当前帧是否仍存在 `attackInstanceId`"隐式判断；若后续出现"中间空帧再出刀"动作，需要改为更显式的生命周期机制。
8. `ImpactContext` 已增加生命周期守卫（`expectedStateAtResolve` + `stateEntrySerialAtCreate`），用于避免过期 `nextState` 在 `impact` 结束时误跳转。
9. `ContactResolver` 当前采用"同一攻击实例对同一目标只取首次结果"的规则：若该 `attackInstanceId|targetId` 已产生 `hit`，后续 guard/parry 不再覆盖该结果。
10. 场景切换触发器（sceneSwitch）需要玩家按交互键（E/J/手柄X）才能触发，防止室内外双向 trigger 重叠导致的死循环切换。
11. AABBTrigger debug 网格使用 `renderingGroupId = 3` 确保渲染在最上层，不被场景元素遮挡。
12. `pickable` 的 sceneStates 持久化（`markPickableCollected`）已就绪，拾取时写入 + 加载时 spawnIf 过滤均已实现。
13. Scene 不再持有稳定对象别名字段（cameraManager/cameraRig/playerController 等），业务方法统一通过 `this._game.xxx` 或 `this.sharedContext.xxx` 访问；稳定对象生命周期归 Game。
14. CharacterBase 有 `controlledBySequence` 标记：sequencer 的 moveActorTo 期间设 true，阻止 controller 覆盖 moveIntent 和 transition 评估，同时 `_applyMovement` 开头加守卫跳过 frameSpeeds/stateSpeed/moveIntent 三个位移分支，确保 sequencer 期间 position 写入来源唯一（只有 moveActorTo 的绝对设置），消除位置双写。`ExploreCollisionSystem.resolveMovement` 也加同样守卫，sequencer 期间跳过 staticBlockers 推开 + walkArea clamp（避免 moveActorTo 走到 walkArea 边界外被钳回）。NpcCharacter/PropEntity 不需要该标记（无 transition 覆盖问题），但 NpcCharacter 的 idle/following 行为由 IdleBehavior/FollowingBehavior 数据驱动（idle clip 配置在 NpcDef）。
15. sequencer 期间 ExploreMode 子系统门控：`sceneSequencer.isBusy()` 期间，①`NpcController.update` 的 idle→greeting 转换跳过（避免气泡误触）②`ExploreMode.#updateDialogueBubble` 跳过（避免把 sequencer 显式 show 的气泡误 hide）③`moveActorTo` 的 `controlledBySequence` 标记让 ExploreCollisionSystem 早退。气泡的显隐完全由 `dialogueBubble` clip 控制（见 TimelineSequencer 文档 §5.12），位置更新照常跑（视锥剔除正常生效，NPC 出相机视野时气泡自动隐藏）。

## 7. 当前文件结构
> 文件清单见 §3「当前目录与关键文件」（含职责说明），不再单独维护树形结构，避免双份不同步。



## 8. 协作约定（给后续 AI/开发）
1. 先保证可运行与可验证，再做结构优化。
2. 优先保持数据驱动：动画和碰撞都以外部 JSON 为准。
3. 计划文档统一组织在 `plans/` 目录，已完成文档归档到 `plans/archived/`。
4. 涉及大改（状态机/架构）先出方案再改代码。
5. 与用户沟通默认使用中文，给其它 AI 的交接文档也用中文，编码统一 UTF-8。

## 9. 关键路径索引（调用链 → 源文件）

### 9.1 顶层编排
```
Scene (scripts/Scene.js)
  -> GameModeManager (scripts/Systems/GameModeManager.js)
     -> ExploreMode (scripts/Systems/Modes/ExploreMode.js)
     -> BattleMode (scripts/Systems/Modes/BattleMode.js)
  -> SceneSequencer (scripts/Systems/SceneSequencer.js)
     -> TimelineSequencer (scripts/Systems/TimelineSequencer.js)
  -> CameraManager (scripts/Systems/CameraManager.js)
     -> DuelCameraRig (scripts/DuelCameraRig.js)
     -> ExploreCameraRig (scripts/ExploreCameraRig.js)
     -> ScriptedCameraRig (scripts/ScriptedCameraRig.js)
  -> CombatSystem (scripts/Systems/CombatSystem.js)
     -> ContactResolver (scripts/Systems/ContactResolver.js)
     -> PushboxResolver (scripts/Systems/PushboxResolver.js)
     -> StageBoundary (scripts/Systems/StageBoundary.js)
  -> SceneVisualSystem (scripts/Enties/SceneVisualSystem.js)
  -> QuestManager (scripts/Systems/QuestManager.js)
  -> InventoryManager (scripts/Systems/InventoryManager.js)
```

### 9.2 主循环
```
character_demo.js
  -> Scene.fixedUpdate()
     -> SceneSequencer.fixedUpdate()
     -> GameModeManager.fixedUpdate()
        -> ExploreMode/BattleMode.fixedUpdate()
           -> InputSystem (scripts/Systems/InputSystem.js)
           -> PlayerController / AIController / NpcController
           -> CombatSystem.fixedUpdate()
  -> Scene.updateRender()
     -> GameModeManager.updateRender()
        -> ExploreMode/BattleMode.updateRender()
           -> 写 context.target / basePosition
           -> SceneVisualSystem.update()
     -> CameraManager.update()
        -> activeRig.compute()
        -> _applyToBabylonCamera()
```

### 9.3 进入战斗
```
ExploreMode.#checkBattleTrigger()
  -> sceneSequencer.play(enterBattleSequence)
     -> TimelineSequencer 驱动 cameraBlend / waitUntil / moveActorTo 等 step
  -> switchMode("battle")
  -> BattleMode.enter()
     -> CameraManager.switchRig("duel")
     -> CombatSystem 激活
```

### 9.4 相机更新
```
BattleMode / ExploreMode.updateRender()
  -> 写入 context.target / basePosition（角色连线中点 / 主角位置）
  -> CameraManager.update()
     -> activeRig.compute(context)
     -> _applyToBabylonCamera()（平滑插值写入 Babylon Camera）
```

### 9.5 控制器链路
```
InputSystem (scripts/Systems/InputSystem.js)
  -> PlayerController (scripts/Systems/PlayerController.js)
  -> AIController (scripts/Systems/AIController.js)
     -> AIKnowledgeRegistry (scripts/Systems/AIKnowledgeRegistry.js)
  -> NpcController (scripts/Systems/NpcController.js)
  -> TestController (scripts/Systems/TestController.js)
  -> DummyController (scripts/Systems/DummyController.js)
```

### 9.6 WorldState / QuestManager 写入链路
```
BattleMode.onVictory → questManager.advanceTo(scenario) / setFlag()
NpcController.action  → questManager.executeAction(actionName) / executeDirectives()
ExploreMode.pickup    → questManager.markPickableCollected() / setQuestStage()
      ↓
  QuestManager → world.setScenario() / world.setFlag()（触发 _notify）
      ↓
  WorldState (scenario / flags / quests / sceneStates) — 观察者模式
      ↓
  Scene._onWorldStateChange() → 遍历 _pendingSpawns → _spawnEntity()
      ↓
Scene.init() 查询 → Entity spawnIf 过滤 + Trigger condition 启用/禁用
（运行时 spawnIf 满足 → 动态 spawn + controller 绑定 + ExploreMode 重建索引）
```

### 9.7 场景切换链路
```
ExploreMode.#updateSceneSwitchTrigger()
  → 检测 hero 与 sceneSwitch trigger 重叠
  → 交互键按下 → scene._pendingSceneLoad = { sceneDef, spawnId }
  → Scene.fixedUpdate() 消费 _pendingSceneLoad
  → Scene._loadScene() → dispose() → init() → hero 放置到 spawn 点
```
