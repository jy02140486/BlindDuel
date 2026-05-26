# GameMode 架构概要设计

## 1. 目标与范围
本设计用于在单场景原型中引入 `ExploreMode` 与 `BattleMode` 双模式运行机制。

本期目标：
- 在不破坏现有战斗表现的前提下，完成 mode 层抽象。
- 支持从探索态通过 trigger 进入战斗态。
- 支持探索镜头（跟随主角）与战斗镜头（双人决斗）切换。

不在本期范围：
- 完整 NPC 对话系统。
- 完整 buff/背包系统。
- 多地图/关卡流转。

## 2. 架构分层

### 2.1 Scene（World/Entity 容器）
职责：
- 创建并持有 Babylon 场景与公共对象。
- 持有角色实例、输入系统、相机 rig、边界系统等共享引用。
- 将 `fixedUpdate` 与 `updateRender` 转发给 `GameModeManager`。

不负责：
- 具体玩法规则。
- 哪些系统当前应启用/禁用。

### 2.2 Systems（规则与调度）
- `GameModeManager`：高层 system，负责 mode 生命周期与切换。
- `ExploreMode` / `BattleMode`：具体规则 system。
- `SceneSequencer`：通用编排 system，负责跨角色、跨 system 的顺序动作执行。

### 2.3 Character（实体能力）
- 保持状态机、动画、碰撞、时间控制等现有能力。
- 增加可选转向能力：`facing`、`allowFacing`。

## 3. 模块设计

### 3.1 GameModeManager
建议路径：`scripts/Systems/GameModeManager.js`

核心职责：
- 注册 modes。
- 维护 `currentMode`。
- 提供 `switchMode(nextModeId, payload)`。
- 调用当前 mode 的 `fixedUpdate` 与 `updateRender`。

建议接口：
- `registerMode(mode)`
- `start(initialModeId, payload?)`
- `switchMode(nextModeId, payload?)`
- `fixedUpdate(dtMs, tickCount)`
- `updateRender(dtMs)`

### 3.2 BaseMode
建议路径：`scripts/Systems/Modes/BaseMode.js`

统一生命周期接口：
- `enter(payload)`
- `exit()`
- `fixedUpdate(dtMs, tickCount)`
- `updateRender(dtMs)`

### 3.3 ExploreMode
建议路径：`scripts/Systems/Modes/ExploreMode.js`

职责：
- 推进探索移动与交互检测。
- 执行 trigger 检测（主角进入战斗触发区）。
- 请求切换到 `BattleMode`。
- 驱动 `ExploreCameraRig`。

本期最小实现：
- 仅保留移动 + trigger 进战斗。
- 攻击输入在探索态屏蔽或忽略。

### 3.4 BattleMode
建议路径：`scripts/Systems/Modes/BattleMode.js`

职责：
- 承接当前战斗固定帧链路：
  - `inputSystem.fixedUpdate`
  - `playerController.fixedUpdate`
  - `opponentController.fixedUpdate`
  - `character.fixedUpdate`
  - `pushboxResolver.resolve`
  - `stageBoundary.clampCharacter`
  - `combatSystem.fixedUpdate`
- 驱动 `DuelCameraRig`。

要求：
- 保证迁移后表现与当前一致。

### 3.5 SceneSequencer
建议路径：`scripts/Systems/SceneSequencer.js`

定位：
- `SceneSequencer` 是通用 system，不绑定某一种 mode。
- 当前阶段主要服务 `Explore <-> Battle` 切换。
- 后续可复用于 NPC 调度、小型过场、任务触发等场景内事件编排。

语义约定：
- `step`：最小动作单位，一步只做一件事。
- `sequence`：由多个 `step` 顺序组成的一段可执行流程数据。
- `sequencer`：逐帧推进 `sequence`、判断当前 step 是否完成并切到下一步的执行器。

职责：
- 管理当前活动中的 sequence。
- 逐步执行角色移动、朝向对齐、状态命令下发、镜头切换、mode 切换等动作。
- 在 sequence 执行期间提供“临时接管控制”的机制，例如锁输入、暂停自由 AI、禁用某些 trigger。

不负责：
- 角色底层移动、动画、碰撞细节。
- 持续性的探索规则或战斗规则。
- 完整剧情系统或复杂分支脚本语言。

首版建议支持的 step 类型：
- `wait`
- `waitUntil`
- `moveActorTo`
- `setActorFacing`
- `sendCommand`
- `switchCamera`
- `switchMode`
- `lockInput`
- `unlockInput`

建议接口：
- `play(sequence, payload?)`
- `stop()`
- `clear()`
- `fixedUpdate(dtMs, tickCount)`
- `isBusy()`

