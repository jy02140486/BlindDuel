//for entities in cutscenes
export class PropEntity {
    constructor(scene, config) {
        this.scene = scene;
        this.id = config.id ?? `prop_${Date.now()}`;
        this.name = config.name ?? this.id;
        this.kind = "prop";
        this.interactable = false;
        this.blocksMovement = false;

        this.pxToWorld = config.pxToWorld ?? 0.06;
        this.baseFrameWidthPx = config.frameWidth ?? 128;
        this.baseFrameHeightPx = config.frameHeight ?? 128;

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

        this.facing = 1;
        this.facingMode = "locked";
        this.currentStateName = null;
        this.currentSpd = 0;

        this._buildSpritePlane(config);

        const initialClip = config.initialClip ?? Object.keys(this.clips)[0];
        if (initialClip) this._setClip(initialClip);
    }

    _buildSpritePlane(config) {
        const planeW = this.baseFrameWidthPx * this.pxToWorld;
        const planeH = this.baseFrameHeightPx * this.pxToWorld;

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
    }

    _setClip(clipName) {
        const clip = this.clips[clipName];
        if (!clip || this._currentClipName === clipName) return;

        const atlas = clip.atlasData;
        if (!atlas?.frames) {
            console.warn(`[PropEntity] clip ${clipName} has no atlas.frames`);
            return;
        }

        this._currentClipName = clipName;
        this._currentClip = { ...clip, atlas };
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
        this._currentFrameIndex = 0;
        this._timeInFrameMs = 0;
        this.currentStateName = clipName;

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

        this._applyFrame(0);
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

        const baseScaleX = frame.w / this.baseFrameWidthPx;
        this.spritePlane.scaling.x = baseScaleX * this.facing;
        this.spritePlane.scaling.y = frame.h / this.baseFrameHeightPx;
    }

    fixedUpdate(dtMs) {
        if (this.isDisposed) return;
        if (!this._currentClip || !this._frames.length) return;

        const frame = this._frames[this._currentFrameIndex];
        this._timeInFrameMs += dtMs;
        while (this._timeInFrameMs >= frame.durationMs) {
            this._timeInFrameMs -= frame.durationMs;
            const next = this._currentFrameIndex + 1;
            if (next >= this._frames.length) {
                if (this._mode === "loop") {
                    this._currentFrameIndex = 0;
                    this._applyFrame(0);
                } else {
                    this._currentFrameIndex = this._frames.length - 1;
                    this._timeInFrameMs = 0;
                    return;
                }
            } else {
                this._currentFrameIndex = next;
                this._applyFrame(next);
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
        if (this.spritePlane && this._frames.length) {
            const frame = this._frames[this._currentFrameIndex];
            const baseScaleX = frame.w / this.baseFrameWidthPx;
            this.spritePlane.scaling.x = baseScaleX * this.facing;
        }
    }
    setFacingMode(_mode) {}

    getVisualBottomY() { return this.root.position.y; }

    dispose() {
        if (this.material?.diffuseTexture) this.material.diffuseTexture.dispose();
        this.material?.dispose?.();
        this.spritePlane?.dispose?.();
        this.root?.dispose?.();
        this.material = null;
        this.spritePlane = null;
        this.root = null;
    }

    get isDisposed() { return !this.root && !this.spritePlane; }
}