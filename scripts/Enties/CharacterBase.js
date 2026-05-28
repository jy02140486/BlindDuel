export class CharacterBase {
    constructor(scene, config) {
        this.scene = scene;
        this.config = config;
        this.id = config.id || config.name || `character_${Date.now()}`;
        this.kind = config.kind ?? "unknown";
        this.blocksMovement = config.blocksMovement ?? false;
        this.interactable = config.interactable ?? false;
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
        this.facing = 1;
        this.allowFacing = false;
        this.stateEntrySerial = 0;
        this.stateTags = new Set();
        this.stateEnterTick = 0;
        this.debugTrace = config.debugTrace ?? false;

        this.animation = config._animation;
        this.collision = config._collision ?? null;

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
        this._applyFrame(this.animation.currentFrameIndex);
        const initialAnchor = this._getCurrentRootAnchor(this.animation.currentFrameIndex);
        this._applyRootAlignment(current.w, current.h, initialAnchor);
        this._syncRootDebug(initialAnchor);
        this.collision?.syncToFrame(this.animation.currentFrameIndex, current.w, current.h, initialAnchor);

        this.currentSpd = 0;

        this.timedTags = new Map();

        this.capabilities = config.capabilities ?? { combat: true, interaction: false };
        this.tickCount = 0;
    }

    has(capabilityName) {
        return this.capabilities?.[capabilityName] === true;
    }

    get(capabilityName) {
        return this.capabilities?.[capabilityName];
    }

    getBlockerAabb() {
        return null;
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

    #applyCurrentClipTexture() {
        this.texture = this.texturesByClip[this.animation.currentClipName];
        if (this.material) {
            this.material.diffuseTexture = this.texture;
        }
    }

    _applyFrame(frameIndex) {
        const frame = this.animation.frames[frameIndex];
        const atlasData = this.animation.currentClip.atlasData;
        const atlasW = atlasData.meta.size.w;
        const atlasH = atlasData.meta.size.h;

        this.texture.uScale = frame.w / atlasW;
        this.texture.uOffset = frame.x / atlasW;

        this.texture.vScale = -(frame.h / atlasH);
        this.texture.vOffset = 1 - (frame.y / atlasH);

        const baseScaleX = frame.w / this.baseFrameWidthPx;
        this.spritePlane.scaling.x = baseScaleX * this.facing;
        this.spritePlane.scaling.y = frame.h / this.baseFrameHeightPx;
    }

    _getCurrentRootAnchor(frameIndex) {
        return null;
    }

    _applyRootAlignment(frameWidth, frameHeight, anchor) {
        if (!this.spritePlane) {
            return;
        }

        const anchorOffsetX = anchor ? (anchor.cx - frameWidth / 2) * this.pxToWorld : 0;
        const anchorOffsetY = anchor ? (frameHeight / 2 - anchor.cy) * this.pxToWorld : 0;

        this.spritePlane.position.x = -anchorOffsetX * this.facing;
        this.spritePlane.position.y = -anchorOffsetY;
        this.spritePlane.position.z = -0.02;
    }

    #updateSpriteFacing() {
        if (!this.spritePlane) {
            return;
        }
        const currentScaleX = Math.abs(this.spritePlane.scaling.x);
        this.spritePlane.scaling.x = currentScaleX * this.facing;
        this.spritePlane.position.x = -this.spritePlane.position.x;
    }

    _syncRootDebug(anchor) {
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

        this.debugPanel.textContent = `State: ${currentState} | Clip: ${currentClip} | Speed: ${moveSpeed.toFixed(2)}`;
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

    _applyMovement(dtMs) {
        const stateSpeed = this.currentStateDef?.speed;
        const frameSpeeds = this.currentStateDef?.frameSpeeds;

        if (frameSpeeds && frameSpeeds.length > 0) {
            const frameIndex = this.animation.currentFrameIndex;
            const frameSpeed = frameSpeeds[frameIndex % frameSpeeds.length];

            if (frameSpeed !== undefined) {
                const dtSec = dtMs / 1000;

                this.root.position.x += frameSpeed * dtSec;
                this.currentSpd = Math.abs(frameSpeed);
                return;
            }
        }

        if (stateSpeed !== undefined) {
            const dtSec = dtMs / 1000;

            this.root.position.x += stateSpeed * dtSec;
            this.currentSpd = Math.abs(stateSpeed);
            return;
        }

        if (this.currentStateDef?.allowMoveInput === false) {
            this.currentSpd = 0;
            return;
        }

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

        if (this.allowFacing && Math.abs(nx) > 0.1) {
            const newFacing = nx > 0 ? 1 : -1;
            if (newFacing !== this.facing) {
                this.facing = newFacing;
                this.#updateSpriteFacing();
            }
        }

        this.root.position.x += nx * this.baseWalkSpeed * dtSec;
        this.root.position.y += ny * this.baseWalkSpeed * dtSec;
        this.currentSpd = Math.hypot(nx * this.baseWalkSpeed, ny * this.baseWalkSpeed);
    }

    _matchesTransitionCondition(condition) {
        if (condition.command) {
            const hasCmd = this.pendingCommands.includes(condition.command);
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

    _consumeTransition() {
        const transitions = this.currentStateDef?.transitions ?? [];
        for (const transition of transitions) {
            const conditions = transition.when ?? [];
            const matched = conditions.every((condition) => this._matchesTransitionCondition(condition));
            if (matched) {
                for (const condition of conditions) {
                    if (condition.command) {
                        const index = this.pendingCommands.indexOf(condition.command);
                        if (index >= 0) {
                            this.pendingCommands.splice(index, 1);
                        }
                    }
                }
                return transition.to;
            }
        }
        return null;
    }

    _getStateTimeScale(stateDef) {
        return stateDef.timeScale ?? 1.0;
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

        const timeScale = this._getStateTimeScale(stateDef);
        this.clearTags();

        this.animation.setTimeScale(timeScale);

        this.animation.play(stateDef.clip, { restart: true });
        this.collision?.setClip(stateDef.clip);
        this.#applyCurrentClipTexture();
        if (this.spritePlane) {
            this._applyFrame(this.animation.currentFrameIndex);
            const current = this.animation.currentFrame;
            const anchor = this._getCurrentRootAnchor(this.animation.currentFrameIndex);
            this._applyRootAlignment(current.w, current.h, anchor);
            this._syncRootDebug(anchor);
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

    hasState(stateName) {
        return Boolean(this.stateGraph?.states?.[stateName]);
    }

    setMoveIntent(intent) {
        this.moveIntent = { ...intent };
    }

    _handleTimedTags(tickCount) {
        for (const [tag, expireTick] of this.timedTags) {
            if (tickCount >= expireTick) {
                this.stateTags.delete(tag);
                this.timedTags.delete(tag);
            }
        }
    }

    fixedUpdate(dtMs, tickCount) {
        this.tickCount = tickCount;

        this._handleTimedTags(tickCount);

        const nextState = this._consumeTransition();
        if (nextState) {
            this.enterState(nextState, tickCount);
        }

        const oldFrame = this.animation.currentFrameIndex;
        this.animation.fixedUpdate(dtMs);
        const newFrame = this.animation.currentFrameIndex;

        if (newFrame !== oldFrame) {
            this._applyFrame(newFrame);
        }

        const current = this.animation.currentFrame;
        const anchor = this._getCurrentRootAnchor(newFrame);
        this._applyRootAlignment(current.w, current.h, anchor);
        this._syncRootDebug(anchor);
        this.collision?.syncToFrame(newFrame, current.w, current.h, anchor);

        this._applyMovement(dtMs);
        this._updateDebugPanel();
    }

    setCollisionVisible(value) {
        this.rootDebugVisible = value;
        this.rootDebugMesh.setEnabled(value);
        this.collision?.setVisible(value);
    }
}