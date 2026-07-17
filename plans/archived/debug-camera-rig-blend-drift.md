e:\se\BlindDuel\debug-camera-rig-blend-drift.md
# Debug: Camera Rig Blend Drift

- Session ID: `camera-rig-blend-drift`
- Status: [OPEN]
- Symptom: 摄像机在 rig 间 blend 完成后，目标 rig 第一帧 compute 输出与 blend 末态不一致，产生"再滑一段"的视觉滑动。prologue 进出战斗时尤为明显。
- Repro: 进入 prologue → 触发进战斗 cameraBlend(→duel) → 观察结尾滑动；战斗结束 → cameraBlend(→explore) → 同样观察。

## Hypotheses
- H1 frameCtx 不一致（clip 一次性构造 vs Mode 实时写入）
- H2 enter 读取 this.state 落后 1 帧（this.state = baseState 在 _updateBlend 返回后才执行）
- H3 targetRig.compute(1000,...) 副作用污染内部状态
- H4 ExploreCameraRig 期望 _cameraPosition 与 blended state.pos 偏离
- H5 ortho/projection 参数跳变

## Instrumentation Plan
在 CameraManager.js 加 `[BlendTrace]` 标签日志，覆盖：
- startBlend: fromState / toState / computeCtx 来源
- _updateBlend COMPLETE: 末帧 blended state
- switchRig: enter 前后 rig 内部状态摘要
- update: blend 完成后 3 帧 compute 的 frameCtx + 输出 state

## Evidence
（待收集）

## Analysis
（待填写）

## Fix
（待填写）