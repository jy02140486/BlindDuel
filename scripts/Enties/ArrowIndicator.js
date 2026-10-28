/**
 * ArrowIndicator — 纯视觉箭头提示组件
 *
 * 只管四件事：
 *   - 在构造时根据 config 创建 Babylon mesh / material / texture
 *   - 每帧通过 setAnchor(anchor) 设置世界坐标
 *   - setVisible(bool) 控制显隐
 *   - tick(dtMs) 驱动 4 帧循环动画
 *
 * 不持有任何业务对象引用。不知道 trigger box、不知道 pickable、
 * 不知道 needsInteract。anchor 由外部（queryHint 的调用方）算好传入。
 */
export class ArrowIndicator {
    constructor(scene, config) {
        this.scene = scene;
        this._frameCount = 4;
        this._frameIndex = 0;
        this._accumMs = 0;
        this._frameMs = config.frameMs ?? 250;

        const pxPerUnit = 32;
        const scale = config.scale ?? 1.0;
        const planeW = (32 / pxPerUnit) * scale;
        const planeH = (48 / pxPerUnit) * scale;
        const rot = this._computeRotation(config.direction ?? "up");

        const id = config.id || "arrow";
        this.plane = BABYLON.MeshBuilder.CreatePlane(`${id}_indicator`, {
            width: planeW,
            height: planeH
        }, scene);
        this.plane.position = BABYLON.Vector3.Zero();
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

    _computeRotation(direction) {
        switch (direction) {
            case "right":  return -Math.PI / 2;
            case "down":   return Math.PI;
            case "left":   return Math.PI / 2;
            case "up":
            default:       return 0;
        }
    }

    setAnchor(anchor) {
        if (this.plane) this.plane.position.copyFrom(anchor);
    }

    setVisible(visible) {
        if (this.plane) this.plane.setEnabled(visible);
    }

    tick(dtMs) {
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
