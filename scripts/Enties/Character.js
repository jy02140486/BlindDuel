import { FrameAnimationComponent } from "../Components/FrameAnimationComponent.js";
import { CollisionComponent } from "../Components/CollisionComponent.js";
import { TimeControlComponent } from "../Components/TimeControlComponent.js";
import { TimeControlSystem } from "../Systems/TimeControlSystem.js";

export class Character {
    constructor(scene, config) {
        this.scene = scene;
        this.config = config;
        this.id = config.id || config.name || `character_${Date.now()}`;
        this.root = new BABYLON.TransformNode(config.name || "character_root", scene);

        this.pxToWorld = config.pxToWorld ?? 0.02;
        this.thicknessPx = config.collisionThicknessPx ?? 40;
        this.showCollision = config.showCollision ?? true;
        this.stateGraph = config.stateGraph ?? null;
        this.currentStateName = null;
        this.currentStateDef = null;
        this.pendingCommands = [];
        this.moveIntent = { x: 0, y: 0 };
        this.rootDebugVisible = this.showCollision;
        this.moveDeadzone = config.moveDeadzone ?? 0.2;
        this.baseWalkSpeed = config.walkSpeed ?? 2.4;
        this.currentSpeed = 0;
        this.stateEntrySerial = 0;
        this.stateTags = new Set();
        this.stateEnterTick = 0;
        this.debugTrace = config.debugTrace ?? false;

        this.animation = new FrameAnimationComponent(config.clips);

        this.collision = new CollisionComponent(
            scene,
            this.root,
            this.#buildColliderClips(config.clips),
            {
                pxToWorld: this.pxToWorld,
                thicknessPx: this.thicknessPx,
                visible: this.showCollision
            }
        );

        this.texturesByClip = this.#buildTextures(scene, config.clips);
        this.texture = null;

        const initialState = this.stateGraph?.initialState ?? Object.keys(config.clips)[0];
        this.enterState(initialState);

        const current = this.animation.currentFrame;
        this.baseFrameWidthPx = current.w;
        this.baseFrameHeightPx = current.h;
        const planeW = current.w * this.pxToWorld;
        const planeH = current.h * this.pxToWorld;
        this.spritePlane = BABYLON.MeshBuilder.CreatePlane(`${config.name || "character"}_plane`, {
            width: planeW,
            height: planeH
        }, scene);
        this.spritePlane.parent = this.root;
        this.spritePlane.position.z = -0.02;

        this.material = new BABYLON.StandardMaterial(`${config.name || "character"}_mat`, scene);
        this.material.emissiveColor = new BABYLON.Color3(1, 1, 1);
        this.material.backFaceCulling = false;
        this.material.useAlphaFromDiffuseTexture = true;
        this.material.disableLighting = true;
        this.spritePlane.material = this.material;
        this.spritePlane.renderingGroupId = config.renderingGroupId ?? 1;
        this.spritePlane.alphaIndex = config.alphaIndex ?? 1;

        this.rootDebugNode = new BABYLON.TransformNode(`${config.name || "character"}_root_debug`, scene);
        this.rootDebugNode.parent = this.root;
        this.rootDebugMesh = BABYLON.MeshBuilder.CreateDisc(`${config.name || "character"}_root_disc`, {
            radius: 3 * this.pxToWorld,
            tessellation: 20
        }, scene);
        this.rootDebugMesh.parent = this.rootDebugNode;
        this.rootDebugMesh.rotation.x = 0;
        this.rootDebugMesh.rotation.y = 0;
        this.rootDebugMesh.rotation.z = 0;
        this.rootDebugMesh.position.z = 0.03;

        this.rootDebugMaterial = new BABYLON.StandardMaterial(`${config.name || "character"}_root_debug_mat`, scene);
        this.rootDebugMaterial.emissiveColor = new BABYLON.Color3(0.439, 0.51, 0.757);
        this.rootDebugMaterial.diffuseColor = new BABYLON.Color3(0.439, 0.51, 0.757);
        this.rootDebugMaterial.alpha = 0.9;
        this.rootDebugMaterial.backFaceCulling = false;
        this.rootDebugMaterial.disableLighting = true;
        this.rootDebugMesh.material = this.rootDebugMaterial;
        this.rootDebugMesh.setEnabled(this.rootDebugVisible);

        this.debugPanel = this.#createDebugPanel();

        this.#applyCurrentClipTexture();
        this.#applyFrame(this.animation.currentFrameIndex);
        const initialAnchor = this.#getCurrentRootAnchor(this.animation.currentFrameIndex);
        this.#applyRootAlignment(current.w, current.h, initialAnchor);
        this.#syncRootDebug(initialAnchor);
        this.collision.syncToFrame(this.animation.currentFrameIndex, current.w, current.h, initialAnchor);

        this.currentSpd=0;

        // 鍏ㄥ眬鍐峰嵈锛圙lobal Cooldown锛?
        this.globalCooldownMs = config.globalCooldownMs ?? 700;
        this.lastActionTime = -Infinity;

        this.timeControl = new TimeControlComponent();
        this.timeControlSystem = new TimeControlSystem();

        // Timed Tags锛堝甫鏈夋晥鏈熺殑鐘舵€佹爣璁帮級
        this.timedTags = new Map();
    }