首版 sequence 数据形态示意：
```js
{
  id: "enter_battle",
  steps: [
    { type: "lockInput", actorId: "hero" },
    { type: "moveActorTo", actorId: "hero", x: -2, z: 0, tolerance: 0.1 },
    { type: "moveActorTo", actorId: "enemy", x: 2, z: 0, tolerance: 0.1 },
    { type: "sendCommand", actorId: "hero", command: "enterBattle" },
    { type: "switchCamera", cameraId: "duel" },
    { type: "switchMode", modeId: "battle" }
  ]
}
```

## 4. 相机方案

### 4.1 ExploreCameraRig
建议路径：`scripts/ExploreCameraRig.js`

逻辑：
- 锁定主角 root 为 target。
- 固定 offset（如后上方）+ 插值跟随。
- 不依赖敌我距离。

### 4.2 DuelCameraRig
- 继续沿用现有逻辑。

### 4.3 CameraManager（建议新增）
建议路径：`scripts/Systems/CameraManager.js`

职责：
- 统一管理 `ExploreCameraRig` 与 `DuelCameraRig` 的生命周期（注册、切换、激活/停用）。
- 接管 `SceneSequencer` 中的相机 blend 逻辑（`startCameraBlend` 改为调用 `cameraManager.startBlend`）。
- 提供屏幕级镜头特效：震动（shake）、闪光（flash）、上下黑边（letterbox）。
- 每帧统一更新当前 active rig 与特效状态。

为什么需要：
- 当前 blend 逻辑分散在 `SceneSequencer`（直接操作 camera）、`BattleMode.enter`（`cameraRig.enable()`）、`ExploreMode.enter`（`exploreCameraRig.enable()`），容易出现 `activeCamera` 被抢回的问题。
- 特效（shake/flash）与相机位置同生命周期，放在同一 manager 内更内聚。
- 后续新增 rig（如对话特写、Boss 登场镜头）只需注册，无需改动 mode 代码。

建议接口：
- `registerRig(id, rig)` — 注册 explore / duel rig。
- `switchRig(id, options?)` — 切换 rig，可选 blend 过渡。
- `startBlend(fromRig, toRig, durationMs)` — 平滑过渡。
- `shake(intensity, durationMs)` / `flash(color, durationMs)` / `letterbox(ratio, durationMs)` — 屏幕特效。
- `update(dtMs, context)` — 每帧更新。

### 4.4 切换约定（更新）
- `CameraManager` 统一持有单一 Babylon Camera 实例，rig 只负责计算与写入变换。
- mode `enter` 通过 `CameraManager.switchRig(id)` 请求切换，不再直接操作 rig。
- `SceneSequencer` 的 `startCameraBlend` step 改为向 `CameraManager` 发指令，不直接操作 camera。
- 切换瞬间由 `CameraManager` 执行位置对齐或短时插值，避免跳变。

## 5. 状态与数据约定

### 5.1 模式枚举
- `explore`
- `battle`

### 5.2 Trigger 数据（首版）
```js
{
  id: "duel_trigger_01",
  type: "battle_start",
  bounds: { minX, maxX, minZ, maxZ },
  once: true,
  consumed: false
}
```

### 5.3 Character 转向（首版）
- `facing: 1 | -1`
- `allowFacing: boolean`（默认 `false`）
- 主角 `allowFacing = true`，敌人/NPC 默认 `false`

更新规则：
- 当 `allowFacing === true` 且 `moveIntent.x` 超过阈值时更新 `facing`。
- 渲染通过 X 轴镜像体现朝向。

## 6. 模式切换时序

### 6.1 Explore -> Battle
1. `ExploreMode` 检测主角进入 `battle_start` trigger。
2. 不直接硬切 mode，而是启动 `SceneSequencer.play(enter_battle_sequence)`。
3. `SceneSequencer` 按 sequence 顺序执行：
- 锁探索输入。
- 让主角、敌人、NPC（如有）移动到预定点位。
- 对齐朝向。
- 给相关角色下发 `enterBattle` 等状态命令。
- 切换到 `DuelCameraRig`。
- 调用 `GameModeManager.switchMode("battle", payload)`。
4. `BattleMode.enter(payload)`：
- 清理输入缓冲。
- 接管后续持续性的战斗规则更新。

### 6.2 Battle -> Explore（可选）
1. 战斗结束条件成立。
2. 启动 `SceneSequencer.play(exit_battle_sequence)`。
3. `SceneSequencer` 按 sequence 顺序执行：
- 锁战斗输入。
- 给主角下发 `exitBattle`。
- 切换到 `ExploreCameraRig`。
- 调用 `GameModeManager.switchMode("explore")`。
4. `ExploreMode.enter()`：
- 恢复探索态的持续规则更新。
- 按需隐藏战斗调试显示。

## 7. 对现有代码的改造清单
1. `scripts/Scene.js`
- 引入并持有 `GameModeManager`。
- 在 `init` 完成 mode 注册与 `start("battle")` 或 `start("explore")`。
- `fixedUpdate` / `updateRender` 改为转发给 manager。

