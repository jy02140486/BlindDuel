# 计划索引（Plan Index）
> 本文件跟踪当前计划入口、待办入口与最近归档。项目上下文、技术栈与协作约定见 `PROJECT_CONTEXT.md`。
> 当前没有“进行中”的单项计划，剩余事项以 `BACKLOG.md` 和专项实施文档为入口。

---

## 进行中

（无进行中计划，待从 BACKLOG 选取）

---

## 待办入口

| 文档 | 目标 | 备注 |
|------|------|------|
| [BACKLOG.md](BACKLOG.md) | 所有未完成事项的主 tracking 入口 | 涵盖战斗、探索、GameMode、相机、资源工具链等 |
| [plans/backlogs_detailed/CLEANBEAT_2P5D_SLOPE_PLAN.md](backlogs_detailed/CLEANBEAT_2P5D_SLOPE_PLAN.md) | 2.5D 坡道与屏幕平行壁面方案 | 已转入详细 backlog，当前不优先实现 |

---

## 最近归档（2026-05-30）

| 计划 | 目标 | 完成内容 |
|------|------|----------|
| [archived/COMBAT_HP_AND_DEATH_STATE.md](archived/COMBAT_HP_AND_DEATH_STATE.md) | CombatCharacter HP + 死亡状态 + 战斗切回探索 | Step 0-4 全部实施：collider 提取、资源接线、状态图、HP 核心、退出序列 |
| [archived/EXPLORE_MOVEMENT_DESIGN.md](archived/EXPLORE_MOVEMENT_DESIGN.md) | 探索阶段移动与相机设计 | walkArea、输入映射、ExploreCameraRig、SceneSequencer 适配 |
| [archived/CAMERAMANAGER_PHASE3_FINISHING_TODO.md](archived/CAMERAMANAGER_PHASE3_FINISHING_TODO.md) | CameraManager Phase 3 收尾 | 探索 walkArea、速度基线、Battle→Explore 过渡序列、CameraShake |

---

## 最近归档（2026-05-28）

| 计划 | 目标 | 完成内容 |
|------|------|----------|
| [archived/EXPLORE_MODE_DATA_AND_COLLISION_PLAN.md](archived/EXPLORE_MODE_DATA_AND_COLLISION_PLAN.md) | ExploreMode 数据索引与碰撞交互计划 | Phase 1-7 全部完成：实体池、索引、AABB、碰撞、交互、y-sort、Scene 清理 |
| [archived/EXPLORE_MODE_DATA_AND_COLLISION_IMPLEMENTATION.md](archived/EXPLORE_MODE_DATA_AND_COLLISION_IMPLEMENTATION.md) | 7 Phase 分步实施文档 | 已全部落地，ExploreMode 碰撞/交互/渲染体系就绪 |

---

## 最近归档（2026-05-27）

| 计划 | 目标 | 完成内容 |
|------|------|----------|
| [archived/CHARACTER_NPC_DECOUPLE_OVERVIEW.md](archived/CHARACTER_NPC_DECOUPLE_OVERVIEW.md) | Character 解耦概要设计 | Phase A-D 设计框架，Phase A-C 实现完毕 |
| [archived/CHARACTER_NPC_DECOUPLE_TASKLIST.md](archived/CHARACTER_NPC_DECOUPLE_TASKLIST.md) | Character 解耦任务清单 | Phase 1-6 完成：`CharacterBase/CombatCharacter/NpcCharacter` 拆分，`NpcFrameComponent + NpcController`，occupancy 锚点修复 |
| [archived/NPC_CONTROLLER_MINIMAL_GREETING_DESIGN.md](archived/NPC_CONTROLLER_MINIMAL_GREETING_DESIGN.md) | NPC `idle/greeting` 控制器设计 | 已实现并接入 `Scene/ExploreMode` |
| [archived/NPC_ROOTMOTION_OCCUPANCY_PIPELINE.md](archived/NPC_ROOTMOTION_OCCUPANCY_PIPELINE.md) | NPC RootMotion Occupancy 脚本设计 | `scripts/tools/extract_rootmotion_occupancy.ps1` 已实现并运行 |
| [archived/GAMEMODE_SCENE_SPLIT_PROPOSAL.md](archived/GAMEMODE_SCENE_SPLIT_PROPOSAL.md) | `Scene/GameMode` 拆分提案 | Phase 1-2 完成，Phase 3-5 已转入 backlog |
| [archived/GAMEMODE_OVERVIEW_DESIGN.md](archived/GAMEMODE_OVERVIEW_DESIGN.md) | `GameMode / CameraRig / SceneSequencer` 概要设计 | 设计已落地为代码，作为基准文档归档 |

