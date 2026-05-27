import { CharacterBase } from "./CharacterBase.js";
import { FrameAnimationComponent } from "../Components/FrameAnimationComponent.js";
import { CollisionComponent } from "../Components/CollisionComponent.js";
import { TimeControlComponent } from "../Components/TimeControlComponent.js";
import { TimeControlSystem } from "../Systems/TimeControlSystem.js";

export class CombatCharacter extends CharacterBase {
    constructor(scene, config) {
        const animation = new FrameAnimationComponent(config.clips);

        const colliderClips = {};
        for (const [clipName, clipDef] of Object.entries(config.clips)) {
            colliderClips[clipName] = clipDef.colliderData;
        }
        const collision = new CollisionComponent(
            scene,
            null,
            colliderClips,
            {
                pxToWorld: config.pxToWorld ?? 0.02,
                thicknessPx: config.collisionThicknessPx ?? 40,
                visible: config.showCollision ?? true
            }
        );

        config._animation = animation;
        config._collision = collision;

        super(scene, config);

        this.collision.rootNode = this.root;
        for (const mesh of this.collision.debugMeshesById.values()) {
            mesh.parent = this.root;
        }

        this.combat = {
            globalCooldownMs: config.globalCooldownMs ?? 700,
            lastActionTime: -Infinity,
            timeControl: new TimeControlComponent(),
            timeControlSystem: new TimeControlSystem()
        };
    }

    _getCurrentRootAnchor(frameIndex) {
        const colliderClip = this.config.clips?.[this.animation.currentClipName]?.colliderData;
        return colliderClip?.frames?.[frameIndex]?.anchors?.root ?? null;
    }

    _getStateTimeScale(stateDef) {
        return this.hasTag("parryBonus")
            ? (stateDef.parryTimeScale ?? stateDef.timeScale ?? 1.0)
            : (stateDef.timeScale ?? 1.0);
    }

    _matchesTransitionCondition(condition) {
        if (condition.command) {
            const canAct = this.canAct();
            const hasCmd = this.pendingCommands.includes(condition.command);
            if (!canAct) {
                return false;
            }
            return hasCmd;
        }

        return super._matchesTransitionCondition(condition);
    }

    _updateDebugPanel() {
        if (!this.debugPanel) return;

        const canvas = this.scene.getEngine().getRenderingCanvas();
        if (!canvas) return;

        const worldPos = this.root.position.clone();
        worldPos.y -= 0.3;

        const projected = BABYLON.Vector3.Project(
            worldPos,
            BABYLON.Matrix.Identity(),
            this.scene.getTransformMatrix(),
            this.scene.activeCamera.viewport.toGlobal(canvas.width, canvas.height)
        );

        if (projected.z > 0 && projected.z < 1) {
            this.debugPanel.style.display = "block";
            this.debugPanel.style.left = `${projected.x - this.debugPanel.offsetWidth / 2}px`;
            this.debugPanel.style.top = `${projected.y}px`;
        } else {
            this.debugPanel.style.display = "none";
        }

        const moveSpeed = this.currentSpd;
        const currentState = this.currentStateName || "unknown";
        const currentClip = this.animation.currentClipName || "none";
        const cdRemaining = this.getCooldownRemaining().toFixed(0);

        this.debugPanel.textContent = `State: ${currentState} | Clip: ${currentClip} | Speed: ${moveSpeed.toFixed(2)} | CD: ${cdRemaining}ms`;
    }

    get globalCooldownMs() { return this.combat.globalCooldownMs; }
    set globalCooldownMs(v) { this.combat.globalCooldownMs = v; }
    get lastActionTime() { return this.combat.lastActionTime; }
    set lastActionTime(v) { this.combat.lastActionTime = v; }
    get timeControl() { return this.combat.timeControl; }
    set timeControl(v) { this.combat.timeControl = v; }
    get timeControlSystem() { return this.combat.timeControlSystem; }
    set timeControlSystem(v) { this.combat.timeControlSystem = v; }

    canAct() {
        const now = performance.now();
        return now - this.lastActionTime >= this.globalCooldownMs;
    }

