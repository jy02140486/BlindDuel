﻿# 项目上下文（Project Context）
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
- 时间控制系统：`scripts/Systems/TimeControlSystem.js`
- 游戏模式管理器：`scripts/Systems/GameModeManager.js`
- 场景序列器：`scripts/Systems/SceneSequencer.js`（支持 `STEP_TYPE` 整数枚举 step）
- 相机管理器：`scripts/Systems/CameraManager.js`
- 决斗相机：`scripts/DuelCameraRig.js`
- 探索相机：`scripts/ExploreCameraRig.js`
- 演出相机：`scripts/ScriptedCameraRig.js`（正交固定画幅，sequence 专用）
- 舞台边界：`scripts/Systems/StageBoundary.js`
- 推盒解析器：`scripts/Systems/PushboxResolver.js`
- 探索碰撞系统：`scripts/Systems/ExploreCollisionSystem.js`
- 角色工厂：`scripts/CharacterFactory.js`（四条装配路径：hero / rabble / traveller / merchant）
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
> 当前进行中的计划与已完成事项，见 `plans/INDEX.md`。

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
1. LibreSprite 1.1-dev 不便直接写文本标签，当前主要走“颜色 + 几何扫描 + 外置 JSON”方案。
2. 若同帧多个矩形相互接触/重叠，会在连通域阶段被合并，需要绘制时留间隔。
3. 旧脚本文件有占用锁，暂不影响主流程。
4. 直接执行 `.ps1` 可能被本机 PowerShell `ExecutionPolicy` 拦截；必要时可通过 `powershell -ExecutionPolicy Bypass -File ...` 运行离线扫描脚本。
5. 当前 demo 已接入最小状态机与输入链路，但事件回调、移动驱动和更多动作状态仍未展开。
6. `weaponbox` 的 debug 显示由 `CollisionComponent` 负责；`root` 点的 debug 显示由 `Character` 负责，二者统一跟随 `C` 键显隐。
7. ~~当前 `Character` 虽已接收 `moveIntent`，但尚未建立角色朝向与精灵朝向的联动；精灵也尚未根据 `facing` 做左右镜像。~~ ✅ 已解决：`CharacterBase` 支持 `FACING_MODE` 枚举（`AUTO_FROM_MOVE`/`LOCKED`/`SCRIPTED`），`setFacing()` 自动同步精灵镜像。
8. 当前项目尚未在 sprite 资源中增加额外“方向数据”字段；阶段性约定建议以运行时 `facing` 为主，默认资源原始朝向视为“面向右”，左向优先通过镜像获得。
9. `ContactResolver` 当前碰撞判定使用 AABB 简化（忽略 OBB 旋转角），属于原型阶段实现。
10. 攻击结束当前按“当前帧是否仍存在 `attackInstanceId`”隐式判断；若后续出现“中间空帧再出刀”动作，需要改为更显式的生命周期机制。
11. `ImpactContext` 已增加生命周期守卫（`expectedStateAtResolve` + `stateEntrySerialAtCreate`），用于避免过期 `nextState` 在 `impact` 结束时误跳转。
12. `ContactResolver` 当前采用“同一攻击实例对同一目标只取首次结果”的规则：若该 `attackInstanceId|targetId` 已产生 `hit`，后续 guard/parry 不再覆盖该结果。

## 6.1 本轮状态（Character 解耦 + NPC 轻量化 + FacingPolicy + ScriptedCameraRig）
1. 已完成 `Character` → `CharacterBase` + `CombatCharacter` + `NpcCharacter` 拆分。
2. 已完成 `CombatSystem` 按 `capabilities.combat` 过滤，NPC 不进入战斗更新。
3. 已完成 `CharacterFactory` 四条装配路径：`createHeroCharacter` / `createRabbleStickCharacter` / `createNpcCharacter` / `createMerchantNpc`。
4. 已完成 NPC 验证：`NpcFrameComponent`（支持多帧 tag 循环播放）+ `NpcController`（idle/greeting 状态切换），已接入 `Scene` / `ExploreMode`。已加入 traveller 和 merchant 两个 NPC。
5. 已知问题：NPC root 锚点默认使用帧中心，与 hero 锚点（collider 定义 near-bottom）不在同一约定，Y-sort 通过 `getVisualBottomY()` 统一计算。
6. NPC 碰撞数据采用独立脚本 `scripts/tools/extract_rootmotion_occupancy.ps1`，输出轻量 `occupancy.aabb`，不依赖战斗 `.collider.json`。
7. 已完成 `FACING_MODE` 枚举：`CharacterBase` 支持 `AUTO_FROM_MOVE`/`LOCKED`/`SCRIPTED`，`ExploreMode`/`BattleMode` 切换时自动设置，`SceneSequencer` 支持 `setActorFacingMode`/`setActorFacing` step。
8. 已完成 `ScriptedCameraRig`：sequence 专用正交固定画幅相机，`SceneSequencer` 支持 `setCameraFrame`/`startCameraBlend` 到 `"scripted"`，blend 过程固定正交避免畸变。
9. 已完成 `STEP_TYPE` 枚举：`SceneSequencer` step 类型整数化，`BattleMode`/`ExploreMode` 内联 sequence 全部改用常量。



