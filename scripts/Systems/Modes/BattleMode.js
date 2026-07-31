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

        if (typeof payload?.fighterDistance === "number") {
            this.context.smoothedFighterDistance = payload.fighterDistance;
            console.log(`[BattleMode] enter smoothedFighterDistance=${payload.fighterDistance.toFixed(2)}`);
        }

        if (battleDef) {
            this._battleDef = battleDef;
            this._combatants = battleDef.combatants
                .map(id => actorRegistry?.get(id))
                .filter(Boolean);
        }

        // 设计规范（见 plans/统一时间源与 Render 采样架构设计.MD §6.5）：
        // sequence 期间 rig 切换由 cameraBlend clip 的 endBlend 全权负责，mode.enter 不重复切 rig，
        // 避免 enter 的 switchRig 与 blend 的 switchRig 互相覆盖。非 sequence 直接进战斗时照常 switchRig。
        if (this.context.sceneSequencer?.isBusy?.()) {
            console.log(`[BattleMode] enter during sequence — skip switchRig (cameraBlend clip owns rig switch)`);
        } else {
            cameraManager?.switchRig("duel");
        }

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
            if (combatant) {
                combatant.activeSpeedMode = "move";
            }
        }
    }

    exit() {
        for (const combatant of this._combatants ?? []) {
            if (combatant) {
                combatant._battleYMin = null;
                combatant._battleYMax = null;
                combatant.activeSpeedMode = "walk";
            }
        }
        // 清理 BattleMode 独占的相机上下文，避免跨场景/跨战斗残留：
        // 下一轮 enterBattleSequence 的 2000~3000ms 窗口期（blend 已结束、mode 尚未 switchTo battle）
        // DuelCameraRig.compute 会读 sharedContext，若 fighterDistance/basePosition 为上次战斗残值，
        // 安全网（!basePosition || !target || fighterDistance==null）失效，镜头会朝主人公漂移缩放。
        // 触发路径：战败 defeatSequence → restoreCheckpoint 显式调 currentMode.exit()（见 Game.restoreCheckpoint）
        this.context.basePosition = null;
        this.context.target = null;
        this.context.fighterDistance = null;
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

        // 优先使用 sceneDef 中内联的 exitBattleSequence（数据驱动）；否则 fallback 到 battleDef.exitSequence
        const inlineExitSeq = this.context.sceneDef?.exitBattleSequence;
        const exitBattleSequence = inlineExitSeq
            ? JSON.parse(JSON.stringify(inlineExitSeq))
            : (this._battleDef?.exitSequence ?? {
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
            });

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
                // 胜利后存档：战场位置不安全（可能被其他系统假设为已清理），
                // 不传 useHeroPos，重置时 fallback 到 spawnId 对应点
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
        // console.log(`[BattleMode] cam pos=(${cam.position.x.toFixed(2)}, ${cam.position.y.toFixed(2)}, ${cam.position.z.toFixed(2)}) orthoL=${cam.orthoLeft?.toFixed(2)}`);

        if (sceneVisualSystem) {
            sceneVisualSystem.update(dtMs, { camera: cam });
        }
    }
}
