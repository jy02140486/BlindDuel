export class ExploreCameraRig {
    constructor(config = {}) {
        this.config = {
            followDistance: 15,
            followHeight: 4,
            smoothing: 0.15,
            orthoWidth: 20,
            ...config
        };
        
        this.scene = null;
        this.canvas = null;
        this.camera = null;
        this.enabled = false;
        this.projection = "perspective";
        this._targetPosition = new BABYLON.Vector3(0, 0, 0);
        this._cameraPosition = new BABYLON.Vector3(0, 0, 0);
    }

    init(scene, canvas) {
        this.scene = scene;
        this.canvas = canvas;
        
        this.camera = new BABYLON.UniversalCamera(
            "exploreCamera",
            new BABYLON.Vector3(0, this.config.followHeight, -this.config.followDistance),
            scene
        );
        
        this.camera.mode = BABYLON.Camera.PERSPECTIVE_CAMERA;
        scene.activeCamera = this.camera;
        
        this.camera.inputs.clear();
        
        this.enabled = true;
    }

    enable() {
        this.enabled = true;
        if (this.camera) {
            this.camera.setEnabled(true);
            if (this.scene) {
                this.scene.activeCamera = this.camera;
            }
        }
    }

    disable() {
        this.enabled = false;
        if (this.camera) {
            this.camera.setEnabled(false);
        }
    }

    toggleProjection() {
        if (!this.camera) return;

        if (this.projection === "perspective") {
            this.projection = "orthographic";
            this.camera.mode = BABYLON.Camera.ORTHOGRAPHIC_CAMERA;

            const windowAspect = this.canvas.width / this.canvas.height;
            const halfWidth = this.config.orthoWidth / 2;
            const halfHeight = (this.config.orthoWidth / windowAspect) / 2;
            this.camera.orthoLeft = -halfWidth;
            this.camera.orthoRight = halfWidth;
            this.camera.orthoTop = halfHeight;
            this.camera.orthoBottom = -halfHeight;

            console.info("[ExploreCameraRig] switched to orthographic");
        } else {
            this.projection = "perspective";
            this.camera.mode = BABYLON.Camera.PERSPECTIVE_CAMERA;

            console.info("[ExploreCameraRig] switched to perspective");
        }
    }

    update(dtMs, { basePosition, target }) {
        if (!this.enabled || !this.camera || !target) {
            return;
        }
        
        const dt = dtMs / 1000;
        const blend = Math.min(this.config.smoothing * dt * 60, 1);
        
        this._targetPosition.copyFrom(target);
        
        const desiredCameraPos = new BABYLON.Vector3(
            this._targetPosition.x,
            this._targetPosition.y + this.config.followHeight,
            this._targetPosition.z - this.config.followDistance
        );
        
        this._cameraPosition.x += (desiredCameraPos.x - this._cameraPosition.x) * blend;
        this._cameraPosition.y += (desiredCameraPos.y - this._cameraPosition.y) * blend;
        this._cameraPosition.z += (desiredCameraPos.z - this._cameraPosition.z) * blend;
        
        this.camera.position.copyFrom(this._cameraPosition);

        if (this.projection === "orthographic") {
            const windowAspect = this.canvas.width / this.canvas.height;
            const halfWidth = this.config.orthoWidth / 2;
            const halfHeight = (this.config.orthoWidth / windowAspect) / 2;

            this.camera.orthoLeft += (-halfWidth - this.camera.orthoLeft) * blend;
            this.camera.orthoRight += (halfWidth - this.camera.orthoRight) * blend;
            this.camera.orthoTop += (halfHeight - this.camera.orthoTop) * blend;
            this.camera.orthoBottom += (-halfHeight - this.camera.orthoBottom) * blend;
        }
    }

    onResize() {
        if (this.camera && this.canvas) {
            if (this.projection === "orthographic") {
                const windowAspect = this.canvas.width / this.canvas.height;
                const currentWidth = this.camera.orthoRight - this.camera.orthoLeft;
                const halfHeight = (currentWidth / windowAspect) / 2;
                this.camera.orthoTop = halfHeight;
                this.camera.orthoBottom = -halfHeight;
            }
            this.camera.aspectRatio = this.canvas.width / this.canvas.height;
            this.camera.updateProjectionMatrix();
        }
    }

    dispose() {
        if (this.camera) {
            this.camera.dispose();
            this.camera = null;
        }
    }
}