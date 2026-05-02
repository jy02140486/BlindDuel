# 计划索引（Plan Index）

> 本文件跟踪所有进行中的计划。项目概况、技术栈、协作约定见 `PROJECT_CONTEXT.md`。

---

## 进行中

| 计划 | 目标 | 创建日期 |
|------|------|----------|
| [COMBAT_RULES_REFINEMENT_PLAN.md](COMBAT_RULES_REFINEMENT_PLAN.md) | thrust 帧级判定 + dodge 无敌 + 格挡/重击 | 2026-05-01 |

---

## 待开始

| 计划 | 目标 | 备注 |
|------|------|------|
| — | — | — |

---

## 最近归档

| 计划 | 目标 | 归档日期 |
|------|------|----------|
| 见 `archived/` 目录 | — | — |

---

## 快速参考：当前开发状态

- **最新完成**: 规则 3 基础设施（stateTags + timeScale + hasTag + allowMoveInput）+ zornhut 重击 + guard 格挡状态接入
- **当前重点**: 规则 4 格挡与重击联动（parryBonus + canParry + 派生攻击）
- **下一步**: `ContactResolver` 扩展 guard 拦截逻辑，格挡成功打 `parryBonus` 标记
- **已知阻塞**: `parryBonus` 派生转移条件已支持（`hasTag`），但 `ContactResolver` 的 `canParry` 逻辑待实现