2. 新增文件
- `scripts/Systems/GameModeManager.js`
- `scripts/Systems/SceneSequencer.js`
- `scripts/Systems/Modes/BaseMode.js`
- `scripts/Systems/Modes/ExploreMode.js`
- `scripts/Systems/Modes/BattleMode.js`
- `scripts/ExploreCameraRig.js`

3. `scripts/Enties/Character.js`
- 增加 `facing` 与 `allowFacing`（默认关闭）。
- 在移动逻辑中按规则更新朝向；渲染应用镜像。

## 8. 当前实现状态与待办

### 8.1 已完成
- [x] `GameModeManager` + `BattleMode` + `ExploreMode` 结构已落地。
- [x] `Scene.fixedUpdate` / `updateRender` 已改为转发给 `GameModeManager`。
- [x] `ExploreCameraRig` 已实现：跟随主角、高度 4、0° 仰角、透视/正交切换。
- [x] `AABBTrigger` 已创建：封装碰撞检测、调试体积、一次性触发回调。
- [x] `PlayerController.enabled` 已添加，支持输入禁用/恢复。
- [x] 新动画（standing/walk/draw/sheath）独立碰撞盒数据已生成。
- [x] Babylon.js 已从 CDN 改为本地部署。
- [x] 触发器流程已通：进入触发器 → 自动移动到 `x=-3.2` → draw 动画 → 相机 blend（3.5s）→ 切 battle 模式。
- [x] `SceneSequencer` 已实现：通用编排 system，支持 `wait`、`waitUntil`、`moveActorTo`、`sendCommand`、`switchCamera`、`switchMode`、`lockInput`、`unlockInput`、`startCameraBlend`、`callback` 等 step 类型。
- [x] `DuelCameraRig` 已补 `enable()` / `disable()` 方法。
- [x] `BattleMode.enter()` / `exit()` 和 `ExploreMode.enter()` 已管理相机生命周期。
- [x] 相机 blend 支持位置、高度、正交参数的平滑插值，切换后无画面跳变。

### 8.2 进行中 / 已知问题
- [x] 相机 blend 与 draw 动画时序不同步 — 已修复：sequence 中用 `waitUntil` 等 draw 完成后再启动 blend，blend 完成后再 `switchMode`。
- [x] blend 结束后 `exploreCameraRig.enable()` 会把 `activeCamera` 抢回 explore 相机 — 已修复：blend 逻辑下沉到 `SceneSequencer`，不再错误 enable explore rig。
- [ ] 触发器 debug 体积按 C 键不显示（待排查）。

### 8.3 待实现（Phase 3/4/5）
- [ ] `Phase 3` 收尾：统一探索/战斗基准俯角，补齐探索态 `walkArea` 可行走范围限制。
- [ ] `Phase 3` 收尾：`Battle -> Explore` 退出战斗 sequence（`sheath` 动画、切回 explore 相机等）。
- [ ] `Phase 4`：`SceneSequencer` 收敛（timeout/cancel/fail 回调、条件 step 数据化）。
- [ ] `Phase 5`：探索内容扩展（NPC 对话气泡、buff 拾取、任务触发）。

## 9. 验收标准
- 结构上完成 Scene 与 mode 解耦。
- `BattleMode` 表现与改造前一致。
- 探索态镜头稳定跟随主角。
- 主角进入 trigger 后能稳定切入战斗态。
- `Explore <-> Battle` 切换可通过 sequence 编排完成，不需要把走位、镜头切换、mode 切换硬编码进单个 mode。
- 切换时无明显状态污染（输入残留、冻结状态残留、镜头突跳）。

## 10. 实施顺序建议（已更新）
1. ✅ 先做 `GameModeManager + BattleMode`，仅结构迁移，不改行为。
2. ✅ 加 `ExploreCameraRig` 与 `ExploreMode`，打通切换。
3. ✅ 接入 trigger 进入战斗（当前硬编码流程）。
4. ✅ 引入 `SceneSequencer` 最小实现，将硬编码流程改为 sequence 编排。
5. ✅ 补主角转向、角色走位 step 与探索输入筛选。
6. ✅ 引入 `CameraManager`：相机切换与 blend 入口已收口到 manager。
7. ⏳ `Phase 3` 收尾：统一探索/战斗基准俯角 + 探索态 `walkArea` 可行走范围限制。
8. ⏳ `Phase 4`：`SceneSequencer` 收敛（timeout/cancel/fail 回调、条件 step 数据化）。
9. ⏳ `Phase 5`：探索内容扩展（NPC 对话气泡、buff 拾取、任务触发）。

## Decision Update (2026-05-26)
- The global base pitch approach is dropped.
- Do not use pitch adjustment as a fix for vertical framing.
- Reason: side effects on `SceneVisualSystem`.
- Keep character world `z` fixed by gameplay rule.
