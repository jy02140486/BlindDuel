import { BaseMode } from "./BaseMode.js";
import { ExploreCollisionSystem } from "../ExploreCollisionSystem.js";
import { FACING_MODE } from "../../Enties/CharacterBase.js";


export class ExploreMode extends BaseMode {
    constructor(context) {
        super("explore", context);
        this._cameraTarget = new BABYLON.Vector3();
        this._battleTriggerFired = false;
        this._scriptedCameraTriggerFired = false;
        this.dynamicActors = [];
        this.staticBlockers = [];
        this.interactables = [];
        this.renderables = [];
        this._collisionSystem = new ExploreCollisionSystem();
    }

    fixedUpdate(dtMs, tickCount) {
        const { inputSystem, playerController, character, sceneSequencer } = this.context;

        this.#checkBattleTrigger(character, sceneSequencer);
        this.#checkScriptedCameraTrigger(character, sceneSequencer);

        if (sceneSequencer?.isBusy()) {
            inputSystem.fixedUpdate(tickCount);
            character.fixedUpdate(dtMs, tickCount);
            return;
        }

        inputSystem.fixedUpdate(tickCount);
        playerController.fixedUpdate(dtMs, tickCount);
        character.fixedUpdate(dtMs, tickCount);

        for (const npc of this.interactables) {
            npc.fixedUpdate(dtMs, tickCount);
            const controller = npc.npcController;
            if (controller) {
                controller.update(dtMs, npc, { player: character });
            }
        }

        this._collisionSystem.resolveMovement(character, this.staticBlockers, this.context.walkArea);

        this.#checkInteraction(character, tickCount);
    }

    #checkInteraction(character, tickCount) {
        const { inputSystem } = this.context;

        if (!inputSystem.consumeAction("interact", tickCount)) return;

