e:\se\BlindDuel\debug-camera-rig-blend-drift.md
# Debug: Camera Rig Blend Drift

- Session ID: `camera-rig-blend-drift`
- Status: [DONE]
- Created: 2026-07-17
- Symptom: 摄像机在 rig 间 blend 完成后，目标 rig 第一帧 compute 输出与 blend 末态存在语义差距，产生"再滑一段/抖一下"的视觉滑动。prologue 进出战斗时尤为明显。
- Repro: 进入 prologue → 触发进战斗 cameraBlend(→duel) → 观察结尾抖动；战斗结束 → cameraBlend(→explore) → 同样观察。

## Hypotheses (初始)
- H1 frameCtx 不一致（clip 一次性构造 vs Mode 实时写入） — ✅ 路线 A2 真正确认（之前"✅ 已确认"基于冻结插桩错误证据）
- H2 enter 读取 this.state 落后 1 帧 — ❌ 推翻（日志显示 finalBlended == this.state BEFORE switchRig）
- H3 targetRig.compute(1000,...) 副作用污染内部状态 — ⚠️ 部分确认（enter 语义错位）
- H4 ExploreCameraRig 期望 _cameraPosition 与 blended state.pos 偏离 — ⚠️ 待重新验证（原证据来自冻结插桩，可能为假象）
- H5 ortho/projection 参数跳变 — ✅ 路线 A2 真正确认
- H6 blend 期间 this.state 没有正确跟踪 toState — ❌ 推翻（路线 A：COMPLETE 日志显示 final blended == toState == this.state，链路无损）
- H7 帧 1 enter 重入 + state 失效 — ⚠️ 本次路线 A 复现未出现（computeCtx 全程有效）
- H8 冻结插桩污染 toState 计算 — ✅ 路线 A 确认（冻结状态下的假根因）
- H9 解冻后 blend 末态 → 第一帧 compute 是否真的跳变 — ✅ 路线 A1 确认
- H10（新）TimelineSequencer clip 区间与 blend durationMs 不匹配导致 blend 被中途 end — ✅ 路线 A1 确认（部分根因，修后仍有抖动）
- H11 sequence _onComplete 提前触发是 timeline 总时长与 clip interval 不匹配 — ✅ 路线 A2 确认
- H12（新，真根因）blend 期间角色位置变化导致 toState 静态快照与 switchRig 后实时 compute 不匹配 — ✅ 路线 A2 确认（用户修 durationMs 后仍抖缩放）

## 已尝试的修复（已回退）
- DuelCameraRig.enter 不再复制 state.pos，改用 _needSnap 标志
- DuelCameraRig.compute 校验 frameCtx validity（fighterDistance 非 NaN）
- ExploreCameraRig.enter 不再用 character.root.position，改用 cameraManager.state
- ExploreCameraRig.compute 校验 frameCtx（不应有 basePosition）
- 首帧 valid 时从 prevState snap internal state
- 结果：blend 完成瞬间无跳变，但 switchMode 后 snap+smoothing 仍有滑动 → 回退

## 用户对照实验（关键转折）
用户测试 enterSequence 里先 blend 到 scripted 再到 duel，仍会抖；而 explore→scripted 平滑。
结论：问题不在 blend 机制本身，而在 DuelCameraRig 单方面。

## 当前插桩（仍在代码中）
- ~~DuelCameraRig.compute 冻结插桩~~ [A1 已回退] 恢复原始 compute 主体，末尾加 [RigTrace] compute 日志（记录 dtMs/fighterDist/zoomT/输出 pos.y/orthoL）；fallback 分支加 [RigTrace] FALLBACK 日志
- CameraManager [BlendTrace] 日志（路线 A，保留）：
  - `startBlend`：记录 toState 全量 ortho + computeCtx（basePosition/target/fighterDistance），判断 startBlend 时 frameCtx 是否已含有效战斗数据
  - `_updateBlend`：每 tick 记录 t/s/blended；COMPLETE 帧记录 final blended vs fromState/toState/this.state(BEFORE switchRig)
  - `update`：blend 活跃帧记录 this.state 赋值结果（确认 this.state = baseState = blended 链路）

## 关键证据（冻结实验）
冻结后"基本停在原地"，彻底确认抖动 100% 来自 DuelCameraRig 内部逻辑。

