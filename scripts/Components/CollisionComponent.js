export class CollisionComponent {
    constructor(scene, rootNode, colliderClips = {}, options = {}) {
        this.scene = scene;
        this.rootNode = rootNode;
        this.colliderClips = colliderClips;
        this.currentClipName = null;
        this.currentColliderData = null;
        this.pxToWorld = options.pxToWorld ?? 0.02;
        this.thicknessPx = options.thicknessPx ?? 40;
        this.visible = options.visible ?? true;

        this.debugMeshesById = new Map();
        this.materialByType = this.#createMaterials(scene);
    }

    #createMaterials(scene) {
        const makeMat = (name, color) => {
            const mat = new BABYLON.StandardMaterial(name, scene);
            mat.diffuseColor = color;
            mat.alpha = 0.35;
            return mat;
        };

        return {
            hitbox: makeMat("hitBoxMat", new BABYLON.Color3(1, 1, 0)),
            weaponbox: makeMat("weaponBoxMat", new BABYLON.Color3(1, 0.3, 0.3)),
            "weaponbox:strong_blade": makeMat("weaponStrongBoxMat", new BABYLON.Color3(0.89, 0.47, 0)),
            "weaponbox:weak_blade": makeMat("weaponWeakBoxMat", new BABYLON.Color3(1, 0, 0)),
            pushbox: makeMat("pushBoxMat", new BABYLON.Color3(0, 0.6, 1)),
            default: makeMat("defaultBoxMat", new BABYLON.Color3(1, 0.5, 0))
        };
    }

    #getMaterialForBox(box) {
        const subtypeKey = box.subtype ? `${box.type}:${box.subtype}` : null;
        if (subtypeKey && this.materialByType[subtypeKey]) {
            return this.materialByType[subtypeKey];
        }

        return this.materialByType[box.type] || this.materialByType.default;
    }

    setVisible(value) {
        this.visible = value;
        for (const mesh of this.debugMeshesById.values()) {
            mesh.setEnabled(value);
        }
    }

    setClips(colliderClips) {
        this.colliderClips = colliderClips;
    }

    setClip(clipName) {
        const colliderData = this.colliderClips[clipName];
        if (!colliderData) {
            throw new Error(`Unknown collision clip: ${clipName}`);
        }

        this.currentClipName = clipName;
        this.currentColliderData = colliderData;

        for (const mesh of this.debugMeshesById.values()) {
            mesh.setEnabled(false);
        }
    }

    syncToFrame(frameIndex, frameWidth, frameHeight, anchor = null) {
        const frame = this.currentColliderData?.frames?.[frameIndex];
        const boxes = frame ? frame.boxes : [];
        const activeIds = new Set();
        const anchorOffsetX = anchor ? (anchor.cx - frameWidth / 2) * this.pxToWorld : 0;
        const anchorOffsetY = anchor ? (frameHeight / 2 - anchor.cy) * this.pxToWorld : 0;

        for (const box of boxes) {
            activeIds.add(box.id);
            let mesh = this.debugMeshesById.get(box.id);
            if (!mesh) {
                mesh = BABYLON.MeshBuilder.CreateBox(`box_${box.id}`, { size: 1 }, this.scene);
                mesh.parent = this.rootNode;
                mesh.renderingGroupId = 2;
                this.debugMeshesById.set(box.id, mesh);
            }

            mesh.material = this.#getMaterialForBox(box);
            mesh.setEnabled(this.visible);
            mesh.position.x = (box.cx - frameWidth / 2) * this.pxToWorld - anchorOffsetX;
            mesh.position.y = (frameHeight / 2 - box.cy) * this.pxToWorld - anchorOffsetY;
            mesh.position.z = 0;

            mesh.rotation.x = 0;
            mesh.rotation.y = 0;
            mesh.rotation.z = -box.angle * Math.PI / 180;

            mesh.scaling.x = box.w * this.pxToWorld;
            mesh.scaling.y = box.h * this.pxToWorld;
            mesh.scaling.z = this.thicknessPx * this.pxToWorld;
        }

        for (const [id, mesh] of this.debugMeshesById.entries()) {
            if (!activeIds.has(id)) {
                mesh.setEnabled(false);
            }
        }
    }
}
