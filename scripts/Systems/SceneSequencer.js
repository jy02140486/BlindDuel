export const STEP_TYPE = Object.freeze({
    WAIT: 0,
    MOVE_ACTOR_TO: 1,
    START_CAMERA_BLEND: 2,
    SWITCH_CAMERA: 3,
    SWITCH_MODE: 4,
    LOCK_INPUT: 5,
    UNLOCK_INPUT: 6,
    SEND_COMMAND: 7,
    SET_ACTOR_FACING: 8,
    SET_ACTOR_FACING_MODE: 9,
    WAIT_UNTIL: 10,
    SET_CAMERA_FRAME: 11,
    CALLBACK: 12
});

export class SceneSequencer {
    constructor(context) {
        this.context = context;
        this._sequence = null;
        this._stepIndex = 0;
        this._stepState = null;
        this._busy = false;
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
        // blend 更新已合并到 CameraManager.update()，由 Scene.updateRender() 统一调用
    }

    _startCurrentStep(payload) {
        const step = this._sequence.steps[this._stepIndex];
        console.log(`[SceneSequencer] step start: ${step.type}`);
        this._stepState = {};

        switch (step.type) {
            case STEP_TYPE.WAIT: {
                this._stepState.elapsedMs = 0;
                break;
            }
            case STEP_TYPE.MOVE_ACTOR_TO: {
                this._stepState.started = true;
                break;
            }
            case STEP_TYPE.START_CAMERA_BLEND: {
                this._startCameraBlend(step);
                break;
            }
            case STEP_TYPE.SWITCH_CAMERA: {
                this._switchCamera(step);
                break;
            }
            case STEP_TYPE.SWITCH_MODE: {
                this._switchMode(step, payload);
                break;
            }
            case STEP_TYPE.LOCK_INPUT: {
                this._setInputLock(step, true);
                break;
            }
            case STEP_TYPE.UNLOCK_INPUT: {
                this._setInputLock(step, false);
                break;
            }
            case STEP_TYPE.SEND_COMMAND: {
                this._sendCommand(step);
                break;
            }
            case STEP_TYPE.SET_ACTOR_FACING: {
                this._setActorFacing(step);
                break;
            }
            case STEP_TYPE.SET_ACTOR_FACING_MODE: {
                this._setActorFacingMode(step);
                break;
            }
            case STEP_TYPE.WAIT_UNTIL: {
                this._stepState.started = true;
                break;
            }
            case STEP_TYPE.SET_CAMERA_FRAME: {
                this._setCameraFrame(step);
                break;
            }
            case STEP_TYPE.CALLBACK: {
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
            case STEP_TYPE.WAIT: {
                this._stepState.elapsedMs += dtMs;
                return this._stepState.elapsedMs >= (step.durationMs || 0);
            }
            case STEP_TYPE.MOVE_ACTOR_TO: {
                return this._updateMoveActorTo(step, dtMs);
            }
            case STEP_TYPE.START_CAMERA_BLEND: {
                return this._stepState.failed || !this.context.cameraManager?.isBlending();
            }
            case STEP_TYPE.WAIT_UNTIL: {
                return typeof step.condition === "function" && step.condition(this.context);
            }
            case STEP_TYPE.SET_CAMERA_FRAME:
            case STEP_TYPE.SWITCH_CAMERA:
            case STEP_TYPE.SWITCH_MODE:
            case STEP_TYPE.LOCK_INPUT:
            case STEP_TYPE.UNLOCK_INPUT:
            case STEP_TYPE.SEND_COMMAND:
            case STEP_TYPE.SET_ACTOR_FACING:
            case STEP_TYPE.SET_ACTOR_FACING_MODE:
            case STEP_TYPE.CALLBACK: {
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
        if (!actor || typeof actor.setFacing !== "function") return;
        actor.setFacing(step.facing);
    }

    _setActorFacingMode(step) {
        const actor = this._getActor(step.actorId);
        if (!actor || typeof actor.setFacingMode !== "function") return;
        actor.setFacingMode(step.mode);
    }

    _updateMoveActorTo(step, dtMs) {
        const actor = this._getActor(step.actorId);
        if (!actor || !actor.root) return true;

        const speed = (step.speed || 4.0) * dtMs / 1000;
        const targetX = step.x ?? actor.root.position.x;
        const targetY = step.y ?? actor.root.position.y;
        const dx = targetX - actor.root.position.x;
        const dy = targetY - actor.root.position.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist <= speed || dist <= (step.tolerance || 0.1)) {
            actor.root.position.x = targetX;
            actor.root.position.y = targetY;
            if (typeof actor.setMoveIntent === "function") {
                actor.setMoveIntent({ x: 0, y: 0 });
            }
            return true;
        }

        const moveX = (dx / dist) * speed;
        const moveY = (dy / dist) * speed;
        actor.root.position.x += moveX;
        actor.root.position.y += moveY;
        if (typeof actor.setMoveIntent === "function") {
            actor.setMoveIntent({ x: dx / dist, y: dy / dist });
        }
        return false;
    }

    _switchCamera(step) {
        this.context.cameraManager?.switchRig(step.cameraId);
    }

    _switchMode(step, payload) {
        this.context.scene.gameModeManager.switchMode(step.modeId, payload);
    }

    _setCameraFrame(step) {
        const rig = this.context.scriptedCameraRig;
        if (!rig) {
            console.warn("[SceneSequencer] setCameraFrame: scriptedCameraRig not available");
            return;
        }
        rig.setFrame({
            center: step.center,
            height: step.height,
            orthoWidth: step.orthoWidth,
            zOffset: step.zOffset
        });
    }

    _startCameraBlend(step) {
        const cameraManager = this.context.cameraManager;
        const toRigId = step.to;

        if (!toRigId) {
            console.warn("[SceneSequencer] startCameraBlend missing target rig");
            this._stepState.failed = true;
            return;
        }

        if (!cameraManager?.rigs?.has(toRigId)) {
            console.warn(`[SceneSequencer] startCameraBlend unknown rig: ${toRigId}`);
            this._stepState.failed = true;
            return;
        }

        const { character, rabbleStick } = this.context;
        let frameCtx = null;

        if (toRigId === "duel" && character && rabbleStick) {
            const heroPos = character.root.position;
            const opponentPos = rabbleStick.root.position;
            const centerX = (heroPos.x + opponentPos.x) * 0.5;
            const centerZ = (heroPos.z + opponentPos.z) * 0.5;
            const fighterDistance = Math.abs(opponentPos.x - heroPos.x);
            frameCtx = {
                basePosition: new BABYLON.Vector3(centerX, 8, centerZ - 25),
                target: new BABYLON.Vector3(centerX, 0, centerZ),
                fighterDistance
            };
        } else if (toRigId === "explore" && character) {
            const pos = character.root.position;
            frameCtx = {
                target: new BABYLON.Vector3(pos.x, pos.y, pos.z)
            };
        }

        const ok = cameraManager.startBlend({
            toRigId,
            durationMs: step.durationMs,
            frameCtx
        });

        this._stepState.failed = !ok;
    }
}
