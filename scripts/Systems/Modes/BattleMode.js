import { BaseMode } from "./BaseMode.js";
import { FACING_MODE } from "../../Enties/CharacterBase.js";


export class BattleMode extends BaseMode {
    constructor(context) {
        super("battle", context);
    }

    enter(_payload) {
        const { cameraManager, character, rabbleStick } = this.context;
        cameraManager?.switchRig("duel");
        if (character) character.setFacingMode(FACING_MODE.LOCKED);
        if (rabbleStick) rabbleStick.setFacingMode(FACING_MODE.LOCKED);
    }

    exit() {}

    fixedUpdate(dtMs, tickCount) {
        const {
            inputSystem,
            playerController,
            rabbleController,
            character,
            rabbleStick,
            pushboxResolver,
            stageBoundary,
            combatSystem,
            sceneSequencer
        } = this.context;

        inputSystem.fixedUpdate(tickCount);
        playerController.fixedUpdate(dtMs, tickCount);
        rabbleController.fixedUpdate(dtMs, tickCount);
        character.fixedUpdate(dtMs, tickCount);
        rabbleStick.fixedUpdate(dtMs, tickCount);
        pushboxResolver.resolve([character, rabbleStick]);
        stageBoundary.clampCharacter(character);
        stageBoundary.clampCharacter(rabbleStick);
        combatSystem.fixedUpdate([character, rabbleStick], tickCount);

        this.#checkBattleEnd(sceneSequencer);
    }

    #checkBattleEnd(sceneSequencer) {
        if (!sceneSequencer || sceneSequencer.isBusy()) return;

        const { character, rabbleStick } = this.context;

        if (!character.isDead && !rabbleStick.isDead) return;

        const exitBattleSequence = {
            id: "exit_battle",
            durationMs: 8000,
            tracks: [
                {
                    id: "hero.input",
                    kind: "actor",
                    binding: { actorId: "hero" },
                    channel: "input",
                    clips: [
                        { type: "inputLock", atMs: 0, locked: true },
                        { type: "inputLock", atMs: 6100, locked: false }
                    ]
                },
                {
                    id: "hero.command",
                    kind: "actor",
                    binding: { actorId: "hero" },
                    channel: "command",
                    clips: [
                        { type: "command", atMs: 2500, command: "sheath" }
                    ]
                },
                {
                    id: "hero.facing",
                    kind: "actor",
                    binding: { actorId: "hero" },
                    channel: "facing",
                    clips: [
                        { type: "faceWorldX", atMs: 5000, direction: -1 }
                    ]
                },
                {
                    id: "hero.movement",
                    kind: "actor",
                    binding: { actorId: "hero" },
                    channel: "movement",
                    clips: [
                        { type: "moveActorTo", startMs: 5500, durationMs: 2000, x: -7.2, y: 0 }
                    ]
                },
                {
                    id: "camera",
                    kind: "camera",
                    binding: { cameraId: "explore" },
                    channel: "blend",
                    clips: [
                        { type: "cameraBlend", startMs: 1000, durationMs: 5400, to: "explore" }
                    ]
                },
                {
                    id: "mode",
                    kind: "mode",
                    clips: [
                        { type: "switchMode", atMs: 6500, modeId: "explore" }
                    ]
                }
            ]
        };

        sceneSequencer.play(exitBattleSequence);
    }

    updateRender(dtMs) {
        const {
            character,
            rabbleStick,
            cameraManager,
            sceneVisualSystem,
            cameraBasePosition,
            cameraTarget
        } = this.context;
        const cameraRig = cameraManager?.activeRig;
        if (!cameraRig) {
            return;
        }

        const heroPos = character.root.position;
        const opponentPos = rabbleStick.root.position;
        const centerX = (heroPos.x + opponentPos.x) * 0.5;
        const centerZ = (heroPos.z + opponentPos.z) * 0.5;
        const targetHeight = 0;

        const rawDistance = Math.abs(opponentPos.x - heroPos.x);
        const distanceBlend = 1 - Math.exp((-cameraRig.smoothing * dtMs) / 1000);
        const smoothBlend = distanceBlend * distanceBlend * (3 - 2 * distanceBlend);
        this.context.smoothedFighterDistance +=
            (rawDistance - this.context.smoothedFighterDistance) * smoothBlend;

        cameraBasePosition.x = centerX;
        cameraBasePosition.y = targetHeight + 8;
        cameraBasePosition.z = centerZ - 25;
        cameraTarget.x = centerX;
        cameraTarget.y = targetHeight;
        cameraTarget.z = centerZ;

        this.context.basePosition = cameraBasePosition;
        this.context.target = cameraTarget;
        this.context.fighterDistance = this.context.smoothedFighterDistance;

        const cam = cameraManager?.getCamera();
        if (!cam) {
            return;
        }
        console.log(`[BattleMode] cam pos=(${cam.position.x.toFixed(2)}, ${cam.position.y.toFixed(2)}, ${cam.position.z.toFixed(2)}) orthoL=${cam.orthoLeft?.toFixed(2)}`);

        if (sceneVisualSystem) {
            sceneVisualSystem.update(dtMs, { camera: cam });
        }
    }
}
