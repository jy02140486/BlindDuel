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
- 角色类：`scripts/Enties/Character.js`
- 动画组件：`scripts/Components/FrameAnimationComponent.js`
- 碰撞组件：`scripts/Components/CollisionComponent.js`
- 状态图定义：`Data/StateGraphDef/LongSwordMan.json`
- Rabble Stick 状态图：`Data/StateGraphDef/RabbleStick.json`
- 战斗接触解析：`scripts/Systems/ContactResolver.js`
- 战斗系统编排：`scripts/Systems/CombatSystem.js`
- 计划文档：`plans/` 目录（当前进行中的计划）
- 归档文档：`plans/archived/` 目录（已完成计划）
- 角色/碰撞实现方案说明：`CHARACTER_COLLISION_PLAN.md`（已归档）

资源：
- 动画图集：
  - `Art/Sprite/longswordman_idle.png` + `Art/Sprite/longswordman_idle.json`
  - `Art/Sprite/longswordman_thrust.png` + `Art/Sprite/longswordman_thrust.json`
- 碰撞蒙版图集：
  - `Data/CollisionMask/longswordman_idle.png` + `Data/CollisionMask/longswordman_idle.json`
  - `Data/CollisionMask/longswordman_thrust.png` + `Data/CollisionMask/longswordman_thrust.json`
- 碰撞扫描输出：
  - `Data/CollisionMask/longswordman_idle.collider.json`
  - `Data/CollisionMask/longswordman_thrust.collider.json`

离线工具：
- 碰撞扫描脚本（离线）：`scripts/tools/extract_collision_boxes.ps1`
- 说明：旧路径 `scripts/extract_collision_boxes.ps1` 目前仍存在（文件锁导致删除失败），后续可再清理

## 4. 已完成事项（最新）
1. 已实现 `Character` 组合结构：动画组件 + 碰撞组件。
2. 已实现基于 atlas `duration` 的逐帧推进与循环播放。
3. 已实现根据 `.collider.json` 在 Babylon 中生成并更新碰撞盒。
4. 已实现状态驱动的移动系统，支持每帧速度控制。
5. 已实现 quart（四连击）动画和碰撞系统。
6. 已完善移动控制，支持自动移动和玩家输入控制。
4. 已实现碰撞盒 debug 可视化（`StandardMaterial` + `diffuse + alpha`）。
5. 已支持运行时开关碰撞显示（`C` 键）。
6. 已确认需要通过本地服务器访问，`file://` 会触发模块/CORS 问题。
7. 已新增 `idle` 动画资源与对应 collision mask 资源。
8. 已生成 `longswordman_idle.collider.json`，当前 `idle` 与 `thrust` 都具备动画图集、collision mask 图集、collider 扫描输出三件套。
9. 已新增最小状态图定义：当前仅保留 `idle` 与 `thrust` 两个状态，输入命令为 `thrust`，`thrust` 播放完自动回 `idle`。
10. 已统一碰撞术语：当前项目约定使用 `hitbox / weaponbox / pushbox`，其中 `hitbox` 表示角色被打到的范围，`weaponbox` 表示用来打别人的范围，`pushbox` 表示占位/挤压范围。
11. 已接入基础输入系统：当前可通过键盘 `L` 或手柄 `B` 触发 `thrust` 命令。
12. 已修正非循环动画完成时的 `normalizedTime` 判定，避免 `thrust` 播放结束后卡在攻击态、不回 `idle`。
13. 已将 `root` 资源独立到 `Data/RootMotion`，并约定运行时统一汇总到各动作的 `.collider.json` 中。
14. 已扩展离线导出方案：`CollisionMask` 负责 `hitbox + weaponbox`，`RootMotion` 负责 `root` 锚点。
15. 已重新生成 `idle / thrust` 的 `.collider.json`，其中 `thrust` 已包含 `weaponbox` 强弱分区，`idle / thrust` 都包含 `anchors.root`。
16. 已接入 debug 可视化分层：`weaponbox` 由 `CollisionComponent` 显示，`root` 点由 `Character` 显示，当前统一跟随 `C` 键显隐。
17. 已将 `sprite root` 与 `character.root` 对齐：运行时会根据 `frames[].anchors.root` 对 sprite 与 collision 共同施加局部偏移，使 root 锚点落在角色根节点原点。
18. 已在场景接入双角色：`hero` + `rabble_stick`，`rabble_stick` 初始生成在右侧（`x=2.5`）。
19. 已新增 `Data/StateGraphDef/RabbleStick.json`，当前最小状态为 `idle / hit`。
20. 已在 `Character` 增加 `takeDamage(ctx)` 与 `getCombatSnapshot()`，并支持 `attackActive` 驱动攻击实例标记。
21. 已接入 `ContactResolver + CombatSystem`：主循环中统一结算接触并调用 `takeDamage`，不在 Entity 内部分散结算。
22. 已实现首版规则：`weapon vs weapon` 优先于 `weapon vs hitbox`，支持强弱拼刀、同级互弹、命中去重。
23. 已支持 `guard weaponbox` 语义：非攻击态（如未来带警戒武器盒的 `idle`）可参与拦截，但不生成主动攻击实例。

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

