import { BaseMode } from "./BaseMode.js";
import { ExploreCollisionSystem } from "../ExploreCollisionSystem.js";

export class ExploreMode extends BaseMode {
    constructor(context) {
        super("explore", context);
        this._cameraTarget = new BABYLON.Vector3();
        this._battleTriggerFired = false;
        this.dynamicActors = [];
        this.staticBlockers = [];
        this.interactables = [];
        this.renderables = [];
        this._collisionSystem = new ExploreCollisionSystem();
    }

    fixedUpdate(dtMs, tickCount) {
        const { inputSystem, playerController, character, npc, npcController, sceneSequencer } = this.context;

        this.#checkBattleTrigger(character, sceneSequencer);

        if (sceneSequencer?.isBusy()) {
            inputSystem.fixedUpdate(tickCount);
            character.fixedUpdate(dtMs, tickCount);
            return;
        }

        inputSystem.fixedUpdate(tickCount);
        playerController.fixedUpdate(dtMs, tickCount);
        character.fixedUpdate(dtMs, tickCount);

        if (npc && npcController) {
            npc.fixedUpdate(dtMs, tickCount);
            npcController.update(dtMs, npc, { player: character });
        }

        this._collisionSystem.resolveMovement(character, this.staticBlockers, this.context.walkArea);

        this.#checkInteraction(character, tickCount);
    }

    #checkInteraction(character, tickCount) {
        const { inputSystem, npcController, npc } = this.context;
        if (!npc || !npcController) return;

        if (npcController.state === "ask") return;

        if (!inputSystem.consumeAction("interact", tickCount)) return;

        const dx = character.root.position.x - npc.root.position.x;
        const dy = character.root.position.y - npc.root.position.y;
        const distSq = dx * dx + dy * dy;
        const interactRadius = npcController.greetingRadius ?? 1.6;
        if (distSq <= interactRadius * interactRadius) {
            npcController.enterAsk(npc);
        }
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
                { type: "moveActorTo", actorId: "hero", x: -3.2, y: 0, tolerance: 0.1 },
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
        this._buildIndices();
        this._collisionSystem.createDebugMeshes(this.staticBlockers, this.context.babylonScene, this.dynamicActors);
    }

    exit() {
        const { character } = this.context;
        if (character) {
            character.allowFacing = false;
        }
        this._collisionSystem.disposeDebugMeshes();
    }

    _buildIndices() {
        const { entityPool } = this.context;
        if (!entityPool) return;

        this.dynamicActors.length = 0;
        this.staticBlockers.length = 0;
        this.interactables.length = 0;
        this.renderables.length = 0;

        for (const entity of entityPool) {
            if (entity.kind === "player") {
                this.dynamicActors.push(entity);
            }
            if (entity.kind === "npc" && entity.blocksMovement) {
                this.staticBlockers.push(entity);
            }
            if (entity.kind === "npc" && entity.interactable) {
                this.interactables.push(entity);
            }
            if (entity.spritePlane) {
                this.renderables.push(entity);
            }
        }
    }

    updateRender(dtMs) {
        const { character, cameraManager, sceneVisualSystem } = this.context;
        const pos = character.root.position;

        this._cameraTarget.set(pos.x, pos.y, pos.z);
        this.context.target = this._cameraTarget;

        for (const entity of this.renderables) {
            if (entity.spritePlane) {
                entity.spritePlane.alphaIndex = 100 - entity.root.position.y;
            }
        }

        const activeCamera = cameraManager?.getCamera();
        if (sceneVisualSystem && activeCamera) {
            sceneVisualSystem.update(dtMs, { camera: activeCamera });
        }

        this._collisionSystem.updateDebugMeshes(this.staticBlockers, this.context.babylonScene, this.dynamicActors);
    }
}
