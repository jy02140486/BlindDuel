# Next AI Handoff (2026-04-24)

Goal: let the next AI start coding immediately with minimal rediscovery.

## 1) Current status (verified)
- Scene entry: `scripts/Scene.js`
- Battle camera rig: `scripts/DuelCameraRig.js`
- Asset manifest: `scripts/AssetManifest.js`
- Data loader: `scripts/DataLoader.js`
- Character assembly: `scripts/CharacterFactory.js`
- Test controller: `scripts/Systems/TestController.js`
- Test script: `Data/TestScripts/rabble_stick_basic_sequence.json`

## 2) Planning docs to read first
- Odinlike visual plan:
  - `plans/ODINLIKE_2D3D_PARALLAX_SCENE_VISUAL_PLAN.md`
- TestController -> AIController plan:
  - `plans/TEST_CONTROLLER_THEN_AI_CONTROLLER_PLAN.md`
- Scene/camera checklist (archived location, not in `plans/` root):
  - `plans/archived/SCENE_CAMERA_DECOUPLE_BEFORE_AI_CHECKLIST.md`

## 3) Not done yet (high priority)
- `DebugCameraRig` is missing.
- Camera mode switching (`debug` / `duel`) is missing.
- `SceneVisualSystem` is not implemented yet.
- Visual scene is still minimal (`clearColor + light + ground`) in `Scene.js`.

## 4) Immediate coding order
1. Add `DebugCameraRig` with the same interface: `init / update / dispose`.
2. Add camera mode selection in `Scene` (config-based first).
3. Add `SceneVisualSystem` skeleton and lifecycle wiring.
4. Move existing ground/background setup from `Scene` to `SceneVisualSystem`.
5. Implement Odinlike Phase A only: `BG_FAR + STAGE + FG_DECOR`.

## 5) Architecture constraints (must keep)
- `Scene`: orchestration only.
- `CameraRig`: camera behavior only (no parallax layer movement).
- `SceneVisualSystem`: parallax/environment runtime updates.
- Do not regress `Character`, `CombatSystem`, `TestController` behavior.

## 6) Quick regression checklist
- Hero can move and attack.
- `rabble_stick` still follows `rabble_stick_basic_sequence.json`.
- Hit state can return to idle (no stuck state).
- `C` key collision-visibility toggle still works.
- Duel camera still follows smoothly after changes.

## 7) Known risks
- Transparent sorting conflicts in foreground occluders.
- Camera jitter can amplify parallax jitter.
- Re-coupling risk if gameplay logic leaks into visual system.

## 8) Handoff rule for the next AI
- Keep each round small.
- Report:
  - changed files
  - regression result
  - remaining TODO

One-line handoff:
Project already has Scene/Data/Factory/BattleCamera decoupling; next step is `DebugCameraRig + mode switch`, then phased `SceneVisualSystem` for Odinlike parallax.
