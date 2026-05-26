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
                return !this.context.cameraManager?.isBlending();
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

    _startCameraBlend(step) {
        const { character, rabbleStick } = this.context;
        let frameCtx = null;

        if (step.to === "duel" && character && rabbleStick) {
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
        } else if (step.to === "explore" && character) {
            const pos = character.root.position;
            frameCtx = {
                target: new BABYLON.Vector3(pos.x, pos.y, pos.z)
            };
        }

        this.context.cameraManager?.startBlend({
            toRigId: step.to,
            durationMs: step.durationMs,
            frameCtx
        });
    }
}
