# 计划索引（Plan Index）
> 本文件跟踪当前计划入口、待办入口与最近归档。项目上下文、技术栈与协作约定见 `PROJECT_CONTEXT.md`。
> 当前没有进行中的单项计划，剩余事项以 `BACKLOG.md` 和专项实施文档为入口。

---

## 最近归档（2026-07-08）

| 计划 | 目标 | 完成内容 |
|------|------|----------|
| [commits_detailed/26.7.7 新增同伴和场景中rabblestick的flee cutscene.MD](commits_detailed/26.7.7%20新增同伴和场景中rabblestick的flee%20cutscene.MD) | Prologue Step 6：PropEntity + cutscene + companion | Charlotte 同伴 NPC + FollowingBehavior + PropEntity + cutsceneInvokers 数据驱动 + TimelineSequencer callback + QuestManager.executeDirectives |
| [commits_detailed/26.7.8 pologue 正式制作part2.MD](commits_detailed/26.7.8%20pologue%20正式制作part2.MD) | Prologue Step 7-8：战斗 + 动态 spawn | WorldState 观察者模式 + Scene 动态实体生成 + PROLOGUE_BATTLE + PropEntity dispose 三层防御 + outro 误用 bug 修复 |

## 最近归档（2026-06-29）

| 计划 | 目标 | 完成内容 |
|------|------|----------|
| [archived/Prologue 场景与数据流重构概要设计.MD](archived/Prologue%20场景与数据流重构概要设计.MD) | Prologue 场景落地 + 入口解耦 | Step 1-5 全部完成：WorldState 加 currentSceneId/currentSpawnId、SceneDefRegistry 模块、Game/character_demo 入口解耦、Scene.init 无 battle trigger 容错、prologue.json 三层视差环境；Step 6（BattleDef 外部化）留待战斗场景 |

---

## 最近归档（2026-06-25）

| 计划 | 目标 | 完成内容 |
|------|------|----------|
| [DEFEAT_AND_CHECKPOINT_PLAN.md](DEFEAT_AND_CHECKPOINT_PLAN.md) | 战败与检查点系统 | 5 Step 全部完成：checkpoint save/restore、HP/buffs 恢复、战斗前/胜利后/任务变更后自动保存、战败检测 + defeatSequence、无检查点回退；附修 rabble controller 外部化、enabled 泄漏、场景切换守卫 |

## 最近归档（2026-06-24）

| 计划 | 目标 | 完成内容 |
|------|------|----------|
| [archived/WorldState-SceneSwitch 实现计划.md](archived/WorldState-SceneSwitch%20实现计划.md) | WorldState 扩展 + 场景切换 | Step 1-8 全部完成：ScenarioMilestones、sceneStates、战斗胜利回写、Entity spawnIf 过滤、Trigger condition 条件化、场景切换交互键触发、buff/inventory 跨场景保持 |
| [archived/SCENE_SWITCH_AND_BATTLE_EXTERNALIZE_PLAN.md](archived/SCENE_SWITCH_AND_BATTLE_EXTERNALIZE_PLAN.md) | 场景切换 + 战斗外部化方案 | Step A-E 全部完成：SceneDef/BattleDef 数据结构、Scene.init 重构、BattleMode 重构、场景切换落地、室内场景测试 |
| [archived/Quest&Pickables.MD](archived/Quest%26Pickables.MD) | RPG 世界状态架构（设计文档） | 核心架构落地：WorldState（scenario/flags/quests/sceneStates）、QuestManager、InventoryManager、NPC resolve、SceneBuilder 概念 |
| [archived/NPC-Quest-WorldState 概要设计.md](archived/NPC-Quest-WorldState%20概要设计.md) | NPC/Quest/WorldState 架构（设计文档） | 设计落地：NPC resolve、DialogueEntry 条件匹配、对白 action 触发、QuestManager 写入流程 |

---

## 进行中

