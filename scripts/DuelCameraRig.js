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

        // 角色间距 → zoom 映射（共用输入范围）
        this.zoomMinDistance = options.zoomMinDistance ?? 1.6;  // 角色间距最小时（贴脸）
        this.zoomMaxDistance = options.zoomMaxDistance ?? 6.4;  // 角色间距最大时（最远）

        // 正交模式输出
        this.orthoMinWidth = options.orthoMinWidth ?? 12;       // 间距最小时的 width（最大 zoom in）
        this.orthoMaxWidth = options.orthoMaxWidth ?? 50;       // 间距最大时的 width（最大 zoom out）

        // 透视模式输出
        this.perspMinDistance = options.perspMinDistance ?? 15; // 间距最小时的 camera distance（最近）
        this.perspMaxDistance = options.perspMaxDistance ?? 35; // 间距最大时的 camera distance（最远）

        // 高度输出（共用同一套 t）
        this.minCameraHeight = options.minCameraHeight ?? 3;    // 间距最小时的高度（最低）
        this.maxCameraHeight = options.maxCameraHeight ?? 8;    // 间距最大时的高度（最高）

        this.targetAspect = options.targetAspect ?? (16 / 9);

        // 运行时状态
        this.currentBasePosition = new BABYLON.Vector3(0, this.maxCameraHeight, -this.perspMaxDistance);
        this.currentTarget = new BABYLON.Vector3(0, 0, 0);
        this.projection = "perspective"; // "perspective" | "orthographic"

        // Debug 面板
        this.debugPanel = this.#createDebugPanel();
    }

    init(scene, canvas) {
        this.canvas = canvas;

        this.camera = new BABYLON.UniversalCamera(
            "duel_camera",
            new BABYLON.Vector3(0, this.maxCameraHeight, -this.perspMaxDistance),
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

    #createDebugPanel() {
        const panel = document.createElement("pre");
        panel.style.position = "fixed";
        panel.style.left = "12px";
        panel.style.bottom = "140px";
        panel.style.margin = "0";
        panel.style.padding = "10px 12px";
        panel.style.background = "rgba(0, 0, 0, 0.55)";
        panel.style.color = "#d8e7ff";
        panel.style.font = "12px/1.5 Consolas, monospace";
        panel.style.zIndex = "10";
        panel.style.pointerEvents = "none";
        panel.style.border = "1px solid rgba(255,255,255,0.12)";
        panel.textContent = "Camera Debug";
        document.body.appendChild(panel);
        return panel;
    }

    #renderDebugPanel(fighterDistance, desiredWidth, desiredDistance, desiredHeight, zoomT) {
        if (!this.debugPanel) return;
        const mode = this.projection;
        const zoomVal = mode === "orthographic" ? desiredWidth.toFixed(2) : desiredDistance.toFixed(2);
        const zoomLabel = mode === "orthographic" ? "orthoWidth" : "distance";
        this.debugPanel.textContent = [
            "Camera Debug",
            `Mode: ${mode}`,
            `FighterDistance: ${fighterDistance.toFixed(2)}`,
            `zoomT: ${zoomT.toFixed(2)}`,
            `${zoomLabel}: ${zoomVal}`,
            `Height Y: ${desiredHeight.toFixed(2)}`
        ].join("\n");
    }

    /**
     * 切换透视/正交投影
     */
    toggleProjection() {
        if (!this.camera) return;

        if (this.projection === "perspective") {
            this.projection = "orthographic";
            this.camera.mode = BABYLON.Camera.ORTHOGRAPHIC_CAMERA;

            const windowAspect = window.innerWidth / window.innerHeight;

            const halfWidth = this.orthoMaxWidth / 2;
            const halfHeight = (this.orthoMaxWidth / windowAspect) / 2;
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

        // 角色间距 → 归一化 t（0=贴脸/minDistance，1=最远/maxDistance）
        const zoomT = BABYLON.Scalar.Clamp(
            (fighterDistance - this.zoomMinDistance) / (this.zoomMaxDistance - this.zoomMinDistance),
            0, 1
        );

        // 高度随间距变化
        const desiredHeight = BABYLON.Scalar.Lerp(this.minCameraHeight, this.maxCameraHeight, zoomT);

        if (this.projection === "perspective") {
            // 透视模式：相机 distance 随间距变化
            const desiredDistance = BABYLON.Scalar.Lerp(this.perspMinDistance, this.perspMaxDistance, zoomT);

            this.camera.position.x = this.currentBasePosition.x;
            this.camera.position.y = desiredHeight;
            this.camera.position.z = this.currentTarget.z - desiredDistance;

            this.#renderDebugPanel(fighterDistance, 0, desiredDistance, desiredHeight, zoomT);
        } else {
            // 正交模式：ortho width 随间距变化
            const desiredWidth = BABYLON.Scalar.Lerp(this.orthoMinWidth, this.orthoMaxWidth, zoomT);

            this.camera.position.x = this.currentBasePosition.x;
            this.camera.position.y = desiredHeight;
            this.camera.position.z = this.currentBasePosition.z;

            const windowAspect = window.innerWidth / window.innerHeight;
            const halfWidth = desiredWidth / 2;
            const halfHeight = (desiredWidth / windowAspect) / 2;

            this.camera.orthoLeft += (-halfWidth - this.camera.orthoLeft) * blend;
            this.camera.orthoRight += (halfWidth - this.camera.orthoRight) * blend;
            this.camera.orthoTop += (halfHeight - this.camera.orthoTop) * blend;
            this.camera.orthoBottom += (-halfHeight - this.camera.orthoBottom) * blend;

            this.#renderDebugPanel(fighterDistance, desiredWidth, 0, desiredHeight, zoomT);
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
        this.debugPanel?.remove();
        this.debugPanel = null;
    }
}