    addTag(tag) {
        this.stateTags.add(tag);
    }

    addTimedTag(tag, durationFrames) {
        this.stateTags.add(tag);
        this.timedTags.set(tag, this.tickCount + durationFrames);
    }

    hasTag(tag) {
        return this.stateTags.has(tag);
    }

    removeTag(tag) {
        this.stateTags.delete(tag);
        this.timedTags.delete(tag);
    }

    clearTags() {
        // 鍙竻闄や笉鍦?timedTags 涓殑鏅€氭爣璁?
        for (const tag of this.stateTags) {
            if (!this.timedTags.has(tag)) {
                this.stateTags.delete(tag);
            }
        }
    }

    clearAllTags() {
        this.stateTags.clear();
        this.timedTags.clear();
    }

    #buildTextures(scene, clips) {
        const textures = {};
        for (const [clipName, clipDef] of Object.entries(clips)) {
            const texture = new BABYLON.Texture(
                clipDef.spriteSheetUrl,
                scene,
                false,
                false,
                BABYLON.Texture.NEAREST_SAMPLINGMODE
            );
            texture.hasAlpha = true;
            texture.wrapU = BABYLON.Texture.CLAMP_ADDRESSMODE;
            texture.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
            textures[clipName] = texture;
        }
        return textures;
    }

    #buildColliderClips(clips) {
        const colliderClips = {};
        for (const [clipName, clipDef] of Object.entries(clips)) {
            colliderClips[clipName] = clipDef.colliderData;
        }
        return colliderClips;
    }

    #applyCurrentClipTexture() {
        this.texture = this.texturesByClip[this.animation.currentClipName];
        if (this.material) {
            this.material.diffuseTexture = this.texture;
        }
    }

    #applyFrame(frameIndex) {
        const frame = this.animation.frames[frameIndex];
        const atlasData = this.animation.currentClip.atlasData;
        const atlasW = atlasData.meta.size.w;
        const atlasH = atlasData.meta.size.h;

        this.texture.uScale = frame.w / atlasW;
        this.texture.uOffset = frame.x / atlasW;

        this.texture.vScale = -(frame.h / atlasH);
        this.texture.vOffset = 1 - (frame.y / atlasH);

        this.spritePlane.scaling.x = frame.w / this.baseFrameWidthPx;
        this.spritePlane.scaling.y = frame.h / this.baseFrameHeightPx;
    }

    #getCurrentRootAnchor(frameIndex) {
        const colliderClip = this.config.clips?.[this.animation.currentClipName]?.colliderData;
        return colliderClip?.frames?.[frameIndex]?.anchors?.root ?? null;
    }

    #applyRootAlignment(frameWidth, frameHeight, anchor) {
        if (!this.spritePlane) {
            return;
        }

        const anchorOffsetX = anchor ? (anchor.cx - frameWidth / 2) * this.pxToWorld : 0;
        const anchorOffsetY = anchor ? (frameHeight / 2 - anchor.cy) * this.pxToWorld : 0;

        this.spritePlane.position.x = -anchorOffsetX;
        this.spritePlane.position.y = -anchorOffsetY;
        this.spritePlane.position.z = -0.02;
    }

    #syncRootDebug(anchor) {
        if (!anchor) {
            this.rootDebugMesh.setEnabled(false);
            return;
        }

        this.rootDebugMesh.position.x = 0;
        this.rootDebugMesh.position.y = 0;
        this.rootDebugMesh.setEnabled(this.rootDebugVisible);
    }

    #createDebugPanel() {
        const panel = document.createElement("div");
        panel.style.position = "absolute";
        panel.style.pointerEvents = "none";
        panel.style.background = "rgba(0, 0, 0, 0.7)";
        panel.style.color = "#d8e7ff";
        panel.style.font = "12px/1.2 Consolas, monospace";
        panel.style.padding = "4px 8px";
        panel.style.borderRadius = "4px";
        panel.style.border = "1px solid rgba(255, 255, 255, 0.3)";
        panel.style.whiteSpace = "nowrap";
        panel.style.zIndex = "1000";
        panel.style.display = "none";
        document.body.appendChild(panel);
        return panel;
    }

    #updateDebugPanel() {
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

        const moveSpeed =this.currentSpd;
        const currentState = this.currentStateName || "unknown";
        const currentClip = this.animation.currentClipName || "none";
        const cdRemaining = this.getCooldownRemaining().toFixed(0);
        
        this.debugPanel.textContent = `State: ${currentState} | Clip: ${currentClip} | Speed: ${moveSpeed.toFixed(2)} | CD: ${cdRemaining}ms`;
    }

    #compareValues(actualValue, op, expectedValue) {
        switch (op) {
        case ">=":
            return actualValue >= expectedValue;
        case ">":
            return actualValue > expectedValue;
        case "<=":
            return actualValue <= expectedValue;
        case "<":
            return actualValue < expectedValue;
        case "==":
            return actualValue === expectedValue;
        default:
            return false;
        }
    }

    #getTransitionParameterValue(parameterName) {
        if (parameterName === "moveMagnitude") {
            const x = Number(this.moveIntent?.x ?? 0);
            const y = Number(this.moveIntent?.y ?? 0);
            return Math.hypot(x, y);
        }

        return undefined;
    }

    #applyMovement(dtMs) {
        // 鑾峰彇褰撳墠鐘舵€佺殑閫熷害璁剧疆
        const stateSpeed = this.currentStateDef?.speed;
        const frameSpeeds = this.currentStateDef?.frameSpeeds;

        // 浼樺厛浣跨敤姣忓抚閫熷害鏁扮粍锛堝姩鐢绘牴杩愬姩锛屼笉鍙?allowMoveInput 褰卞搷锛?
        if (frameSpeeds && frameSpeeds.length > 0) {
            const frameIndex = this.animation.currentFrameIndex;
            const frameSpeed = frameSpeeds[frameIndex % frameSpeeds.length];

            if (frameSpeed !== undefined) {
                const dtSec = dtMs / 1000;

                // 姣忓抚閫熷害锛氱鍙蜂唬琛ㄦ柟鍚戯紝鏁板€间唬琛ㄩ€熷害
                this.root.position.x += frameSpeed * dtSec;
                this.currentSpd = Math.abs(frameSpeed);
                return;
            }
        }

        // 濡傛灉娌℃湁姣忓抚閫熷害锛屾鏌ョ姸鎬侀€熷害
        if (stateSpeed !== undefined) {
            const dtSec = dtMs / 1000;

            // 鐘舵€侀€熷害锛氱鍙蜂唬琛ㄦ柟鍚戯紝鏁板€间唬琛ㄩ€熷害
            this.root.position.x += stateSpeed * dtSec;
            this.currentSpd = Math.abs(stateSpeed);
            return;
        }

        // 鐘舵€佹樉寮忕姝㈢帺瀹剁Щ鍔ㄨ緭鍏?
        if (this.currentStateDef?.allowMoveInput === false) {
            this.currentSpd = 0;
            return;
        }

        // 濡傛灉閮芥病鏈夊畾涔夛紝浣跨敤鐜╁杈撳叆鎺у埗绉诲姩
        const x = Number(this.moveIntent?.x ?? 0);
        const y = Number(this.moveIntent?.y ?? 0);
        const magnitude = Math.hypot(x, y);

        if (magnitude <= this.moveDeadzone) {
            this.currentSpd = 0;
            return;
        }

        const dtSec = dtMs / 1000;
        const nx = x / magnitude;
        const ny = y / magnitude;

        this.root.position.x += nx * this.baseWalkSpeed * dtSec;
        this.root.position.z += ny * this.baseWalkSpeed * dtSec;
        this.currentSpd = Math.hypot(nx * this.baseWalkSpeed, ny * this.baseWalkSpeed);
    }

    #matchesTransitionCondition(condition) {
        if (condition.command) {
            // 鍏ㄥ眬鍐峰嵈鏈熼棿涓嶅搷搴旀敾鍑绘寚浠?
            const canAct = this.canAct();
            const hasCmd = this.pendingCommands.includes(condition.command);
            if (!canAct) {
                return false;
            }
            return hasCmd;
        }

        if (condition.time === "normalized") {
            return this.#compareValues(this.animation.normalizedTime, condition.op, condition.value);
        }

        if (condition.parameter) {
            const parameterValue = this.#getTransitionParameterValue(condition.parameter);
            if (typeof parameterValue === "undefined") {
                return false;
            }
            return this.#compareValues(parameterValue, condition.op, condition.value);
        }

        if (condition.hasTag) {
            const hasIt = this.stateTags.has(condition.hasTag);
            return hasIt;
        }

        return false;
    }

    #consumeTransition() {
        const transitions = this.currentStateDef?.transitions ?? [];
        for (const transition of transitions) {
            const conditions = transition.when ?? [];
            const matched = conditions.every((condition) => this.#matchesTransitionCondition(condition));
            if (matched) {
                for (const condition of conditions) {
                    if (condition.command) {
                        const index = this.pendingCommands.indexOf(condition.command);
                        if (index >= 0) {
                            this.pendingCommands.splice(index, 1);
                        }
                    }
                }
                //console.log(`Transition to ${transition.to} matched conditions`);
                return transition.to;
            }
        }
        return null;
    }

    enterState(stateName, tickCount = null) {
        const stateDef = this.stateGraph?.states?.[stateName];
        if (!stateDef) {
            throw new Error(`Unknown character state: ${stateName}`);
        }

        this.stateEntrySerial += 1;
        this.currentStateName = stateName;
        this.currentStateDef = stateDef;
        this.stateEnterTick = tickCount ?? this.stateEnterTick;

        // 璁剧疆鍔ㄧ敾閫熷害锛氭湁 parryBonus 鏃剁敤 parryTimeScale锛屽惁鍒欑敤 timeScale
        // 娉ㄦ剰锛氬厛璁＄畻 timeScale锛屽啀娓呴櫎 tags
        const timeScale = this.hasTag("parryBonus")
            ? (stateDef.parryTimeScale ?? stateDef.timeScale ?? 1.0)
            : (stateDef.timeScale ?? 1.0);
        // 杩涘叆鏂扮姸鎬佹椂娓呴櫎鏅€氭爣璁帮紝淇濈暀鏈埌鏈熺殑 Timed Tags
        this.clearTags();

        this.animation.setTimeScale(timeScale);

        this.animation.play(stateDef.clip, { restart: true });
        this.collision.setClip(stateDef.clip);
        this.#applyCurrentClipTexture();
        if (this.spritePlane) {
            this.#applyFrame(this.animation.currentFrameIndex);
            const current = this.animation.currentFrame;
            const anchor = this.#getCurrentRootAnchor(this.animation.currentFrameIndex);
            this.#applyRootAlignment(current.w, current.h, anchor);
            this.#syncRootDebug(anchor);
        }
    }

    pushCommand(command) {
        if (!this.#canAcceptCommand(command)) {
            return false;
        }
        this.pendingCommands.length = 0;
        this.pendingCommands.push(command);
        return true;
    }

    #canAcceptCommand(command) {
        const transitions = this.currentStateDef?.transitions ?? [];
        for (const transition of transitions) {
            const conditions = transition.when ?? [];
            for (const condition of conditions) {
                if (condition.command === command) {
                    return true;
                }
            }
        }
        return false;
    }

    canAct() {
        const now = performance.now();
        return now - this.lastActionTime >= this.globalCooldownMs;
    }

    getCooldownRemaining() {
        const now = performance.now();
        const remaining = this.globalCooldownMs - (now - this.lastActionTime);
        return Math.max(0, remaining);
    }

    /**
     * 瑙﹀彂鍏ㄥ眬鍐峰嵈
     * 搴斿湪鍔ㄧ敾/纭洿缁撴潫鍚庤皟鐢?
     */
    triggerCooldown() {
        this.lastActionTime = performance.now();
    }

    hasState(stateName) {
        return Boolean(this.stateGraph?.states?.[stateName]);
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
        this.moveIntent = { ...intent };
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

        // impact / hitstop / blockstun / hitstun 期间暂停 Timed Tags 倒计时
        if (timeControlFrame.shouldAdvanceTimedTags) {
            for (const [tag, expireTick] of this.timedTags) {
                if (tickCount >= expireTick) {
                    this.stateTags.delete(tag);
                    this.timedTags.delete(tag);
                    console.log(`[TimedTag] ${this.id}: ${tag} expired at tick ${tickCount}`);
                }
            }
        }

        if (timeControlFrame.shouldAdvanceAnimation && !timeControlFrame.shouldRunStateLogic) {
            const oldFrameWhenFrozen = this.animation.currentFrameIndex;
            this.animation.fixedUpdate(effectiveDeltaMs);
            const newFrameWhenFrozen = this.animation.currentFrameIndex;
            if (newFrameWhenFrozen !== oldFrameWhenFrozen) {
                this.#applyFrame(newFrameWhenFrozen);
            }
            const currentWhenFrozen = this.animation.currentFrame;
            const anchorWhenFrozen = this.#getCurrentRootAnchor(newFrameWhenFrozen);
            this.#applyRootAlignment(currentWhenFrozen.w, currentWhenFrozen.h, anchorWhenFrozen);
            this.#syncRootDebug(anchorWhenFrozen);
            this.collision.syncToFrame(newFrameWhenFrozen, currentWhenFrozen.w, currentWhenFrozen.h, anchorWhenFrozen);
            this.#updateDebugPanel();
            return;
        }

        if (!timeControlFrame.shouldRunStateLogic) {
            return;
        }

        const oldState = this.currentStateName;

        const nextStateBeforeUpdate = this.#consumeTransition();
        if (nextStateBeforeUpdate) {
            this.enterState(nextStateBeforeUpdate, tickCount);
        }

        const oldFrame = this.animation.currentFrameIndex;
        this.animation.fixedUpdate(effectiveDeltaMs);
        const newFrame = this.animation.currentFrameIndex;

        if (newFrame !== oldFrame) {
            this.#applyFrame(newFrame);
        }

        const current = this.animation.currentFrame;
        const anchor = this.#getCurrentRootAnchor(newFrame);
        this.#applyRootAlignment(current.w, current.h, anchor);
        this.#syncRootDebug(anchor);
        this.collision.syncToFrame(newFrame, current.w, current.h, anchor);

        // walk debug log disabled
        // if (this.animation.currentClipName === "walk" && newFrame !== oldFrame) {
        //     const aox = anchor ? ((anchor.cx - current.w / 2) * this.pxToWorld) : 0;
        //     console.log(`[walk] frame=${newFrame} w=${current.w} h=${current.h} anchor=(${anchor?.cx},${anchor?.cy}) aox=${aox.toFixed(3)} spX=${this.spritePlane.position.x.toFixed(3)} spScaleX=${this.spritePlane.scaling.x.toFixed(3)}`);
        // }

        this.#applyMovement(effectiveDeltaMs);

        // 检测状态变化：从攻击状态回到 idle 时才触发全局冷却
        const newState = this.currentStateName;
        const oldStateDef = oldState ? this.stateGraph?.states?.[oldState] : null;
        const wasAttackState = oldStateDef?.attackActive === true;
        if (oldState !== newState && newState === "idle" && wasAttackState) {
            this.triggerCooldown();
        }

        this.#updateDebugPanel();
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

    setCollisionVisible(value) {
        this.rootDebugVisible = value;
        this.rootDebugMesh.setEnabled(value);
        this.collision.setVisible(value);
    }
}

