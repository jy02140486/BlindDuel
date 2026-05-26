# CameraManager Phase 3 - Base Pitch (¸©½Ç) Pseudocode

## Goal
- Unify one global base pitch for both `ExploreMode` and `BattleMode`.
- Recommended default: `12deg`.
- Keep transition smooth with no obvious perspective jump when switching modes.

## 1) CameraManager Global Config (Pseudocode)

```js
class CameraManager {
  constructor() {
    this.cameraConfig = {
      basePitchDeg: 12,
      pitchSmoothing: 10 // optional
    };
  }

  getBasePitchRad() {
    return DegToRad(this.cameraConfig.basePitchDeg);
  }
}
```

## 2) Shared Helper: Solve Camera Position By Pitch

Convention:
- Positive pitch means camera looks downward.
- Build camera position from `target + distance + pitch`.

```js
function solveCameraPosByPitch(target, distance, pitchRad, followX = target.x) {
  const yOffset = Math.sin(pitchRad) * distance;
  const zOffset = Math.cos(pitchRad) * distance;

  return Vec3(
    followX,
    target.y + yOffset,
    target.z - zOffset
  );
}
```

## 3) ExploreCameraRig.compute (Pseudocode)

```js
compute(dtMs, context, prevState) {
  if (!context.target) return fallback(prevState);

  const pitch = context.cameraManager.getBasePitchRad();
  const dist = this.config.followDistance;

  const desiredPos = solveCameraPosByPitch(
    context.target,
    dist,
    pitch,
    context.target.x
  );

  const desiredTarget = context.target;

  this._cameraPosition = lerp(this._cameraPosition, desiredPos, blend(dtMs));
  this._targetPosition = lerp(this._targetPosition, desiredTarget, blend(dtMs));

  state.pos = this._cameraPosition;
  state.target = this._targetPosition;
  state.projection = this.projection;

  if (state.projection === "orthographic") {
    // keep existing ortho width/aspect logic
    state.orthoLeft = ...;
    state.orthoRight = ...;
    state.orthoTop = ...;
    state.orthoBottom = ...;
  }

  return state;
}
```

## 4) DuelCameraRig.compute (Pseudocode)

```js
compute(dtMs, context, prevState) {
  if (!context.target) return fallback(prevState);

  const pitch = context.cameraManager.getBasePitchRad();
  const zoomT = clamp((fighterDistance - minD) / (maxD - minD), 0, 1);

  if (projection === "perspective") {
    const dist = lerp(perspMinDistance, perspMaxDistance, zoomT);
    desiredPos = solveCameraPosByPitch(
      context.target,
      dist,
      pitch,
      context.basePosition.x
    );
  } else {
    // ortho mode also uses same base pitch for position consistency
    const virtualDist = lerp(orthoVirtualMinDistance, orthoVirtualMaxDistance, zoomT);
    desiredPos = solveCameraPosByPitch(
      context.target,
      virtualDist,
      pitch,
      context.basePosition.x
    );

    const desiredWidth = lerp(orthoMinWidth, orthoMaxWidth, zoomT);
    state.orthoLeft = ...;
    state.orthoRight = ...;
    state.orthoTop = ...;
    state.orthoBottom = ...;
  }

  this.currentBasePosition = lerp(this.currentBasePosition, desiredPos, blend(dtMs));
  this.currentTarget = lerp(this.currentTarget, context.target, blend(dtMs));

  state.pos = this.currentBasePosition;
  state.target = this.currentTarget;
  state.projection = this.projection;

  return state;
}
```

## 5) Blend/Transition Rule (No Jump)
- During `startBlend`, `fromState` should be current real camera state.
- `toState` should be computed by target rig using the same global base pitch.
- Keep easing as current `_smoothstep` (or project default).

This keeps Explore/Battle transitions consistent and avoids visible pitch jump.

## 6) Minimal Acceptance Checklist
- Explore and Battle both read pitch from one source (`CameraManager.cameraConfig.basePitchDeg`).
- Changing `basePitchDeg` (e.g. `12 -> 10`) affects both modes consistently.
- Explore <-> Battle blend shows no obvious pitch discontinuity.
- Existing projection toggle behavior still works.

## Archive Note (2026-05-26)
- This draft is archived and should not be treated as the latest implementation guide.
- Reason: the team decided not to solve framing by moving character vertical framing target.
- Additional rule confirmed later: character world `z` should not be moved by camera logic.
- Use `plans/CAMERAMANAGER_PHASE3_FINISHING_TODO.md` as the active source of truth.

## Decision Update (2026-05-26)
- Base pitch approach is fully dropped.
- Reason: it causes side effects on `SceneVisualSystem`, and is no longer part of the implementation path.