## 7. 当前文件结构
```
GemeniPrototype-BlindBattle/
├── Art/
│   ├── Environment/              # 环境资源（地面、建筑、天空等）
│   ├── RawAssets/                # 原始源文件（.ase, .kra）
│   │   ├── Env/
│   │   ├── longswordman/
│   │   ├── rabblestick/
│   │   ├── merchant.ase
│   │   └── traveller.ase
│   └── Sprite/                   # 精灵图集（导出后）
│       ├── longswordman/
│       ├── rabble_stick/
│       └── NPCs/
│           ├── traveller.{json,png}
│           └── merchant.{json,png}
├── Data/
│   ├── CollisionMask/            # 碰撞遮罩（战斗用）
│   │   ├── longswordman/
│   │   └── rabble_stick/
│   ├── PushBox/                  # 推盒数据
│   │   ├── longswordman/
│   │   └── rabble_stick/
│   ├── RootMotion/               # 根运动数据
│   │   ├── longswordman/
│   │   ├── rabble_stick/
│   │   └── NPCs/
│   │       ├── traveller.{json,png,occupancy.json}
│   │       └── merchant.{json,png,occupancy.json}
│   ├── StateGraphDef/            # 状态图定义
│   │   ├── LongSwordMan.json
│   │   ├── RabbleStick.json
│   │   └── Merchant.json
│   └── TestScripts/
├── lib/                          # 第三方库
│   └── babylon.js
├── scripts/
│   ├── Components/
│   │   ├── AnimatedTileComponent.js
│   │   ├── CollisionComponent.js
│   │   ├── FrameAnimationComponent.js
│   │   ├── NpcFrameComponent.js
│   │   └── TimeControlComponent.js
│   ├── Enties/
│   │   ├── AABBTrigger.js
│   │   ├── CharacterBase.js
│   │   ├── CombatCharacter.js
│   │   ├── NpcCharacter.js
│   │   ├── SceneVisualSystem.js
│   │   └── WalkArea.js
│   ├── Systems/
│   │   ├── Modes/
│   │   │   ├── BaseMode.js
│   │   │   ├── BattleMode.js
│   │   │   └── ExploreMode.js
│   │   ├── AIController.js
│   │   ├── AIKnowledgeRegistry.js
│   │   ├── BaseController.js
│   │   ├── CameraManager.js
│   │   ├── CombatSystem.js
│   │   ├── ContactResolver.js
│   │   ├── DummyController.js
│   │   ├── ExploreCollisionSystem.js
│   │   ├── GameModeManager.js
│   │   ├── InputSystem.js
│   │   ├── NpcController.js
│   │   ├── PlayerController.js
│   │   ├── PushboxResolver.js
│   │   ├── SceneSequencer.js
│   │   ├── StageBoundary.js
│   │   ├── TestController.js
│   │   └── TimeControlSystem.js
│   ├── tools/
│   │   ├── extract_collision_boxes.ps1
│   │   └── extract_rootmotion_occupancy.ps1
│   ├── AssetManifest.js
│   ├── CharacterFactory.js
│   ├── DataLoader.js
│   ├── DuelCameraRig.js
│   ├── ExploreCameraRig.js
│   └── Scene.js
├── plans/
│   ├── archived/                 # 已完成计划
│   ├── backlogs_detailed/
│   ├── BACKLOG.md
│   ├── INDEX.md
├── .codebuddy/plans/
├── babylon_demo.html
├── character_demo.js
├── index.html
└── style.css
```



## 8. 协作约定（给后续 AI/开发）
1. 先保证可运行与可验证，再做结构优化。
2. 优先保持数据驱动：动画和碰撞都以外部 JSON 为准。
3. 计划文档统一组织在 `plans/` 目录，已完成文档归档到 `plans/archived/`。
4. 涉及大改（状态机/架构）先出方案再改代码。
5. 与用户沟通默认使用中文，给其它 AI 的交接文档也用中文，编码统一 UTF-8。
