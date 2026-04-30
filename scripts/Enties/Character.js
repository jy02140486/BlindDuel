import { FrameAnimationComponent } from "../Components/FrameAnimationComponent.js";
import { CollisionComponent } from "../Components/CollisionComponent.js";

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

        // 全局冷却（Global Cooldown）
        this.globalCooldownMs = config.globalCooldownMs ?? 700;
        this.lastActionTime = -Infinity;
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
        // 获取当前状态的速度设置
        const stateSpeed = this.currentStateDef?.speed;
        const frameSpeeds = this.currentStateDef?.frameSpeeds;
        
        // 优先使用每帧速度数组
        if (frameSpeeds && frameSpeeds.length > 0) {
            const frameIndex = this.animation.currentFrameIndex;
            const frameSpeed = frameSpeeds[frameIndex % frameSpeeds.length];
            
            if (frameSpeed !== undefined) {
                const dtSec = dtMs / 1000;
                
                // 每帧速度：符号代表方向，数值代表速度
                this.root.position.x += frameSpeed * dtSec;
                this.currentSpd = Math.abs(frameSpeed);
                return;
            }
        }
        
        // 如果没有每帧速度，检查状态速度
        if (stateSpeed !== undefined) {
            const dtSec = dtMs / 1000;
            
            // 状态速度：符号代表方向，数值代表速度
            this.root.position.x += stateSpeed * dtSec;
            this.currentSpd = Math.abs(stateSpeed);
            return;
        }
        
        // 如果都没有定义，使用玩家输入控制移动
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
            // 全局冷却期间不响应攻击指令
            if (!this.canAct()) {
                return false;
            }
            return this.pendingCommands.includes(condition.command);
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

    enterState(stateName) {
        const stateDef = this.stateGraph?.states?.[stateName];
        if (!stateDef) {
            throw new Error(`Unknown character state: ${stateName}`);
        }

        this.stateEntrySerial += 1;
        this.currentStateName = stateName;
        this.currentStateDef = stateDef;
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
        this.pendingCommands.push(command);
        return true;
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
     * 触发全局冷却
     * 应在动画/硬直结束后调用
     */
    triggerCooldown() {
        this.lastActionTime = performance.now();
    }

    hasState(stateName) {
        return Boolean(this.stateGraph?.states?.[stateName]);
    }

    takeDamage(ctx = {}) {
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

        const worldBoxes = boxes.map((box) => {
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
                    ? (attackInstanceId ? "offense" : "guard")
                    : null,
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
            boxes: worldBoxes
        };
    }

    setMoveIntent(intent) {
        this.moveIntent = { ...intent };
    }

    update(dtMs) {
        const oldState = this.currentStateName;

        const nextStateBeforeUpdate = this.#consumeTransition();
        if (nextStateBeforeUpdate) {
            this.enterState(nextStateBeforeUpdate);
        }

        const oldFrame = this.animation.currentFrameIndex;
        this.animation.update(dtMs);
        const newFrame = this.animation.currentFrameIndex;

        if (newFrame !== oldFrame) {
            this.#applyFrame(newFrame);
        }

        const current = this.animation.currentFrame;
        const anchor = this.#getCurrentRootAnchor(newFrame);
        this.#applyRootAlignment(current.w, current.h, anchor);
        this.#syncRootDebug(anchor);
        this.collision.syncToFrame(newFrame, current.w, current.h, anchor);

        const preMoveX = this.root.position.x;
        this.#applyMovement(dtMs);
        const moved = this.root.position.x !== preMoveX;

        const nextStateAfterUpdate = this.#consumeTransition();
        if (nextStateAfterUpdate) {
            this.enterState(nextStateAfterUpdate);
            const updatedCurrent = this.animation.currentFrame;
            const updatedAnchor = this.#getCurrentRootAnchor(this.animation.currentFrameIndex);
            this.#applyRootAlignment(updatedCurrent.w, updatedCurrent.h, updatedAnchor);
            this.#syncRootDebug(updatedAnchor);
            this.collision.syncToFrame(this.animation.currentFrameIndex, updatedCurrent.w, updatedCurrent.h, updatedAnchor);
        } /*else if (moved) {
            const current = this.animation.currentFrame;
            const anchor = this.#getCurrentRootAnchor(this.animation.currentFrameIndex);
            this.collision.syncToFrame(this.animation.currentFrameIndex, current.w, current.h, anchor);
        }*/

        // 检测状态变化：从非idle状态回到idle时触发CD
        const newState = this.currentStateName;
        if (oldState !== newState && newState === "idle" && oldState !== null) {
            this.triggerCooldown();
        }

        this.#updateDebugPanel();
    }

    setCollisionVisible(value) {
        this.rootDebugVisible = value;
        this.rootDebugMesh.setEnabled(value);
        this.collision.setVisible(value);
    }
}
