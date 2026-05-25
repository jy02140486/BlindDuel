# CameraManager Phase 3 Remaining - Pseudocode Handoff

## Goal
Complete the remaining Phase 3 work with a low-risk, incremental implementation:
- Single Babylon camera managed by `CameraManager`
- Camera rigs become pure calculators (no direct camera ownership)
- Minimal camera effect pipeline scaffold
- Keep gameplay behavior unchanged as much as possible

## Constraints
- Prioritize "still runnable" over perfect abstraction.
- Do not change combat/explore gameplay logic.
- Keep `Explore -> Battle` transition behavior visually close to current state.

## 1) Refactor `scripts/Systems/CameraManager.js`

```js
class CameraManager {
  constructor(context) {
    this.context = context
    this.rigs = new Map()             // id -> rigAdapter
    this.activeRigId = null
    this.activeRig = null

    this.camera = null                // single Babylon camera
    this.state = this._createCameraState()
    this.blend = this._createBlendState()
    this.effects = []                 // effect stack
  }

  init(scene, canvas, options) {
    // create one UniversalCamera
    // scene.activeCamera = this.camera
    // set default projection/fov/near/far
    // init this.state from camera values
  }

  registerRig(id, rigAdapter) {
    // rigAdapter contract:
    // - enter(ctx)
    // - exit(ctx)
    // - compute(dtMs, ctx, prevState) => desiredState
    // - onResize?(ctx)
    this.rigs.set(id, rigAdapter)
  }

  switchRig(nextRigId, payload) {
    // no-op if same
    // activeRig.exit
    // switch pointer
    // activeRig.enter
  }

  update(dtMs, frameCtx) {
    // 1) if blending: get blended baseState
    // 2) else: baseState = activeRig.compute(...)
    // 3) apply effects stack: baseState -> effectedState
    // 4) apply effectedState to this.camera
    // 5) cache this.state
  }

  startBlend({ toRigId, durationMs, easing, payload }) {
    // fromState = clone(this.state)
    // query target rig once to compute toState (without switching)
    // set blend.active + timing
    // on complete: switchRig(toRigId, payload)
  }

  isBlending() { return this.blend.active }

  toggleProjection() {
    // switch state.projection
    // preserve consistent ortho width/aspect behavior
  }

  onResize() {
    // update aspect
    // call activeRig.onResize if exists
    // re-apply camera params
  }

  enqueueEffect(effect) {
    // effect: { id, type, durationMs, elapsedMs, params, priority }
    // push + sort by priority
  }

  clearEffects(filterFn) {
    // clear all or filtered subset
  }

  _updateBlend(dtMs) {
    // t = clamp(elapsed/duration)
    // s = easing(t)
    // blended = lerpState(from, to, s)
    // finish -> switchRig
    // return blended
  }

  _applyEffects(baseState, dtMs, frameCtx) {
    // apply each effect, remove expired
    // return finalState
  }

  _applyToBabylonCamera(state) {
    // camera.position = state.pos
    // projection mode
    // ortho by width+aspect
    // perspective by fov
  }
}
```

## 2) (Optional but Recommended) Add `scripts/Systems/CameraState.js`

```js
export function createCameraState() {
  return {
    pos: { x: 0, y: 0, z: 0 },
    target: { x: 0, y: 0, z: 0 },
    projection: "perspective", // or "orthographic"
    orthoWidth: 20,
    fov: 0.8,
    aspect: 16 / 9
  }
}

export function cloneState(s) { /* deep copy */ }
export function lerpState(a, b, t) { /* interpolated copy */ }
export function smoothstep(t) { return t * t * (3 - 2 * t) }
```

## 3) Convert Duel rig into pure adapter

Suggested new file: `scripts/Systems/CameraRigs/DuelRigAdapter.js`

```js
class DuelRigAdapter {
  constructor(config) { this.config = config; this.runtime = {} }

  enter(ctx) {
    // init smoothing runtime values
  }

  exit(ctx) {}

  compute(dtMs, ctx, prevState) {
    // read hero/enemy positions
    // compute center + fighter distance
    // map to desired height + zoom
    // return nextState only (do NOT mutate activeCamera)
    return nextState
  }

  onResize(ctx) {}
}
```

## 4) Convert Explore rig into pure adapter

Suggested new file: `scripts/Systems/CameraRigs/ExploreRigAdapter.js`

```js
class ExploreRigAdapter {
  constructor(config) { this.config = config; this.runtime = {} }

  enter(ctx) {}
  exit(ctx) {}

  compute(dtMs, ctx, prevState) {
    // follow hero root with smoothing
    // return nextState
    return nextState
  }
}
```

## 5) Wire in `scripts/Scene.js`

```js
init() {
  // create CameraManager and init(scene, canvas)
  // register rigs: "explore" and "duel"
  // switchRig("explore")
  // expose cameraManager in sharedContext
}

updateRender(dtMs) {
  // suggested order:
  // gameModeManager.updateRender(dtMs)
  // sceneSequencer.updateRender(dtMs)
  // cameraManager.update(dtMs, frameCtx)
  // sceneVisualSystem.update(dtMs, { camera: cameraManager.camera })
}
```

## 6) Final role of modes

`ExploreMode` / `BattleMode`:
- `enter()` only declares camera intent via manager (`switchRig`).
- `updateRender()` only prepares context/frame input if needed.
- Never directly mutate `scene.activeCamera`.
- Never directly enable/disable rig instances.

## 7) Keep sequencer API, normalize step schema

```js
{
  type: "startCameraBlend",
  toRigId: "duel",      // replace legacy `to`
  durationMs: 1200,
  easing: "smoothstep",
  payload: { /* optional */ }
}
```

Implementation behavior:
- `SceneSequencer` calls `cameraManager.startBlend(step)`
- Wait until `!cameraManager.isBlending()`

## 8) Minimal effect implementation (shake only)

```js
cameraManager.enqueueEffect({
  id: "hit_shake_001",
  type: "shake",
  durationMs: 120,
  elapsedMs: 0,
  params: { ampX: 0.12, ampY: 0.06, freq: 35 },
  priority: 100
})

// in _applyEffects
if (effect.type === "shake") {
  // offset position by noise/sin with falloff
}
```

## 9) Acceptance checklist

- [ ] No direct `rig.enable()/disable()` calls outside manager compatibility layer.
- [ ] No direct camera position/ortho mutation in modes or sequencer.
- [ ] `CameraManager.camera` is the sole active camera source.
- [ ] `Explore -> Battle -> Explore` has no obvious camera jump.
- [ ] Perspective/orthographic switch still works.
- [ ] At least one effect (`shake`) works and expires automatically.

## 10) Suggested execution order

1. Introduce camera state helpers.
2. Build single-camera manager update loop.
3. Port Duel rig adapter.
4. Port Explore rig adapter.
5. Rewire Scene update order.
6. Keep sequencer interface stable (`startCameraBlend`).
7. Add minimal shake effect.
8. Run manual regression on Explore/Battle transition.