        for (const npc of this.interactables) {
            const controller = npc.npcController;
            if (!controller || controller.state === "ask") continue;

            const dx = character.root.position.x - npc.root.position.x;
            const dy = character.root.position.y - npc.root.position.y;
            const distSq = dx * dx + dy * dy;
            const interactRadius = controller.greetingRadius ?? 1.6;
            if (distSq <= interactRadius * interactRadius) {
                controller.enterAsk(npc);
            }
        }
    }

    #checkBattleTrigger(character, sceneSequencer) {
        if (this._battleTriggerFired) {
            return;
        }

        const battleTriggers = this.context.sceneDef?.triggers?.filter(t => t.type === "battle") ?? [];
        let pendingBattleDef = null;
        for (const triggerDef of battleTriggers) {
            const trigger = this.context.scene.triggers.get(triggerDef.id);
            if (trigger && trigger.check(character)) {
                this._battleTriggerFired = true;
                pendingBattleDef = this.context.battleDefs?.[triggerDef.battleId];
                break;
            }
        }
        if (!this._battleTriggerFired || !pendingBattleDef) return;

        const enterBattleSequence = {
            id: "enter_battle",
            durationMs: 6400,
            tracks: [
                {
                    id: "hero.input",
                    kind: "actor",
                    binding: { actorId: "hero" },
                    channel: "input",
                    clips: [
                        { type: "inputLock", atMs: 0, locked: true },
                        { type: "inputLock", atMs: 6400, locked: false }
                    ]
                },
                {
                    id: "hero.movement",
                    kind: "actor",
                    binding: { actorId: "hero" },
                    channel: "movement",
                    clips: [
                        { type: "moveActorTo", startMs: 0, durationMs: 3000, x: -3.2, y: 0 }
                    ]
                },
                {
                    id: "hero.command",
                    kind: "actor",
                    binding: { actorId: "hero" },
                    channel: "command",
                    clips: [
                        { type: "command", atMs: 3500, command: "draw" }
                    ]
                },
                {
                    id: "camera",
                    kind: "camera",
                    binding: { cameraId: "duel" },
                    channel: "blend",
                    clips: [
                        { type: "cameraBlend", startMs: 2900, durationMs: 3500, to: "duel" }
                    ]
                },
                {
                    id: "mode",
                    kind: "mode",
                    clips: [
                        { type: "switchMode", atMs: 6400, modeId: "battle", payload: { battleDef: pendingBattleDef } }
                    ]
                }
            ]
        };

        sceneSequencer.play(enterBattleSequence);
    }

    #checkScriptedCameraTrigger(character, sceneSequencer) {
        if (this._scriptedCameraTriggerFired) {
            return;
        }

        const trigger = this.context.scene.scriptedCameraTrigger;
        if (!trigger) {
            return;
        }

        const triggered = trigger.check(character);
        if (!triggered) {
            return;
        }

        this._scriptedCameraTriggerFired = true;

        const testSequence = {
            id: "test_timeline_scripted_camera",
            durationMs: 6000,
            tracks: [
                {
                    id: "hero.input",
                    kind: "actor",
                    binding: { actorId: "hero" },
                    channel: "input",
                    clips: [
                        { type: "inputLock", atMs: 0, locked: true },
                        { type: "inputLock", atMs: 5500, locked: false }
                    ]
                },
                {
                    id: "hero.movement",
                    kind: "actor",
                    binding: { actorId: "hero" },
                    channel: "movement",
                    clips: [
                        { type: "moveActorTo", startMs: 0, durationMs: 2000, x: -16, y: 0.6 }
                    ]
                },
                {
                    id: "camera.frame",
                    kind: "camera",
                    binding: { cameraId: "scripted" },
                    channel: "frame",
                    clips: [
                        { type: "setCameraFrame", atMs: 0, center: [-16, -1.5, 0], height: 4.2, orthoWidth: 18 }
                    ]
                },
                {
                    id: "camera.blend",
                    kind: "camera",
                    binding: { cameraId: "scripted" },
                    channel: "blend",
                    clips: [
                        { type: "cameraBlend", startMs: 0, durationMs: 0, to: "scripted" },
                        { type: "cameraBlend", startMs: 4000, durationMs: 1200, to: "explore" }
                    ]
                },
                {
                    id: "camera.fx",
                    kind: "camera",
                    channel: "fx",
                    clips: [
                        { type: "cameraEffect", atMs: 0, effect: "letterbox", durationMs: 5000, height: 72, speed: 240 },
                        { type: "cameraEffect", atMs: 200, effect: "fade", durationMs: 300, color: "black", from: 1, to: 0 },
                        { type: "cameraEffect", atMs: 800, effect: "shake", durationMs: 220, amplitude: 0.22 },
                        { type: "cameraEffect", atMs: 800, effect: "flash", durationMs: 120, color: "white" }
                    ]
                }
            ]
        };

        sceneSequencer.play(testSequence);
    }

    enter(_payload) {
        const { cameraManager, character } = this.context;
        cameraManager?.switchRig("explore");
        if (character) {
            character.setFacingMode(FACING_MODE.AUTO_FROM_MOVE);
        }
        this._buildIndices();
        this._collisionSystem.createDebugMeshes(this.staticBlockers, this.context.babylonScene, this.dynamicActors);
    }

    exit() {
        const { character } = this.context;
        if (character) {
            character.setFacingMode(FACING_MODE.LOCKED);
        }
        this._collisionSystem.disposeDebugMeshes();
    }

    _buildIndices() {
        const { entityPool, stageMaskData } = this.context;
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

        // --- StageMask pushbox 作为静态障碍物 ---
        if (stageMaskData && stageMaskData.masks) {
            for (const mask of stageMaskData.masks) {
                const pb = mask.pushbox;
                if (!pb) continue;
                this.staticBlockers.push({
                    _maskId: mask.id,
                    getBlockerAabb: () => ({
                        minX: pb.x,
                        maxX: pb.x + pb.w,
                        minY: pb.y,
                        maxY: pb.y + pb.h,
                    })
                });
            }
        }
    }

    updateRender(dtMs) {
        const { character, cameraManager, sceneVisualSystem, sceneSequencer } = this.context;
        const pos = character.root.position;

        this._cameraTarget.set(pos.x, pos.y, pos.z);
        this.context.target = this._cameraTarget;

        if (sceneSequencer?.isBusy()) {
            console.log(`[ExploreMode] updateRender during sequence — context.target set to char pos=(${pos.x.toFixed(2)},${pos.y.toFixed(2)},${pos.z.toFixed(2)}) activeRig=${cameraManager?.activeRigId}`);
        }

        for (const entity of this.renderables) {
            if (entity.spritePlane) {
                entity.spritePlane.alphaIndex = 100 - entity.root.position.y;
            }
        }

        const activeCamera = cameraManager?.getCamera();
        if (sceneVisualSystem && activeCamera) {
            const characterPositions = this.renderables
                .filter(e => e.root)
                .map(e => ({ x: e.root.position.x, y: e.root.position.y }));
            sceneVisualSystem.update(dtMs, { camera: activeCamera, characterPositions });
        }

        this._collisionSystem.updateDebugMeshes(this.staticBlockers, this.context.babylonScene, this.dynamicActors);

        // 所有角色渲染完成后关闭 stencil，避免影响后续渲染组（前景、UI 等）
        const engine = this.context.babylonScene?.getEngine();
        const gl = engine?._gl;
        if (gl) {
            gl.disable(gl.STENCIL_TEST);
        }
    }
}