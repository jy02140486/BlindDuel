function _createCameraState() {
    return {
        pos: new BABYLON.Vector3(0, 8, -25),
        target: new BABYLON.Vector3(0, 0, 0),
        projection: "perspective",
        orthoLeft: -10,
        orthoRight: 10,
        orthoTop: 5.6,
        orthoBottom: -5.6,
        fov: 0.8,
        aspect: 16 / 9
    };
}

function _cloneState(s) {
    return {
        pos: s.pos.clone(),
        target: s.target.clone(),
        projection: s.projection,
        orthoLeft: s.orthoLeft,
        orthoRight: s.orthoRight,
        orthoTop: s.orthoTop,
        orthoBottom: s.orthoBottom,
        fov: s.fov,
        aspect: s.aspect
    };
}

function _lerpState(a, b, t) {
    return {
        pos: BABYLON.Vector3.Lerp(a.pos, b.pos, t),
        target: BABYLON.Vector3.Lerp(a.target, b.target, t),
        // 游戏默认始终正交，blend 只处理正交参数，不处理 projection 切换
        projection: "orthographic",
        orthoLeft: a.orthoLeft + (b.orthoLeft - a.orthoLeft) * t,
        orthoRight: a.orthoRight + (b.orthoRight - a.orthoRight) * t,
        orthoTop: a.orthoTop + (b.orthoTop - a.orthoTop) * t,
        orthoBottom: a.orthoBottom + (b.orthoBottom - a.orthoBottom) * t,
        fov: b.fov,
        aspect: a.aspect + (b.aspect - a.aspect) * t
    };
}

function _smoothstep(t) {
    return t * t * (3 - 2 * t);
}

export class CameraManager {
    constructor(context = {}) {
        this.context = context;
        this.rigs = new Map();
        this.activeRigId = null;
        this.activeRig = null;

        this.camera = null;
        this.state = _createCameraState();
        this._blend = {
            active: false,
            elapsedMs: 0,
            durationMs: 0,
            fromState: null,
            toState: null,
            toRigId: null
        };
        this._effects = [];
    }

    init(scene, canvas, options = {}) {
        this.camera = new BABYLON.UniversalCamera(
            "main_camera",
            this.state.pos.clone(),
            scene
        );
        this.camera.mode = BABYLON.Camera.PERSPECTIVE_CAMERA;
        this.camera.fov = options.fov ?? 0.8;
        this.camera.minZ = options.minZ ?? 0.1;
        this.camera.maxZ = options.maxZ ?? 1000;
        this.camera.inputs.clear();

        scene.activeCamera = this.camera;

        this.state.aspect = canvas.width / canvas.height;
        this._applyToBabylonCamera(this.state);
    }

    registerRig(id, rigAdapter) {
        if (!id || !rigAdapter) return;
        this.rigs.set(id, rigAdapter);
    }

    switchRig(nextRigId, payload) {
        const nextRig = this.rigs.get(nextRigId);
        if (!nextRig) {
            console.warn(`[CameraManager] unknown rig: ${nextRigId}`);
            return false;
        }
        if (this.activeRigId === nextRigId) {
            return true;
        }

        if (this.activeRig && typeof this.activeRig.exit === "function") {
            this.activeRig.exit(this.context);
        }

        this.activeRigId = nextRigId;
        this.activeRig = nextRig;

        if (typeof nextRig.enter === "function") {
            nextRig.enter(this.context);
        }

        return true;
    }

    update(dtMs, frameCtx) {
        if (!this.camera) return;

        let baseState;
        if (this._blend.active) {
            baseState = this._updateBlend(dtMs);
        } else if (this.activeRig && typeof this.activeRig.compute === "function") {
            baseState = this.activeRig.compute(dtMs, frameCtx, this.state);
        } else {
            baseState = _cloneState(this.state);
        }

        const finalState = this._applyEffects(baseState, dtMs, frameCtx);
        this._applyToBabylonCamera(finalState);
        this.state = finalState;
    }

    startBlend({ toRigId, durationMs, easing, frameCtx }) {
        const targetRig = this.rigs.get(toRigId);
        if (!targetRig) {
            console.warn(`[CameraManager] startBlend: unknown rig "${toRigId}"`);
            return false;
        }

        const fromState = _cloneState(this.state);

        const computeCtx = frameCtx || this.context;
        let toState;
        if (typeof targetRig.compute === "function") {
            toState = targetRig.compute(0, computeCtx, fromState);
        } else {
            toState = _cloneState(fromState);
        }

        const blend = this._blend;
        blend.active = true;
        blend.elapsedMs = 0;
        blend.durationMs = durationMs || 1500;
        blend.fromState = fromState;
        blend.toState = toState;
        blend.toRigId = toRigId;
        blend.easing = easing || _smoothstep;

        return true;
    }

    isBlending() {
        return this._blend.active;
    }

    toggleProjection() {
        if (this.activeRig && typeof this.activeRig.toggleProjection === "function") {
            this.activeRig.toggleProjection();
        }
    }

    onResize() {
        if (!this.camera) return;
        const canvas = this.camera.getEngine().getRenderingCanvas();
        if (canvas) {
            this.state.aspect = canvas.width / canvas.height;
        }
        if (this.activeRig && typeof this.activeRig.onResize === "function") {
            this.activeRig.onResize(this.context);
        }
        this._applyToBabylonCamera(this.state);
    }

    enqueueEffect(effect) {
        if (!effect) return;
        this._effects.push({
            id: effect.id || `fx_${Date.now()}`,
            type: effect.type,
            durationMs: effect.durationMs || 0,
            elapsedMs: 0,
            params: effect.params || {},
            priority: effect.priority ?? 0
        });
        this._effects.sort((a, b) => a.priority - b.priority);
    }

    clearEffects(filterFn) {
        if (typeof filterFn === "function") {
            for (let i = this._effects.length - 1; i >= 0; i--) {
                if (filterFn(this._effects[i])) {
                    this._effects.splice(i, 1);
                }
            }
        } else {
            this._effects.length = 0;
        }
    }

    _updateBlend(dtMs) {
        const blend = this._blend;
        blend.elapsedMs += dtMs;
        const t = Math.min(blend.elapsedMs / blend.durationMs, 1);
        const s = blend.easing(t);
        const blended = _lerpState(blend.fromState, blend.toState, s);

        if (t >= 1) {
            blend.active = false;
            if (blend.toRigId) {
                this.switchRig(blend.toRigId);
            }
        }

        return blended;
    }

    _applyEffects(baseState, dtMs, frameCtx) {
        const expired = [];
        for (let i = 0; i < this._effects.length; i++) {
            const fx = this._effects[i];
            fx.elapsedMs += dtMs;
            if (fx.elapsedMs >= fx.durationMs) {
                expired.push(i);
                continue;
            }
        }
        for (let i = expired.length - 1; i >= 0; i--) {
            this._effects.splice(expired[i], 1);
        }
        return baseState;
    }

    _applyToBabylonCamera(state) {
        if (!this.camera) return;
        this.camera.position.copyFrom(state.pos);

        if (state.projection === "orthographic") {
            this.camera.mode = BABYLON.Camera.ORTHOGRAPHIC_CAMERA;
            this.camera.orthoLeft = state.orthoLeft;
            this.camera.orthoRight = state.orthoRight;
            this.camera.orthoTop = state.orthoTop;
            this.camera.orthoBottom = state.orthoBottom;
        } else {
            this.camera.mode = BABYLON.Camera.PERSPECTIVE_CAMERA;
            this.camera.fov = state.fov;
        }
    }

    getCamera() {
        return this.camera;
    }
}
