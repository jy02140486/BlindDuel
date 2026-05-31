---
name: COMBAT_HP_FEATURE_DESIGN
overview: 给 CombatCharacter 增加 HP 属性，支持受击扣血、HP 归零后进入死亡状态(defeated/die)，死亡后 BattleMode 检测战斗结束并切换回探索模式。
todos:
  - id: save-hp-design-md
    content: 保存 HP 系统设计文档到 plans/COMBAT_HP_FEATURE_DESIGN.md
    status: completed
---

## 用户需求

将上一轮对话中讨论确认的 HP 系统设计文档保存到项目 `plans/` 目录下。

## 文档内容

已确认的 HP 与死亡系统设计文档，包含：现状分析、数据流设计（mermaid 图）、6 步改动步骤、文件改动清单、验收标准、已知风险与后续扩展。

## 技术方案

在 `e:\se\BlindDuel\plans\COMBAT_HP_FEATURE_DESIGN.md` 创建新文件，写入完整的设计文档内容。文档格式为 Markdown，与 `plans/` 目录下现有文档风格保持一致。

## 实现要点

- 文件路径：`e:\se\BlindDuel\plans\COMBAT_HP_FEATURE_DESIGN.md`
- 内容来源：上一轮对话中已讨论确认的完整方案
- 遵守 `andrej-karpathy-skills-CLAUDE.MD` 的 Simplicity First 原则：不添加额外内容，只写已确认的方案