# Scene 与 GameMode 划分草案

## 目标
在不重写现有战斗系统的前提下，为项目增加 `ExploreMode` 与 `BattleMode` 的可切换架构。

## 设计原则
- 先可运行，再抽象。
- `Scene` 只保留“引擎/渲染/公共对象”职责。
- 玩法规则与每帧系统编排下放到 mode。
- 现有 `CombatSystem / ContactResolver / TimeControl` 逻辑尽量原样复用。

## 职责边界

### Scene 保留
- Babylon `Scene` 的创建、渲染、销毁。
- 公共对象实例化：主角、敌人、相机、环境、输入系统。
- 公共服务与共享引用挂载（例如角色引用、触发器容器）。
- 将固定帧更新转发给 `GameModeManager`。

### GameModeManager 职责
- 维护 `currentMode`。
- 统一调用 `enter / exit / fixedUpdate / updateRender`。
- 处理模式切换：`switchMode("explore")`、`switchMode("battle")`。

### ExploreMode 职责
- 探索移动与交互（NPC 距离检测、对话气泡触发）。
- 拾取物检查（未来 buff 道具）。
- 战斗系统停用（不跑 Combat 结算）。
- 检测战斗触发器，满足条件后请求切到 `BattleMode`。

### BattleMode 职责
- 复用当前 `Scene.fixedUpdate` 的战斗链路：
  - 输入更新
  - 控制器更新
  - 角色 fixedUpdate
  - pushbox / boundary
  - combat fixedUpdate
- 决斗镜头更新与战斗调试逻辑。
- 战斗结束条件成立后，可切回 `ExploreMode`（可选）。

## 相机分层策略（新增）

### ExploreCameraRig（新增）
- 专用于探索态，逻辑为“跟随主角”。
- 目标永远锁定主角 root，不依赖敌我双方距离。
- 使用固定偏移 + 平滑跟随（位置插值），避免镜头抖动。

### DuelCameraRig（保留）
- 继续专用于战斗态，保持现有“双角色居中 + 距离驱动缩放”逻辑。

### 切换职责
- `GameModeManager` 或 mode 生命周期负责启用当前 rig 并停用另一套 rig 更新。
- 推荐保留单一 Babylon Camera 实例，两个 rig 只负责计算与写入相机变换（避免频繁创建/销毁相机对象）。

## 最小类结构（建议）
- `scripts/Systems/GameModeManager.js`
- `scripts/Systems/SceneSequencer.js`
- `scripts/Systems/Modes/BaseMode.js`
- `scripts/Systems/Modes/ExploreMode.js`
- `scripts/Systems/Modes/BattleMode.js`
- `scripts/ExploreCameraRig.js`

## 与现有代码的最小改造点
1. `Scene.js`
- 把当前 `fixedUpdate` 内战斗流程迁移到 `BattleMode.fixedUpdate`。
- `Scene.fixedUpdate` 只保留：
  - `if paused return`
  - `gameModeManager.fixedUpdate(dtMs, tickCount)`
- `updateRender` 建议改为转发给当前 mode，让 mode 选择对应 camera rig 的更新逻辑。

2. 触发器（第一版）
- 增加简单 AABB trigger 数据结构。
- `ExploreMode` 每帧检测主角是否进入。
- 进入后不直接硬切，而是启动 `SceneSequencer` 执行 `enter_battle_sequence`。

3. 切到 Battle 时初始化（第一版）
- 由 `SceneSequencer` 顺序执行：
  - 锁探索输入。
  - 对齐双方初始站位/朝向。
  - 按需调度相关 NPC 到预定位置。
  - 下发 `enterBattle` 状态命令（如主角 `standing/walk -> draw -> idle`）。
  - 清理输入缓冲（避免带入探索期输入）。
  - 显示战斗调试元素（如果需要）。
  - 切换到 `DuelCameraRig`。
  - 调用 `gameModeManager.switchMode("battle")`。

4. 切到 Explore 时初始化（第一版）
- 由 `SceneSequencer` 顺序执行：
  - 锁战斗输入。
  - 下发 `exitBattle` 状态命令（如主角 `idle -> sheath -> standing`）。
  - 切换到 `ExploreCameraRig`。
  - 调用 `gameModeManager.switchMode("explore")`。
  - 可选：隐藏战斗专属调试显示（按需）。

## 出生点与战斗站位约定（新增）
- 开场出生点与战斗对齐点分离定义，不复用同一组坐标。
- 建议至少定义三类点位：
  - `explore_spawn`：主角进入场景时的探索起点。
  - `duel_anchor.hero`：切入战斗时主角对齐点。
  - `duel_anchor.enemy`：切入战斗时敌人对齐点。
