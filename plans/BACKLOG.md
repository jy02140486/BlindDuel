# 待办与优化 backlog

> 不阻塞当前主线，但值得后续处理的事项。

---

## 资源工具链

| 事项 | 描述 | 优先级 | 备注 |
|------|------|--------|------|
| 合并冗余 atlas JSON | `Data/CollisionMask/`、`Data/PushBox/`、`Data/RootMotion/` 三个目录下的 `.json` 文件内容相同（帧布局、duration 一致），仅 `.png` 像素内容不同。可优化为只保留一份 `.json` 作为帧索引，减少维护成本。 | 低 | 需改 `extract_collision_boxes.ps1` 脚本 |
| 旧脚本文件占用锁清理 | 旧路径 `scripts/extract_collision_boxes.ps1` 因文件锁无法删除，仍残留在仓库中。 | 低 | 不影响主流程，后续找机会清理 |

## 探索系统

| 事项 | 描述 | 优先级 | 备注 |
|------|------|--------|------|
| 投掷物与暗器玩法（含 Projectile） | 在探索模式可获得投掷物/暗器资源，并在战斗中释放；同时补齐 projectile 基础能力（生成、飞行、命中、销毁、与现有 Combat 规则衔接）。 | 中 | 建议先做单一 projectile 类型验证战斗闭环 |
| NPC 物物交换玩法（以物换物） | 探索模式中允许用小物件与 NPC 交易，换取 buff、投掷物或其他战斗资源。 | 中 | 需定义交易条件、库存/消耗规则、NPC 交互反馈与失败提示 |
| NPC root 锚点与 hero 锚点约定不一致 | NPC 默认使用帧中心作为 root 锚点，hero 使用 collider 定义的 near-bottom 锚点，两者不在同一约定。当前 Y-sort 通过 `getVisualBottomY()` 统一计算绕过。 | 中 | 长期应统一锚点约定，或显式区分两种锚点语义 |
| 状态机事件回调未展开 | 状态切换缺少 enter/exit 钩子机制，无法在状态进入/退出时触发数据驱动的事件（音效、特效、指令派发）。 | 中 | 移动驱动已展开（moveIntent + controlledBySequence + FollowingBehavior）；事件回调待补 |

| 实体默认隐藏 + 触发时显示 | cutscene/battle 相关实体（如 prop_faller、scenario-gated enemy）在触发条件未满足时应保持隐藏，而非场景加载即出现。当前 `spawnIf` 只控制生成，未满足时实体直接不存在；但部分场景需要实体已生成但不可见（如 prop_faller 需在 scenario=105 后才播 fall 动画，但生成位置需提前预备）。应加 `visibleIf` 字段（与 `spawnIf` 并列），在 `_buildIndices` / fixedUpdate 里根据 WorldState 切换 `spritePlane.isVisible`。同样适用于 BattleDef 中的敌人（如 scenario<105 时 enemy 不可见）。 | 中 | Step 6 prop_faller 暂用 spawnIf 单独生成，idle 静止待机。后续扩到 battle enemy 与多个 cutscene actor |
| ItemDef 双源不一致 | 物品定义有两套：`Data/ItemDefs.js`（集中注册表，Quest/NPC 链路用）和 SceneDefs JSON 里 entity 内联的 itemDef（PickableEntity → InventoryManager.addItem 实际消费的）。两边独立维护，新字段（如 `throwable`）要同时改两处才生效。应统一为引用式：SceneDef 只写 `itemId: "dagger"`，运行时从 ItemDefs.js 拉取完整定义，避免双源漂移。 | 低 | 投掷物 ammo 同步实现中发现（改了 ItemDefs.js 但 getThrowables 仍空，才发现 SceneDefs 那份才是真的）；当前 dagger 已两边都加 throwable: true，后续其他投掷物注意同步加 |

## 探索系统切换问题

