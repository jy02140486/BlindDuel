export class WalkArea {
    constructor(scene, options = {}) {
        this.scene = scene;
        this.minX = options.minX ?? -20;
        this.maxX = options.maxX ?? 20;
        this.minY = options.minY ?? -5;
        this.maxY = options.maxY ?? 5;
        this.obstacles = options.obstacles ?? [];
        this.visible = options.visible ?? false;

        this._plane = null;
        this._material = null;
        if (this.scene) {
            this.#createVisuals();
        }
    }

    #createVisuals() {
        const width = this.maxX - this.minX;
        const height = this.maxY - this.minY;
        const centerX = (this.minX + this.maxX) * 0.5;
        const centerY = (this.minY + this.maxY) * 0.5;

        this._plane = BABYLON.MeshBuilder.CreatePlane(
            "walkArea_plane",
            { width, height },
            this.scene
        );
        this._plane.position.x = centerX;
        this._plane.position.y = centerY;
        this._plane.position.z = 0.05;
        this._plane.renderingGroupId = 3;

        this._material = new BABYLON.StandardMaterial("walkAreaMat", this.scene);
        this._material.diffuseColor = new BABYLON.Color3(0.2, 0.8, 0.4);
        this._material.emissiveColor = new BABYLON.Color3(0.2, 0.8, 0.4);
        this._material.alpha = 0.45;
        this._material.backFaceCulling = false;
        this._material.disableLighting = true;

        this._plane.material = this._material;
        this._plane.setEnabled(this.visible);
    }

    setVisible(value) {
        this.visible = value;
        if (this._plane) {
            this._plane.setEnabled(value);
        }
    }

    dispose() {
        if (this._plane) {
            this._plane.dispose();
            this._plane = null;
        }
        if (this._material) {
            this._material.dispose();
            this._material = null;
        }
    }

    clampPosition(position) {
        if (!position) return;
        if (position.x < this.minX) position.x = this.minX;
        else if (position.x > this.maxX) position.x = this.maxX;
        if (position.y < this.minY) position.y = this.minY;
        else if (position.y > this.maxY) position.y = this.maxY;
    }

    containsPoint(x, y) {
        return x >= this.minX && x <= this.maxX && y >= this.minY && y <= this.maxY;
    }
}
