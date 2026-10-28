import { ArrowIndicator } from "./ArrowIndicator.js";

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

        this._hintArrow = null;
    }

    #createDebugMaterial(color) {
        const mat = new BABYLON.StandardMaterial("trigger_debug_mat", this.scene);
        mat.diffuseColor = color;
        mat.alpha = 0.3;
        mat.disableLighting = true;
        return mat;
    }

    checkOverlap(entityOrPos) {
        if (!this._enabled) return false;

        // 兼容三种输入：entity（有 .root.position）、带 .position 的对象、纯 Vector3
        const entityPos = entityOrPos.root?.position
            ?? entityOrPos.position
            ?? entityOrPos;
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
        if (this._hintArrow) {
            this._hintArrow.dispose();
            this._hintArrow = null;
        }
        this._hintArrow = new ArrowIndicator(this.scene, config);
        this._hintConfig = {
            edge: config.edge ?? "bottom",
            offset: config.offset ?? 0.3
        };
        // trigger 是静态的，anchor 预计算一次
        this._hintAnchor = this._computeHintAnchor();
    }

    updateArrow(visible, dtMs) {
        if (!this._hintArrow) return;
        if (visible) {
            this._hintArrow.setAnchor(this._hintAnchor);
            this._hintArrow.setVisible(true);
            this._hintArrow.tick(dtMs);
        } else {
            this._hintArrow.setVisible(false);
        }
    }

    disposeArrow() {
        if (this._hintArrow) {
            this._hintArrow.dispose();
            this._hintArrow = null;
        }
    }

    queryHint(playerPos) {
        if (!this._enabled || this.triggered) return null;
        if (!this.checkOverlap(playerPos)) return null;
        return { anchor: this._hintAnchor };
    }

    _computeHintAnchor() {
        const p = this.position, s = this.size;
        const halfW = s.width / 2, halfH = s.height / 2;
        const { edge, offset } = this._hintConfig;
        switch (edge) {
            case "top":    return new BABYLON.Vector3(p.x, p.y + halfH + offset, p.z);
            case "bottom": return new BABYLON.Vector3(p.x, p.y - halfH - offset, p.z);
            case "left":   return new BABYLON.Vector3(p.x - halfW - offset, p.y, p.z);
            case "right":  return new BABYLON.Vector3(p.x + halfW + offset, p.y, p.z);
            default:       return new BABYLON.Vector3(p.x, p.y - halfH - offset, p.z);
        }
    }
}
