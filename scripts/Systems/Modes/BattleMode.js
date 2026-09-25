import { BaseMode } from "./BaseMode.js";
import { FACING_MODE } from "../../Enties/CharacterBase.js";
import { STEP_TYPE } from "../SceneSequencer.js";
import { ProjectileManager } from "../ProjectileManager.js";


export class BattleMode extends BaseMode {
    constructor(context) {
        super("battle", context);
    }

    enter(payload) {
        const { cameraManager, actorRegistry } = this.context;
        const battleDef = payload?.battleDef;

        if (typeof payload?.fighterDistance === "number") {
            this.context.smoothedFighterDistance = payload.fighterDistance;
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

        // ProjectileManager lifecycle — owned by BattleMode since projectiles are battle-scope.
        // Scene provides Babylon scene + entityPool for render interpolation.
        this._projectileManager = new ProjectileManager({
            scene: this.context.scene?.scene ?? null,
            entityPool: this.context.scene?.entityPool ?? null
        });

        // Subscribe to throw animation events — Phase 3b wireup.
        // throw_draw (frame 1): create carried sprite (dagger in hand)
        // throw_release (frame 2): dispose carried sprite + spawn real projectile
        this._carriedSprites = new Map();  // throwerId → { plane, texture, material }
        const bus = this.context.animationEventBus;
        if (bus) {
            this._throwDrawHandler = (payload) => this.#onThrowDraw(payload);
            this._throwReleaseHandler = (payload) => this.#onThrowRelease(payload);
            bus.subscribe("throw_draw", this._throwDrawHandler);
            bus.subscribe("throw_release", this._throwReleaseHandler);
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
        this.context.pendingBattleDef = null;

        // Clean up all projectiles when battle ends — avoid Babylon resource leaks
        // and prevent projectiles from carrying over to explore mode.
        if (this._projectileManager) {
            this._projectileManager.clearAll();
            this._projectileManager = null;
        }

        // Unsubscribe throw handlers + cleanup any lingering carried sprites
        const bus = this.context.animationEventBus;
        if (bus && this._throwDrawHandler) {
            bus.unsubscribe("throw_draw", this._throwDrawHandler);
            this._throwDrawHandler = null;
        }
        if (bus && this._throwReleaseHandler) {
            bus.unsubscribe("throw_release", this._throwReleaseHandler);
            this._throwReleaseHandler = null;
        }
        this.#disposeAllCarriedSprites();
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

        // Sync carried sprites (daggers in hand) — AFTER character update so hand anchors are fresh
        this.#updateCarriedSprites();

        pushboxResolver.resolve(combatants);

        for (const c of combatants) {
            stageBoundary.clampCharacter(c, dtMs);
        }

        // Projectile motion integration — AFTER character movement/clamp so projectiles
        // start at correct positions, BEFORE combat resolve so resolvers see updated positions.
        this._projectileManager?.fixedUpdate(dtMs, tickCount);

        const activeProjectiles = this._projectileManager?.getActiveProjectiles() ?? [];
        combatSystem.fixedUpdate(combatants, tickCount, {
            boundary: stageBoundary,
            projectiles: activeProjectiles,
            projectileManager: this._projectileManager
        });

        // post-combat clamp — 保险，防止 knockback / freezeImpact 后任何漏网位移推出边界
        for (const c of combatants) {
            stageBoundary.clampCharacter(c, dtMs);
        }

        // Flush destroyed projectiles AFTER all resolve + post-clamp, so CombatSystem effects
        // (hit/projectile_destroy) can still reference them.
        this._projectileManager?.flushDestroyed();

        this.#checkBattleEnd(sceneSequencer);
    }

    /**
     * Handle throw_draw animation event — create a carried sprite (dagger in hand) on frame 1.
     * Pure visual — no physics, no collision. Follows hand anchor each frame.
     */
    #onThrowDraw(payload) {
        const thrower = payload?.source;
        if (!thrower || !this._projectileManager) return;
        if ((this._combatants ?? []).includes(thrower) === false) return;
        if (this._carriedSprites.has(thrower.id)) return;

        const scene = this.context.scene?.scene;
        if (!scene) return;

        // Build matching Projectile sprite pattern:
        // root TransformNode (world space) → plane (local offset, bottom-anchored)
        const pxToWorld = thrower.pxToWorld;
        const frameW = 32, frameH = 6;
        const planeW = frameW * pxToWorld;
        const planeH = frameH * pxToWorld;

        const root = new BABYLON.TransformNode(`carried_${thrower.id}_root`, scene);

        const plane = BABYLON.MeshBuilder.CreatePlane(
            `carried_${thrower.id}_plane`,
            { width: planeW, height: planeH },
            scene
        );
        plane.parent = root;
        plane.position.y = planeH / 2;  // anchor at bottom of plane (same as Projectile)
        plane.position.z = -0.02;
        plane.renderingGroupId = 1;
        // alphaIndex = 9000: renders AFTER all props/characters (alphaIndex=0)
        // but BEFORE depthMask (alphaIndex=10000) so stencil occlusion still works.
        // This ensures carried sprite always appears on top of furniture.
        plane.alphaIndex = 9000;

        const material = new BABYLON.StandardMaterial(`carried_${thrower.id}_mat`, scene);
        material.emissiveColor = new BABYLON.Color3(1, 1, 1);
        material.backFaceCulling = false;
        material.useAlphaFromDiffuseTexture = true;
        material.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
        material.disableLighting = true;
        material.disableDepthWrite = true;
        plane.material = material;

        const texture = new BABYLON.Texture(
            "./Art/Sprite/projectiles/proj_dagger.png", scene,
            false, false, BABYLON.Texture.NEAREST_SAMPLINGMODE
        );
        texture.hasAlpha = true;
        material.diffuseTexture = texture;

        // Store
        this._carriedSprites.set(thrower.id, { root, plane, material, texture, thrower });

        // Initial position
        const hand = thrower.getHandAnchorWorld();
            if (hand) {
                // Force carried root.z slightly in front of thrower — avoids occlussion
                // by scene props at same depth layer (table, etc.)
                const frontZ = thrower.root.position.z + 0.05;
                root.position.set(hand.x, hand.y, frontZ);
            } else {
            console.warn("[BattleMode] throw_draw but no hand anchor on frame",
                thrower.animation.currentFrameIndex, "— root at origin");
        }
    }

    /**
     * Sync all carried sprite positions to their thrower's current hand anchor.
     * Called once per fixedUpdate AFTER character.fixedUpdate so hand anchors are fresh.
     */
    #updateCarriedSprites() {
        for (const [id, entry] of this._carriedSprites) {
            const thrower = entry.thrower;
            if (!thrower || thrower.isDisposed || !thrower.root || !entry.root) {
                this.#disposeCarriedSprite(id);
                continue;
            }
            const hand = thrower.getHandAnchorWorld();
            if (hand) {
                // Keep carried sprite slightly in front of thrower to avoid prop occlusion
                const frontZ = thrower.root.position.z + 0.05;
                entry.root.position.set(hand.x, hand.y, frontZ);
            }
        }
    }

