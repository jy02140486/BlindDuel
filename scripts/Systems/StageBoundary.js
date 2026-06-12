export class StageBoundary {
    constructor(scene, options = {}) {
        this.scene = scene;
        this.minX = options.minX ?? -8;
        this.maxX = options.maxX ?? 8;
        this.minY = options.minY ?? -Infinity;
        this.maxY = options.maxY ?? Infinity;
        this._yCorrectionSpeed = options.yCorrectionSpeed ?? 8;
        this.visible = true;

        this.pillarLeft = null;
        this.pillarRight = null;
        this.material = null;

        this.#createVisuals();
    }

    #createVisuals() {
        this.material = new BABYLON.StandardMaterial("stageBoundaryMat", this.scene);
        this.material.diffuseColor = new BABYLON.Color3(0, 1, 0.533);
        this.material.emissiveColor = new BABYLON.Color3(0, 1, 0.533);
        this.material.alpha = 0.25;
        this.material.backFaceCulling = false;
        this.material.disableLighting = true;

        const pillarY = Number.isFinite(this.minY) && Number.isFinite(this.maxY)
            ? (this.minY + this.maxY) / 2
            : 1.5;

        this.pillarLeft = BABYLON.MeshBuilder.CreateCylinder(
            "stageBoundary_left",
            { height: 3, diameter: 0.1, tessellation: 16 },
            this.scene
        );
        this.pillarLeft.position.x = this.minX;
        this.pillarLeft.position.y = pillarY;
        this.pillarLeft.position.z = 0;
        this.pillarLeft.material = this.material;
        this.pillarLeft.setEnabled(this.visible);

        this.pillarRight = BABYLON.MeshBuilder.CreateCylinder(
            "stageBoundary_right",
            { height: 3, diameter: 0.1, tessellation: 16 },
            this.scene
        );
        this.pillarRight.position.x = this.maxX;
        this.pillarRight.position.y = pillarY;
        this.pillarRight.position.z = 0;
        this.pillarRight.material = this.material;
        this.pillarRight.setEnabled(this.visible);
    }

    clampCharacter(character, dtMs) {
        if (!character || !character.root) return;
        const pos = character.root.position;
        if (pos.x < this.minX) {
            pos.x = this.minX;
        } else if (pos.x > this.maxX) {
            pos.x = this.maxX;
        }
        if (Number.isFinite(this.minY) && Number.isFinite(this.maxY)) {
            const dtSec = (dtMs ?? 16) / 1000;
            const blend = 1 - Math.exp(-this._yCorrectionSpeed * dtSec);
            if (pos.y < this.minY) {
                pos.y += (this.minY - pos.y) * blend;
            } else if (pos.y > this.maxY) {
                pos.y += (this.maxY - pos.y) * blend;
            }
        }
    }

    setBounds(bounds) {
        if (bounds.minX != null) this.minX = bounds.minX;
        if (bounds.maxX != null) this.maxX = bounds.maxX;
        if (bounds.minY != null) this.minY = bounds.minY;
        if (bounds.maxY != null) this.maxY = bounds.maxY;
        const pillarY = Number.isFinite(this.minY) && Number.isFinite(this.maxY)
            ? (this.minY + this.maxY) / 2
            : 1.5;
        if (this.pillarLeft) {
            this.pillarLeft.position.x = this.minX;
            this.pillarLeft.position.y = pillarY;
        }
        if (this.pillarRight) {
            this.pillarRight.position.x = this.maxX;
            this.pillarRight.position.y = pillarY;
        }
    }

    setVisible(value) {
        this.visible = value;
        if (this.pillarLeft) this.pillarLeft.setEnabled(value);
        if (this.pillarRight) this.pillarRight.setEnabled(value);
    }

    dispose() {
        if (this.pillarLeft) {
            this.pillarLeft.dispose();
            this.pillarLeft = null;
        }
        if (this.pillarRight) {
            this.pillarRight.dispose();
            this.pillarRight = null;
        }
        if (this.material) {
            this.material.dispose();
            this.material = null;
        }
    }
}