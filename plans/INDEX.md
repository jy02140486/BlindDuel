# 计划索引（Plan Index）

> 本文件跟踪当前进行中的计划、待办入口与最近归档。项目上下文、技术栈与协作约定见 `PROJECT_CONTEXT.md`。

---

## 进行中

| 计划 | 目标 | 备注 |
|------|------|------|
| [GAMEMODE_SCENE_SPLIT_PROPOSAL.md](GAMEMODE_SCENE_SPLIT_PROPOSAL.md) | 推进 `Scene / GameMode` 拆分，落地 `ExploreMode` / `BattleMode` 双模式结构 | Phase 1/2 已完成；Phase 3（CameraManager 收口）进行中 |
| [GAMEMODE_OVERVIEW_DESIGN.md](GAMEMODE_OVERVIEW_DESIGN.md) | 汇总 `GameMode`、`CameraRig`、`SceneSequencer`、状态切换等概要设计 | 作为后续实现基准文档 |

---

## 待办入口

| 文档 | 目标 | 备注 |
|------|------|------|
| [BACKLOG.md](BACKLOG.md) | 记录不阻塞主线的战斗问题、资源工具优化与探索扩展项 | 包含最新的“防御按晚时双受击异常”记录 |

---

## 最近归档

| 计划 | 目标 | 归档日期 |
|------|------|----------|
| [archived/TIMECONTROL_REFACTOR_GUIDE.md](archived/TIMECONTROL_REFACTOR_GUIDE.md) | TimeControl 三步重构 + 生命周期守卫 + Combat 规则收敛 | 2026-05-18 |
| [archived/FIXED_UPDATE_PLAN.md](archived/FIXED_UPDATE_PLAN.md) | 固定帧 60fps、输入缓冲、Just Guard、Hitstop、ImpactContext | 2026-05-05 |
| [archived/COMBAT_RULES_REFINEMENT_PLAN.md](archived/COMBAT_RULES_REFINEMENT_PLAN.md) | thrust 帧级判定、dodge 无敌、格挡/重击规则修正 | 2026-05-04 |

---

## 更早归档

| 计划 | 目标 | 归档日期 |
|------|------|----------|
| `plans/archived/` 目录 | 更早阶段的角色碰撞、移动、场景视觉、AI 等历史方案 | 见各文件头部 |

---

## 快速参考：当前开发状态

- **Phase 1 已完成**：`GameModeManager + BattleMode + ExploreMode` 已接入，`Scene` 通过 mode 层驱动战斗/探索链路。
- **Phase 2 已完成**：
  - `ExploreCameraRig` 已实现（跟随主角、透视/正交切换、高度 4、0° 仰角）。
  - `AABBTrigger` 已创建，触发器逻辑从硬编码改为类封装（位置 `-6,0,0`，大小 `4x8x4`）。
  - `PlayerController.enabled` 已添加，支持输入禁用/恢复。
  - 新动画（standing/walk/draw/sheath）的独立碰撞盒数据已生成，解决精灵切换抖动问题。
  - Babylon.js 已从 CDN 改为本地部署。
  - 触发器流程已通：进入触发器 → 自动移动到 `x=-3.2` → draw 动画 → 相机 blend → 切 battle 模式。
  - `SceneSequencer` 已实现：通用编排 system，支持 `wait`、`waitUntil`、`moveActorTo`、`sendCommand`、`switchCamera`、`switchMode`、`lockInput`、`unlockInput`、`startCameraBlend`、`callback` 等 step。
  - 相机 blend 支持位置、高度、正交参数的平滑插值，切换后无画面跳变。
- **当前问题**：
  - [x] 相机 blend 与 draw 动画时序不同步 — 已修复。
  - [x] blend 结束后 `exploreCameraRig.enable()` 抢回 activeCamera — 已修复。
  - [ ] 触发器 debug 体积按 C 键不显示（待排查）。
- **状态机准备**：`LongSwordMan` 已新增 `standing / walk / draw / sheath` 定义，当前默认起始状态仍是 `idle`。
- **资源现状**：`longswordman` 新增动画与 `RootMotion` 已接入资源清单；碰撞盒数据已独立生成。
- **已知问题**：战斗中"防御按晚后 longswordman 进 hit，rabble 打完后也进 hit"的异常已记录到 [BACKLOG.md](BACKLOG.md)。
- **下一步**：
  - Phase 3：完成 `CameraManager` 收口收尾（统一基准俯角、探索 `walkArea` 可行走范围限制）。
  - Phase 4：`SceneSequencer` 收敛（timeout/cancel/fail 回调、条件 step 数据化）。
  - Phase 5：探索内容扩展（NPC 对话气泡、buff 拾取、任务触发）。
