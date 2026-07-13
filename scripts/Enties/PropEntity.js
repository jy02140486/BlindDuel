//for entities in cutscenes
export class PropEntity {
    constructor(scene, config) {
        this.scene = scene;
        this.id = config.id ?? `prop_${Date.now()}`;
        this.name = config.name ?? this.id;
        this.kind = "prop";
        this.interactable = false;
        this.blocksMovement = config.blocksMovement ?? false;
        this._blocker = config.blocker ?? null;

        this.pxToWorld = config.pxToWorld ?? 1;
        this.displayWidth = config.frameWidth ?? 3.84;
        this.displayHeight = config.frameHeight ?? 3.84;

        this.root = new BABYLON.TransformNode(this.name, scene);
        const pos = config.pos ?? [0, 0, 0];
        this.root.position.set(pos[0], pos[1], pos[2] ?? 0);

        this.clips = config.clips ?? {};
        this._currentClipName = null;
        this._currentClip = null;
        this._frames = [];
        this._currentFrameIndex = 0;
        this._timeInFrameMs = 0;
        this._mode = "loop";
        this._sharedTexture = null;
        this._sharedAtlasData = null;
        this.stateMap = config.stateMap ?? null;
        this._initialClip = config.initialClip ?? null;

        this.facing = 1;
        this.facingMode = "locked";
        this.currentStateName = null;
        this.currentSpd = 0;

        this._buildSpritePlane(config);

        const initialClip = config.initialClip ?? Object.keys(this.clips)[0];
        if (initialClip) {
            this._setClip(initialClip);
        }
    }

    _buildSpritePlane(config) {
        const planeW = this.displayWidth;
        const planeH = this.displayHeight;

        this.spritePlane = BABYLON.MeshBuilder.CreatePlane(`${this.name}_plane`, {
            width: planeW,
            height: planeH
        }, this.scene);
        this.spritePlane.parent = this.root;
        this.spritePlane.position.z = -0.02;
        this.spritePlane.position.y = planeH / 2;

        this.material = new BABYLON.StandardMaterial(`${this.name}_mat`, this.scene);
        this.material.emissiveColor = new BABYLON.Color3(1, 1, 1);
        this.material.backFaceCulling = false;
        this.material.useAlphaFromDiffuseTexture = true;
        this.material.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
        this.material.disableLighting = true;
        this.material.disableDepthWrite = true;
        this.spritePlane.material = this.material;
        this.spritePlane.renderingGroupId = config.renderingGroupId ?? 1;
        this.spritePlane.alphaIndex = 0;

        if (config.spriteSheetUrl && config.atlasData?.frames) {
            this._sharedAtlasData = config.atlasData;
            const tex = new BABYLON.Texture(
                config.spriteSheetUrl,
                this.scene,
                false,
                false,
                BABYLON.Texture.NEAREST_SAMPLINGMODE
            );
            tex.hasAlpha = true;
            tex.wrapU = BABYLON.Texture.CLAMP_ADDRESSMODE;
            tex.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
            this.material.diffuseTexture = tex;
            this._sharedTexture = tex;
        }
    }

