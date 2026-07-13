/**
 * PickableEntity — 可拾取物品实体
 * 轻量实体，不继承 CharacterBase。仅包含 sprite plane + 渲染设置。
 * 支持 Y 偏移让物品精灵显示在合适高度（接近手部）。
 */
export class PickableEntity {
    constructor(scene, config) {
        this.scene = scene;
        this.id = config.id ?? `pickable_${Date.now()}`;
        this.name = config.name ?? this.id;
        this.kind = "pickable";
        this.interactable = true;
        this.pickable = true;

        this.itemDef = config.itemDef ?? null;
        this.visualYOffset = config.visualYOffset ?? 1.5;

        // 根节点（逻辑位置在地面）
        this.root = new BABYLON.TransformNode(this.name, scene);

        // Sprite plane
        const pxToWorld = config.pxToWorld ?? 0.06;
        const frameW = config.frameWidth ?? 16;
        const frameH = config.frameHeight ?? 16;
        const planeW = frameW * pxToWorld;
        const planeH = frameH * pxToWorld;

        this.spritePlane = BABYLON.MeshBuilder.CreatePlane(`${this.name}_plane`, {
            width: planeW,
            height: planeH
        }, scene);
        this.spritePlane.parent = this.root;
        this.spritePlane.position.y = this.visualYOffset;
        this.spritePlane.position.z = -0.02;

        // 材质
        this.material = new BABYLON.StandardMaterial(`${this.name}_mat`, scene);
        this.material.emissiveColor = new BABYLON.Color3(1, 1, 1);
        this.material.backFaceCulling = false;
        this.material.useAlphaFromDiffuseTexture = true;
        this.material.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
        this.material.disableLighting = true;
        this.material.disableDepthWrite = true;
        this.spritePlane.material = this.material;
        this.spritePlane.renderingGroupId = config.renderingGroupId ?? 1;
        this.spritePlane.alphaIndex = 0;

        // 纹理
        if (config.textureUrl) {
            this.material.diffuseTexture = new BABYLON.Texture(config.textureUrl, scene);
            this.material.diffuseTexture.hasAlpha = true;
        }

        // --- Debug：root 位置圆盘 ---
        this._debugVisible = false;
        this._debugDisc = BABYLON.MeshBuilder.CreateDisc(`${this.name}_root_debug`, {
            radius: 3 * (config.pxToWorld ?? 0.06),
            tessellation: 20
        }, scene);
        this._debugDisc.parent = this.root;
        this._debugDisc.position.z = 0.03;

        this._debugMaterial = new BABYLON.StandardMaterial(`${this.name}_root_debug_mat`, scene);
        this._debugMaterial.emissiveColor = new BABYLON.Color3(0.439, 0.51, 0.757);
        this._debugMaterial.diffuseColor = new BABYLON.Color3(0.439, 0.51, 0.757);
        this._debugMaterial.alpha = 0.9;
        this._debugMaterial.backFaceCulling = false;
        this._debugMaterial.disableLighting = true;
        this._debugDisc.material = this._debugMaterial;
        this._debugDisc.setEnabled(this._debugVisible);

        this.debugPanel = this.#createDebugPanel();
    }

    #createDebugPanel() {
        const panel = document.createElement("div");
        panel.style.position = "absolute";
        panel.style.pointerEvents = "none";
        panel.style.background = "rgba(60, 0, 80, 0.78)";
        panel.style.color = "#e8d4ff";
        panel.style.font = "12px/1.2 Consolas, monospace";
        panel.style.padding = "4px 8px";
        panel.style.borderRadius = "4px";
        panel.style.border = "1px solid rgba(200, 160, 255, 0.5)";
        panel.style.whiteSpace = "nowrap";
        panel.style.zIndex = "1000";
        panel.style.display = "none";
        document.body.appendChild(panel);
        return panel;
    }

    _updateDebugPanel() {
        if (!this.debugPanel || !this.spritePlane) return;
        const canvas = this.scene.getEngine().getRenderingCanvas();
        if (!canvas) return;
        const anchor = this.root.position.clone();
        anchor.y += this.visualYOffset;
        const projected = BABYLON.Vector3.Project(
            anchor,
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
        const ry = this.root.position.y;
        this.debugPanel.textContent = `y:${ry.toFixed(2)} visY:${(ry + this.visualYOffset).toFixed(2)} alpha:${this.spritePlane.alphaIndex}`;
    }

    setCollisionVisible(value) {
        this._debugVisible = value;
        if (this._debugDisc) {
            this._debugDisc.setEnabled(value);
        }
    }

    /** 被拾取：销毁 mesh */
    pickup() {
        if (this.debugPanel) {
            this.debugPanel.remove();
            this.debugPanel = null;
        }
        if (this.spritePlane) {
            this.spritePlane.dispose();
            this.spritePlane = null;
        }
        if (this.material) {
            this.material.dispose();
            this.material = null;
        }
        if (this._debugDisc) {
            this._debugDisc.dispose();
            this._debugDisc = null;
        }
        if (this._debugMaterial) {
            this._debugMaterial.dispose();
            this._debugMaterial = null;
        }
        if (this.root) {
            this.root.dispose();
            this.root = null;
        }
    }

    get isDisposed() {
        return !this.root && !this.spritePlane;
    }
}