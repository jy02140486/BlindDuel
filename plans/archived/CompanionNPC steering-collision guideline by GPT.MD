NPC Movement / Companion Guideline
统一所有可移动实体的移动管线

Player、Companion、以及未来会自主移动的 NPC，都应遵循统一流程：

Controller / Behavior
    ↓
moveIntent
    ↓
Movement / Collision Resolution
    ↓
actual position
Controller / Behavior 不应直接修改 root.position。
root.position 的最终写入应该由移动/碰撞层负责。
这是为了避免出现 Character、Sequencer、NPC Controller 等多个系统同时写位置的问题。
NPC 应同时具备 Dynamic Actor 和 Blocker 两种身份
当前 dynamicActors 只有 Player，这是历史实现，不应作为长期设计限制。

一个 NPC 可以同时属于：

dynamicActors
blockers
staticBlockers 建议逐渐改名为 blockers。
blockers 不应假设对象本身是静态的；只要其 AABB 能够随当前位置实时计算，就可以作为 blocker。

Companion 的目标状态是：

can move
can be blocked
can block Player
can block other NPCs
所有自主移动 NPC 都应该经过 ExploreCollisionSystem

不再允许 NPC Controller 直接：

npc.root.position += ...

应改为：

NPC Controller
    ↓
moveIntent
    ↓
resolveMovement(npc, blockers, walkArea)
    ↓
actual position
因此 NPC 可以自然获得：
墙体阻挡
Static prop 阻挡
walkArea 限制
Player 阻挡
其他 NPC 阻挡
Collision System 与 Steering / Navigation 分离

Collision System 负责：

“这个移动是否合法，以及实际最多能移动多少。”

Steering / Behavior 负责：

“我希望往哪个方向移动。”

Navigation / A* 负责：

“当前方向走不通时，应该经过哪些区域才能到达目标。”

三者不要混在一起。
Companion 第一阶段只实现 Steering，不实现 A*

当前 Companion 的基本需求只是：

保持在 Player 附近并跟随 Player。

第一阶段使用：

Seek target
+
Separation
+
WalkArea constraint
+
Collision resolution

最简单的目标点可以是：

target = player.position + companionOffset
Companion 根据 target 生成 moveIntent，然后交给统一碰撞系统处理。
Steering 不负责强制穿过障碍物
Steering 是期望运动。
Collision 是最终权威。

例如 NPC 想向 Player 移动，但墙挡住了：

desired movement
     ↓
collision resolution
     ↓
actual movement
不允许 Controller 为了“跟上 Player”而绕过 Collision System。
不要把 Player 与 NPC 实现成完全对等的物理刚体
当前游戏不需要物理引擎式的双向刚体推挤。

更适合采用：

当前正在主动移动的 Actor，与其他实体进行碰撞检测；被碰撞实体默认不因为这次碰撞而自动获得反向位移。

例如：

Player moving
    ↓
NPC blocks Player
    ↓
Player stops / is displaced

而不是：

Player pushes NPC
NPC pushes Player

NPC 自己移动时同理：

NPC moving
    ↓
Player blocks NPC
    ↓
NPC stops
这样可以避免双方每帧互相 resolve 导致 jitter / oscillation。
NPC 之间也优先采用“主动移动者 vs blocker”模型
第一阶段不做完整的双向刚体解算。
NPC A 正在移动时，NPC B 可以作为 blocker。
A 被 B 阻挡即可。
不需要因为 A 撞 B 就同时给 B 一个 MTV 位移。
如果以后确实需要 NPC 群体互相推挤，再单独设计 crowd / separation 系统。
Companion 的目标不是始终精确贴着 Player

不应该每帧强制：

NPC.position = Player.position + offset
应该定义一个 follow radius / desired distance。

例如：

distance > followRadius
    → 移动

distance <= followRadius
    → 停止 / 减速
这样 NPC 被墙挡住时不会不断产生“必须穿墙才能满足目标位置”的错误行为。
第一阶段不需要全局寻路
当前游戏是 2.5D 横版探索。
Player 本身也不依赖 Pathfinding。

Companion 的基础跟随应该先通过：

Seek
+
Collision
+
WalkArea

解决。

不要为了“NPC 能被墙挡住”直接引入 A*。
只有出现“需要绕障碍到达目标”的需求时才引入 A*

Steering 可以处理：

直接跟随

Collision 可以处理：

撞墙 / 撞 NPC / 撞 Player

但 Steering + Collision 无法自动解决：

墙挡住 NPC
↓
NPC 需要绕到墙另一边
↓
最终重新找到 Player
当项目真正出现这种需求时，再引入 Pathfinding。
未来 A* 应作为 Behavior / Navigation 层的可替换组件
不要让 A* 直接控制 root.position。

推荐：

FollowBehavior
    ↓
PathFollower / Steering
    ↓
moveIntent
    ↓
Collision Resolution
    ↓
actual position
这样引入 A* 时不需要推翻现有 NPC Movement / Collision 架构。
未来的 A* 优先考虑基于 WalkArea / Waypoint Graph，而不是立即建立复杂 NavMesh
当前游戏的移动空间是受 walkArea 约束的 2.5D 横向空间。

如果未来需要全局寻路，可以优先考虑：

WalkArea
    +
Waypoint / Navigation Graph
    +
A*
暂时没有必要引入完整 3D NavMesh 系统。
NPC 的 Behavior 与 Movement Resolution 应保持职责边界

Behavior 决定：

Follow
Patrol
Flee
Investigate

Behavior 输出：

moveIntent

Movement / Collision 决定：

actual movement

Pathfinding 如果存在，只负责：

global route / path
不允许这些系统互相直接修改 Actor Transform。

推荐最终架构

ExploreMode
│
├── PlayerController
│       ↓
│   moveIntent
│
├── CompanionController
│       ↓
│   Follow / Steering
│       ↓
│   moveIntent
│
├── NPCController
│       ↓
│   Patrol / Behavior
│       ↓
│   moveIntent
│
└── Movement Resolution
        │
        ├── blockers
        ├── walkArea
        └── collision rules
                ↓
          actual position

当前实现优先级

P0
└─ 统一 NPC → moveIntent → resolveMovement

P0
└─ NPC 同时支持 dynamic actor + blocker

P0
└─ blockers 改为动态语义，不再强调 static

P1
└─ Companion Seek / Follow

P1
└─ Player / NPC / NPC collision rules

P1
└─ Separation / 简单局部 Steering

P2
└─ 实际出现绕障碍需求后，再实现 Pathfinding

P3
└─ 根据实际场景复杂度选择 Waypoint Graph + A*

核心原则可以压缩成一句话：

先把 NPC 做成和 Player 一样经过统一 Movement → Collision 管线的“可移动实体”，Companion 当前只需要 Steering/Seek；A* 是未来为“绕障碍重新寻找目标”增加的 Navigation 层，而不是当前 NPC 移动系统的基础。