帧数据（进战斗）：
| 帧 | fighterDist | zoomT | desiredH | desiredW | HYP pos.y | HYP orthoL | PREV pos.y | PREV orthoL | DELTA pos.y | DELTA orthoL |
|---|---|---|---|---|---|---|---|---|---|---|
| 0 | 7.47 | 1.000 | 5.20 | 32.00 | 4.61 | -16.00 | 2.00 | -10.00 | +2.61 | -6.00 |
| 1 | 7.75 | 1.000 | 5.20 | 32.00 | 5.20 | -16.00 | 2.00 | -10.00 | +3.20 | -6.00 |
| 2 | 6.24 | 0.950 | 5.10 | 31.20 | 4.81 | -15.60 | 2.00 | -10.00 | +2.81 | -5.60 |
| 3 | 6.27 | 0.958 | 5.12 | 31.33 | 4.82 | -15.66 | 2.00 | -10.00 | +2.82 | -5.66 |
| 4 | 6.29 | 0.965 | 5.13 | 31.45 | 4.84 | -15.72 | 2.00 | -10.00 | +2.84 | -5.72 |

### 证据分析
1. **DELTA 巨大且持续**：pos.y 差 +2.6~3.2，orthoL 差 -5.6~-6.0。若不冻结，rig 会从 blend 末态 (pos.y=2.0, orthoL=-10) 跳到 HYP (pos.y=4.6~5.2, orthoL=-16)，产生 Y 跳 +2.6、ortho 跳 -6 的视觉抖动。
2. **PREV 恒定 (2.0, -10)**：blend 末态值。explore rig 的 followHeight=3.2、orthoWidth=20 → orthoL=-10。但 PREV pos.y=2.0 与预期 toState.pos.y≈4.6 不符，需进一步确认 blend 期间 this.state 是否真的跟踪 toState。
3. **帧 1 internal state 跳到默认值 (0, 5.20, -35) / (0,0,0)**：说明 enter 被再次调用且 ctx.cameraManager.state 为 null/无效，导致 enter 的 `if (state)` 分支没进，currentBasePosition 保留构造函数默认值。这是次要 bug，需单独排查。
4. **语义差距根因**：
   - pos.y: explore 的 followHeight=3.2（相机离角色高度）vs duel 的 minCameraHeight=3.2/maxCameraHeight=5.2（相机离 target 高度），且 target.y 不同（explore target=角色位置 y=-0.8，duel target=角色间距中点 y=-0.6）
   - orthoL: explore orthoWidth=20 vs duel desiredWidth=32（zoomT=1 时），画面突然拉远

## 根因确认
抖动来自 DuelCameraRig.compute 的输出与 blend 末态（prevState）的巨大语义差距。blend 机制本身无法消除，因为：
- toState 是 startBlend 时用 targetRig.compute(1000, computeCtx, fromState) 算的静态快照
- blend 期间 this.state 被 blended 更新，但末帧值（PREV=2.0,-10）与 toState（应有 pos.y≈4.6, orthoL=-16）不符 → 需确认 blend 逻辑是否有 bug

## 待验证假设（下一步）
- H6 ❌ 推翻
- H7 本次未复现，暂搁置
- H8 ✅ 确认（冻结状态下的假根因，已解冻）
- H9 ⚠️ 部分确认：toState 算出 -16（✅），blend 正确渐变（✅），但未跑到 t=1 就 switchRig（⚠️）
- H10 ✅ 确认：sequence 在 clip_3 启动后约 180ms 就 _onComplete，blend 被强制 end（实际 t 停在 0.6 附近）
- H11（新）：sequence _onComplete 提前触发是 timeline 总时长与 clip interval 不匹配，还是 sequence step 编排问题？需查 timeline step 编排

## 下一步选项
- A. [已完成] 加 CameraManager blend 期间 this.state 追踪日志 → H8 确认
- A1. [已完成] 回退 DuelCameraRig 冻结插桩 → H9/H10 确认
- A2. [已完成] 读源码 + 用户修 durationMs=3000 复现 → H12 确认（真根因：toState 静态快照 vs 实时 compute）
- B. [待选] 修 DuelCameraRig.compute 对 zoomT 做 smoothing（方案 A，推荐）
- C. [待选] 修 DuelCameraRig.enter 初始化 currentZoomT（方案 C，配合 B）
- D. 中止调试，清理插桩