| 事项 | 描述 | 优先级 | 备注 |
|------|------|--------|------|
| Sequence 中角色朝 -x 移动时不镜像 | `SceneSequencer._updateMoveActorTo` 设 `moveIntent` 触发 `_applyMovement`，但 `allowFacing` 在序列执行期间为 `false`，sprite 不翻转。 | 中 | 影响 battle→explore 退出序列的 `moveActorTo` 步骤；需解耦序列移动与 `allowFacing` 守卫 |

## GameMode 未完成事项

| 事项 | 描述 | 优先级 | 备注 |
|------|------|--------|------|
| SceneSequencer 收敛 | 补充 `timeout/cancel/fail` 回调，条件 step 数据化。修复序列中角色朝 -x 移动时不镜像问题。 | 中 | 当前仅实现基础 step，缺少错误处理与条件判断扩展 |

# mannual
prologue_cs_rabble_flee.json摄像机移向prop时会有jitter
配音，格挡成功攻方播还是守方播，是不是跟动画播
主人公clash也有加速奖励
闪躲距离过长
独立的防御/闪避决策序列？

## AI 系统

> 关联：`plans/26.10.9 预测能力通用化计划.MD`（Phase 5 主计划）、`docs/AI系统说明.MD` §10

### Phase 5：统一预测层（`predictedOpponentEvents[]`）

> 架构：prediction layer 只产纯时间线事件（不做 threatLevel/canPreempt 判断），评分函数消费 events。subsume 现有 throw preemptive 硬编码路径。
> 覆盖缺口：**B1 + B4**（B5/B6 后移至 Post-Phase 5）
>
> Step 1 → B1（opp stateName / attackProfile 识别进 Situation）
> Step 2a → 建立预测事件生成器，先只观测不迁移
> Step 2b → 迁移现有 throw preemptive cut 到事件层（回归验收）
> Step 3 → #scoreAttack 截击判断 + #scoreDefense 差异化防御（消费 events）
> Step 4 → B4 近距离打断 throw（时间条件：T_my_active < T_release）

### 缺口 B1：不区分 opp 出什么招

| 项 | 说明 |
|----|------|
| 现状 | `Situation` 只有 oppPhase + oppVulnerable + oppThreat，没有 opp 当前 stateName / attackProfile |
| 想让 AI 做到 | opp 出 swing（startup 长）→ 用 thrust 截断；opp 出 thrust（startup 短）→ 不抢先 |
| 补法 | Phase 5 Step 1：`#buildSituation` 从 opp committed state 查 attackProfile（AIKnowledgeRegistry 已缓存） |

### 缺口 B4：近距离 reach 内无法打断 throw

| 项 | 说明 |
|----|------|
| 现状 | throw_windup 期间 reach 内，reactive cut 物理上不可能（flightMs 太短）；唯一可靠方案是 windup 期间 hitstun opp 打断 |
| 补法 | Phase 5 Step 4。**时间条件**：T_my_active < T_release（我的攻击先于 release 激活），不是 throwReleaseMs ≤ ownStartupMs |

### 缺口 B2：没有 defensePreferences

| 项 | 说明 |
|----|------|
| 现状 | `aiProfile` 只有 `attackPreferences`，没有 per-defense-state 偏好 |
| 想让 AI 做到 | Rabble 偏好 parry 而弱 guard |
| 补法 | `aiProfile.defensePreferences: {guard_low:1.0, guard_high:0.6, parry:1.8}` + `#scoreDefense` 末尾乘入（和 attackPreferences 对称） |
| 优先级 | 高（改动最小，性价比最高） |

### Post-Phase 5（后移，不阻塞核心交付）

| 缺口 | 说明 |
|------|------|
| **B5** 预测驱动的 positioning | "opp out of reach → advance" 太简化。是否前进取决于敌人 profile、自身攻击范围、opp 时序。先让 prediction 对 attack/defense 有明确收益再迭代 |
| **B6** predictionAccuracy 旋钮 | `oppActionIdentification`/`timingPrecision`/`reactionDelayMs` 是三个不同维度，不应在基础预测层未稳定时一起实现；同一次 opp 动作内误差应保持稳定（避免每 tick 随机抖动） |
| **B3** strafe 侧移 | 大改，涉及 combat movement 系统；当前 X-only 距离控制够用，最后考虑 |