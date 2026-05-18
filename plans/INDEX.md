# 计划索引（Plan Index）

> 本文件跟踪所有进行中的计划。项目概况、技术栈、协作约定见 `PROJECT_CONTEXT.md`。

---

## 进行中

> 当前无进行中的计划，见 [BACKLOG.md](BACKLOG.md)。

---

## 待开始

| 计划 | 目标 | 备注 |
|------|------|------|
| 见 [BACKLOG.md](BACKLOG.md) | 资源工具链优化等 | 不阻塞主线 |

---

## 最近归档

| 计划 | 目标 | 归档日期 |
|------|------|----------|
| [archived/TIMECONTROL_REFACTOR_GUIDE.md](archived/TIMECONTROL_REFACTOR_GUIDE.md) | TimeControl 三步重构 + 生命周期守卫（过期 impact 跳转拦截）+ Combat 规则收敛 | 2026-05-18 |
| [archived/FIXED_UPDATE_PLAN.md](archived/FIXED_UPDATE_PLAN.md) | 逻辑帧固定 60fps + 输入缓冲 + Just Guard + Hitstop + ImpactContext | 2026-05-05 |
| [archived/COMBAT_RULES_REFINEMENT_PLAN.md](archived/COMBAT_RULES_REFINEMENT_PLAN.md) | thrust 帧级判定 + dodge 无敌 + 格挡/重击 | 2026-05-04 |

---

## 更早归档

| 计划 | 目标 | 归档日期 |
|------|------|----------|
| 见 `archived/` 目录 | — | — |

---

## 快速参考：当前开发状态

- **最新完成**: TimeControl 三步重构（组件/系统拆分 + `effectiveDeltaMs` 统一入口 + Combat 规则收敛）与 impactContext 生命周期守卫修复
- **当前重点**: 验证并收敛 `ContactResolver` 的“同一攻击实例对同一目标只取首次结果”规则，继续观察 clash/guard/hit 先后关系
- **下一步**: 见 [BACKLOG.md](BACKLOG.md)
- **已知问题**: 
  - guard 动画仅 2 帧，parry 窗口依赖 `guardFrame === 0` 预判
  - 无连击系统
  - AI 行为单一（当前为 TestController 脚本回放）
  - `tickDiff` 阈值仍为硬编码（已记录到 backlog，后续配置化）
