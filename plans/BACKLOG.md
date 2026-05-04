# 待办与优化 backlog

> 不阻塞当前主线，但值得后续处理的事项。

---

## 资源工具链

| 事项 | 描述 | 优先级 | 备注 |
|------|------|--------|------|
| 合并冗余 atlas JSON | `Data/CollisionMask/`、`Data/PushBox/`、`Data/RootMotion/` 三个目录下的 `.json` 文件内容相同（帧布局、duration 一致），仅 `.png` 像素内容不同。可优化为只保留一份 `.json` 作为帧索引，减少维护成本。 | 低 | 需改 `extract_collision_boxes.ps1` 脚本 |

## 战斗系统

| 事项 | 描述 | 优先级 | 备注 |
|------|------|--------|------|
| Hitstop（卡帧/顿帧）机制 | 攻击命中/被防御/拼刀瞬间双方动画暂停 50-200ms，让玩家看到命中瞬间。当前项目无 hitstop，导致"判定发生但精灵没显示完就切状态"的视觉不同步问题（如 rabble swing 前摇结束瞬间被 guard，直接进 hit 看不到攻击帧）。 | 中 | 依赖 `timeScale` 基础设施 |
| 状态切换与渲染同步 | 当前 `CombatSystem.update()` 在同一帧内立即调用 `takeDamage()` → `enterState()`，导致攻击方刚进入 active 帧就被打断，玩家看不到该帧。典型 2D 格斗游戏通过 hitstop + blockstun/hitstun 硬直来解决。 | 中 | 可与 hitstop 一起实现 |
| Guard 动画帧数不足 | guard 仅 2 帧（第 0 帧 parry，第 1 帧后摇），无法覆盖 swing 等长 active 帧攻击。需要增加"纯防御"帧，或改用时间戳判定 parry 窗口。 | 中 | 可与 Fixed Update 一起解决 |
| Just Guard 时机判定 | 当前 guard 任意帧都可以 parry，不合理。应该只有"攻击到来前按下 guard"或"guard 前 N 帧内"才能 parry。需要固定逻辑帧或时间戳判定。 | 中 | 依赖 Fixed Update |