| 计划 | 目标 | 进度 |
|------|------|------|
| [COMBAT_RULES_REDESIGN_PLAN.md](COMBAT_RULES_REDESIGN_PLAN.md) | 战斗判定规则重设计：从"剑身强弱"转向"招式轻重+轨迹" | Step 0 进行中（mask 重绘） |

## 待办入口

| 文档 | 目标 | 备注 |
|------|------|------|
| [BACKLOG.md](BACKLOG.md) | 所有未完成事项的主 tracking 入口 | 涵盖战斗、探索、GameMode、相机、资源工具链等 |
| [TIMELINE_SEQUENCER_CONCURRENT_ACTION_PLAN.md](TIMELINE_SEQUENCER_CONCURRENT_ACTION_PLAN.md) | Timeline Sequencer 并发 action 重构方案 | 待评审，尚未实施 |
| [plans/backlogs_detailed/CLEANBEAT_2P5D_SLOPE_PLAN.md](backlogs_detailed/CLEANBEAT_2P5D_SLOPE_PLAN.md) | 2.5D 坡道与屏幕平行壁面方案 | 已转入详细 backlog，当前不优先实现 |

---

## 最近归档（2026-06-08）

| 计划 | 目标 | 完成内容 |
|------|------|----------|
| [archived/STAGE_MASK_PIPELINE_PLAN.md](archived/STAGE_MASK_PIPELINE_PLAN.md) | 舞台遮罩管线 | Step 0-6 全部完成：扫描脚本、分图层导出、加载管线、Stencil 三步法、pushbox/walkArea 消费、端到端验证 + 动态 mask 可见性修复 |

## 最近归档（2026-06-03）

| 计划 | 目标 | 完成内容 |
|------|------|----------|
| [CAMERA_EFFECTS_PIPELINE_PLAN.md](CAMERA_EFFECTS_PIPELINE_PLAN.md) | 镜头效果管线 | Step 0-6 全部完成 |

## 最近归档（2026-06-01）

| 计划 | 目标 | 完成内容 |
|------|------|----------|
| [archived/SEQUENCE_CAMERA_AND_FACING_POLICY_PROPOSAL.md](archived/SEQUENCE_CAMERA_AND_FACING_POLICY_PROPOSAL.md) | Sequence 相机独立控制 + 角色 FacingPolicy 解耦方案 | Phase 1-2 全部实施：`ScriptedCameraRig`（正交固定画幅）、`FACING_MODE` 枚举、`SceneSequencer` step 类型枚举化、退出战斗 sequence 朝向控制 |
| [archived/FACING_POLICY_IMPLEMENTATION_STEPS.md](archived/FACING_POLICY_IMPLEMENTATION_STEPS.md) | FacingPolicy 实施步骤 | 三步全部落地：CharacterBase 改造、Mode 切换更新、SceneSequencer 支持 facing step |

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
- **场景切换**：室内外双向切换已通，交互键触发（防死循环），hero HP/buffs/inventory 跨场景保持
- **WorldState**：scenario + flags + quests + sceneStates 体系完整，**观察者模式**（onChange/setScenario/setFlag）驱动动态 spawn
- **QuestManager**：唯一写入入口，支持 scenario 推进、flag 设置、quest 阶段管理、action 执行、**executeDirectives 批量指令**
- **动态实体生成**：Scene 维护 `_pendingSpawns`，WorldState 变更时检查条件并动态 spawn + 绑定 controller + 重建索引
- **Entity spawnIf 过滤**：实体按条件生成（scenarioMin/Max、flag、quest stage），init 时 + 运行时双重评估
- **Trigger condition 条件化**：触发器按条件启用/禁用，ExploreMode 每帧同步
- **PropEntity**：过场动画道具实体，hold/loop 双模式，不进 NpcController/staticBlockers/interactables
- **同伴 NPC**：Charlotte + FollowingBehavior，基于距离的动态速度调整，cutscene 末尾 callback 激活跟随
- **cutsceneInvokers**：SceneDef 数据驱动 cutscene 触发（condition + sequenceUrl + flagOnPlay），替代硬编码
- **TimelineSequencer**：多 track + 10 种 clip 类型 + callback handler（Map<String, Function>），文档见 `docs/TimelineSequencer.md`
- `GameMode` 拆分已接入：`GameModeManager + BattleMode + ExploreMode`
- `Explore -> Battle` 主流程已通，`Battle -> Explore` 返回流程已通
- Character 解耦已完成：`CharacterBase / CombatCharacter / NpcCharacter`
- NPC 最小链路已通：`NpcFrameComponent + NpcController(idle/greeting/following) + occupancy`
- 战斗 HP 系统已完成：角色血量、死亡状态动画、战斗结束自动切回探索模式
- 当前下一阶段重点：待从 BACKLOG 中选取

