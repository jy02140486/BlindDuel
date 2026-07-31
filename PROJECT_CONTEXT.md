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
- 帧时钟（权威时间源）：`scripts/Systems/FrameClock.js`（全游戏唯一时钟，Hybrid 模型 fixedTime + accumulator，详见 `plans/archived/统一时间源与 Render 采样架构设计.MD`）
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
- 音频系统入口：`scripts/Systems/AudioManager.js`（Game 持有，Scene 通过 `this._game.audioManager` 访问）
- 音频数据库：`scripts/Systems/Audio/AudioDatabase.js`（AudioId → Clip Definition）
- 音频池：`scripts/Systems/Audio/AudioPool.js`（基于 `BABYLON.Sound` 的缓存与复用）
- 音频播放器：`scripts/Systems/Audio/AudioPlayer.js`（随机 Clip + 音量 + Pitch + 频率限制）
- 音乐播放器：`scripts/Systems/Audio/MusicPlayer.js`（BGM 管理 + crossfade/cut 状态机，lazy load + onload pending play）
- 环境音播放器：`scripts/Systems/Audio/AmbientPlayer.js`（多轨 ambient 管理，lazy load + pending play，与 MusicPlayer 模式对称）
- 音频配置：`Data/Audio/audio_clips.json`（事件→音效映射，每条 def 含 `bus` 字段作为资源属性）+ `Data/Audio/audio_buses.json`（5 条总线 master/music/sfx/ui/ambient）+ `Data/Audio/music_clips.json`（BGM 定义）
- 音频设计稿（已归档）：`plans/archived/AudioSystemDesign.MD`（v0.2，Step 1-5 全部落地；§8「与 Animation 集成」由 AnimationEventSystemDesign 接管）
- 动画事件系统设计稿（已归档）：`plans/archived/AnimationEventSystemDesign.MD`（v0.1，三层架构 Animation → AnimationEvent → Presentation Systems；Step 6a/6b 已落地，Step 6c 后置）
- 动画事件资源目录：`Data/AnimationEvents/<char>/*.events.json`（sidecar 模式，与 atlas 对齐；战斗角色每 clip 一文件，NPC 一文件含所有 clip）
- 音频工具用户文档：`docs/Audio Tools User Guide.MD`
- 游戏入口：`scripts/Game.js`（WorldState / QuestManager / InventoryManager / AudioManager / Scene 的顶层组装）
- 计划文档：`plans/` 目录（已完成计划归档在 `plans/archived/`）

资源：
- 动画图集：`Art/Sprite/longswordman/`、`Art/Sprite/rabble_stick/`、`Art/Sprite/NPCs/`
- 碰撞蒙版图集：`Data/CollisionMask/longswordman/`、`Data/CollisionMask/rabble_stick/`
- 根运动数据：`Data/RootMotion/longswordman/`、`Data/RootMotion/rabble_stick/`、`Data/RootMotion/NPCs/`
- NPC 占用盒数据：`Data/RootMotion/NPCs/*.occupancy.json`
- 碰撞扫描输出：`Data/CollisionMask/**/*.collider.json`
- 音频原始合包：`Audio/sfx/_raw/*.wav` + `sliceinfo.txt`（不入 AssetManifest）
- 音频切片中间产物：`Audio/sfx/<合包名>/slice_NN.wav`（仍为源格式）
- 音乐资源：`Audio/music/*.wav`（待定）
- 运行时 sfx 资源：`Audio/sfx/combat/*.wav`、`Audio/sfx/<分类>/`（入 AssetManifest `audio.sfx` 分组）

