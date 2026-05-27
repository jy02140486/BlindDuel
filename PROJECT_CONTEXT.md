# 项目上下文（Project Context）

## 1. 项目概况
- 项目名：`GemeniPrototype-BlindBattle`
- 当前目标：先跑通 2D 角色在 Babylon 中的最小战斗原型流程（动画播放 + 碰撞盒可视化 + 帧同步）
- 当前阶段：原型验证阶段（先保证“看得见、对得上、能迭代”）

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
- 演示入口：`babylon_demo.html`
- 角色演示主逻辑：`character_demo.js`
- 基础实体类：`scripts/Enties/CharacterBase.js`
- 战斗角色类：`scripts/Enties/CombatCharacter.js`
- NPC 实体类：`scripts/Enties/NpcCharacter.js`
- 动画组件：`scripts/Components/FrameAnimationComponent.js`
- NPC 帧动画组件：`scripts/Components/NpcFrameComponent.js`
- 碰撞组件：`scripts/Components/CollisionComponent.js`
- 时间控制组件：`scripts/Components/TimeControlComponent.js`
- 状态图定义：`Data/StateGraphDef/LongSwordMan.json`
- Rabble Stick 状态图：`Data/StateGraphDef/RabbleStick.json`
- 战斗接触解析：`scripts/Systems/ContactResolver.js`
- 战斗系统编排：`scripts/Systems/CombatSystem.js`
- NPC 控制器：`scripts/Systems/NpcController.js`
- 时间控制系统：`scripts/Systems/TimeControlSystem.js`
- 角色工厂：`scripts/CharacterFactory.js`
- 计划文档：`plans/` 目录（当前进行中的计划）
- 归档文档：`plans/archived/` 目录（已完成计划）
- 角色/碰撞实现方案说明：`CHARACTER_COLLISION_PLAN.md`（已归档）

资源：
- 动画图集：
  - `Art/Sprite/longswordman/longswordman_idle.png` + `Art/Sprite/longswordman/longswordman_idle.json`
  - `Art/Sprite/longswordman/longswordman_thrust.png` + `Art/Sprite/longswordman/longswordman_thrust.json`
- 碰撞蒙版图集：
  - `Data/CollisionMask/longswordman/longswordman_idle.png` + `Data/CollisionMask/longswordman/longswordman_idle.json`
  - `Data/CollisionMask/longswordman/longswordman_thrust.png` + `Data/CollisionMask/longswordman/longswordman_thrust.json`
- 碰撞扫描输出：
  - `Data/CollisionMask/longswordman/longswordman_idle.collider.json`
  - `Data/CollisionMask/longswordman/longswordman_thrust.collider.json`

离线工具：
- 碰撞扫描脚本（离线）：`scripts/tools/extract_collision_boxes.ps1`
- 说明：旧路径 `scripts/extract_collision_boxes.ps1` 目前仍存在（文件锁导致删除失败），后续可再清理

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
7. 当前 `Character` 虽已接收 `moveIntent`，但尚未建立角色朝向与精灵朝向的联动；精灵也尚未根据 `facing` 做左右镜像。
8. 当前项目尚未在 sprite 资源中增加额外“方向数据”字段；阶段性约定建议以运行时 `facing` 为主，默认资源原始朝向视为“面向右”，左向优先通过镜像获得。
9. `ContactResolver` 当前碰撞判定使用 AABB 简化（忽略 OBB 旋转角），属于原型阶段实现。
10. 攻击结束当前按“当前帧是否仍存在 `attackInstanceId`”隐式判断；若后续出现“中间空帧再出刀”动作，需要改为更显式的生命周期机制。
11. `ImpactContext` 已增加生命周期守卫（`expectedStateAtResolve` + `stateEntrySerialAtCreate`），用于避免过期 `nextState` 在 `impact` 结束时误跳转。
12. `ContactResolver` 当前采用“同一攻击实例对同一目标只取首次结果”的规则：若该 `attackInstanceId|targetId` 已产生 `hit`，后续 guard/parry 不再覆盖该结果。

