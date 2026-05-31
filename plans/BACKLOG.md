# 待办与优化 backlog

> 不阻塞当前主线，但值得后续处理的事项。

---

## 资源工具链

| 事项 | 描述 | 优先级 | 备注 |
|------|------|--------|------|
| 合并冗余 atlas JSON | `Data/CollisionMask/`、`Data/PushBox/`、`Data/RootMotion/` 三个目录下的 `.json` 文件内容相同（帧布局、duration 一致），仅 `.png` 像素内容不同。可优化为只保留一份 `.json` 作为帧索引，减少维护成本。 | 低 | 需改 `extract_collision_boxes.ps1` 脚本 |

## 战斗系统

> 以下事项已在 [FIXED_UPDATE_PLAN.md](archived/FIXED_UPDATE_PLAN.md)（2026-05-05 归档）中完成。

| 事项 | 描述 | 状态 | 备注 |
|------|------|------|------|
| Hitstop（卡帧/顿帧）机制 | 攻击命中/被防御/拼刀瞬间双方动画暂停 | ✅ 已完成 | `applyHitstop` + `hitstopFrames` |
| 状态切换与渲染同步 | `CombatSystem` 同一帧内立即切状态导致吞帧 | ✅ 已完成 | `ImpactContext` + `freezeImpact` |
| Guard 动画帧数不足 | guard 仅 2 帧，无法覆盖长 active 帧攻击 | ✅ 已完成 | `guardFrame === 0` 无条件预判 |
| Just Guard 时机判定 | guard 任意帧都可以 parry，不合理 | ✅ 已完成 | `tickDiff` + `isPreemptiveGuard` |

> 以下事项在 [TIMED_TAGS_MECHANIC_PLAN.md](TIMED_TAGS_MECHANIC_PLAN.md) 中完成。

| 事项 | 描述 | 状态 | 备注 |
|------|------|------|------|
| Timed Tags 机制 | 带有效期的状态标记，冻结期间暂停倒计时 | ✅ 已完成 | `timedTags` + `addTimedTag` |
| parryBonus 派生修复 | Just Guard 后无法派生 zornhut/quart | ✅ 已修复 | 指令生命周期解耦 |
| 全局冷却误触发 | 移动后回 idle 也触发 CD | ✅ 已修复 | 只检测 `attackActive` 状态 |

## 规则配置化

| 事项 | 描述 | 优先级 | 备注 |
|------|------|--------|------|
| `tickDiff` 外部配置化 | 将 `ContactResolver` 中 Just Guard/预判 guard 使用的 `tickDiff` 阈值（当前硬编码 `<= 7`）提取为外部可配置项（建议进 StateGraph 或 Combat 配置）。 | 中 | 需要同步默认值与回归测试，避免改变现有手感 |
| **hitstop 时长外部配置化** | `ContactResolver` 中各场景的 hitstop 时长目前全部硬编码：parry（双方 8 帧）、block（双方 4 帧）、clash tie（双方 8 帧）、clash lose（弱方 6 帧 / 强方 4 帧）、命中（双方 8 帧）。应提取为外部配置（建议按场景/攻击类型/武器等级分表）。 | 中 | 需同步默认值与手感测试 |
| Scene 角色与战斗区域外部配置化 | 当前 `Scene.js` 中硬编码了角色创建（hero、rabbleStick）和战斗触发器位置。应改为从外部 JSON/数据文件读取场景中需要创建的角色定义、战斗区域定义。 | 高 | 影响场景编辑工作流，是后续加入更多角色/场景的前置条件 |
| 标志点外部配置化（出生点/触发器等） | 出生点、触发器位置、NPC 站位等关键坐标当前分散硬编码在各处。应统一收敛为外部场景数据文件中的标志点定义。 | 高 | 与「角色与战斗区域」条目强关联，可合并实施 |
| SceneVisual 外部数据化 | `SceneVisualSystem` 中的背景层（BG_FAR/BG_MID/STAGE 等）定义、元素坐标、parallax 参数当前硬编码在代码中。应改为从外部 JSON 读取场景视觉配置。 | 中 | 影响场景美术迭代效率 |
| Sequence 外部 JSON 化 | `ExploreMode` 和 `BattleMode` 中的 `enter_battle` / `exit_battle` 序列目前硬编码为 JS 对象。应改为从外部 JSON 文件读取，支持策划直接编辑序列步骤。 | 中 | 需定义 step type schema 与校验 |
| 击退距离外部配置化 | `ContactResolver` 中击退距离（knockbackX）当前硬编码，与武器等级和命中场景绑定。应提取为外部可配置项（建议按武器/攻击类型分表）。 | 低 | 与 hitstop 配置化可同步推进 |

## 探索系统