    getCooldownRemaining() {
        const now = performance.now();
        const remaining = this.globalCooldownMs - (now - this.lastActionTime);
        return Math.max(0, remaining);
    }

    triggerCooldown() {
        this.lastActionTime = performance.now();
    }

    takeDamage(ctx = {}) {
        if (this.currentStateDef?.invincible) {
            return false;
        }

        const knockbackX = Number(ctx.knockbackX ?? 0);
        if (knockbackX !== 0) {
            this.root.position.x += knockbackX;
        }

        const hitState = ctx.hitState || "hit";
        if (!this.hasState(hitState)) {
            return false;
        }

        if (this.currentStateName !== hitState) {
            this.enterState(hitState);
        }

        return true;
    }

    getCombatSnapshot() {
        const clipName = this.animation.currentClipName;
        const clipDef = this.config?.clips?.[clipName];
        const colliderClip = clipDef?.colliderData;
        const frameIndex = this.animation.currentFrameIndex;
        const animationFrame = this.animation.currentFrame;
        const colliderFrame = colliderClip?.frames?.[frameIndex];
        const boxes = colliderFrame?.boxes ?? [];
        const frameWidth = animationFrame?.w ?? colliderFrame?.frameRect?.w ?? 0;
        const frameHeight = animationFrame?.h ?? colliderFrame?.frameRect?.h ?? 0;
        const anchor = colliderFrame?.anchors?.root ?? null;
        const anchorOffsetX = anchor ? (anchor.cx - frameWidth / 2) * this.pxToWorld : 0;
        const anchorOffsetY = anchor ? (frameHeight / 2 - anchor.cy) * this.pxToWorld : 0;
        const hasWeapon = boxes.some((box) => box.type === "weaponbox");
        const isAttackState = this.currentStateDef?.attackActive === true;
        const attackInstanceId = (isAttackState && hasWeapon)
            ? `${this.id}:${this.currentStateName}:${this.stateEntrySerial}`
            : null;

        const attackActiveFrames = this.currentStateDef?.attackActiveFrames;
        const isActiveAttackFrame = isAttackState && hasWeapon &&
            (attackActiveFrames === undefined || attackActiveFrames.includes(frameIndex));

        const isInvincible = this.currentStateDef?.invincible === true;
        const worldBoxes = boxes
            .filter((box) => !(isInvincible && box.type === "hitbox"))
            .map((box) => {
                const localX = (box.cx - frameWidth / 2) * this.pxToWorld - anchorOffsetX;
                const localY = (frameHeight / 2 - box.cy) * this.pxToWorld - anchorOffsetY;
                const widthWorld = box.w * this.pxToWorld;
                const heightWorld = box.h * this.pxToWorld;
                const depthWorld = this.thicknessPx * this.pxToWorld;

                return {
                    id: box.id,
                    type: box.type,
                    subtype: box.subtype ?? null,
                    attackInstanceId: box.type === "weaponbox" ? attackInstanceId : null,
                    weaponRole: box.type === "weaponbox"
                        ? (isActiveAttackFrame ? "offense" : "guard")
                        : null,
                    canParry: box.type === "weaponbox" && this.currentStateDef?.guardActive === true,
                    center: {
                        x: this.root.position.x + localX,
                        y: this.root.position.y + localY,
                        z: this.root.position.z
                    },
                    half: {
                        x: widthWorld / 2,
                        y: heightWorld / 2,
                        z: depthWorld / 2
                    },
                    angle: box.angle ?? 0
                };
            });

        return {
            characterId: this.id,
            stateName: this.currentStateName,
            frameIndex: this.animation.currentFrameIndex,
            rootPositionX: this.root.position.x,
            attackInstanceId,
            stateEnterTick: this.stateEnterTick,
            boxes: worldBoxes
        };
    }

    setMoveIntent(intent) {
        super.setMoveIntent(intent);
    }

    applyHitstop(frames) {
        this.timeControlSystem.applyHitstop(this, frames);
    }