## 6.1 本轮状态（Character 解耦 + NPC 轻量化）
1. 已完成 `Character` → `CharacterBase` + `CombatCharacter` + `NpcCharacter` 拆分。
2. 已完成 `CombatSystem` 按 `capabilities.combat` 过滤，NPC 不进入战斗更新。
3. 已完成 `CharacterFactory` 三条装配路径：`createHeroCharacter` / `createRabbleStickCharacter` / `createNpcCharacter`。
4. 已完成最小 NPC 验证：`NpcFrameComponent`（单帧状态动画）+ `NpcController`（idle/greeting 状态切换），已接入 `Scene` / `ExploreMode`。
5. 已知问题：NPC root 锚点默认使用帧中心，与 hero 锚点（collider 定义 near-bottom）不在同一约定，Y-sort 通过 `getVisualBottomY()` 统一计算。
6. NPC 碰撞数据采用独立脚本 `scripts/tools/extract_rootmotion_occupancy.ps1`，输出轻量 `occupancy.aabb`，不依赖战斗 `.collider.json`。



## 7. 当前文件结构
```
GemeniPrototype-BlindBattle/
├── Art/                          # 动画资源
│   └── Sprite/                   # 精灵图集
│       ├── longswordman_*.json
│       ├── longswordman_*.png
│       ├── rabblestick_*.json
│       └── rabblestick_*.png
├── Data/                         # 数据资源
│   ├── CollisionMask/            # 碰撞遮罩（战斗用）
│   │   ├── longswordman_*.collider.json
│   │   ├── longswordman_*.json
│   │   └── longswordman_*.png
│   ├── RootMotion/               # 根运动数据
│   │   ├── longswordman_*.json
│   │   └── rabblestick_*.json
│   └── StateGraphDef/            # 状态图定义
│       ├── LongSwordMan.json
│       └── RabbleStick.json
├── scripts/                      # 脚本代码
│   ├── Components/               # 组件类
│   │   ├── CollisionComponent.js
│   │   ├── FrameAnimationComponent.js
│   │   ├── NpcFrameComponent.js
│   │   └── TimeControlComponent.js
│   ├── Enties/                   # 实体类
│   │   ├── CharacterBase.js
│   │   ├── CombatCharacter.js
│   │   └── NpcCharacter.js
│   ├── Systems/                  # 系统类
│   │   ├── CombatSystem.js
│   │   ├── ContactResolver.js
│   │   ├── InputSystem.js
│   │   ├── NpcController.js
│   │   ├── PlayerController.js
│   │   ├── TestController.js
│   │   └── TimeControlSystem.js
│   ├── CharacterFactory.js
│   └── tools/                    # 工具脚本
│       ├── extract_collision_boxes.ps1
│       └── extract_rootmotion_occupancy.ps1
├── plans/                        # 计划文档（当前进行中）
│   ├── INDEX.md
│   ├── CHARACTER_NPC_DECOUPLE_OVERVIEW.md
│   ├── CHARACTER_NPC_DECOUPLE_TASKLIST.md
│   ├── NPC_CONTROLLER_MINIMAL_GREETING_DESIGN.md
│   ├── NPC_ROOTMOTION_OCCUPANCY_PIPELINE.md
│   ├── GAMEMODE_SCENE_SPLIT_PROPOSAL.md
│   ├── GAMEMODE_OVERVIEW_DESIGN.md
│   └── archived/                 # 归档计划（已完成）
├── babylon_demo.html             # Babylon演示入口
├── character_demo.js             # 角色演示逻辑
├── index.html                    # 主入口
└── style.css                     # 样式文件
```



## 8. 协作约定（给后续 AI/开发）
1. 先保证可运行与可验证，再做结构优化。
2. 优先保持数据驱动：动画和碰撞都以外部 JSON 为准。
3. 计划文档统一组织在 `plans/` 目录，已完成文档归档到 `plans/archived/`。
3. 涉及大改（状态机/架构）先出方案再改代码。
4. 与用户沟通默认使用中文，给其它ai的交接文档也用中文，编码统一utf8
5. 如果本次会话开始编码前还没读过andrej-karpathy-skills-CLAUDE.MD，要先读一下
