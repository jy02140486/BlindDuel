export class ExploreCollisionSystem {
    constructor() {
        this._debugMeshes = [];
    }

    resolveMovement(entity, blockers, walkArea) {
        const pos = entity.root.position;

        for (const blocker of blockers) {
            const blockerAabb = blocker.getBlockerAabb();
            if (!blockerAabb) continue;

            const entityAabb = entity.getBlockerAabb?.() ?? null;
            let overlapLeft, overlapRight, overlapBottom, overlapTop;

            if (entityAabb) {
                if (entityAabb.maxX <= blockerAabb.minX || entityAabb.minX >= blockerAabb.maxX ||
                    entityAabb.maxY <= blockerAabb.minY || entityAabb.minY >= blockerAabb.maxY) {
                    continue;
                }
                overlapLeft = entityAabb.maxX - blockerAabb.minX;
                overlapRight = blockerAabb.maxX - entityAabb.minX;
                overlapBottom = entityAabb.maxY - blockerAabb.minY;
                overlapTop = blockerAabb.maxY - entityAabb.minY;
            } else {
                if (pos.x < blockerAabb.minX || pos.x > blockerAabb.maxX ||
                    pos.y < blockerAabb.minY || pos.y > blockerAabb.maxY) {
                    continue;
                }
                overlapLeft = pos.x - blockerAabb.minX;
                overlapRight = blockerAabb.maxX - pos.x;
                overlapBottom = pos.y - blockerAabb.minY;
                overlapTop = blockerAabb.maxY - pos.y;
            }

            const minOverlap = Math.min(overlapLeft, overlapRight, overlapBottom, overlapTop);

            if (minOverlap === overlapLeft) pos.x -= overlapLeft;
            else if (minOverlap === overlapRight) pos.x += overlapRight;
            else if (minOverlap === overlapBottom) pos.y -= overlapBottom;
            else pos.y += overlapTop;
        }

        if (walkArea) {
            walkArea.clampPosition(pos);
        }
    }

    createDebugMeshes(blockers, scene, dynamicActors) {
        this.disposeDebugMeshes();
        for (const actor of (dynamicActors || [])) {
            const aabb = actor.getBlockerAabb?.();
            if (!aabb) continue;
            this._debugMeshes.push(this._createAabbWireframe(aabb, scene, new BABYLON.Color3(0, 1, 0)));
        }
        for (const blocker of (blockers || [])) {
            const aabb = blocker.getBlockerAabb();
            if (!aabb) continue;
            this._debugMeshes.push(this._createAabbWireframe(aabb, scene, new BABYLON.Color3(1, 0, 0)));
        }
    }

    updateDebugMeshes(blockers, scene, dynamicActors) {
        this.disposeDebugMeshes();
        for (const actor of (dynamicActors || [])) {
            const aabb = actor.getBlockerAabb?.();
            if (!aabb) continue;
            this._debugMeshes.push(this._createAabbWireframe(aabb, scene, new BABYLON.Color3(0, 1, 0)));
        }
        for (const blocker of (blockers || [])) {
            const aabb = blocker.getBlockerAabb();
            if (!aabb) continue;
            this._debugMeshes.push(this._createAabbWireframe(aabb, scene, new BABYLON.Color3(1, 0, 0)));
        }
    }

    disposeDebugMeshes() {
        for (const mesh of this._debugMeshes) {
            mesh.dispose();
        }
        this._debugMeshes.length = 0;
    }

    _createAabbWireframe(aabb, scene, color) {
        const worldW = aabb.maxX - aabb.minX;
        const worldH = aabb.maxY - aabb.minY;
        const centerX = (aabb.minX + aabb.maxX) / 2;
        const centerY = (aabb.minY + aabb.maxY) / 2;

        const plane = BABYLON.MeshBuilder.CreatePlane("aabb_debug", {
            width: worldH,
            height: worldW,
            sideOrientation: BABYLON.Mesh.DOUBLESIDE
        }, scene);
        plane.position.set(centerX, centerY, -0.01);
        plane.rotation.z = Math.PI / 2;
        plane.renderingGroupId = 2;

        const mat = new BABYLON.StandardMaterial("aabb_debug_mat", scene);
        mat.diffuseColor = color;
        mat.alpha = 0.25;
        mat.backFaceCulling = false;
        mat.disableLighting = true;
        mat.wireframe = true;
        plane.material = mat;

        return plane;
    }
}