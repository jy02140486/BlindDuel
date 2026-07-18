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

// [JITTER_DEBUG] 复制状态（用于保存上一帧状态）
function _copyState(dest, src) {
    dest.pos.copyFrom(src.pos);
    dest.target.copyFrom(src.target);
    dest.projection = src.projection;
    dest.orthoLeft = src.orthoLeft;
    dest.orthoRight = src.orthoRight;
    dest.orthoTop = src.orthoTop;
    dest.orthoBottom = src.orthoBottom;
    dest.fov = src.fov;
    dest.aspect = src.aspect;
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

        // [JITTER_DEBUG] 相机抖动检测
        this._prevCameraState = null; // 延迟初始化，避免第一帧误报
        this._camJitterThreshold = 0.3;
        this._camJitterLogInterval = 3000;
        this._lastCamJitterLog = 0;
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

        this._createOverlay(canvas);
    }

    rebind(newScene, newCamera) {
        const oldSceneId = this.camera?.getScene?.()?.uid ?? null;
        const newSceneId = newScene?.uid ?? null;
        console.log(`[CameraManager] rebind scene ${oldSceneId} → ${newSceneId}, camera=`, !!newCamera);
        this.camera = newCamera;
        if (newScene && newCamera) {
            newScene.activeCamera = newCamera;
            this._applyToBabylonCamera(this.state);
        }
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
            console.log(`[CameraManager] switchRig "${nextRigId}" — already active, skip`);
            return true;
        }

        console.log(`[CameraManager] switchRig "${this.activeRigId}" → "${nextRigId}"`);

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

        const _blendActiveAtStart = this._blend.active;
        let baseState;
        if (this._blend.active) {
            baseState = this._updateBlend(dtMs);
        } else if (this.activeRig && typeof this.activeRig.compute === "function") {
            baseState = this.activeRig.compute(dtMs, frameCtx, this.state);
        } else {
            baseState = _cloneState(this.state);
        }

        const finalState = this._applyEffects(baseState, dtMs, frameCtx);

        // [JITTER_DEBUG] 检测相机状态突变（跳过第一帧初始化）
        if (this._prevCameraState) {
            this.#checkCameraJitter(baseState, _blendActiveAtStart);
        } else {
            this._prevCameraState = _cloneState(baseState);
        }

        this._applyToBabylonCamera(finalState);
        this.state = baseState;

        // [JITTER_DEBUG] 保存当前状态用于下一帧对比
        _copyState(this._prevCameraState, baseState);
    }

    // [JITTER_DEBUG] 检测相机状态突变
    #checkCameraJitter(currentState, isBlending) {
        const now = performance.now();
        if (now - this._lastCamJitterLog < this._camJitterLogInterval) return;

        const prev = this._prevCameraState;
        const dx = currentState.pos.x - prev.pos.x;
        const dy = currentState.pos.y - prev.pos.y;
        const dz = currentState.pos.z - prev.pos.z;
        const posDist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        const tdx = currentState.target.x - prev.target.x;
        const tdy = currentState.target.y - prev.target.y;
        const tdz = currentState.target.z - prev.target.z;
        const targetDist = Math.sqrt(tdx * tdx + tdy * tdy + tdz * tdz);

        if (posDist > this._camJitterThreshold || targetDist > this._camJitterThreshold) {
            this._lastCamJitterLog = now;

            const seqBusy = this.context.sceneSequencer?.isBusy?.() ?? false;
            const activeClipNames = this.context.sceneSequencer?.activeClipStates ?
                [...this.context.sceneSequencer.activeClipStates.values()].map(s => s.clip.type) : [];

            console.warn(
                `[CAM_JITTER_DETECTED] activeRig=${this.activeRigId} blending=${isBlending} ` +
                `seqBusy=${seqBusy} activeClips=[${activeClipNames.join(',')}]`
            );
            console.warn(
                `[CAM_JITTER_POS] delta=(${dx.toFixed(4)},${dy.toFixed(4)},${dz.toFixed(4)}) dist=${posDist.toFixed(4)} ` +
                `prev=(${prev.pos.x.toFixed(4)},${prev.pos.y.toFixed(4)},${prev.pos.z.toFixed(4)}) ` +
                `curr=(${currentState.pos.x.toFixed(4)},${currentState.pos.y.toFixed(4)},${currentState.pos.z.toFixed(4)})`
            );
            console.warn(
                `[CAM_JITTER_TARGET] delta=(${tdx.toFixed(4)},${tdy.toFixed(4)},${tdz.toFixed(4)}) dist=${targetDist.toFixed(4)} ` +
                `prev=(${prev.target.x.toFixed(4)},${prev.target.y.toFixed(4)},${prev.target.z.toFixed(4)}) ` +
                `curr=(${currentState.target.x.toFixed(4)},${currentState.target.y.toFixed(4)},${currentState.target.z.toFixed(4)})`
            );

            if (isBlending && this._blend.toState) {
                console.warn(
                    `[CAM_JITTER_BLEND] elapsed=${this._blend.elapsedMs.toFixed(1)}ms ` +
                    `duration=${this._blend.durationMs}ms ` +
                    `toRig=${this._blend.toRigId} ` +
                    `toStatePos=(${this._blend.toState.pos.x.toFixed(4)},${this._blend.toState.pos.y.toFixed(4)},${this._blend.toState.pos.z.toFixed(4)})`
                );
            }
        }
    }

    startBlend({ toRigId, durationMs, easing, frameCtx }) {
        const targetRig = this.rigs.get(toRigId);
        if (!targetRig) {
            console.warn(`[CameraManager] startBlend: unknown rig "${toRigId}"`);
            return false;
        }

        if (durationMs != null && durationMs <= 0) {
            console.log(`[CameraManager] startBlend to="${toRigId}" durationMs=${durationMs} → instant switchRig`);
            this.switchRig(toRigId);
            return true;
        }

        const fromState = _cloneState(this.state);

        console.log(`[CameraManager] startBlend to="${toRigId}" durationMs=${durationMs} fromPos=(${fromState.pos.x.toFixed(2)},${fromState.pos.y.toFixed(2)},${fromState.pos.z.toFixed(2)}) fromTarget=(${fromState.target.x.toFixed(2)},${fromState.target.y.toFixed(2)},${fromState.target.z.toFixed(2)})`);

        const computeCtx = frameCtx || this.context;
        let toState;
        if (typeof targetRig.compute === "function") {
            toState = targetRig.compute(1000, computeCtx, fromState);
        } else {
            toState = _cloneState(fromState);
        }

        console.log(`[CameraManager] startBlend toPos=(${toState.pos.x.toFixed(2)},${toState.pos.y.toFixed(2)},${toState.pos.z.toFixed(2)}) toTarget=(${toState.target.x.toFixed(2)},${toState.target.y.toFixed(2)},${toState.target.z.toFixed(2)})`);

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
        const fx = {
            id: effect.id || `fx_${Date.now()}`,
            type: effect.type,
            durationMs: effect.durationMs || 0,
            elapsedMs: 0,
            params: effect.params || {},
            priority: effect.priority ?? 0
        };
        this._effects.push(fx);
        this._effects.sort((a, b) => a.priority - b.priority);

        if (fx.type === "flash") {
            this._triggerFlash(fx);
        }
        if (fx.type === "fade") {
            this._triggerFade(fx);
        }
        if (fx.type === "letterbox") {
            this._triggerLetterbox(fx);
        }
    }

    hasActiveEffects() {
        return this._effects.length > 0;
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
            this._clearFlash();
            this._clearFade();
            this._clearLetterbox();
        }
    }

    setFadeImmediate(color = "black", opacity = 1) {
        const el = this._overlay?.fade;
        if (!el) return;
        el.style.transition = "none";
        el.style.background = color;
        el.style.opacity = String(opacity);
        el.offsetHeight;
    }

    _updateBlend(dtMs) {
        const blend = this._blend;
        blend.elapsedMs += dtMs;
        const t = Math.min(blend.elapsedMs / blend.durationMs, 1);
        const s = blend.easing(t);
        const blended = _lerpState(blend.fromState, blend.toState, s);

        if (t >= 1) {
            console.log(`[CameraManager] blend COMPLETE elapsed=${blend.elapsedMs.toFixed(1)}ms → switchRig "${blend.toRigId}"`);
            blend.active = false;
            if (blend.toRigId) {
                this.switchRig(blend.toRigId);
            }
        } else {
            // blend tick：blended 已计算完成，将在 update() 中赋给 this.state
        }

        return blended;
    }

    _applyEffects(baseState, dtMs, frameCtx) {
        const expired = [];
        let maxShakeX = 0;
        let maxShakeZ = 0;

        for (let i = 0; i < this._effects.length; i++) {
            const fx = this._effects[i];
            fx.elapsedMs += dtMs;

            if (fx.type === "letterbox") {
                if (this._updateLetterbox(fx, dtMs)) {
                    expired.push(i);
                }
                continue;
            }

            if (fx.elapsedMs >= fx.durationMs) {
                if (fx.type === "flash") {
                    this._clearFlash();
                }
                expired.push(i);
                continue;
            }
            if (fx.type === "shake") {
                const offset = this._computeShakeOffset(fx);
                if (Math.abs(offset.x) > Math.abs(maxShakeX)) maxShakeX = offset.x;
                if (Math.abs(offset.z) > Math.abs(maxShakeZ)) maxShakeZ = offset.z;
            }
        }
        for (let i = expired.length - 1; i >= 0; i--) {
            this._effects.splice(expired[i], 1);
        }

        if (maxShakeX === 0 && maxShakeZ === 0) return baseState;

        const shaken = _cloneState(baseState);
        shaken.pos.x += maxShakeX;
        shaken.pos.z += maxShakeZ;
        shaken.target.x += maxShakeX;
        shaken.target.z += maxShakeZ;
        return shaken;
    }

    _computeShakeOffset(fx) {
        const params = fx.params || {};
        const amplitude = params.amplitude ?? 0.2;
        const frequency = params.frequency ?? 30;
        const phase = params.phase ?? 0;
        const t = fx.elapsedMs / fx.durationMs;
        const decay = 1 - t;
        const angle = (fx.elapsedMs * frequency * 2 * Math.PI / 1000) + phase;
        const raw = amplitude * Math.sin(angle) * decay;
        return { x: raw, z: raw * 0.7 };
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

    _createOverlay(canvas) {
        const container = document.createElement("div");
        container.id = "camera-overlay";
        container.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:1;overflow:hidden;";

        const flash = document.createElement("div");
        flash.id = "fx-flash";
        flash.style.cssText = "position:absolute;inset:0;opacity:0;";

        const fade = document.createElement("div");
        fade.id = "fx-fade";
        fade.style.cssText = "position:absolute;inset:0;opacity:0;";

        const letterTop = document.createElement("div");
        letterTop.id = "fx-letter-top";
        letterTop.style.cssText = "position:absolute;left:0;right:0;top:0;background:black;transform:translateY(-100%);";

        const letterBottom = document.createElement("div");
        letterBottom.id = "fx-letter-bottom";
        letterBottom.style.cssText = "position:absolute;left:0;right:0;bottom:0;background:black;transform:translateY(100%);";

        container.appendChild(flash);
        container.appendChild(fade);
        container.appendChild(letterTop);
        container.appendChild(letterBottom);

        canvas.parentNode.insertBefore(container, canvas.nextSibling);

        this._overlay = { container, flash, fade, letterTop, letterBottom };
    }

    _triggerFlash(fx) {
        const el = this._overlay?.flash;
        if (!el) return;
        const params = fx.params || {};
        el.style.background = params.color || "white";
        el.style.transition = `opacity ${fx.durationMs}ms ease-out`;
        el.style.opacity = "0";
        el.offsetHeight;
        el.style.opacity = String(params.maxAlpha ?? 1.0);
    }

    _clearFlash() {
        const el = this._overlay?.flash;
        if (!el) return;
        el.style.transition = "none";
        el.style.opacity = "0";
    }

    _triggerFade(fx) {
        const el = this._overlay?.fade;
        if (!el) return;
        const params = fx.params || {};
        el.style.background = params.color || "black";
        el.style.transition = "none";
        el.style.opacity = String(params.from ?? 0);
        el.offsetHeight;
        el.style.transition = `opacity ${fx.durationMs}ms linear`;
        el.style.opacity = String(params.to ?? 1);
    }

    _clearFade() {
        const el = this._overlay?.fade;
        if (!el) return;
        el.style.transition = "none";
        el.style.opacity = "0";
    }

    _triggerLetterbox(fx) {
        const params = fx.params || {};
        const height = params.height ?? 72;
        const speed = params.speed ?? 240;
        const enterMs = (height / speed) * 1000;
        const totalMs = fx.durationMs || Infinity;

        fx._lb = {
            phase: "entering",
            elapsedMs: 0,
            enterMs,
            height,
            totalMs
        };

        const topEl = this._overlay?.letterTop;
        const bottomEl = this._overlay?.letterBottom;
        if (!topEl || !bottomEl) return;

        topEl.style.height = `${height}px`;
        bottomEl.style.height = `${height}px`;
        topEl.style.transition = "none";
        bottomEl.style.transition = "none";
        topEl.style.transform = "translateY(-100%)";
        bottomEl.style.transform = "translateY(100%)";
        topEl.offsetHeight;
        bottomEl.offsetHeight;
        topEl.style.transition = `transform ${enterMs}ms linear`;
        bottomEl.style.transition = `transform ${enterMs}ms linear`;
        topEl.style.transform = "translateY(0)";
        bottomEl.style.transform = "translateY(0)";
    }

    _updateLetterbox(fx, dtMs) {
        const lb = fx._lb;
        if (!lb) return true;

        lb.elapsedMs += dtMs;

        if (lb.phase === "entering" && lb.elapsedMs >= lb.enterMs) {
            lb.phase = "staying";
            lb.elapsedMs = 0;
        }

        if (lb.phase === "staying" && lb.totalMs !== Infinity) {
            const stayMs = lb.totalMs - lb.enterMs * 2;
            if (stayMs <= 0 || lb.elapsedMs >= stayMs) {
                lb.phase = "exiting";
                lb.elapsedMs = 0;
                this._startLetterboxExit(fx);
            }
        }

        if (lb.phase === "exiting" && lb.elapsedMs >= lb.enterMs) {
            return true;
        }

        return false;
    }

    _startLetterboxExit(fx) {
        const lb = fx._lb;
        const topEl = this._overlay?.letterTop;
        const bottomEl = this._overlay?.letterBottom;
        if (!topEl || !bottomEl || !lb) return;
        topEl.style.transition = `transform ${lb.enterMs}ms linear`;
        bottomEl.style.transition = `transform ${lb.enterMs}ms linear`;
        topEl.style.transform = "translateY(-100%)";
        bottomEl.style.transform = "translateY(100%)";
    }

    _clearLetterbox() {
        const topEl = this._overlay?.letterTop;
        const bottomEl = this._overlay?.letterBottom;
        if (!topEl || !bottomEl) return;
        topEl.style.transition = "none";
        bottomEl.style.transition = "none";
        topEl.style.transform = "translateY(-100%)";
        bottomEl.style.transform = "translateY(100%)";
        topEl.style.height = "0";
        bottomEl.style.height = "0";
    }

    dispose() {
        if (this._overlay?.container) {
            this._overlay.container.remove();
            this._overlay = null;
        }
        for (const rig of this.rigs.values()) {
            if (rig && typeof rig.dispose === "function") {
                rig.dispose();
            }
        }
        this.rigs.clear();
        this.activeRig = null;
        this.activeRigId = null;
        this._effects.length = 0;
    }

    getCamera() {
        return this.camera;
    }
}
