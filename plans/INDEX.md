# 计划索引（Plan Index）

> 本文件跟踪当前进行中的计划、待办入口与最近归档。项目上下文、技术栈与协作约定见 `PROJECT_CONTEXT.md`。
>
> **当前无进行中的专项计划。剩余事项全部进入 `BACKLOG.md`。**

---

## 进行中

*（无）*

---

## 待办入口

| 文档 | 目标 | 备注 |
|------|------|------|
| [BACKLOG.md](BACKLOG.md) | 所有未完成事项的主 tracking 入口 | 涵盖战斗、探索、GameMode、相机、资源工具链等 |

---

## 最近归档（2026-05-27）

| 计划 | 目标 | 完成内容 |
|------|------|----------|
| [archived/CHARACTER_NPC_DECOUPLE_OVERVIEW.md](archived/CHARACTER_NPC_DECOUPLE_OVERVIEW.md) | Character 解耦概要设计 | Phase A-D 设计框架，Phase A-C 实现完毕 |
| [archived/CHARACTER_NPC_DECOUPLE_TASKLIST.md](archived/CHARACTER_NPC_DECOUPLE_TASKLIST.md) | Character 解耦任务清单 | Phase 1-6 完成：CharacterBase/CombatCharacter/NpcCharacter 拆分，NpcFrameComponent + NpcController，occupancy 锚点修复 |
| [archived/NPC_CONTROLLER_MINIMAL_GREETING_DESIGN.md](archived/NPC_CONTROLLER_MINIMAL_GREETING_DESIGN.md) | NPC idle/greeting 控制器设计 | 已实现并接入 Scene/ExploreMode |
| [archived/NPC_ROOTMOTION_OCCUPANCY_PIPELINE.md](archived/NPC_ROOTMOTION_OCCUPANCY_PIPELINE.md) | NPC RootMotion Occupancy 脚本设计 | `scripts/tools/extract_rootmotion_occupancy.ps1` 已实现并运行 |
| [archived/GAMEMODE_SCENE_SPLIT_PROPOSAL.md](archived/GAMEMODE_SCENE_SPLIT_PROPOSAL.md) | Scene/GameMode 拆分提案 | Phase 1-2 完成；Phase 3-5 入 BACKLOG |
| [archived/GAMEMODE_OVERVIEW_DESIGN.md](archived/GAMEMODE_OVERVIEW_DESIGN.md) | GameMode、CameraRig、SceneSequencer 概要设计 | 设计已落地为代码，作为基准文档归档 |

---

## 更早归档

| 计划 | 目标 | 归档日期 |
|------|------|----------|
| [archived/TIMECONTROL_REFACTOR_GUIDE.md](archived/TIMECONTROL_REFACTOR_GUIDE.md) | TimeControl 三步重构 + 生命周期守卫 + Combat 规则收敛 | 2026-05-18 |
| [archived/FIXED_UPDATE_PLAN.md](archived/FIXED_UPDATE_PLAN.md) | 固定帧 60fps、输入缓冲、Just Guard、Hitstop、ImpactContext | 2026-05-05 |
| [archived/COMBAT_RULES_REFINEMENT_PLAN.md](archived/COMBAT_RULES_REFINEMENT_PLAN.md) | thrust 帧级判定、dodge 无敌、格挡/重击规则修正 | 2026-05-04 |
| `plans/archived/` 目录 | 更早阶段的角色碰撞、移动、场景视觉、AI 等历史方案 | 见各文件头部 |

---

## 快速参考：当前开发状态

- **GameMode 拆分**：`GameModeManager + BattleMode + ExploreMode` 已接入，`Scene` 通过 mode 层驱动。
- **SceneSequencer**：已实现基础 step（wait / moveActorTo / switchMode / startCameraBlend 等）。
- **Explore-Battle 流程**：触发器进入 → SceneSequencer 编排 → draw 动画 → 相机 blend → 切模式，链路已通。
- **Character 解耦**：`CharacterBase` / `CombatCharacter` / `NpcCharacter` 拆分完成，NPC 最小验证通过。
- **NPC 系统**：`NpcFrameComponent`（单帧动画）+ `NpcController`（idle/greeting）+ occupancy 锚点，已接入 ExploreMode。
- **NPC 工具链**：`extract_rootmotion_occupancy.ps1` 可独立生成 occupancy 数据。
- **当前**：无进行中的专项计划，剩余事项见 [BACKLOG.md](BACKLOG.md)。

## Update Log (2026-05-27)
- 6 个计划文档归档：CHARACTER_NPC_DECOUPLE x2、NPC_CONTROLLER、NPC_ROOTMOTION_OCCUPANCY、GAMEMODE x2
- BACKLOG.md 补充 GameMode 未完成事项（CameraManager Phase 3、SceneSequencer 收敛、Phase 5 内容扩展）
- 剩余 Phase 全部移入 BACKLOG，INDEX"进行中"清空