## 7. 下一步计划
1. 将当前 demo 方案平滑接入正式入口结构（而不只在 `babylon_demo.html` 验证）。
2. 为 `rabble_stick` 补齐受击与攻击相关资源链路（优先补 `hit.collider` 与状态图扩展）。
3. 将 `ContactResolver` 从 AABB 升级为 OBB 判定，减少斜角盒体误判。
4. 明确并实现攻击实例生命周期边界（替代纯“有无 weaponbox”的隐式结束判定）。
5. 逐步把 debug 碰撞显示与真正判定逻辑解耦。
6. 建立 `Character.facing` 与 `sprite` 朝向联动，并评估是否需要在状态/clip 配置中补充 `mirrorable` 一类的方向策略字段。

## 8. 当前文件结构
```
GemeniPrototype-BlindBattle/
├── Art/                          # 动画资源
│   └── Sprite/                   # 精灵图集
│       ├── longswordman_idle.json
│       ├── longswordman_idle.png
│       ├── longswordman_move.json
│       ├── longswordman_move.png
│       ├── longswordman_quart.json
│       ├── longswordman_quart.png
│       ├── longswordman_thrust.json
│       └── longswordman_thrust.png
├── Data/                         # 数据资源
│   ├── CollisionMask/            # 碰撞遮罩
│   │   ├── longswordman_*.collider.json
│   │   ├── longswordman_*.json
│   │   └── longswordman_*.png
│   ├── RootMotion/               # 根运动数据
│   │   └── longswordman_*.json
│   └── StateGraphDef/            # 状态图定义
│       ├── LongSwordMan.json
│       └── RabbleStick.json
├── scripts/                      # 脚本代码
│   ├── Components/               # 组件类
│   │   ├── CollisionComponent.js
│   │   └── FrameAnimationComponent.js
│   ├── Enties/                   # 实体类
│   │   └── Character.js
│   ├── Systems/                  # 系统类
│   │   ├── CombatSystem.js
│   │   ├── ContactResolver.js
│   │   ├── InputSystem.js
│   │   └── PlayerController.js
│   └── tools/                    # 工具脚本
│       └── extract_collision_boxes.ps1
├── plans/                        # 计划文档（当前进行中）
│   ├── QUART_IMPLEMENTATION_PLAN.md
│   ├── MOVEMENT_IMPLEMENTATION_PLAN.md
│   └── archived/                 # 归档计划（已完成）
│       ├── CHARACTER_COLLISION_PLAN.md
│       └── PROJECT_CONTEXT.md
├── babylon_demo.html             # Babylon演示入口
├── character_demo.js             # 角色演示逻辑
├── index.html                    # 主入口
└── style.css                     # 样式文件
```

## 9. 当前进行中的计划
### 9.1 Quart招数实现（plans/QUART_IMPLEMENTATION_PLAN.md）
- 添加键盘I键和手柄Y按钮触发quart招数
- 实现状态相关的速度倍率系数功能
- 在idle和move状态中添加quart转换条件

### 9.2 移动系统优化（plans/MOVEMENT_IMPLEMENTATION_PLAN.md）
- 实现状态驱动的移动控制
- 添加状态速度倍率机制
- 优化移动控制和根运动集成

## 10. 已完成事项更新
11. 已建立计划文档组织结构：`plans/` 目录存放当前进行中的计划，`plans/archived/` 存放已完成计划。

## 11. 协作约定（给后续 AI/开发）
1. 先保证可运行与可验证，再做结构优化。
2. 优先保持数据驱动：动画和碰撞都以外部 JSON 为准。
3. 计划文档统一组织在 `plans/` 目录，已完成文档归档到 `plans/archived/`。
3. 涉及大改（状态机/架构）先出方案再改代码。
4. 与用户沟通默认使用中文。
