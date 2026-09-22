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

## AI 系统（Phase 4+）

> 触发：设计 Rabble profile（精于防反、opp 出重击→伺机轻击截断、积极走位）时发现现有 7 个 knob 能配 ~70%，但三个核心特征表达不了。
> 关联文档：`docs/AI系统说明.MD` Section 10
> 原则：Phase 4 先落地现有 7 个 knob（见下 Rabble 草案），跑实际效果；缺口按 B2→B1→B3 顺序按需补，不要为一个角色一次加一堆 knob。

### Rabble 草案（Phase 4 可直接用）

```json
{ "aiProfile": {
  "baseAggression":0.9, "baseDefense":1.2, "decayAlpha":0.25,
  "distanceAppetite":0.8, "retreatDesire":0.5, "repetitionCostRate":0.08,
  "attackPreferences": {"thrust":1.5, "swing":0.6, "dash":1.2}
}}
```

预期效果：defenseMult 基准偏高→opp 出招时更早进 guard；alpha=0.25→攻防切换快；attackPreferences→优先 thrust。

### B1: 不区分 opp 出什么招

| 项 | 说明 |
|----|------|
| 现状 | `Situation` 只有 oppPhase + oppVulnerable + oppThreat，没有 opp 当前 stateName / attackProfile |
| 缺口 | 无法针对 opp 招式类型差异化 preemptive（opp 出 swing 想截断，出 thrust 赶不上就不抢）|
| 补法 | 1) `#buildSituation` 从 opp 已 committed 的 state 查当前 attackProfile；2) `#scoreAttack` 的 startupFactor 改成和 opp startupMs 比 |
| 优先级 | 中 |

### B2: 没有 defensePreferences

| 项 | 说明 |
|----|------|
| 现状 | `aiProfile` 只有 `attackPreferences`，没有 per-defense-state 偏好 |
| 缺口 | Rabble 想让 parry 分比 guard 高做不到，只能靠 `baseDefense` 整体拉防御意愿 |
| 补法 | `aiProfile.defensePreferences: {guard_low:1.0, guard_high:0.6, parry:1.8}` + `#scoreDefense` 末尾乘入（和 attackPreferences 对称）|
| 优先级 | 高（改动最小，性价比最高）|

### B3: positioning 只有一维推拉

| 项 | 说明 |
|----|------|
| 现状 | approach/hold/retreat 只改前后距离，没有 strafe（左右侧移）|
| 缺口 | "积极走位获取机会"想包括绕侧、拉角度，但 distanceAppetite 只能前后推拉 |
| 补法 | 大改。两个方向：a) 加 `strafeLeft/strafeRight` 进候选池；b) 用更复杂的位置目标（opp 侧面 45° 扇区）。需和 combat movement 系统对齐 |
| 优先级 | 低（大改，最后考虑）|