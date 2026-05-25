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
- 探索/战斗共用统一的“全局基准俯角”（建议 10°~20°），保证 `z` 轴移动在屏幕上有可感知位移，并避免 mode 切换时场景透视关系跳变。

### DuelCameraRig（保留）
- 继续专用于战斗态，保持现有“双角色居中 + 距离驱动缩放”逻辑。

### 切换职责（更新）
- 推荐引入 `CameraManager` 统一接管 rig 注册、切换、blend 与屏幕特效。
- `CameraManager` 持有单一 Babylon Camera 实例，rig 只负责计算与写入变换。
- mode 通过 `CameraManager.switchRig(id)` 请求切换，不再直接 `rig.enable()`，避免 `activeCamera` 被抢回。
- `SceneSequencer` 的 `startCameraBlend` step 向 `CameraManager` 发指令，不直接操作 camera。

## 最小类结构（建议）
- `scripts/Systems/GameModeManager.js`
- `scripts/Systems/SceneSequencer.js`
- `scripts/Systems/CameraManager.js`（新增，统一 rig 管理 + 屏幕特效）
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

### Phase 3（CameraManager 收口）
- 新增 `scripts/Systems/CameraManager.js`，统一管理 rig 注册、切换、blend、镜头特效入口。
- `Scene` 持有并初始化 `CameraManager`，对外仅暴露管理器，不再让 mode/sequencer 直接持有并操作多个 rig。
- `ExploreMode/BattleMode` 改为声明式调用：
  - `cameraManager.switchRig("explore" | "duel")`
  - `cameraManager.updateRig(dtMs, context)`（由当前 rig 执行 update）
- `SceneSequencer.startCameraBlend` 改为委托 `cameraManager.startBlend(...)`，不再直接插值 `activeCamera`。
- rig 责任收敛为“计算目标镜头参数”，不再负责抢占 `scene.activeCamera`。
- 为后续镜头特效预留统一入口（如 `enqueueEffect("shake", config)`、`clearEffects()`），首版可先空实现。
- 探索/战斗镜头基准参数定稿纳入本阶段：
  - `ExploreCameraRig` 与 `DuelCameraRig` 统一全局基准俯角（建议初始值 12°，可配置）。
  - mode 间允许差异化调整距离/高度/缩放参数，但不改变该基准俯角。
- 探索态可行走范围首版纳入本阶段：
  - 先实现 `walkArea(minX, maxX, minZ, maxZ)` 的边界 clamp。
  - 暂不在本阶段引入“坡道/高度差/贴地法线”逻辑。
  - `obstacles[]`（AABB 障碍）可在本阶段后半或 Phase 5 补齐。

### Phase 4（Sequencer 收敛，依赖 Phase 3 完成）
- 前置条件：`CameraManager` 已成为唯一镜头切换与 blend 入口。
- 将 `SceneSequencer` 从“流程 + 相机 + 控制器锁定”的重职责，收敛为“纯流程编排器”。
- 从 `SceneSequencer` 移除相机参数直接插值与 `activeCamera` 直接读写，改为调用 `cameraManager.startBlend(...)`。
- 保留 step 编排模型，但补齐工程化能力：
  - step 级 `timeoutMs` 与 `onTimeout`（避免 `waitUntil` 或移动步骤卡死）。
  - sequence 级取消与失败回调（可观测、可恢复）。
  - 预留可中断能力（为对话/UI/战斗事件抢占做准备）。
- `waitUntil(fn)` 逐步替换为可数据化条件（如 `stateEquals`、`distanceBelow`），减少闭包耦合，提升复用与可配置性。

### Phase 5
- 探索内容扩展：NPC 对话气泡、buff 拾取、任务触发。

## 当前已知风险
- [x] 探索/战斗两套 rig 的参数体系不同，切换瞬间可能出现镜头跳变；已通过 `SceneSequencer` 的 `startCameraBlend` step 实现位置、高度、正交参数的平滑插值过渡。
- 当前玩家控制器默认会处理攻击指令；探索态需屏蔽或替换为探索控制器。
- 战斗进入前若不重置 TimeControl/状态标签，可能带入异常状态。
- `SceneSequencer` 当前职责偏重（流程编排 + 输入锁 + 镜头插值 + 模式切换），后续功能增多时维护成本会上升；计划在 `CameraManager` 稳定后进入 Phase 4 收敛。
- 若模式间俯角不统一，`SceneVisualSystem` 在切换时可能出现透视与层次跳变；已决定在 Phase 3 采用探索/战斗统一基准俯角。
- 坡道/上下坡移动暂不纳入当前迭代；在缺少地形约束与法线投影前实现真坡道风险高、返工成本大。

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

## 验收标准（CameraManager 阶段）
- [ ] `ExploreMode/BattleMode` 不再直接调用 `rig.enable()/disable()` 或直接写 `scene.activeCamera`。
- [ ] `SceneSequencer` 不再直接读写 `activeCamera.position/ortho*`，改为调用 `CameraManager` 提供的 blend 接口。
- [ ] `CameraManager` 成为唯一镜头切换入口：rig 切换与 blend 行为在探索/战斗流程中表现与现状一致。
- [ ] 保持透视/正交切换能力，且 `Explore -> Battle -> Explore` 往返无明显镜头跳变。
- [ ] 为镜头特效保留统一 API（可空实现），不影响现有流程稳定性。
- [ ] 探索/战斗共用统一基准俯角后，主角 `z` 向移动在屏幕上具备可见位移，且 mode 切换无透视跳变感。
- [ ] 探索态至少具备 `walkArea` 边界限制，角色不会走出定义范围。

## 验收标准（Sequencer 阶段）
- [ ] `SceneSequencer` 仅负责流程推进，不再承担镜头插值细节。
- [ ] `waitUntil` / `moveActorTo` 等阻塞步骤具备 `timeout` 保护，超时后可恢复或失败退出。
- [ ] 支持 sequence 级取消与失败回调，失败原因可观测（日志或事件）。
- [ ] 新增至少一类数据化条件 step，减少对闭包函数条件的依赖。
- [ ] `Explore -> Battle` 主流程行为不回归（输入锁、角色对齐、状态切换仍稳定）。
