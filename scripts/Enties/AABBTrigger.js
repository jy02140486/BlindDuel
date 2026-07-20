export class AABBTrigger {
    constructor(scene, position, size, options = {}) {
        this.scene = scene;
        this.position = position.clone();
        this.size = { ...size };
        this.triggered = false;
        this._enabled = options.enabled ?? true;
        this.onEnter = options.onEnter || (() => {});

        this.collisionBox = BABYLON.MeshBuilder.CreateBox(
            options.name ? `trigger_${options.name}_collision` : "aabb_trigger", size, scene);
        this.collisionBox.position.copyFrom(position);
        this.collisionBox.isVisible = false;

        this.debugMesh = BABYLON.MeshBuilder.CreateBox(
            options.name ? `trigger_${options.name}_debug` : "aabb_debug", size, scene);
        this.debugMesh.position.copyFrom(position);
        this.debugMesh.material = this.#createDebugMaterial(options.debugColor || new BABYLON.Color3(0, 1, 0));
        this.debugMesh.renderingGroupId = 3;
        this.debugMesh.setEnabled(options.debugVisible || false);

        this._arrow = null;
    }

    #createDebugMaterial(color) {
        const mat = new BABYLON.StandardMaterial("trigger_debug_mat", this.scene);
        mat.diffuseColor = color;
        mat.alpha = 0.3;
        mat.disableLighting = true;
        return mat;
    }

    checkOverlap(entity) {
        if (!this._enabled) return false;

        const entityPos = entity.root.position;
        const halfW = this.size.width / 2;
        const halfH = this.size.height / 2;
        const halfD = this.size.depth / 2;

        const inX = entityPos.x >= this.position.x - halfW && entityPos.x <= this.position.x + halfW;
        const inY = entityPos.y >= this.position.y - halfH && entityPos.y <= this.position.y + halfH;
        const inZ = entityPos.z >= this.position.z - halfD && entityPos.z <= this.position.z + halfD;

        return inX && inY && inZ;
    }

    check(entity) {
        if (!this._enabled) return false;
        if (this.triggered) return false;

        if (this.checkOverlap(entity)) {
            this.triggered = true;
            this.onEnter(entity);
            return true;
        }
        return false;
    }

    setDebugVisible(visible) {
        if (this.debugMesh) {
            this.debugMesh.setEnabled(visible);
        }
    }

    setEnabled(value) {
        this._enabled = value;
        if (!value) this.triggered = false;
    }

    dispose() {
        if (this.collisionBox) {
            this.collisionBox.dispose();
            this.collisionBox = null;
        }
        if (this.debugMesh) {
            this.debugMesh.dispose();
            this.debugMesh = null;
        }
        this.disposeArrow();
    }

    setupArrow(config) {
        if (this._arrow) {
            this._arrow.dispose();
            this._arrow = null;
        }
        this._arrow = new ArrowIndicator(this.scene, this.position, this.size, config);
    }

    updateArrow(visible, dtMs) {
        if (!this._arrow) return;
        this._arrow.setVisible(visible);
        if (visible) this._arrow.stepFrame(dtMs);
    }

    disposeArrow() {
        if (this._arrow) {
            this._arrow.dispose();
            this._arrow = null;
        }
    }
}

class ArrowIndicator {
    constructor(scene, triggerPosition, triggerSize, config) {
        this.scene = scene;
        this._triggerPosition = triggerPosition.clone();
        this._triggerSize = { ...triggerSize };
        this._frameCount = 4;
        this._frameIndex = 0;
        this._accumMs = 0;
        this._frameMs = config.frameMs ?? 250;

        const pxPerUnit = 32;
        const scale = config.scale ?? 1.0;
        const planeW = (32 / pxPerUnit) * scale;
        const planeH = (48 / pxPerUnit) * scale;

        const pos = this._computePosition(config.edge ?? "bottom", config.offset ?? 0.3);
        const rot = this._computeRotation(config.direction ?? "up");

        const id = config.id || "arrow";
        this.plane = BABYLON.MeshBuilder.CreatePlane(`${id}_indicator`, {
            width: planeW,
            height: planeH
        }, scene);
        this.plane.position.copyFrom(pos);
        this.plane.rotation.z = rot;
        this.plane.renderingGroupId = 3;
        this.plane.alphaIndex = 100;
        this.plane.setEnabled(false);

        this.material = new BABYLON.StandardMaterial(`${id}_arrow_mat`, scene);
        this.material.emissiveColor = new BABYLON.Color3(1, 1, 1);
        this.material.backFaceCulling = false;
        this.material.useAlphaFromDiffuseTexture = true;
        this.material.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
        this.material.disableLighting = true;
        this.material.disableDepthWrite = true;
        this.plane.material = this.material;

        const tex = new BABYLON.Texture(
            config.atlasUrl,
            scene,
            false,
            true,
            BABYLON.Texture.NEAREST_SAMPLINGMODE
        );
        tex.hasAlpha = true;
        tex.wrapU = BABYLON.Texture.CLAMP_ADDRESSMODE;
        tex.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
        tex.uScale = 1 / this._frameCount;
        tex.uOffset = 0;
        this.material.diffuseTexture = tex;
        this._texture = tex;
    }

    _computePosition(edge, offset) {
        const p = this._triggerPosition;
        const s = this._triggerSize;
        const cx = p.x, cy = p.y, cz = p.z;
        const halfW = s.width / 2;
        const halfH = s.height / 2;
        switch (edge) {
            case "top":    return new BABYLON.Vector3(cx, cy + halfH + offset, cz);
            case "left":   return new BABYLON.Vector3(cx - halfW - offset, cy, cz);
            case "right":  return new BABYLON.Vector3(cx + halfW + offset, cy, cz);
            case "bottom":
            default:       return new BABYLON.Vector3(cx, cy - halfH - offset, cz);
        }
    }

    _computeRotation(direction) {
        switch (direction) {
            case "right":  return -Math.PI / 2;
            case "down":   return Math.PI;
            case "left":   return Math.PI / 2;
            case "up":
            default:       return 0;
        }
    }

    setVisible(visible) {
        if (this.plane) this.plane.setEnabled(visible);
    }

    stepFrame(dtMs) {
        this._accumMs += dtMs;
        while (this._accumMs >= this._frameMs) {
            this._accumMs -= this._frameMs;
            this._frameIndex = (this._frameIndex + 1) % this._frameCount;
            if (this._texture) {
                this._texture.uOffset = this._frameIndex / this._frameCount;
            }
        }
    }

    dispose() {
        if (this.plane) {
            this.plane.dispose();
            this.plane = null;
        }
        if (this.material) {
            this.material.dispose();
            this.material = null;
        }
        if (this._texture) {
            this._texture.dispose();
            this._texture = null;
        }
    }
}