    #disposeCarriedSprite(throwerId) {
        const entry = this._carriedSprites.get(throwerId);
        if (!entry) return;
        try {
            entry.texture?.dispose?.();
            entry.material?.dispose?.();
            entry.plane?.dispose?.();
            entry.root?.dispose?.();
        } catch (e) {
            console.warn("[BattleMode] dispose carried sprite error", e);
        }
        this._carriedSprites.delete(throwerId);
    }

    #disposeAllCarriedSprites() {
        for (const id of Array.from(this._carriedSprites.keys())) {
            this.#disposeCarriedSprite(id);
        }
    }

    /**
     * Handle throw_release animation event — spawn a Projectile from the throwing character's hand.
     * Payload: { type: "throw_release", clipName, frame, source: CombatCharacter, ... }
     */
    #onThrowRelease(payload) {
        const thrower = payload?.source;
        if (!thrower || !this._projectileManager) return;

        // Only handle throw_release from combatants in THIS battle
        const combatants = this._combatants ?? [];
        if (!combatants.includes(thrower)) return;

        // Dispose carried sprite FIRST — dagger leaves hand
        this.#disposeCarriedSprite(thrower.id);

        // Get hand anchor world position — falls through if hand not marked on this frame
        const handWorld = thrower.getHandAnchorWorld();
        if (!handWorld) {
            console.warn("[BattleMode] throw_release but no hand anchor on current frame — skip spawn");
            return;
        }

        // Find opponent to determine throw direction
        const opponent = combatants.find(c => c !== thrower);
        const dirX = opponent
            ? Math.sign(opponent.root.position.x - thrower.root.position.x)
            : 1;  // default facing right

        // v1: hardcoded dagger projectile config
        // velocity.x = constant horizontal speed, arcHeight = handY above,
        // groundY = thrower floor level, gravity = determines time-of-flight naturally
        this._projectileManager.spawn({
            ownerId: thrower.id,
            teamId: thrower.kind === "player" ? "hero" : "enemy",
            startPos: { x: handWorld.x, y: handWorld.y },
            groundY: thrower.root.position.y,  // floor level — lands here
            velocity: { x: dirX * 6, y: 1 },
            pxToWorld: thrower.pxToWorld,
            frame: { w: 32, h: 6 },
            sourceSize: { w: 32, h: 6 },
            spriteUrl: "./Art/Sprite/projectiles/proj_dagger.png",
            cuttable: true,
            damage: 1,
            lifetimeMs: 4000,
            arcHeight: 1.5,  // peak 1.5 world units above hand
            gravity: 4      // world units/s²
        });
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
                { type: STEP_TYPE.WAIT, durationMs: 1000 },
                { type: STEP_TYPE.CAMERA_EFFECT, effect: "fade", durationMs: 800, color: "black", from: 0, to: 1 },
                { type: STEP_TYPE.WAIT, durationMs: 2000 },
                // 注意：CALLBACK step 不 await async fn（见 SceneSequencer._startCurrentStep）。
                // restoreCheckpoint 是 fire-and-forget，必须作为 sequence 最后一步，
                // 否则后续 step 会在 await requestSceneSwitch 期间执行（old scene 正在 dispose）。
                { type: STEP_TYPE.CALLBACK, fn: (ctx) => {
                    const p = ctx.game?.restoreCheckpoint({ fadeInAfter: true });
                    if (p && typeof p.catch === "function") {
                        p.catch(err => console.error("[BattleMode] restoreCheckpoint failed", err));
                    }
                } },
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