- `ExploreMode` 开场使用 `explore_spawn`。
- `Explore -> Battle` 切换时，优先由 `SceneSequencer` 将双方移动/对齐到 `duel_anchor`，而不是在 `BattleMode.enter` 中硬编码瞬移。
- 首版可先放在 `Scene` 配置对象中，后续再迁移到独立 JSON 做数据驱动。

## 探索可行走范围约定（新增）
- 首版采用清版游戏风格的二维平面约束：`主矩形可行走区 + 若干 AABB 障碍`。
- 主可行走区定义为单一矩形 `walkArea(minX, maxX, minZ, maxZ)`。
- 障碍定义为 `obstacles[]`（每个障碍为一个 AABB）。
- 探索态位移处理建议流程：
  - 先按输入计算候选位置。
  - 对候选位置执行 `walkArea` 边界 clamp。
  - 再做障碍重叠检测；若重叠则执行最小分离或回退到移动前位置（首版可先用回退策略）。
- 首版不引入 navmesh 与寻路，优先保证稳定与可调试。
- 数据建议先放在 `Scene` 配置对象的 `navigation` 下，后续再迁移到独立 JSON。

## 分阶段落地

### Phase 1（低风险）
- 引入 `GameModeManager` + `BattleMode`，功能等价于当前战斗。
- 对外行为不变，只做结构搬迁。
- 同步引入 `ExploreCameraRig` 空实现（先不接探索逻辑，只确保接口与切换机制成立）。

### Phase 2（已完成）
- [x] `ExploreMode` 已创建，支持探索移动与 trigger 检测。
- [x] `ExploreCameraRig` 已实现（跟随主角、高度 4、0° 仰角、透视/正交切换）。
- [x] `AABBTrigger` 已创建，封装碰撞检测与调试可视化。
- [x] Battle trigger 流程已通：进入触发器 → 自动移动 → draw 动画 → 相机 blend → 切 battle 模式。
- [x] `SceneSequencer` 已实现：将硬编码流程改为 sequence 编排。
  - 首版 step 集：`wait`、`waitUntil`、`moveActorTo`、`sendCommand`、`switchCamera`、`switchMode`、`lockInput`、`unlockInput`、`startCameraBlend`、`callback`。
  - 支持正交/透视投影模式的平滑过渡。
- [x] 角色走位/对齐已纳入 `moveActorTo` step。
- [x] `enterBattle` / `draw -> idle` 过渡已纳入 `sendCommand` + `waitUntil` step。
- [x] `ExploreCameraRig -> DuelCameraRig` 切换已纳入 `startCameraBlend` step，支持位置、高度、正交参数的平滑插值。
- 仍不做复杂对话与任务分支。

### Phase 3
- 探索内容扩展：NPC 对话气泡、buff 拾取、任务触发。

## 当前已知风险
- [x] 探索/战斗两套 rig 的参数体系不同，切换瞬间可能出现镜头跳变；已通过 `SceneSequencer` 的 `startCameraBlend` step 实现位置、高度、正交参数的平滑插值过渡。
- 当前玩家控制器默认会处理攻击指令；探索态需屏蔽或替换为探索控制器。
- 战斗进入前若不重置 TimeControl/状态标签，可能带入异常状态。

## 角色转向约定（先行记录）
- 转向能力数据放在 `Character`：`facing`（`1 | -1`）与 `allowFacing`（默认 `false`）。
- 主角开启：`allowFacing = true`；敌人/NPC 当前关闭：`allowFacing = false`。
- 仅当 `allowFacing === true` 且水平移动输入超过阈值时更新 `facing`。
- 精灵朝向由渲染镜像实现（按 `facing` 应用 X 轴镜像），不要求资源侧新增方向字段。

## 验收标准（第一版）
- [x] 代码结构上已存在 mode 层。
- [x] `BattleMode` 下表现与当前版本一致。
- [x] 可从 `ExploreMode` 通过 trigger 进入 `BattleMode`。
- [x] `Explore -> Battle` 切换由 sequence 编排完成，不需要把角色走位、镜头切换、mode 切换硬编码到单个 mode。
- [x] 切换过程中无明显状态污染（输入、冻结状态、碰撞显示）。
- [x] 探索态镜头能稳定跟随主角，战斗态镜头仍保持现有决斗取景效果。
- [x] 相机 blend 支持正交/透视投影模式的平滑过渡，切换后无画面跳变。