离线工具：
- 碰撞扫描脚本：`scripts/tools/extract_collision_boxes.ps1`
- NPC 占用盒提取脚本：`scripts/tools/extract_rootmotion_occupancy.ps1`
- 音频切片脚本：`scripts/tools/slice_audio_pack.ps1`（Mode: Scan / Slice / EvenSplit / EvenSplitBatch）
- 音频格式转换脚本：`scripts/tools/convert_audio_format.ps1`（采样率/位深/声道转换）
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
6. PowerShell 脚本需兼容 Windows 自带的 PowerShell 5.x：
   - 不支持 `?.` null 条件运算符（PS7+ 语法），需用 `if ($x) { ... $x.Prop }` 等价实现
   - 不支持 `::new()` 直接调用（部分场景），优先用 `New-Object`
   - UTF-8 无 BOM 的中文注释会被 PS5 按 GBK 解码导致乱码，跨版本脚本统一用英文注释
   - 运行指令：`powershell -ExecutionPolicy Bypass -File xxx.ps1 [args]`
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
16. **Mode 切换 clip 位置规范**（设计文档 §6.5）：涉及 mode 变化的 sequence，`switchMode` clip 必须放在末尾（`atMs == durationMs`），禁止放中间。配套机制：① sequence 期间 `BattleMode.enter` 不调 `switchRig`（由 `cameraBlend` clip 的 endBlend 负责）；② `DuelCameraRig.compute` 在 `fighterDistance==null`（mode 未 enter）时 return prevState hold。三者配套，缺一不可。窗口期（blend.endMs → switchMode.atMs）相机定格在 blend 终值，属 cinematic 定格语义。
17. **统一时间源架构**（设计文档 §7 阶段 1-3 已落地）：全游戏唯一 `FrameClock` 实例（`scripts/Systems/FrameClock.js`），主循环走 `advance/stepFixed/refreshRender`；TimelineSequencer 与 CameraManager 改造为采样化（`sample(renderTime)` 纯函数求值），moveActorTo/cameraBlend handler 改为 `onEnter/sample/onExit` 三段式。TimeControlSystem 与 FrameClock 正交（参数注入 `clock.fixedDelta`，不读 clock 内部状态）。
18. **Render 插值架构**（设计文档 §7 阶段 3 已落地）：Simulation Driven 实体（玩家走位、普通 NPC）走 `lerp(previous, current, renderAlpha)` 插值路径；Sampleable 实体（sequencer 控制的 actor、cameraBlend）走 `sample(renderTime)` 直采路径不插值。分流标志为 `supportsRenderSampling`（默认 false），在 `moveActorTo`/`moveActorByDirection` 的 start/end 与 Phase 2 的 `controlledBySequence` 配套设/重置（前者控渲染采样路径，后者控 fixedUpdate 行为，sequencer 期间两者同设 true、结束同设 false）。**实现偏差**：设计稿 §8.7 原写「`CharacterBase.fixedUpdate` 末尾快照」，实际将 snapshot/restore 移到 `Scene.fixedUpdate` 边界（`gameModeManager.fixedUpdate` 前后配对调用），原因是要覆盖 `ExploreCollisionSystem.resolveMovement` 的 walkArea clamp 与 `PushboxResolver.resolve` 的 pushback 这些 `character.fixedUpdate()` 返回之后才执行的后置 position 写入。`_renderTransformSynced` 状态位用于处理两个边界：首次 snapshot 时同步 previous=current=root.position 避免 (0,0,0)→spawn 闪烁；sequencer end 时重置避免从过期快照 lerp 跳变。`Scene.updateRender` 重排为 `sample → _interpolateEntities(renderAlpha) → mode.updateRender → camera.update`，保证相机 target 读到插值后位置（设计文档 §7 阶段 3 要求）。

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
Game (scripts/Game.js)
  -> WorldState (scripts/WorldState.js)
  -> QuestManager (scripts/Systems/QuestManager.js)
  -> InventoryManager (scripts/Systems/InventoryManager.js)
  -> AudioManager (scripts/Systems/AudioManager.js)
     -> AudioDatabase (scripts/Systems/Audio/AudioDatabase.js)
     -> AudioPool (scripts/Systems/Audio/AudioPool.js)
     -> AudioPlayer (scripts/Systems/Audio/AudioPlayer.js)
     -> MusicPlayer (scripts/Systems/Audio/MusicPlayer.js)
     -> AmbientPlayer (scripts/Systems/Audio/AmbientPlayer.js)
  -> Scene (scripts/Scene.js)
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
character_demo.js (主循环: clock.advance → while(stepFixed) fixedUpdate → refreshRender → updateRender)
  -> Scene.fixedUpdate(clock)
     -> SceneSequencer.fixedUpdate(clock)   // 内部 TimelineSequencer 读 clock.fixedTime 推进
     -> GameModeManager.fixedUpdate(dtMs, tickCount)   // surgical: Scene 从 clock 提取后转传
        -> ExploreMode/BattleMode.fixedUpdate()
           -> InputSystem (scripts/Systems/InputSystem.js)
           -> PlayerController / AIController / NpcController
           -> CombatSystem.fixedUpdate()
  -> Scene.updateRender(clock)
     -> SceneSequencer.sample(clock.renderTime)   // 采样型 clip 求值（cameraBlend/moveActorTo）
     -> _interpolateEntities(clock.renderAlpha)   // Phase 3：Simulation Driven 实体走 lerp(previous, current, renderAlpha)，supportsRenderSampling=true 的实体跳过
     -> GameModeManager.updateRender()
        -> ExploreMode/BattleMode.updateRender()
           -> 写 context.target / basePosition   // 读插值后位置（Phase 3 重排保证）
           -> SceneVisualSystem.update()
     -> CameraManager.update()
        -> activeRig.compute()  // 或 _blend.sampleDriven 路径（timeline 采样）
        -> _applyToBabylonCamera()
     -> audioManager.update(deltaTime)  // Game 持有，Scene 调用；第一阶段空实现（设计稿 C1）

