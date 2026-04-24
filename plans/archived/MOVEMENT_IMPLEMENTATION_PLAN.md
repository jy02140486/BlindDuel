# Movement Implementation Plan

## Goal
- Add a scalable movement pipeline to the current prototype.
- Keep clear ownership: state machine decides intent, Character (or Movement) executes movement.

## Resource Status
- Sprite assets exist for `idle`, `move`, `thrust`.
- CollisionMask and RootMotion assets exist for `idle`, `move`, `thrust`.
- `Data/CollisionMask/longswordman_move.collider.json` is generated.

## Phases
1. State transition phase (done)
- Add `move` state in state graph.
- Add `idle -> move` and `move -> idle` transitions.
- Use `moveMagnitude` threshold (`0.2`) for enter/exit move.
- Demo now loads `move` clip and `move` collider data.

2. Movement execution phase (todo)
- Add unified movement update in `Character` (or extract `MovementComponent`).
- Compute world delta from `moveIntent` and update `character.root.position`.
- Add base movement config (`walkSpeed`) with `dt` integration.

3. State-driven movement policy phase (todo)
- Support policy fields per state, for example: `canMove`, `speedScale`, `useRootMotion`.
- Allow attack states to lock input or reduce speed by config.

4. Facing and mirroring phase (todo)
- Update `facing` from `moveIntent.x`.
- Add sprite/collision mirroring behavior based on `facing`.

5. Validation phase (todo)
- Tune `idle <-> move` threshold to avoid jitter.
- Verify `move -> thrust -> idle/move` flow is stable.
- Verify root alignment and collision debug stay correct during movement.

## Files Changed In This Step
- `Data/StateGraphDef/LongSwordMan.json`
- `scripts/Enties/Character.js`
- `character_demo.js`
- `Data/CollisionMask/longswordman_move.collider.json`
