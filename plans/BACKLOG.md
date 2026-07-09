# 待办与优化 backlog

> 不阻塞当前主线，但值得后续处理的事项。

---

## 资源工具链

| 事项 | 描述 | 优先级 | 备注 |
|------|------|--------|------|
| 合并冗余 atlas JSON | `Data/CollisionMask/`、`Data/PushBox/`、`Data/RootMotion/` 三个目录下的 `.json` 文件内容相同（帧布局、duration 一致），仅 `.png` 像素内容不同。可优化为只保留一份 `.json` 作为帧索引，减少维护成本。 | 低 | 需改 `extract_collision_boxes.ps1` 脚本 |
| 旧脚本文件占用锁清理 | 旧路径 `scripts/extract_collision_boxes.ps1` 因文件锁无法删除，仍残留在仓库中。 | 低 | 不影响主流程，后续找机会清理 |

## 规则配置化

| 事项 | 描述 | 优先级 | 备注 |
|------|------|--------|------|
| `tickDiff` 外部配置化 | 将 `ContactResolver` 中 Just Guard/预判 guard 使用的 `tickDiff` 阈值（当前硬编码 `<= 7`）提取为外部可配置项（建议进 StateGraph 或 Combat 配置）。 | 中 | 需要同步默认值与回归测试，避免改变现有手感 |
| **hitstop 时长外部配置化** | `ContactResolver` 中各场景的 hitstop 时长目前全部硬编码：parry（双方 8 帧）、block（双方 4 帧）、clash tie（双方 8 帧）、clash lose（弱方 6 帧 / 强方 4 帧）、命中（双方 8 帧）。应提取为外部配置（建议按场景/攻击类型/武器等级分表）。 | 中 | 需同步默认值与手感测试 |
| Sequence 外部 JSON 化 | `BattleDef.enterSequence`（函数）/ `exitSequence`（对象）目前硬编码在 `SceneDefs.js`。应改为从外部 JSON 文件读取，支持策划直接编辑序列步骤。 | 中 | cutsceneInvokers 已 JSON 化可参考；剩 enter/exit battle sequence 需处理 enterSequence 是函数的问题 |
| 击退距离外部配置化 | `ContactResolver` 中击退距离（knockbackX）当前硬编码，与武器等级和命中场景绑定。应提取为外部可配置项（建议按武器/攻击类型分表）。 | 低 | 与 hitstop 配置化可同步推进 |

## 探索系统

| 事项 | 描述 | 优先级 | 备注 |
|------|------|--------|------|
| 投掷物与暗器玩法（含 Projectile） | 在探索模式可获得投掷物/暗器资源，并在战斗中释放；同时补齐 projectile 基础能力（生成、飞行、命中、销毁、与现有 Combat 规则衔接）。 | 中 | 建议先做单一 projectile 类型验证战斗闭环 |
| NPC 物物交换玩法（以物换物） | 探索模式中允许用小物件与 NPC 交易，换取 buff、投掷物或其他战斗资源。 | 中 | 需定义交易条件、库存/消耗规则、NPC 交互反馈与失败提示 |
| NPC root 锚点与 hero 锚点约定不一致 | NPC 默认使用帧中心作为 root 锚点，hero 使用 collider 定义的 near-bottom 锚点，两者不在同一约定。当前 Y-sort 通过 `getVisualBottomY()` 统一计算绕过。 | 中 | 长期应统一锚点约定，或显式区分两种锚点语义 |
| 状态机事件回调未展开 | 状态切换缺少 enter/exit 钩子机制，无法在状态进入/退出时触发数据驱动的事件（音效、特效、指令派发）。 | 中 | 移动驱动已展开（moveIntent + controlledBySequence + FollowingBehavior）；事件回调待补 |

| 实体默认隐藏 + 触发时显示 | cutscene/battle 相关实体（如 prop_faller、scenario-gated enemy）在触发条件未满足时应保持隐藏，而非场景加载即出现。当前 `spawnIf` 只控制生成，未满足时实体直接不存在；但部分场景需要实体已生成但不可见（如 prop_faller 需在 scenario=105 后才播 fall 动画，但生成位置需提前预备）。应加 `visibleIf` 字段（与 `spawnIf` 并列），在 `_buildIndices` / fixedUpdate 里根据 WorldState 切换 `spritePlane.isVisible`。同样适用于 BattleDef 中的敌人（如 scenario<105 时 enemy 不可见）。 | 中 | Step 6 prop_faller 暂用 spawnIf 单独生成，idle 静止待机。后续扩到 battle enemy 与多个 cutscene actor |

## 探索系统切换问题

| 事项 | 描述 | 优先级 | 备注 |
|------|------|--------|------|
| Sequence 中角色朝 -x 移动时不镜像 | `SceneSequencer._updateMoveActorTo` 设 `moveIntent` 触发 `_applyMovement`，但 `allowFacing` 在序列执行期间为 `false`，sprite 不翻转。 | 中 | 影响 battle→explore 退出序列的 `moveActorTo` 步骤；需解耦序列移动与 `allowFacing` 守卫 |

## NPC 行为架构

| 事项 | 描述 | 优先级 | 备注 |
|------|------|--------|------|
| NpcController Behavior 解耦 | 当前 `NpcController` 把状态管理、感知、行为逻辑揉在一起（idle/greeting/following）。Step 5 已抽 `FollowingBehavior` 验证接口，但 `idle` 和 `greeting` 仍在 controller 内部。应进一步抽 `IdleBehavior` / `GreetingBehavior`，controller 只负责 behavior 调度与状态切换。未来可做到 `NpcDef.behaviors: ["greeting", "following"]` 数据驱动装配。 | 中 | Step 5 验证 FollowingBehavior 接口后，渐进迁移 idle/greeting；同步考虑 `canEnter(context)` 接口用于 controller 自动判进入条件 |
| Charlotte 跟随穿模 | companion `blocksMovement:false`（避免挡路），导致 follow 期间 Charlotte 朝 target=hero.x+1.0 移动时可能穿过 hero。视觉上是"Charlotte 贴着 hero 走过去"。 | 低 | 原型阶段可接受，属 §2.6 sequencer/character 交互职责范围；未来可考虑路径规划绕开、或 follow target 改为动态偏移（hero 左/右根据 Charlotte 当前侧） |

## GameMode 未完成事项

| 事项 | 描述 | 优先级 | 备注 |
|------|------|--------|------|
| SceneSequencer 收敛 | 补充 `timeout/cancel/fail` 回调，条件 step 数据化。修复序列中角色朝 -x 移动时不镜像问题。 | 中 | 当前仅实现基础 step，缺少错误处理与条件判断扩展 |

