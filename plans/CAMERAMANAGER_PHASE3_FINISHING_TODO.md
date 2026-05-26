# CameraManager Phase 3 Finishing TODO

## Status
- Phase 3 core refactor is done and runnable.
- This file tracks the remaining Phase 3 finishing items that were intentionally deferred.

## Decisions (2026-05-26)
- Global base pitch plan is dropped.
- Reason: it was introduced to mitigate vertical framing issues, but it also impacts `SceneVisualSystem` behavior and is not the chosen direction.
- Character world `z` must remain fixed by gameplay rule (camera logic must not drive character `z` movement).

## Remaining Items
- [ ] Add explore walking boundary clamp (`walkArea`) in explore movement flow.
  - Minimal data: `walkArea(minX, maxX, minZ, maxZ)`.
  - First version can skip obstacle AABBs.
- [ ] Increase explore movement speed baseline.
  - Target: exploration traversal should feel clearly faster than current tuning.
  - Keep combat movement speed tuning unchanged.
- [ ] Implement `Battle -> Explore` transition sequence.
  - Suggested steps: `lockInput -> sendCommand(sheath/exitBattle) -> startCameraBlend(to: explore) -> switchMode(explore) -> unlockInput`.
- [ ] Keep `_applyEffects` as placeholder or implement at least one minimal effect (`shake`).
  - If placeholder remains, keep docs explicit that effects are not active yet.

## Out Of Scope (for now)
- True slope movement / terrain normal projection.
- Navmesh/pathfinding.

## Acceptance (Phase 3 close)
- [ ] Character world `z` is not moved by camera/transition logic.
- [ ] Explore walk area limits are effective (no out-of-bounds movement).
- [ ] Explore movement speed is faster and remains stable.
- [ ] Battle exit flow can return to explore mode reliably.
- [ ] No regressions in existing `Explore -> Battle` flow.
