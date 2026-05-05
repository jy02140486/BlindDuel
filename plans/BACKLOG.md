# 待办与优化 backlog

> 不阻塞当前主线，但值得后续处理的事项。

---

## 资源工具链

| 事项 | 描述 | 优先级 | 备注 |
|------|------|--------|------|
| 合并冗余 atlas JSON | `Data/CollisionMask/`、`Data/PushBox/`、`Data/RootMotion/` 三个目录下的 `.json` 文件内容相同（帧布局、duration 一致），仅 `.png` 像素内容不同。可优化为只保留一份 `.json` 作为帧索引，减少维护成本。 | 低 | 需改 `extract_collision_boxes.ps1` 脚本 |

## 战斗系统

> 以下事项已在 [FIXED_UPDATE_PLAN.md](archived/FIXED_UPDATE_PLAN.md)（2026-05-05 归档）中全部完成。

| 事项 | 描述 | 状态 | 备注 |
|------|------|------|------|
| Hitstop（卡帧/顿帧）机制 | 攻击命中/被防御/拼刀瞬间双方动画暂停 | ✅ 已完成 | `applyHitstop` + `hitstopFrames` |
| 状态切换与渲染同步 | `CombatSystem` 同一帧内立即切状态导致吞帧 | ✅ 已完成 | `ImpactContext` + `freezeImpact` |
| Guard 动画帧数不足 | guard 仅 2 帧，无法覆盖长 active 帧攻击 | ✅ 已完成 | `guardFrame === 0` 无条件预判 |
| Just Guard 时机判定 | guard 任意帧都可以 parry，不合理 | ✅ 已完成 | `tickDiff` + `isPreemptiveGuard` |