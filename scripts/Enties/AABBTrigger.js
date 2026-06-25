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
    }
}