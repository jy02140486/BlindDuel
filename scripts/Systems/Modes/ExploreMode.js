import { BaseMode } from "./BaseMode.js";

export class ExploreMode extends BaseMode {
    constructor(context) {
        super("explore", context);
        this._cameraTarget = new BABYLON.Vector3();
        this._battleTriggerFired = false;
    }

    fixedUpdate(dtMs, tickCount) {
        const { inputSystem, playerController, character, sceneSequencer } = this.context;

        this.#checkBattleTrigger(character, sceneSequencer);

        if (sceneSequencer?.isBusy()) {
            inputSystem.fixedUpdate(tickCount);
            character.fixedUpdate(dtMs, tickCount);
            return;
        }

        inputSystem.fixedUpdate(tickCount);
        playerController.fixedUpdate(dtMs, tickCount);
        character.fixedUpdate(dtMs, tickCount);
    }

    #checkBattleTrigger(character, sceneSequencer) {
        if (this._battleTriggerFired) {
            return;
        }

        const triggered = this.context.scene.battleTrigger.check(character);
        if (!triggered) {
            return;
        }

        this._battleTriggerFired = true;

        const enterBattleSequence = {
            id: "enter_battle",
            steps: [
                { type: "lockInput", actorId: "hero" },
                { type: "moveActorTo", actorId: "hero", x: -3.2, z: 0, tolerance: 0.1 },
                { type: "sendCommand", actorId: "hero", command: "draw" },
                { type: "waitUntil", condition: (ctx) => ctx.character.currentStateName === "idle" },
                { type: "startCameraBlend", to: "duel", durationMs: 3500 },
                { type: "switchMode", modeId: "battle" },
                { type: "unlockInput", actorId: "hero" }
            ]
        };

        sceneSequencer.play(enterBattleSequence);
    }

    enter(_payload) {
        const { cameraManager, character } = this.context;
        cameraManager?.switchRig("explore");
        if (character) {
            character.allowFacing = true;
        }
    }

    exit() {
        const { character } = this.context;
        if (character) {
            character.allowFacing = false;
        }
    }

    updateRender(dtMs) {
        const { character, cameraManager, sceneVisualSystem } = this.context;
        const pos = character.root.position;

        this._cameraTarget.set(pos.x, pos.y, pos.z);
        this.context.target = this._cameraTarget;

        const activeCamera = cameraManager?.getCamera();
        if (sceneVisualSystem && activeCamera) {
            sceneVisualSystem.update(dtMs, { camera: activeCamera });
        }
    }
}
