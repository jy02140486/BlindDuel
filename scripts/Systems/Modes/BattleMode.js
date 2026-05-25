import { BaseMode } from "./BaseMode.js";

export class BattleMode extends BaseMode {
    constructor(context) {
        super("battle", context);
    }

    enter(_payload) {
        const { cameraManager } = this.context;
        cameraManager?.switchRig("duel");
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
            combatSystem
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