## Update Log (2026-07-08)
- Scene 生命周期回归清理完成：§2.1 别名冗余 + §2.2 rigs 幂等 + §2.3 dispose 死代码 + §2.4 sharedContext 重复赋值 + §2.6 sequencer/character 交互（B-1 `controlledBySequence` 标记方案）；§2.5 验证通过；§2.7 暂不修
- 附带修复：TimelineSequencer `_validateTimeline` 重叠检查 bug（Set→Map）+ switchMode handler ctx 路径遗漏
- Prologue Step 6-8 完成并归档：`commits_detailed/26.7.7` + `26.7.8 part1/part2`
- WorldState 观察者模式：`onChange/setScenario/setFlag/_notify`，状态变更派发通知
- Scene 动态实体生成系统：`_pendingSpawns + _spawnEntity + _onWorldStateChange`，支持条件延迟 spawn
- PropEntity 独立类：过场动画用，hold/loop 双模式，不进 NpcController/staticBlockers/interactables
- Charlotte 同伴 NPC + FollowingBehavior：基于距离的动态速度调整，滞后带防抖动
- cutsceneInvokers 数据驱动：SceneDef 配置触发条件 + sequence URL + flag，替代硬编码
- TimelineSequencer 扩展：callback action（Map<String, Function>）+ SEND_COMMAND fallback + 用户文档 `docs/TimelineSequencer.md`
- QuestManager.executeDirectives：批量指令执行（advanceScenario/setFlag/startQuest/removeItem 等）
- PROLOGUE_BATTLE BattleDef：enemy_1 + bt_prologue + onVictory 回写 scenario/flag
- PropEntity dispose 三层防御：isDisposed 守卫 + _buildIndices 过滤 + entityPool 清理
- Bug 修复：outro 误用 prologue（worldState.currentSceneId 未同步）

## Update Log (2026-06-29)
- Prologue 场景与数据流重构完成并归档：`Prologue 场景与数据流重构概要设计.MD` — Step 1-5 全部落地
- WorldState 扩展 `currentSceneId` / `currentSpawnId`，新游戏默认起点改为 `prologue`
- 新增 `scripts/SceneDefRegistry.js`：硬编码 SceneDef 注册 + 异步 fetch JSON 缓存 + 同步查表 fallback
- Game/character_demo 入口解耦：`game.init()` 无参，从 `worldState.currentSceneId` 读起点；`restoreCheckpoint` 用 `getSceneDefSync` 同步查表
- Scene.init 容错：无 battle trigger 时用默认 StageBoundary/DuelCameraRig 配置，不再强行查 `battleDefs["battle_field_1"]` 兜底
- 新增首个外部化 SceneDef：`Data/SceneDefs/prologue.json`（三层视差环境：BG_FAR skybase / MID AcientRuin layer1+2 / STAGE grassbase+grasstop+AcientRuin）
- 待办：Step 6 BattleDef 外部化 + 组件延迟创建，留待做战斗场景时再加

