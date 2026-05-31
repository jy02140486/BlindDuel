> **Status**: ✅ 已完成（2026-05-30）

# CameraManager Phase 3 Finishing TODO

## Status
- Phase 3 core refactor is done and runnable.
- All remaining items are now complete.

## Decisions (2026-05-26)
- Global base pitch plan is dropped.
- Reason: it was introduced to mitigate vertical framing issues, but it also impacts `SceneVisualSystem` behavior and is not the chosen direction.
- Character world `z` must remain fixed by gameplay rule (camera logic must not drive character `z` movement).

## Remaining Items
- [x] Add explore walking boundary clamp (`walkArea`) in explore movement flow.
  - Minimal data: `walkArea(minX, maxX, minY, maxY)`.
  - First version can skip obstacle AABBs.
- [x] Increase explore movement speed baseline.
  - Target: exploration traversal should feel clearly faster than current tuning.
  - Keep combat movement speed tuning unchanged.
- [x] Implement `Battle -> Explore` transition sequence.
  - Suggested steps: `lockInput -> sendCommand(sheath/exitBattle) -> startCameraBlend(to: explore) -> switchMode(explore) -> unlockInput`.
- [x] Keep `_applyEffects` as placeholder or implement at least one minimal effect (`shake`).
  - Camera shake effect is implemented in `CameraManager._applyEffects`.

## Out Of Scope (for now)
- True slope movement / terrain normal projection.
- Navmesh/pathfinding.

## Acceptance (Phase 3 close)
- [x] Character world `z` is not moved by camera/transition logic.
- [x] Explore walk area limits are effective (no out-of-bounds movement).
- [x] Explore movement speed is faster and remains stable.
- [x] Battle exit flow can return to explore mode reliably.
- [x] No regressions in existing `Explore -> Battle` flow.