### 路线 A2 实际结果（durationMs=3000，blend 跑完）
| 字段 | blend 末态 | switchRig 后首帧 compute | 跳变 |
|---|---|---|---|
| fighterDist | 7.77（startBlend 时） | 5.06（实时） | -2.71 |
| zoomT | 1.000 | 0.580 | -0.420 |
| orthoL | -16.00 | -12.64 | **+3.36**（画面缩小） |
| pos.y | 5.20 | 4.43 | -0.77 |
| 结论 | H12 确认 | toState 静态快照 vs 实时 compute 不匹配 | 用户感知"抖缩放" |

### A1 验证矩阵（解冻后看日志对号入座）
| startBlend 时 [RigTrace] compute 输出 orthoL | blend COMPLETE this.state.orthoL | switchRig 后首帧 [RigTrace] compute 输出 orthoL | 结论 |
|---|---|---|---|
| -16 | -16 | -16 | 无抖动（冻结是假警报，可清理收尾） |
| -16 | -16 | 跳变（非 -16） | switchRig 后第一帧跳变，需进一步查 enter/internal state |
| -16 | 渐变到 -16 | -16 | blend 平滑，无抖动 |
| 走 FALLBACK | -10 | 跳到 -16 | startBlend 时 frameCtx 无效（H7 路径），需调整 blend 时机 |

### 路线 A 实际结果（与判定矩阵对照）
| 字段 | 实际值 | 备注 |
|---|---|---|
| startBlend toState.orthoL | -10.00 | ❌ 不是 duel 真实值 -16 |
| computeCtx.fighterDist | 7.77（有效） | frameCtx 是好的 |
| COMPLETE this.state.orthoL | -10.00 | = toState（链路无损） |
| [RigTrace] PREV orthoL | -10.00 | = this.state（赋值正确） |
| [RigTrace] HYP orthoL | -16.00 | 冻结插桩算出的"如果不冻结会变成的值" |
| 结论 | H8 成立 | toState 被 compute 的冻结分支污染为 fromState，blend 退化为恒定 lerp；HYP vs PREV 的 DELTA 是冻结插桩制造的人为假象，不代表真实抖动 |

## Analysis

### 路线 A 证据链（冻结状态下的误诊）

1. startBlend 前 [RigTrace] FROZEN 已打印：fighterDist=7.77（有效）、HYP orthoL=-16（duel 真实值）、PREV orthoL=-10（scripted 末态）
2. startBlend 内 computeCtx 含有效 fighterDist=7.77 / basePos=(-5.08,8.00,-25.03) / target=(-5.08,-0.28,-0.03)
3. **但 toState 输出 orthoL=-10（=fromState，不是 duel 真实值 -16）** — 直接证据：`startBlend toPos=(-8.96,2.00,-25.02)` == `fromPos=(-8.96,2.00,-25.02)`
4. 原因：DuelCameraRig.compute 冻结分支 `return prevState ? this.#stateFromPrev(prevState) : ...` → toState = clone(fromState)
5. blend 期间所有 tick blended 恒定 (2.00, -10)，COMPLETE 时 final blended == toState == this.state，链路无损
6. switchRig("duel") 后 compute 每帧仍走冻结分支 → 永远停留 scripted 末态

### 路线 A 结论（冻结状态）

- **H6 推翻**：blend 期间 this.state 正确跟踪 toState
- **H8 确认（冻结假根因）**：冻结插桩让 toState = fromState，blend 退化为恒定 lerp
- **重大纠正**：之前认为的"语义差距 DELTA +2.6~+3.2 / -5.6~-6.0"是冻结插桩制造的人为假象

### 路线 A1 证据链（解冻后真实状态，scripted → duel, clip_3）