> **Phase 3 snapshot/restore 配对**（Scene.fixedUpdate 边界）：
> ```
> Scene.fixedUpdate(clock)
>   -> _restoreEntityPositions()         // 将 root.position 还原为上一帧 snapshot.current（清除上一帧 updateRender 的 lerp 残留）
>   -> GameModeManager.fixedUpdate()     // _applyMovement + walkArea clamp + pushback 等所有 position 写入
>   -> _snapshotEntityPositions()        // previous ← current, current ← root.position（supportsRenderSampling=true 的实体跳过）
> ```
> snapshot/restore 不放在 CharacterBase.fixedUpdate 末尾的原因：walkArea clamp 与 pushback 在 character.fixedUpdate() 返回之后才执行，必须延后到 Scene.fixedUpdate 末尾才能捕获完整 position。详见规范第 18 条。
```
> AudioManager 由 `Game` 持有，`Scene.updateRender(deltaTime)` 调用 `audioManager.update(deltaTime)`。当前处于 Step 5 完成：`play`/`stop`/`playMusic`/`stopMusic`/`switchMusic`/`update`/`setPaused`/`attachScene`/`detachScene`/`setBusVolume`/`switchAmbient`/`stopAllAmbient` 已实现；TimelineSequencer `playAudio` clip 已接入（Step 3，默认 `stopOnInterrupt: true`，`bus` 字段已生效）；SceneDef `music`/`ambient` 字段已读入（Step 4/5，支持 null/string/array/object 含条件写法）；AudioBus 真正生效（`_activeSounds` Map 跟踪在播 Sound，`setBusVolume` 实时回写 `finalVolume = baseVolume × busVolume × masterVolume`，localStorage 持久化 `blinduel_audio_bus_volumes`）；AudioContext 解锁修复（监听 pointerdown/keydown/onUnlock 补播 loop sound，用 `meta.loop` 判断因 `BABYLON.Sound` 无 `isLooping` 公开属性）。详见 `plans/archived/AudioSystemDesign.MD` §7/§9/§11。
>
> AnimationEvent 链路（Step 6a/6b 已落地）：`FrameAnimationComponent.fixedUpdate()` 帧推进命中事件帧 → `onAnimationEvent` 回调 → `AnimationEventBus.dispatch(payload)` → AudioManager.wireAnimationEventBus 订阅 → `audioManager.play(type)`。事件 payload 不携带消费者语义（`type` 直接当 audioId，简化策略 E1）。Step 6c（武器感知映射、VFX/Camera/Gameplay 消费者）后置 backlog。设计详见 `plans/archived/AnimationEventSystemDesign.MD`。

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