    _setClip(clipName) {
        const clip = this.clips[clipName];
        if (!clip || this._currentClipName === clipName) return;

        const useShared = this._sharedTexture && !clip.spriteSheetUrl;
        const atlas = useShared ? this._sharedAtlasData : clip.atlasData;
        if (!atlas?.frames) {
            console.warn(`[PropEntity] clip ${clipName} has no atlas.frames`);
            return;
        }

        this._currentClipName = clipName;
        this._mode = clip.mode === "hold" ? "hold" : "loop";

        const entries = Object.entries(atlas.frames);
        entries.sort((a, b) => {
            const fa = a[1].frame, fb = b[1].frame;
            if (fa.y !== fb.y) return fa.y - fb.y;
            if (fa.x !== fb.x) return fa.x - fb.x;
            return a[0].localeCompare(b[0]);
        });
        this._frames = entries.map(([name, item]) => ({
            name,
            x: item.frame.x,
            y: item.frame.y,
            w: item.frame.w,
            h: item.frame.h,
            durationMs: item.duration || 100
        }));

        let frameTag = null;
        if (useShared && clip.tag) {
            const tagDef = atlas.meta?.frameTags?.find(t => t.name === clip.tag);
            if (tagDef) {
                frameTag = { from: tagDef.from, to: tagDef.to };
            }
        }
        if (!frameTag) {
            frameTag = { from: 0, to: this._frames.length - 1 };
        }

        this._currentFrameIndex = frameTag.from;
        this._timeInFrameMs = 0;
        this.currentStateName = clipName;
        this._currentClip = { ...clip, atlas, frameTag };

        if (!useShared) {
            if (this.material.diffuseTexture) {
                this.material.diffuseTexture.dispose();
            }
            const tex = new BABYLON.Texture(
                clip.spriteSheetUrl,
                this.scene,
                false,
                false,
                BABYLON.Texture.NEAREST_SAMPLINGMODE
            );
            tex.hasAlpha = true;
            tex.wrapU = BABYLON.Texture.CLAMP_ADDRESSMODE;
            tex.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
            this.material.diffuseTexture = tex;
        }

        this._applyFrame(this._currentFrameIndex);
    }

    _applyFrame(idx) {
        if (!this._frames.length) return;
        const frame = this._frames[Math.min(idx, this._frames.length - 1)];
        const atlas = this._currentClip?.atlas;
        if (!atlas?.meta?.size) return;

        const atlasW = atlas.meta.size.w;
        const atlasH = atlas.meta.size.h;
        const tex = this.material.diffuseTexture;
        if (tex) {
            tex.uScale = frame.w / atlasW;
            tex.uOffset = frame.x / atlasW;
            tex.vScale = -(frame.h / atlasH);
            tex.vOffset = 1 - (frame.y / atlasH);
        }

        this.spritePlane.scaling.x = this.facing;
        this.spritePlane.scaling.y = 1;
    }

    fixedUpdate(dtMs) {
        if (this.isDisposed) return;
        if (!this._currentClip || !this._frames.length) return;

        const tag = this._currentClip.frameTag;
        const to = tag ? tag.to : this._frames.length - 1;
        const from = tag ? tag.from : 0;

        const frame = this._frames[this._currentFrameIndex];
        this._timeInFrameMs += dtMs;
        while (this._timeInFrameMs >= frame.durationMs) {
            this._timeInFrameMs -= frame.durationMs;
            if (this._currentFrameIndex + 1 <= to) {
                this._currentFrameIndex += 1;
                this._applyFrame(this._currentFrameIndex);
            } else if (this._mode === "loop") {
                this._currentFrameIndex = from;
                this._applyFrame(this._currentFrameIndex);
            } else {
                this._currentFrameIndex = to;
                this._timeInFrameMs = 0;
                return;
            }
        }
    }

    enterState(name) { this._setClip(name); }
    pushCommand(name) { this._setClip(name); return true; }
    hasState(name) { return Boolean(this.clips[name]); }
    setMoveIntent(_intent) { /* prop 不用 intent 驱动，sequence 直接写 root.position */ }
    setFacing(facing) {
        const next = facing >= 0 ? 1 : -1;
        if (next === this.facing) return;
        this.facing = next;
        if (this.spritePlane) {
            this.spritePlane.scaling.x = this.facing;
        }
    }
    setFacingMode(_mode) {}

    getBlockerAabb() {
        if (!this._blocker) return null;
        const p = this.root.position;
        const b = this._blocker;
        return {
            minX: p.x - b.halfW, maxX: p.x + b.halfW,
            minY: b.centerY - b.halfH, maxY: b.centerY + b.halfH
        };
    }

    getVisualBottomY() { return this.root.position.y; }

    dispose() {
        if (this.material?.diffuseTexture) this.material.diffuseTexture.dispose();
        this.material?.dispose?.();
        this.spritePlane?.dispose?.();
        this.root?.dispose?.();
        this.material = null;
        this.spritePlane = null;
        this.root = null;
        this._sharedTexture = null;
        this._sharedAtlasData = null;
    }

    get isDisposed() { return !this.root && !this.spritePlane; }
}