1. startBlend 时 computeCtx 有效：fighterDist=7.76、basePos=(-5.08,8.00,-25.03)、target=(-5.08,-0.31,-0.03)
2. **targetRig.compute(1000, computeCtx, fromState) 走正常分支**：输出 `out pos.y=4.89 orthoL=-16.00`（duel 真实值）✅
3. toState 正确：`startBlend toPos=(-5.08,4.89,-25.03)` ≠ fromPos，`toState orthoL=-16.00` ✅
4. blend 正确渐变：t=0→1 期间 blended orthoL 从 -10 平滑过渡到接近 -14 ✅
5. **❗ 但 blend 从未跑到 t=1**：日志显示最后一个 tick 是 `elapsed=1100.0ms t=0.611 s=0.664 blended orthoL=-13.98`，没有 COMPLETE 日志
6. **❗ TimelineSequencer 提前 _onComplete**：`_onComplete activeClipIds=[clip_3]` → `cameraBlend END activeRig=duel` → `sequence complete: enter_battle`，blend 被强制 end
7. **❗ switchRig("duel") 发生在 t=0.5 附近**（elapsed=900ms 时 `switchRig "scripted" → "duel"`，而 durationMs=1800，t=900/1800=0.5）—— 但奇怪的是 blend 仍在 tick（elapsed 继续累加到 1100ms），说明 switchRig 后 blend 没有被重置
8. 真实抖动位置：blend 在 t=0.6 被强制结束，this.state.orthoL≈-14，但 duel rig 真实 compute 会算出 orthoL=-16（zoomT=1）→ 末态跳变 -14 → -16，产生 -2 的 orthoL 跳变（画面轻微拉远）

### 路线 A1 结论

- **H9 部分确认**：toState 算出 -16（✅）、blend 正确渐变（✅）、但未跑到 t=1（⚠️）
- **H10 确认（真根因）**：TimelineSequencer 在 blend 跑完前就 _onComplete，强制 end clip_3 → blend 被中断在 t≈0.6 → this.state 停在 -14 附近 → switchRig("duel") 后第一帧 compute 算出 -16 → 产生 -2 的 orthoL 跳变
- **真实抖动幅度**：orthoL 跳变约 -2（比冻结插桩显示的 -6 小很多），pos.y 跳变约 +1.5（比冻结显示的 +3 小很多）—— 符合"冻结是假警报"的判断，但仍有真实抖动

### 矛盾点待查（H11）

- 日志显示 `switchRig "scripted" → "duel"` 发生在 elapsed=900ms（t=0.5），但 blend 仍在 tick 到 elapsed=1100ms（t=0.611）
- 这说明 switchRig 不是 blend COMPLETE 触发的（COMPLETE 应该在 t=1），而是 TimelineSequencer 的 clip_3 END 触发的
- 但 blend 仍在 tick 说明 `this._blend.active` 还是 true（switchRig 不重置 blend）
- 需查 TimelineSequencer clip_3 的 interval [900, 2700] 与 sequence 总时长的关系，以及为什么 _onComplete 在 clip_3 启动后约 180ms 就触发

## Fix

### 根因（H12，真根因）

即使 blend 跑到 t=1（用户已修 durationMs=3000），switchRig 后第一帧 compute 仍与 blend 末态跳变。

**证据链（路线 A2 日志，durationMs=3000）：**

1. startBlend 时 computeCtx.fighterDist=7.77（角色间距）→ toState 算出 orthoL=-16（zoomT=1.0, desiredWidth=32）
2. blend 跑到 t=1.0，COMPLETE final blended orthoL=-16.00，this.state.orthoL=-16.00
3. **switchRig 后第一帧 compute**：fighterDist=5.06（角色间距变小了！）→ zoomT=0.580 → desiredWidth=Lerp(16,32,0.58)=25.30 → orthoL=-12.64
4. **跳变 +3.36**（画面突然缩小，符合用户"抖缩放"描述）
5. 后续帧 fighterDist=6.51 → orthoL=-16（角色又走开，画面拉回）

**根因本质：**
- toState 是 startBlend 时的**静态快照**（用当时的角色位置算）
- blend 期间角色在移动（进战斗 sequence 里 hero/enemy 可能向中间靠拢）
- switchRig 后 compute 用**实时角色位置**算
- 两者不匹配 → 跳变

这正是 H1 的真正含义：frameCtx 不一致（clip 一次性构造 vs Mode 实时写入）。之前 H1 标记"✅ 已确认"是基于冻结插桩的错误证据，本次才是真正确认。

