import { BaseMode } from "./BaseMode.js";
import { FACING_MODE } from "../../Enties/CharacterBase.js";
import { STEP_TYPE } from "../SceneSequencer.js";


export class BattleMode extends BaseMode {
    constructor(context) {
        super("battle", context);
    }

    enter(payload) {
        const { cameraManager, actorRegistry } = this.context;
        const battleDef = payload?.battleDef;

        if (battleDef) {
            this._battleDef = battleDef;
            this._combatants = battleDef.combatants
                .map(id => actorRegistry?.get(id))
                .filter(Boolean);
        }

        cameraManager?.switchRig("duel");

        const { stageBoundary } = this.context;
        if (stageBoundary && this._battleDef?.stageBounds) {
            stageBoundary.setBounds(this._battleDef.stageBounds);
        }

        const stageBounds = this._battleDef?.stageBounds;
        for (const combatant of this._combatants ?? []) {
            if (combatant?.setFacingMode) {
                combatant.setFacingMode(FACING_MODE.LOCKED);
            }
            if (stageBounds && combatant) {
                combatant._battleYMin = stageBounds.minY ?? null;
                combatant._battleYMax = stageBounds.maxY ?? null;
            }
        }
    }

    exit() {
        for (const combatant of this._combatants ?? []) {
            if (combatant) {
                combatant._battleYMin = null;
                combatant._battleYMax = null;
            }
        }
    }

    fixedUpdate(dtMs, tickCount) {
        const {
            inputSystem,
            playerController,
            rabbleController,
            pushboxResolver,
            stageBoundary,
            combatSystem,
            sceneSequencer
        } = this.context;

        const combatants = this._combatants ?? [];
        const character = combatants[0];
        const opponent = combatants[1];

        inputSystem.fixedUpdate(tickCount);
        playerController.fixedUpdate(dtMs, tickCount);
        rabbleController.fixedUpdate(dtMs, tickCount);

        for (const c of combatants) {
            c.fixedUpdate(dtMs, tickCount);
        }

        pushboxResolver.resolve(combatants);

        for (const c of combatants) {
            stageBoundary.clampCharacter(c, dtMs);
        }

        combatSystem.fixedUpdate(combatants, tickCount);

        this.#checkBattleEnd(sceneSequencer);
    }

    #checkBattleEnd(sceneSequencer) {
        if (!sceneSequencer || sceneSequencer.isBusy()) return;

        const combatants = this._combatants ?? [];
        if (combatants.length < 2) return;

        const [character, rabbleStick] = combatants;

        if (!character.isDead && !rabbleStick.isDead) return;

        if (character.isDead) {
            this.#handleDefeat(sceneSequencer);
            return;
        }

        // 如果 battleDef 未定义 exitSequence，使用最小默认退场序列保证不会卡死
        const exitBattleSequence = this._battleDef?.exitSequence ?? {
            id: "exit_battle_fallback",
            durationMs: 1000,
            tracks: [
                {
                    id: "camera",
                    kind: "camera",
                    binding: { cameraId: "explore" },
                    channel: "blend",
                    clips: [
                        { type: "cameraBlend", startMs: 0, durationMs: 800, to: "explore" }
                    ]
                },
                {
                    id: "mode",
                    kind: "mode",
                    clips: [
                        { type: "switchMode", atMs: 800, modeId: "explore" }
                    ]
                }
            ]
        };

        const { questManager } = this.context;
        if (questManager && this._battleDef?.onVictory) {
            const v = this._battleDef.onVictory;
            if (v.scenario) questManager.advanceTo(v.scenario);
            for (const flag of v.flags ?? []) {
                questManager.setFlag(flag, true);
            }
            for (const q of v.questStages ?? []) {
                questManager.setQuestStage(q.id, q.stage);
            }
        }

        if (rabbleStick.isDead) {
            const { game, sceneDef } = this.context;
            if (game) {
                const spawnId = Object.keys(sceneDef.spawns)[0] ?? "house_door";
                game.saveCheckpoint(sceneDef.id, spawnId);
            }
        }

        sceneSequencer.play(exitBattleSequence);
    }

    #handleDefeat(sceneSequencer) {
        const defeatSequence = {
            id: "defeat",
            steps: [
                { type: STEP_TYPE.LOCK_INPUT, actorId: "hero" },
                { type: STEP_TYPE.WAIT, durationMs: 2500 },
                { type: STEP_TYPE.CALLBACK, fn: (ctx) => ctx.game?.restoreCheckpoint() },
            ]
        };
        sceneSequencer.play(defeatSequence);
    }

    updateRender(dtMs) {
        const {
            cameraManager,
            sceneVisualSystem,
            cameraBasePosition,
            cameraTarget
        } = this.context;
        const cameraRig = cameraManager?.activeRig;
        if (!cameraRig) {
            return;
        }

        const combatants = this._combatants ?? [];
        if (combatants.length < 2) return;

        const heroPos = combatants[0].root.position;
        const opponentPos = combatants[1].root.position;
        const centerX = (heroPos.x + opponentPos.x) * 0.5;
        const centerZ = (heroPos.z + opponentPos.z) * 0.5;
        const targetHeight = this._battleDef?.battleYBaseline ?? 0;

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