    applyBlockstun(frames) {
        this.timeControlSystem.applyBlockstun(this, frames);
    }

    freezeImpact(durationFrames, options = {}) {
        this.timeControlSystem.freezeImpact(this, durationFrames, {
            ...options,
            startTick: this.tickCount
        });
    }

    get impactContext() {
        return this.timeControl.impactContext;
    }

    get hitstopFrames() {
        return this.timeControl.hitstopFrames;
    }

    get blockstunFrames() {
        return this.timeControl.blockstunFrames;
    }

    get hitstunFrames() {
        return this.timeControl.hitstunFrames;
    }

    fixedUpdate(dtMs, tickCount) {
        this.tickCount = tickCount;

        const timeControlFrame = this.timeControlSystem.tick(this, dtMs, tickCount);
        const effectiveDeltaMs = timeControlFrame.effectiveDeltaMs;
        if (this.debugTrace) {
            const impact = this.timeControl.impactContext;
            const impactNextState = impact?.nextState ?? null;
            const impactFrames = impact?.frames ?? 0;
            console.log(
                `[CharTrace] tick=${tickCount} id=${this.id} state=${this.currentStateName} entry=${this.stateEntrySerial} mode=${timeControlFrame.mode}` +
                ` hs=${this.timeControl.hitstopFrames} bs=${this.timeControl.blockstunFrames} hts=${this.timeControl.hitstunFrames}` +
                ` impactFrames=${impactFrames} impactNext=${impactNextState} effectiveDt=${effectiveDeltaMs}`
            );
        }

        if (timeControlFrame.shouldAdvanceTimedTags) {
            for (const [tag, expireTick] of this.timedTags) {
                if (tickCount >= expireTick) {
                    this.stateTags.delete(tag);
                    this.timedTags.delete(tag);
                }
            }
        }

        if (timeControlFrame.shouldAdvanceAnimation && !timeControlFrame.shouldRunStateLogic) {
            const oldFrameWhenFrozen = this.animation.currentFrameIndex;
            this.animation.fixedUpdate(effectiveDeltaMs);
            const newFrameWhenFrozen = this.animation.currentFrameIndex;
            if (newFrameWhenFrozen !== oldFrameWhenFrozen) {
                this._applyFrame(newFrameWhenFrozen);
            }
            const currentWhenFrozen = this.animation.currentFrame;
            const anchorWhenFrozen = this._getCurrentRootAnchor(newFrameWhenFrozen);
            this._applyRootAlignment(currentWhenFrozen.w, currentWhenFrozen.h, anchorWhenFrozen);
            this._syncRootDebug(anchorWhenFrozen);
            this.collision.syncToFrame(newFrameWhenFrozen, currentWhenFrozen.w, currentWhenFrozen.h, anchorWhenFrozen);
            this._updateDebugPanel();
            return;
        }

        if (!timeControlFrame.shouldRunStateLogic) {
            return;
        }

        const oldState = this.currentStateName;

        const nextStateBeforeUpdate = this._consumeTransition();
        if (nextStateBeforeUpdate) {
            this.enterState(nextStateBeforeUpdate, tickCount);
        }

        const oldFrame = this.animation.currentFrameIndex;
        this.animation.fixedUpdate(effectiveDeltaMs);
        const newFrame = this.animation.currentFrameIndex;

        if (newFrame !== oldFrame) {
            this._applyFrame(newFrame);
        }

        const current = this.animation.currentFrame;
        const anchor = this._getCurrentRootAnchor(newFrame);
        this._applyRootAlignment(current.w, current.h, anchor);
        this._syncRootDebug(anchor);
        this.collision.syncToFrame(newFrame, current.w, current.h, anchor);

        this._applyMovement(effectiveDeltaMs);

        const newState = this.currentStateName;
        const oldStateDef = oldState ? this.stateGraph?.states?.[oldState] : null;
        const wasAttackState = oldStateDef?.attackActive === true;
        if (oldState !== newState && newState === "idle" && wasAttackState) {
            this.triggerCooldown();
        }

        this._updateDebugPanel();
    }
}