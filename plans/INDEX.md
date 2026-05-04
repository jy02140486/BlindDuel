# 计划索引（Plan Index）

> 本文件跟踪所有进行中的计划。项目概况、技术栈、协作约定见 `PROJECT_CONTEXT.md`。

---

## 进行中

| 计划 | 目标 | 创建日期 |
|------|------|----------|
| [FIXED_UPDATE_PLAN.md](FIXED_UPDATE_PLAN.md) | 逻辑帧固定 60fps + 输入缓冲 + Just Guard 时机判定 | 2026-05-04 |

---

## 待开始

| 计划 | 目标 | 备注 |
|------|------|------|
| 见 [BACKLOG.md](BACKLOG.md) | 资源工具链优化等 | 不阻塞主线 |

---

## 最近归档

| 计划 | 目标 | 归档日期 |
|------|------|----------|
| [archived/COMBAT_RULES_REFINEMENT_PLAN.md](archived/COMBAT_RULES_REFINEMENT_PLAN.md) | thrust 帧级判定 + dodge 无敌 + 格挡/重击 | 2026-05-04 |

---

## 最近归档

| 计划 | 目标 | 归档日期 |
|------|------|----------|
| 见 `archived/` 目录 | — | — |

---

## 快速参考：当前开发状态

- **最新完成**: 阶段 4c 格挡与重击联动（parryBonus + canParry + 派生攻击 + timeScale 加速）
- **当前重点**: Fixed Update 改造（逻辑帧固定 60fps + 输入缓冲 + Just Guard 时机判定）
- **下一步**: 见 [FIXED_UPDATE_PLAN.md](FIXED_UPDATE_PLAN.md)
- **已知问题**: 
  - guard 动画仅 2 帧，parry 窗口可能不足
  - 无 hitstop，视觉反馈不足
  - 无输入缓冲，精确时机难以掌握
  - 当前变帧率更新，不利于格斗游戏判定
