# 待办与优化 backlog

> 不阻塞当前主线，但值得后续处理的事项。

---

## 资源工具链

| 事项 | 描述 | 优先级 | 备注 |
|------|------|--------|------|
| 旧脚本文件占用锁清理 | 旧路径 `scripts/extract_collision_boxes.ps1` 因文件锁无法删除，仍残留在仓库中。 | 低 | 不影响主流程，后续找机会清理 |

## 探索系统

| 事项 | 描述 | 优先级 | 备注 |
|------|------|--------|------|
| 状态机事件回调未展开 | 状态切换缺少 enter/exit 钩子机制，无法在状态进入/退出时触发数据驱动的事件（音效、特效、指令派发）。 | 中 | 移动驱动已展开（moveIntent + controlledBySequence + FollowingBehavior）；事件回调待补 |
| 实体默认隐藏 + 触发时显示 | cutscene/battle 相关实体（如 prop_faller、scenario-gated enemy）在触发条件未满足时应保持隐藏，而非场景加载即出现。当前 `spawnIf` 只控制生成，未满足时实体直接不存在；但部分场景需要实体已生成但不可见（如 prop_faller 需在 scenario=105 后才播 fall 动画，但生成位置需提前预备）。应加 `visibleIf` 字段（与 `spawnIf` 并列），在 `_buildIndices` / fixedUpdate 里根据 WorldState 切换 `spritePlane.isVisible`。同样适用于 BattleDef 中的敌人（如 scenario<105 时 enemy 不可见）。 | 中 | Step 6 prop_faller 暂用 spawnIf 单独生成，idle 静止待机。后续扩到 battle enemy 与多个 cutscene actor |
| ItemDef 双源不一致 | 物品定义有两套：`Data/ItemDefs.js`（集中注册表，Quest/NPC 链路用）和 SceneDefs JSON 里 entity 内联的 itemDef（PickableEntity → InventoryManager.addItem 实际消费的）。两边独立维护，新字段（如 `throwable`）要同时改两处才生效。应统一为引用式：SceneDef 只写 `itemId: "dagger"`，运行时从 ItemDefs.js 拉取完整定义，避免双源漂移。 | 低 | 投掷物 ammo 同步实现中发现（改了 ItemDefs.js 但 getThrowables 仍空，才发现 SceneDefs 那份才是真的）；当前 dagger 已两边都加 throwable: true，后续其他投掷物注意同步加 |

## GameMode 未完成事项

| 事项 | 描述 | 优先级 | 备注 |
|------|------|--------|------|
| SceneSequencer 收敛 | 补充 `timeout/cancel/fail` 回调，条件 step 数据化。修复序列中角色朝 -x 移动时不镜像问题。 | 中 | 当前仅实现基础 step，缺少错误处理与条件判断扩展 |

# mannual
prologue_cs_rabble_flee.json摄像机移向prop时会有jitter
配音，格挡成功攻方播还是守方播，是不是跟动画播
主人公clash也有加速奖励
盾格挡的后退
破盾的被破方hitstop

## AI 系统

> 关联：`docs/AI系统说明.MD` §10（缺口状态以该文档 §10 为准）

> Phase 5 统一预测层（`predictedOpponentEvents[]`，Step 1-4）及缺口 B1/B4/B5 已落地（2026-10-12），详见 `docs/AI系统说明.MD` §10 与 `plans/archived/26.9.24 投掷物及预测/26.10.9 预测能力通用化计划.MD`。

### 缺口 B2：没有 defensePreferences

| 项 | 说明 |
|----|------|
| 现状 | `aiProfile` 只有 `attackPreferences`，没有 per-defense-state 偏好 |
| 想让 AI 做到 | Rabble 偏好 parry 而弱 guard |
| 补法 | `aiProfile.defensePreferences: {guard_low:1.0, guard_high:0.6, parry:1.8}` + `#scoreDefense` 末尾乘入（和 attackPreferences 对称） |
| 优先级 | 高（改动最小，性价比最高） |

### 其他后移缺口（不阻塞当前主线）

| 缺口 | 说明 |
|------|------|
| **B6** predictionAccuracy 旋钮 | `oppActionIdentification`/`timingPrecision`/`reactionDelayMs` 是三个不同维度，不应在基础预测层未稳定时一起实现；同一次 opp 动作内误差应保持稳定（避免每 tick 随机抖动） |