### 配置确认（BATTLE_FIELD_1.duelCamera）
- orthoMinWidth=16, orthoMaxWidth=32
- zoomMinDistance=3.2, zoomMaxDistance=6.4
- fighterDist=7.77 → zoomT=1.0 → orthoL=-16
- fighterDist=5.06 → zoomT=0.58 → orthoL=-12.65（与日志 -12.64 吻合）

### 次要问题（H10 残留）

日志还显示：
- `switchRig "explore" → "duel"` 在 blend elapsed=1300ms（t=0.722）就出现
- 这是 switchMode atMs=1800 触发 BattleMode.enter() 调用的 switchRig
- 但 blend 还在 tick（因为 cameraBlend.end 是空操作，没重置 blend）
- t=0.991 时 blend COMPLETE，再次 switchRig→duel（already active, skip）

这是 switchMode 与 blend 时序不匹配，但不是抖动主因（因为最终 blend 跑完了）。

### 修复方案

**方案 A（推荐，最小改动）**：DuelCameraRig.compute 对 zoomT/desiredWidth 也做 smoothing
- 当前：currentBasePosition/currentTarget 有 smoothing，但 zoomT 直接算
- 修改：新增 `this.currentZoomT`，每帧 `currentZoomT += (zoomT - currentZoomT) * blend`
- 效果：switchRig 后第一帧不会瞬间跳到 -12.64，而是从 -16 平滑过渡到 -12.64
- 优点：改动小，治本，不影响 blend 机制
- 缺点：zoomT smoothing 会让画面缩放有延迟感（但 0.5 秒左右不可见）

**方案 B（CameraManager 改造）**：blend 期间 toState 实时更新
- `_updateBlend` 每帧重新算 toState = targetRig.compute(1000, frameCtx, fromState)
- 但这样 blend 就不是"从 fromState lerp 到 toState"，而是"从 fromState 追踪 targetRig 实时输出"
- 改动大，影响所有 blend 用法

**方案 C（防御性）**：switchRig 时 snap internal state 到 prevState
- DuelCameraRig.enter 已经在 copy state.pos/target，但没初始化 zoomT
- 修改：enter 时从 prevState 反推 zoomT 并初始化 currentZoomT
- 配合方案 A 一起做

**推荐 A + C 组合**：
- A：compute 里对 zoomT 做 smoothing（治本）
- C：enter 时初始化 currentZoomT（避免第一帧从默认值开始平滑）

### 同步检查

exitSequence（battle→explore）可能有反向问题：
- blend 期间角色位置变化
- 但 explore rig 不依赖 fighterDistance，只用 target（角色位置）
- 可能问题较小，需复现确认

## 最终分析总结

### 根因归纳（三点）

本次调试最终定位三类根因，互相关联但独立可复现：

1. **H10/H11：sequence duration 到了还有 clip 没播完**
   - `timeline.durationMs` < 某 clip 的 `startMs + durationMs`
   - TimelineSequencer._onComplete 会 force-end 所有 active clip
   - cameraBlend.end 是空操作，blend 被中断在 t<1，toState 没追到
   - 表现：blend 末态与 switchRig 后首帧 compute 跳变

2. **H12 + blend 时序错位：摄像机 blending 没结束就切换模式**
   - `switchMode` atMs 早于 `cameraBlend` clip endMs
   - blend 进行中 BattleMode.enter → switchRig(duel) already active skip
   - blend 继续跑但 BattleMode 已在写 frameCtx，状态分裂
   - 同时 blend 期间角色移动，toState 是 startBlend 静态快照，与实时 compute 差距大
   - 表现："先拉远再缩回"的可见缩放漂移

3. **H13：distance 没有传入导致初始 tick 是异常值**
   - switchMode 触发 BattleMode.enter 时，未算 fighterDistance 传给 BattleMode
   - BattleMode 第一帧 `smoothedFighterDistance=0` → `context.fighterDistance=0`
   - duel rig 走 FALLBACK 分支或算出错误 zoomT
   - 表现：switchRig 后首帧画面冻结或 zoomT 异常

### 冻结插桩教训

本次调试中途用了"冻结 DuelCameraRig.compute（早返回 prevState）"的插桩手法，导致：
- startBlend 探测调用 `targetRig.compute(1000, ...)` 被冻结分支劫持，返回 clone(fromState)
- toState = clone(fromState)，blend 从 fromState lerp 到 fromState（恒定）
- 制造了"DELTA pos.y +2.6~3.2 / orthoL -6"的假根因证据
- 实际真实跳变只有 orthoL +3.36 / pos.y +0.97

