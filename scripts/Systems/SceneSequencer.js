export class SceneSequencer {
    constructor(context) {
        this.context = context;
        this._sequence = null;
        this._stepIndex = 0;
        this._stepState = null;
        this._busy = false;
        this._cameraBlend = {
            active: false,
            elapsedMs: 0,
            durationMs: 0,
            fromPos: new BABYLON.Vector3(),
            fromTarget: new BABYLON.Vector3(),
            toPos: new BABYLON.Vector3(),
            toTarget: new BABYLON.Vector3(),
            fromOrthoLeft: 0,
            fromOrthoRight: 0,
            fromOrthoTop: 0,
            fromOrthoBottom: 0,
            toOrthoLeft: 0,
            toOrthoRight: 0,
            toOrthoTop: 0,
            toOrthoBottom: 0,
            fromMode: null,
            toMode: null
        };
    }

    isBusy() {
        return this._busy;
    }

    play(sequence, payload) {
        if (!sequence || !Array.isArray(sequence.steps)) {
            console.warn("[SceneSequencer] play called with invalid sequence");
            return;
        }
        this._sequence = sequence;
        this._stepIndex = 0;
        this._stepState = {};
        this._busy = true;
        console.log(`[SceneSequencer] start sequence: ${sequence.id}`);
        this._startCurrentStep(payload);
    }

    stop() {
        if (!this._busy) return;
        console.log("[SceneSequencer] stop");
        this._busy = false;
        this._sequence = null;
        this._stepIndex = 0;
        this._stepState = null;
        this._cameraBlend.active = false;
    }

    clear() {
        this.stop();
    }

    fixedUpdate(dtMs, tickCount) {
        if (!this._busy) return;

        const step = this._sequence.steps[this._stepIndex];
        const done = this._updateStep(step, dtMs, tickCount);

        if (done) {
            console.log(`[SceneSequencer] step done: ${step.type}`);
            this._stepIndex++;
            if (this._stepIndex >= this._sequence.steps.length) {
                console.log(`[SceneSequencer] sequence complete: ${this._sequence.id}`);
                this._busy = false;
                this._sequence = null;
                this._stepIndex = 0;
                this._stepState = null;
            } else {
                this._startCurrentStep();
            }
        }
    }

    updateRender(dtMs) {
        this._updateCameraBlend(dtMs);
    }

    _startCurrentStep(payload) {
        const step = this._sequence.steps[this._stepIndex];
        console.log(`[SceneSequencer] step start: ${step.type}`);
        this._stepState = {};

        switch (step.type) {
            case "wait": {
                this._stepState.elapsedMs = 0;
                break;
            }
            case "moveActorTo": {
                this._stepState.started = true;
                break;
            }
            case "startCameraBlend": {
                this._startCameraBlend(step);
                break;
            }
            case "switchCamera": {
                this._switchCamera(step);
                break;
            }
            case "switchMode": {
                this._switchMode(step, payload);
                break;
            }
            case "lockInput": {
                this._setInputLock(step, true);
                break;
            }
            case "unlockInput": {
                this._setInputLock(step, false);
                break;
            }
            case "sendCommand": {
                this._sendCommand(step);
                break;
            }
            case "setActorFacing": {
                this._setActorFacing(step);
                break;
            }
            case "waitUntil": {
                this._stepState.started = true;
                break;
            }
            case "callback": {
                if (typeof step.fn === "function") {
                    step.fn(this.context, payload);
                }
                break;
            }
            default:
                console.warn(`[SceneSequencer] unknown step type: ${step.type}`);
                break;
        }
    }

    _updateStep(step, dtMs, tickCount) {
        switch (step.type) {
            case "wait": {
                this._stepState.elapsedMs += dtMs;
                return this._stepState.elapsedMs >= (step.durationMs || 0);
            }
            case "moveActorTo": {
                return this._updateMoveActorTo(step, dtMs);
            }
            case "startCameraBlend": {
                return !this._cameraBlend.active;
            }
            case "waitUntil": {
                return typeof step.condition === "function" && step.condition(this.context);
            }
            case "switchCamera":
            case "switchMode":
            case "lockInput":
            case "unlockInput":
            case "sendCommand":
            case "setActorFacing":
            case "callback": {
                return true;
            }
            default:
                return true;
        }
    }

    _getActor(actorId) {
        if (actorId === "hero") return this.context.character;
        if (actorId === "enemy") return this.context.rabbleStick;
        return null;
    }

    _setInputLock(step, locked) {
        const actor = this._getActor(step.actorId);
        if (!actor) return;
        const controller = step.actorId === "hero"
            ? this.context.playerController
            : null;
        if (controller && "enabled" in controller) {
            controller.enabled = !locked;
        }
    }

    _sendCommand(step) {
        const actor = this._getActor(step.actorId);
        if (!actor) return;
        if (typeof actor.enterState === "function") {
            actor.enterState(step.command);
        } else if (typeof actor.pushCommand === "function") {
            actor.pushCommand(step.command);
        }
    }

    _setActorFacing(step) {
        const actor = this._getActor(step.actorId);
        if (!actor || !actor.root) return;
        const scaleX = step.facing >= 0 ? 1 : -1;
        actor.root.scaling.x = Math.abs(actor.root.scaling.x) * scaleX;
    }

    _updateMoveActorTo(step, dtMs) {
        const actor = this._getActor(step.actorId);
        if (!actor || !actor.root) return true;

        const speed = (step.speed || 4.0) * dtMs / 1000;
        const targetX = step.x ?? actor.root.position.x;
        const targetZ = step.z ?? actor.root.position.z;
        const dx = targetX - actor.root.position.x;
        const dz = targetZ - actor.root.position.z;
        const dist = Math.sqrt(dx * dx + dz * dz);

        if (dist <= speed || dist <= (step.tolerance || 0.1)) {
            actor.root.position.x = targetX;
            actor.root.position.z = targetZ;
            if (typeof actor.setMoveIntent === "function") {
                actor.setMoveIntent({ x: 0, y: 0 });
            }
            return true;
        }

        const moveX = (dx / dist) * speed;
        const moveZ = (dz / dist) * speed;
        actor.root.position.x += moveX;
        actor.root.position.z += moveZ;
        if (typeof actor.setMoveIntent === "function") {
            actor.setMoveIntent({ x: dx / dist, y: dz / dist });
        }
        return false;
    }

    _switchCamera(step) {
        const { cameraRig, exploreCameraRig, scene } = this.context;
        const babylonScene = scene.scene;
        if (step.cameraId === "duel") {
            exploreCameraRig?.disable();
            cameraRig?.enable?.();
            if (cameraRig?.camera && babylonScene) {
                babylonScene.activeCamera = cameraRig.camera;
            }
        } else if (step.cameraId === "explore") {
            cameraRig?.disable?.();
            exploreCameraRig?.enable();
        }
    }

    _switchMode(step, payload) {
        this.context.scene.gameModeManager.switchMode(step.modeId, payload);
    }

    _startCameraBlend(step) {
        const blend = this._cameraBlend;
        const { cameraRig, exploreCameraRig, scene, character, rabbleStick } = this.context;
        const babylonScene = scene.scene;

        blend.durationMs = step.durationMs || 1500;
        blend.elapsedMs = 0;
        blend.active = true;

        const activeCam = babylonScene?.activeCamera;
        if (!activeCam) {
            console.warn("[SceneSequencer] startCameraBlend: no activeCamera");
            blend.active = false;
            return;
        }

        blend.fromPos.copyFrom(activeCam.position);
        // 不读取 activeCam.getTarget()，因为 explore 相机没有使用 setTarget
        // blend 只插值 position，不操作 setTarget，避免引入额外的朝向变化
        blend.fromTarget.copyFrom(activeCam.position);

        // 记录当前正交参数
        blend.fromMode = activeCam.mode;
        blend.fromOrthoLeft = activeCam.orthoLeft ?? -1;
        blend.fromOrthoRight = activeCam.orthoRight ?? 1;
        blend.fromOrthoTop = activeCam.orthoTop ?? 1;
        blend.fromOrthoBottom = activeCam.orthoBottom ?? -1;

        if (step.to === "duel") {
            const heroPos = character.root.position;
            const opponentPos = rabbleStick.root.position;
            const centerX = (heroPos.x + opponentPos.x) * 0.5;
            const centerZ = (heroPos.z + opponentPos.z) * 0.5;
            const fighterDistance = Math.abs(opponentPos.x - heroPos.x);
            // 用 DuelCameraRig 的公式计算目标高度，确保 blend 结束后和 update() 一致
            const zoomT = cameraRig
                ? BABYLON.Scalar.Clamp(
                    (fighterDistance - cameraRig.zoomMinDistance) / (cameraRig.zoomMaxDistance - cameraRig.zoomMinDistance),
                    0, 1
                  )
                : 0;
            const desiredHeight = cameraRig
                ? BABYLON.Scalar.Lerp(cameraRig.minCameraHeight, cameraRig.maxCameraHeight, zoomT)
                : 8;
            blend.toPos.set(centerX, desiredHeight, centerZ - 25);
            blend.toTarget.set(centerX, 0, centerZ);

            // 继承 explore 相机的投影模式偏好
            if (blend.fromMode === BABYLON.Camera.ORTHOGRAPHIC_CAMERA && cameraRig) {
                blend.toMode = BABYLON.Camera.ORTHOGRAPHIC_CAMERA;
                // 用 DuelCameraRig 的公式计算目标正交参数，确保 blend 结束后和 BattleMode.updateRender 一致
                const fighterDistance = Math.abs(rabbleStick.root.position.x - character.root.position.x);
                const zoomT = BABYLON.Scalar.Clamp(
                    (fighterDistance - cameraRig.zoomMinDistance) / (cameraRig.zoomMaxDistance - cameraRig.zoomMinDistance),
                    0, 1
                );
                const desiredWidth = BABYLON.Scalar.Lerp(cameraRig.orthoMinWidth, cameraRig.orthoMaxWidth, zoomT);
                const windowAspect = window.innerWidth / window.innerHeight;
                const halfWidth = desiredWidth / 2;
                const halfHeight = (desiredWidth / windowAspect) / 2;
                blend.toOrthoLeft = -halfWidth;
                blend.toOrthoRight = halfWidth;
                blend.toOrthoTop = halfHeight;
                blend.toOrthoBottom = -halfHeight;
                console.log(`[CameraBlend] duel target: zoomT=${zoomT.toFixed(2)} width=${desiredWidth.toFixed(2)} aspect=${windowAspect.toFixed(2)} halfH=${halfHeight.toFixed(2)}`);
            } else {
                blend.toMode = BABYLON.Camera.PERSPECTIVE_CAMERA;
                blend.toOrthoLeft = blend.fromOrthoLeft;
                blend.toOrthoRight = blend.fromOrthoRight;
                blend.toOrthoTop = blend.fromOrthoTop;
                blend.toOrthoBottom = blend.fromOrthoBottom;
            }
            exploreCameraRig?.disable();
        } else if (step.to === "explore") {
            const pos = character.root.position;
            blend.toPos.set(pos.x, 4, pos.z - 15);
            blend.toTarget.set(pos.x, 0, pos.z);

            const exploreCam = exploreCameraRig?.camera;
            if (exploreCam && exploreCameraRig?.projection === "orthographic") {
                blend.toMode = BABYLON.Camera.ORTHOGRAPHIC_CAMERA;
                blend.toOrthoLeft = exploreCam.orthoLeft ?? -10;
                blend.toOrthoRight = exploreCam.orthoRight ?? 10;
                blend.toOrthoTop = exploreCam.orthoTop ?? 5.6;
                blend.toOrthoBottom = exploreCam.orthoBottom ?? -5.6;
            } else {
                blend.toMode = BABYLON.Camera.PERSPECTIVE_CAMERA;
                blend.toOrthoLeft = blend.fromOrthoLeft;
                blend.toOrthoRight = blend.fromOrthoRight;
                blend.toOrthoTop = blend.fromOrthoTop;
                blend.toOrthoBottom = blend.fromOrthoBottom;
            }
            cameraRig?.disable?.();
        } else if (step.toPos && step.toTarget) {
            blend.toPos.copyFrom(step.toPos);
            blend.toTarget.copyFrom(step.toTarget);
            blend.toMode = blend.fromMode;
            blend.toOrthoLeft = blend.fromOrthoLeft;
            blend.toOrthoRight = blend.fromOrthoRight;
            blend.toOrthoTop = blend.fromOrthoTop;
            blend.toOrthoBottom = blend.fromOrthoBottom;
        }

        console.log(`[SceneSequencer] camera blend start: to=${step.to}, duration=${blend.durationMs}ms`);
        console.log(`[CameraBlend] fromMode=${blend.fromMode}(${blend.fromMode === BABYLON.Camera.ORTHOGRAPHIC_CAMERA ? "ortho" : "persp"}) toMode=${blend.toMode}(${blend.toMode === BABYLON.Camera.ORTHOGRAPHIC_CAMERA ? "ortho" : "persp"})`);
        console.log(`[CameraBlend] fromOrtho L=${blend.fromOrthoLeft} R=${blend.fromOrthoRight} T=${blend.fromOrthoTop} B=${blend.fromOrthoBottom}`);
        console.log(`[CameraBlend] toOrtho L=${blend.toOrthoLeft} R=${blend.toOrthoRight} T=${blend.toOrthoTop} B=${blend.toOrthoBottom}`);
        console.log(`[CameraBlend] activeCam=${activeCam?.name} mode=${activeCam?.mode} orthoL=${activeCam?.orthoLeft}`);
    }

    _updateCameraBlend(dtMs) {
        const blend = this._cameraBlend;
        if (!blend.active) return;

        blend.elapsedMs += dtMs;
        const t = Math.min(blend.elapsedMs / blend.durationMs, 1);
        const smooth = t * t * (3 - 2 * t);

        const babylonScene = this.context.scene?.scene;
        const cam = babylonScene?.activeCamera;
        if (cam) {
            cam.position.x = blend.fromPos.x + (blend.toPos.x - blend.fromPos.x) * smooth;
            cam.position.y = blend.fromPos.y + (blend.toPos.y - blend.fromPos.y) * smooth;
            cam.position.z = blend.fromPos.z + (blend.toPos.z - blend.fromPos.z) * smooth;
            // 不调用 setTarget，两个 rig 都没有使用它，避免 blend 期间引入额外朝向变化

            // 插值正交参数
            const isOrthoTransition = blend.fromMode === BABYLON.Camera.ORTHOGRAPHIC_CAMERA || blend.toMode === BABYLON.Camera.ORTHOGRAPHIC_CAMERA;
            console.log(`[CameraBlend] t=${t.toFixed(3)} smooth=${smooth.toFixed(3)} isOrtho=${isOrthoTransition} cam.mode=${cam.mode} fromMode=${blend.fromMode} toMode=${blend.toMode}`);
            if (isOrthoTransition) {
                cam.mode = BABYLON.Camera.ORTHOGRAPHIC_CAMERA;
                const newLeft = blend.fromOrthoLeft + (blend.toOrthoLeft - blend.fromOrthoLeft) * smooth;
                const newRight = blend.fromOrthoRight + (blend.toOrthoRight - blend.fromOrthoRight) * smooth;
                const newTop = blend.fromOrthoTop + (blend.toOrthoTop - blend.fromOrthoTop) * smooth;
                const newBottom = blend.fromOrthoBottom + (blend.toOrthoBottom - blend.fromOrthoBottom) * smooth;
                cam.orthoLeft = newLeft;
                cam.orthoRight = newRight;
                cam.orthoTop = newTop;
                cam.orthoBottom = newBottom;
                console.log(`[CameraBlend] ortho L=${newLeft.toFixed(2)} R=${newRight.toFixed(2)} T=${newTop.toFixed(2)} B=${newBottom.toFixed(2)}`);
            }
        }

        if (t >= 1) {
            blend.active = false;
            console.log(`[SceneSequencer] camera blend done: pos=(${cam.position.x.toFixed(2)}, ${cam.position.y.toFixed(2)}, ${cam.position.z.toFixed(2)})`);

            // 同步 DuelCameraRig 内部状态，避免切换后跳变
            const { cameraRig, exploreCameraRig } = this.context;
            if (cameraRig && cam) {
                cameraRig.currentBasePosition.x = cam.position.x;
                cameraRig.currentBasePosition.y = cam.position.y;
                cameraRig.currentBasePosition.z = cam.position.z;
                cameraRig.currentTarget.x = blend.toTarget.x;
                cameraRig.currentTarget.y = blend.toTarget.y;
                cameraRig.currentTarget.z = blend.toTarget.z;

                // 继承 explore 相机的投影模式偏好
                if (exploreCameraRig && exploreCameraRig.projection !== cameraRig.projection) {
                    cameraRig.toggleProjection();
                }
            }
        }
    }
}