## Update Log (2026-06-25)
- 战败与检查点系统完成并归档：[DEFEAT_AND_CHECKPOINT_PLAN.md](DEFEAT_AND_CHECKPOINT_PLAN.md) — 5 Step 全部落地
- 附修：rabble controller 外部化（读 entity def 的 controller 字段）、playerController.enabled 泄漏修复、场景切换守卫

## Update Log (2026-06-24)
- 4 个计划文档完成并归档：`WorldState-SceneSwitch 实现计划`、`SCENE_SWITCH_AND_BATTLE_EXTERNALIZE_PLAN`、`Quest&Pickables`、`NPC-Quest-WorldState 概要设计`
- WorldState 体系完整：ScenarioMilestones、sceneStates、Entity spawnIf 过滤、Trigger condition 条件化、战斗胜利回写
- 场景切换落地：室内外双向切换、交互键触发（防死循环）、buff/inventory 跨场景保持
- PlayerController 生命周期修正：与 Scene 同生命周期，不在 dispose/init 中销毁重建
- AABBTrigger debug 渲染层级提升、sceneSwitch 颜色区分

## Update Log (2026-06-01)
- 2 个计划文档完成并归档：`SEQUENCE_CAMERA_AND_FACING_POLICY_PROPOSAL`、`FACING_POLICY_IMPLEMENTATION_STEPS`
- `ScriptedCameraRig` 已落地：正交固定画幅、aspect 统一用 `window.innerWidth / window.innerHeight`、blend 固定正交
- `FACING_MODE` 已落地：CharacterBase 枚举、`ExploreMode`/`BattleMode` 切换设置、`SceneSequencer` 支持 `setActorFacingMode`/`setActorFacing`
- `STEP_TYPE` 已落地：SceneSequencer step 类型整数枚举化，BattleMode/ExploreMode sequence 定义全部改用常量
- 新增待办入口：[TIMELINE_SEQUENCER_CONCURRENT_ACTION_PLAN.md](TIMELINE_SEQUENCER_CONCURRENT_ACTION_PLAN.md) — Timeline Sequencer 并发 action 重构方案，待评审

## Update Log (2026-05-30)
- 3 个计划文档完成并归档：`COMBAT_HP_AND_DEATH_STATE`、`EXPLORE_MOVEMENT_DESIGN`、`CAMERAMANAGER_PHASE3_FINISHING_TODO`
- HP 系统 5 步实施全部落地：collider 提取 → 资源接线 → 状态图 → HP 核心 → 退出序列
- `BACKLOG.md` 新增：序列中角色朝 -x 移动时不镜像问题；CameraManager Phase 3 / 探索移动 / HP 标记完成
- `INDEX.md` 进行中清空

## Update Log (2026-05-27)
- 6 个计划文档归档：`CHARACTER_NPC_DECOUPLE` x2、`NPC_CONTROLLER`、`NPC_ROOTMOTION_OCCUPANCY`、`GAMEMODE` x2
- `BACKLOG.md` 补充 GameMode 未完成事项：`CameraManager Phase 3`、`SceneSequencer` 收尾、Phase 5 内容扩展
- 剩余 Phase 全部移入 `BACKLOG`，`INDEX` 的"进行中"清空

## Update Log (2026-05-28)
- 探索模式实施完成并归档：`EXPLORE_MODE_DATA_AND_COLLISION_PLAN.md`、`EXPLORE_MODE_DATA_AND_COLLISION_IMPLEMENTATION.md`
- Phase 1-7 全部落地：实体池 → 索引 → AABB → 碰撞 → 交互(J/X) → y-sort → Scene 清理
- `INDEX.md` 进行中/待办已清空，下一重点待从 `BACKLOG.md` 选取

## Update Log (2026-05-28)
- 新增探索模式实现入口：[EXPLORE_MODE_DATA_AND_COLLISION_PLAN.md](EXPLORE_MODE_DATA_AND_COLLISION_PLAN.md)
- `backlogs_detailed/CLEANBEAT_2P5D_SLOPE_PLAN.md` 保留为坡道详细方案，不作为当前主线