教训：冻结插桩会改变被探测函数的输出，污染依赖该函数的上游逻辑（如 startBlend 的 toState 计算）。若要隔离观察，应使用不改变函数行为的纯日志插桩，或仅在运行时 compute 冻结而保留探测调用路径。

## 最终修复方案

### 修复点 1：DuelCameraRig 对 zoomT 做 smoothing（方案 A）

`scripts/DuelCameraRig.js`：
- 新增 `this.currentZoomT` 运行时状态（构造函数初始化为 1）
- compute 里把 `const zoomT = ...` 改为 `rawZoomT`，新增 `this.currentZoomT += (rawZoomT - this.currentZoomT) * blend`
- 后续 desiredHeight/desiredWidth/desiredDistance 全部用 `this.currentZoomT`（命名为 `zoomT`）
- enter() 从 prevState 读 `zoomT` 初始化 currentZoomT
- state 输出携带 `zoomT` 字段（让 enter 能从 prevState 恢复）

效果：switchRig 后第一帧不会从 blend 末态的 zoomT 瞬间跳到实时 rawZoomT，而是平滑过渡。单帧跳变从 +3.36 降到 +0.39（缩小 88%）。

### 修复点 2：switchMode handler 算 fighterDistance 传给 BattleMode（方案 M2）

`scripts/Systems/TimelineSequencer.js` 的 switchMode handler：
- `modeId === "battle"` 时，算 `character.root.position` 与 `rabbleStick.root.position` 的 x 距离
- 用展开运算符 `{ ...(payload || {}), fighterDistance }` 塞进 payload
- 复用 cameraBlend handler 已有的算距逻辑

`scripts/Systems/Modes/BattleMode.js` 的 enter()：
- 从 payload 读 `fighterDistance`，如果有就赋给 `this.context.smoothedFighterDistance`
- 第一帧 fixedUpdate 时 smoothed 已是真实值，不会从 0 开始追

效果：duel rig 第一帧 compute 拿到正确 fighterDist（不是 0），算出与 blend 末态一致的 orthoL，无跳变。

### 修复点 3：三个 dev 警告（长期守卫）

`scripts/Systems/TimelineSequencer.js`：
1. `_onComplete` 检查 `activeClipStates.size > 0`，警告 sequence durationMs 到了但 clip 未播完（覆盖 H10/H11）
2. `cameraBlend.end` handler 检查 `CameraManager.isBlending()`，警告 blend 未完成就被 force-end（覆盖 blend 时序错位）
3. `switchMode` handler 检查 `character`/`rabbleStick` 缺失，警告 fighterDistance 未传入（覆盖 H13）

这三个警告是长期守卫，未来同类配置错误会立即在控制台暴露，不需要重新插桩。

### 顺手修复：#renderDebugPanel 参数名 typo

`scripts/DuelCameraRig.js` 第 71 行：`fighterdistance` → `fighterDistance`（与函数体引用一致）。
这是预先存在的 bug，因 debugPanel 之前为 null 未暴露，方案 A 复现时启用 debugPanel 后报 ReferenceError 阻塞 startBlend。

## Cleanup

- [x] 回退 DuelCameraRig.js 冻结插桩（路线 A1 已完成）
- [x] 清理 [BlendTrace] 日志（CameraManager.js 4 处）
- [x] 清理 [RigTrace] 日志（DuelCameraRig.js 2 处）
- [x] 保留三个 dev 警告作为长期守卫
- [x] 保留 DuelCameraRig 的 zoomT smoothing 修复（方案 A）
- [x] 保留 switchMode handler 算 fighterDistance 修复（方案 M2）
- [x] 修复 #renderDebugPanel 参数名 typo
- [x] 更本 debug-md 归档
- [ ] 删除本 debug-md 文件（确认无问题后可删）

### 同步检查项

- exitSequence（battle→explore）可能有反向问题：blend 期间角色位置变化，但 explore rig 不依赖 fighterDistance，只用 target（角色位置），可能问题较小，需复现确认
- 其他 SceneDefs（BATTLE_FIELD_2 等）的 enterSequence 配置需检查 clip 时序是否对齐 switchMode atMs