---

## 更早归档

| 计划 | 目标 | 归档日期 |
|------|------|----------|
| [archived/TIMECONTROL_REFACTOR_GUIDE.md](archived/TIMECONTROL_REFACTOR_GUIDE.md) | TimeControl 三步重构 + 生命周期守卫 + Combat 规则收敛 | 2026-05-18 |
| [archived/FIXED_UPDATE_PLAN.md](archived/FIXED_UPDATE_PLAN.md) | 固定步 60fps、输入缓冲、Just Guard、Hitstop、ImpactContext | 2026-05-05 |
| [archived/COMBAT_RULES_REFINEMENT_PLAN.md](archived/COMBAT_RULES_REFINEMENT_PLAN.md) | thrust 帧级判定、dodge 无敌、格挡/重击规则修正 | 2026-05-04 |
| `plans/archived/` 目录 | 更早阶段的角色碰撞、移动、场景视觉、AI 等历史方案 | 见各文件头部 |

---

## 快速参考：当前开发状态
- `GameMode` 拆分已接入：`GameModeManager + BattleMode + ExploreMode`
- `SceneSequencer` 已具备基础 step：`wait / moveActorTo / switchMode / startCameraBlend` 等
- `Explore -> Battle` 主流程已通：触发器进入 -> `SceneSequencer` 编排 -> `draw` 动画 -> 相机 blend -> 切模式
- Character 解耦已完成：`CharacterBase / CombatCharacter / NpcCharacter`
- NPC 最小链路已通：`NpcFrameComponent + NpcController(idle/greeting) + occupancy` 已接入 `ExploreMode`
- NPC 工具链已补齐：`extract_rootmotion_occupancy.ps1` 可独立生成 occupancy 数据
- `Explore -> Battle` 主流程已通，`Battle -> Explore` 返回流程已通（通过死亡状态触发 SceneSequencer）
- 战斗 HP 系统已完成：角色血量、死亡状态动画、战斗结束自动切回探索模式
- 当前下一阶段重点：待从 BACKLOG 中选取

## Update Log (2026-05-30)
- 3 个计划文档完成并归档：`COMBAT_HP_AND_DEATH_STATE`、`EXPLORE_MOVEMENT_DESIGN`、`CAMERAMANAGER_PHASE3_FINISHING_TODO`
- HP 系统 5 步实施全部落地：collider 提取 → 资源接线 → 状态图 → HP 核心 → 退出序列
- `BACKLOG.md` 新增：序列中角色朝 -x 移动时不镜像问题；CameraManager Phase 3 / 探索移动 / HP 标记完成
- `INDEX.md` 进行中清空

## Update Log (2026-05-27)
- 6 个计划文档归档：`CHARACTER_NPC_DECOUPLE` x2、`NPC_CONTROLLER`、`NPC_ROOTMOTION_OCCUPANCY`、`GAMEMODE` x2
- `BACKLOG.md` 补充 GameMode 未完成事项：`CameraManager Phase 3`、`SceneSequencer` 收尾、Phase 5 内容扩展
- 剩余 Phase 全部移入 `BACKLOG`，`INDEX` 的“进行中”清空

## Update Log (2026-05-28)
- 探索模式实施完成并归档：`EXPLORE_MODE_DATA_AND_COLLISION_PLAN.md`、`EXPLORE_MODE_DATA_AND_COLLISION_IMPLEMENTATION.md`
- Phase 1-7 全部落地：实体池 → 索引 → AABB → 碰撞 → 交互(J/X) → y-sort → Scene 清理
- `INDEX.md` 进行中/待办已清空，下一重点待从 `BACKLOG.md` 选取

## Update Log (2026-05-28)
- 新增探索模式实现入口：[EXPLORE_MODE_DATA_AND_COLLISION_PLAN.md](EXPLORE_MODE_DATA_AND_COLLISION_PLAN.md)
- `backlogs_detailed/CLEANBEAT_2P5D_SLOPE_PLAN.md` 保留为坡道详细方案，不作为当前主线
