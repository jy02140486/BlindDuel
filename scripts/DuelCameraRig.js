/*
DuelCameraRig - 格斗场景相机架

基类：UniversalCamera（原 ArcRotateCamera 已迁移）
- 侧视固定角度，通过 position + lookAt 控制
- 支持透视/正交投影切换（Phase D）

透视模式：
- "zoom" 通过调整 camera.position.z（远离/靠近目标）实现
- 保持固定 fov

正交模式（规划中）：
- position 相对 target 固定偏移
- "zoom" 通过调整 orthoLeft/Right/Top/Bottom 实现
- 固定 16:9 视口比例
*/
export class DuelCameraRig {
    constructor(options = {}) {
        this.camera = null;
        this.canvas = null;

        // 通用配置
        this.smoothing = options.smoothing ?? 8;

        // 相机高度（Y 方向偏移）
        this.cameraHeight = options.cameraHeight ?? 8;
        // 相机在 target 后方的距离（Z 方向，正数 = 后方）
        this.cameraDistance = options.cameraDistance ?? 25;

        // 透视模式 zoom 范围
        this.minZoomDistance = options.minZoomDistance ?? 15;
        this.maxZoomDistance = options.maxZoomDistance ?? 35;
        this.zoomScale = options.zoomScale ?? 1.5;

        // 正交模式
        this.baseOrthoWidth = options.baseOrthoWidth ?? 20;
        this.minOrthoWidth = options.minOrthoWidth ?? 15;
        this.maxOrthoWidth = options.maxOrthoWidth ?? 40;
        this.orthoZoomScale = options.orthoZoomScale ?? 8;
        this.targetAspect = options.targetAspect ?? (16 / 9);

        // 运行时状态
        this.currentBasePosition = new BABYLON.Vector3(0, this.cameraHeight, -this.cameraDistance);
        this.currentTarget = new BABYLON.Vector3(0, 0, 0);
        this.projection = "perspective"; // "perspective" | "orthographic"
    }

    init(scene, canvas) {
        this.canvas = canvas;

        this.camera = new BABYLON.UniversalCamera(
            "duel_camera",
            new BABYLON.Vector3(0, this.cameraHeight, -this.cameraDistance),
            scene
        );

        // 默认透视模式
        this.camera.mode = BABYLON.Camera.PERSPECTIVE_CAMERA;

        // 设为场景主相机
        scene.activeCamera = this.camera;

        // 不附加控制，完全由代码驱动
        // this.camera.attachControl(canvas, false);
        this.camera.inputs.clear();

        // 暂时不锁定朝向，让 inspector 可以手动调整 rotation 观察行为
        // this.camera.lockedTarget = new BABYLON.Vector3(0, this.targetHeight, -1);

        console.info("[CameraRig] mode=duel (UniversalCamera, perspective, rotation-free)");
    }

    /**
     * 切换透视/正交投影
     */
    toggleProjection() {
        if (!this.camera) return;

        if (this.projection === "perspective") {
            this.projection = "orthographic";
            this.camera.mode = BABYLON.Camera.ORTHOGRAPHIC_CAMERA;

            const canvas = this.camera.getEngine().getRenderingCanvas();
            const windowAspect = canvas ? (canvas.width / canvas.height) : (16 / 9);

            const halfWidth = this.baseOrthoWidth / 2;
            const halfHeight = (this.baseOrthoWidth / windowAspect) / 2;
            this.camera.orthoLeft = -halfWidth;
            this.camera.orthoRight = halfWidth;
            this.camera.orthoTop = halfHeight;
            this.camera.orthoBottom = -halfHeight;

            console.info("[CameraRig] switched to orthographic");
        } else {
            this.projection = "perspective";
            this.camera.mode = BABYLON.Camera.PERSPECTIVE_CAMERA;

            // 重置 position.z 到基准值，避免切换时跳变
            this.camera.position.z = this.baseOffsetZ;

            console.info("[CameraRig] switched to perspective");
        }
    }

    /**
     * 窗口缩放时保持正交比例（根据实际窗口比例）
     */
    onResize() {
        if (!this.camera || this.projection !== "orthographic") return;

        const canvas = this.camera.getEngine().getRenderingCanvas();
        if (!canvas) return;

        const windowAspect = canvas.width / canvas.height;
        const currentWidth = this.camera.orthoRight - this.camera.orthoLeft;
        const halfHeight = (currentWidth / windowAspect) / 2;
        this.camera.orthoTop = halfHeight;
        this.camera.orthoBottom = -halfHeight;
    }

    update(dtMs, context) {
        if (!this.camera) {
            return;
        }

        const basePosition = context?.basePosition;
        const target = context?.target;
        const fighterDistance = context?.fighterDistance ?? 0;

        if (!basePosition || !target) {
            return;
        }

        const blend = 1 - Math.exp((-this.smoothing * dtMs) / 1000);

        // 平滑 basePosition（相机基准位置）
        this.currentBasePosition.x += (basePosition.x - this.currentBasePosition.x) * blend;
        this.currentBasePosition.y += (basePosition.y - this.currentBasePosition.y) * blend;
        this.currentBasePosition.z += (basePosition.z - this.currentBasePosition.z) * blend;

        // 平滑 target（相机看向的点）
        this.currentTarget.x += (target.x - this.currentTarget.x) * blend;
        this.currentTarget.y += (target.y - this.currentTarget.y) * blend;
        this.currentTarget.z += (target.z - this.currentTarget.z) * blend;

        if (this.projection === "perspective") {
            // 透视模式：根据人物距离调整 cameraDistance（zoom）
            const desiredDistance = BABYLON.Scalar.Clamp(
                this.cameraDistance + fighterDistance * this.zoomScale,
                this.minZoomDistance,
                this.maxZoomDistance
            );

            // 相机位置 = target 后方 desiredDistance 处
            this.camera.position.x = this.currentBasePosition.x;
            this.camera.position.y = this.currentBasePosition.y;
            this.camera.position.z = this.currentTarget.z - desiredDistance;
        } else {
            // 正交模式：固定相机位置，调整 ortho 范围
            this.camera.position.x = this.currentBasePosition.x;
            this.camera.position.y = this.currentBasePosition.y;
            this.camera.position.z = this.currentBasePosition.z;

            const desiredWidth = BABYLON.Scalar.Clamp(
                this.baseOrthoWidth + fighterDistance * this.orthoZoomScale,
                this.minOrthoWidth,
                this.maxOrthoWidth
            );

            const halfWidth = desiredWidth / 2;
            const halfHeight = (desiredWidth / this.targetAspect) / 2;

            this.camera.orthoLeft += (-halfWidth - this.camera.orthoLeft) * blend;
            this.camera.orthoRight += (halfWidth - this.camera.orthoRight) * blend;
            this.camera.orthoTop += (halfHeight - this.camera.orthoTop) * blend;
            this.camera.orthoBottom += (-halfHeight - this.camera.orthoBottom) * blend;
        }

        // 让相机朝向 target（只在需要时启用）
        // this.camera.setTarget(this.currentTarget);
    }

    dispose() {
        if (!this.camera) {
            return;
        }
        this.camera.detachControl(this.canvas);
        this.camera.dispose();
        this.camera = null;
        this.canvas = null;
    }
}