| 事项 | 描述 | 优先级 | 备注 |
|------|------|--------|------|
| 可拾取小物件增益（食物/饮料） | 在探索模式中加入可拾取物件（如食物、饮料）；拾取后提供临时增益，例如减少招式 CD、提升移动速度。 | 中 | 需定义增益类型、持续时间、叠加规则与 UI 提示 |
| 投掷物与暗器玩法（含 Projectile） | 在探索模式可获得投掷物/暗器资源，并在战斗中释放；同时补齐 projectile 基础能力（生成、飞行、命中、销毁、与现有 Combat 规则衔接）。 | 中 | 建议先做单一 projectile 类型验证战斗闭环 |
| NPC 物物交换玩法（以物换物） | 探索模式中允许用小物件与 NPC 交易，换取 buff、投掷物或其他战斗资源。 | 中 | 需定义交易条件、库存/消耗规则、NPC 交互反馈与失败提示 |
| ✅ 角色基类解耦（面向无战斗 NPC） | 将当前"以战斗为中心"的角色结构拆为 `CharacterBase` / `CombatCharacter` / `NpcCharacter`，支持无战斗 NPC 仅具备移动与简单动画。 | 高 | Phase 1-6 已完成（2026-05-27），Interaction 能力预留（Phase 7）与直连逻辑清理（Phase 8）待推进 |

## ս��������٣�������

| ���� | ���� | ���ȼ� | ��ע |
|------|------|--------|------|
| ��������ƫ��ʱ��˫�ܻ��쳣 | ��ǰ�Կɸ��֣��������������� `longswordman` ���� `hit`���� `rabble` �ڴ����Ҳ���� `hit` ���쳣�����Ԥ��Ӧ������쳣˫�ܻ���·�� | �� | ��Ҫ��� `ContactResolver` ��ͬ����ʵ���ж���״̬�л�ʱ������Ų顣 |

## 探索系统切换问题（2026-05-23）

| 事项 | 描述 | 优先级 | 备注 |
|------|------|--------|------|
| ✅ 相机 blend 与 draw 动画时序不同步 | draw 动画在 `t=0.81` 结束，但相机 blend 要到 `t=1.0`（3.5s）才完成。已通过 `SceneSequencer` 的 `waitUntil` + `startCameraBlend` + `switchMode` step 解决，等 blend 完成后再切 battle 模式。 | 高 | 已完成 |
| ✅ blend 后 activeCamera 被抢回 | `Scene._updateCameraBlend` 结束时调用 `exploreCameraRig.enable()` 导致相机被抢回。已将 blend 逻辑下沉到 `SceneSequencer`，移除 Scene 中的硬编码 blend，不再错误 enable explore rig。 | 高 | 已完成 |
| 触发器 debug 体积不显示 | 按 C 键切换碰撞显示时，触发器的绿色半透明体积未出现。 | 中 | 待排查 `AABBTrigger.debugMesh` 的 `setEnabled` 是否生效，或 mesh 被遮挡 |
| ✅ 硬编码流程需迁移到 SceneSequencer | 当前触发器后的自动移动、draw 动画、相机 blend、模式切换全部硬编码在 ExploreMode / Scene 中。已实现 `SceneSequencer`，流程改为 sequence 编排。 | 高 | 已完成 |
| Sequence 中角色朝 -x 移动时不镜像 | `SceneSequencer._updateMoveActorTo` 设 `moveIntent` 触发 `_applyMovement`，但 `allowFacing` 在序列执行期间为 `false`，sprite 不翻转。 | 中 | 影响 battle→explore 退出序列的 `moveActorTo` 步骤；需解耦序列移动与 `allowFacing` 守卫 |

## GameMode 未完成事项（2026-05-27）

| 事项 | 描述 | 优先级 | 备注 |
|------|------|--------|------|
| ✅ CameraManager Phase 3 收口 | 统一基准俯角、探索 `walkArea` 可行走范围限制。 | 高 | 已完成，见 `archived/CAMERAMANAGER_PHASE3_FINISHING_TODO.md` |
| ✅ 探索阶段移动与相机设计 | `EXPLORE_MOVEMENT_DESIGN.md` 中定义的 walkArea、移动映射、相机行为。 | 高 | 已完成，见 `archived/EXPLORE_MOVEMENT_DESIGN.md` |
| ✅ Combat HP 与死亡 → 探索过渡 | CombatCharacter 血量、死亡状态、战斗结束切回探索模式。 | 高 | 已完成，见 `archived/COMBAT_HP_AND_DEATH_STATE.md` |
| SceneSequencer 收敛 | 补充 `timeout/cancel/fail` 回调，条件 step 数据化。修复序列中角色朝 -x 移动时不镜像问题。 | 中 | 当前仅实现基础 step，缺少错误处理与条件判断扩展 |
| Phase 5：探索内容扩展 | NPC 对话气泡、buff 拾取、任务触发。 | 中 | 由 Interaction 能力预留后推进 |

## 相机管理重构（后续优化）

| 事项 | 描述 | 优先级 | 备注 |
|------|------|--------|------|
| 完善 `CameraManager` 特效管线 | `CameraManager` 已接管 rig 切换与 blend 入口；后续补齐屏幕特效实现（shake/flash/letterbox）与参数调优。 | 中 | 与 `Phase 3` 收尾/后续 polish 同步推进 |
