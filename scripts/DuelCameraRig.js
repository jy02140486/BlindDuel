/*
DuelCameraRig - 格斗场景相机架（纯计算适配器）

职责：根据角色位置计算目标相机状态，不直接操作 Babylon Camera。
由 CameraManager 调用 compute() 获取 desiredState，再统一写入 Camera。
*/
export class DuelCameraRig {
    constructor(options = {}) {
        // 通用配置
        this.smoothing = options.smoothing ?? 8;

        // 角色间距 → zoom 映射（共用输入范围）
        this.zoomMinDistance = options.zoomMinDistance ?? 1.6;
        this.zoomMaxDistance = options.zoomMaxDistance ?? 6.4;

        // 正交模式输出
        this.orthoMinWidth = options.orthoMinWidth ?? 12;
        this.orthoMaxWidth = options.orthoMaxWidth ?? 50;

        // 透视模式输出
        this.perspMinDistance = options.perspMinDistance ?? 15;
        this.perspMaxDistance = options.perspMaxDistance ?? 35;

        // 高度输出（共用同一套 t）
        this.minCameraHeight = options.minCameraHeight ?? 3;
        this.maxCameraHeight = options.maxCameraHeight ?? 8;

        this.targetAspect = options.targetAspect ?? (16 / 9);

        // 运行时状态
        this.currentBasePosition = new BABYLON.Vector3(0, this.maxCameraHeight, -this.perspMaxDistance);
        this.currentTarget = new BABYLON.Vector3(0, 0, 0);
        this.projection = "orthographic";

        // Debug 面板
        this.debugPanel = this.#createDebugPanel();
    }

    enter(ctx) {
        const state = ctx?.cameraManager?.state;
        if (state) {
            this.currentBasePosition.copyFrom(state.pos);
            this.currentTarget.copyFrom(state.target);
        }
    }

    exit(ctx) {
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
        if (this.projection === "perspective") {
            this.projection = "orthographic";
            console.info("[CameraRig] switched to orthographic");
        } else {
            this.projection = "perspective";
            console.info("[CameraRig] switched to perspective");
        }
    }

    onResize() {
        // 正交比例由 CameraManager 统一维护
    }

    compute(dtMs, context, prevState) {
        const basePosition = context?.basePosition;
        const target = context?.target;
        const fighterDistance = context?.fighterDistance ?? 0;

        if (!basePosition || !target) {
            return prevState ? this.#stateFromPrev(prevState) : this.#defaultState();
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

        // 角色间距 → 归一化 t
        const zoomT = BABYLON.Scalar.Clamp(
            (fighterDistance - this.zoomMinDistance) / (this.zoomMaxDistance - this.zoomMinDistance),
            0, 1
        );

        const desiredHeight = BABYLON.Scalar.Lerp(this.minCameraHeight, this.maxCameraHeight, zoomT);

        const state = this.#defaultState();
        state.target = this.currentTarget.clone();
        state.projection = this.projection;

        if (this.projection === "perspective") {
            const desiredDistance = BABYLON.Scalar.Lerp(this.perspMinDistance, this.perspMaxDistance, zoomT);
            state.pos.set(this.currentBasePosition.x, desiredHeight, this.currentTarget.z - desiredDistance);
            this.#renderDebugPanel(fighterDistance, 0, desiredDistance, desiredHeight, zoomT);
        } else {
            const desiredWidth = BABYLON.Scalar.Lerp(this.orthoMinWidth, this.orthoMaxWidth, zoomT);
            state.pos.set(this.currentBasePosition.x, desiredHeight, this.currentBasePosition.z);

            const windowAspect = window.innerWidth / window.innerHeight;
            const halfWidth = desiredWidth / 2;
            const halfHeight = (desiredWidth / windowAspect) / 2;
            state.orthoLeft = -halfWidth;
            state.orthoRight = halfWidth;
            state.orthoTop = halfHeight;
            state.orthoBottom = -halfHeight;
            this.#renderDebugPanel(fighterDistance, desiredWidth, 0, desiredHeight, zoomT);
        }

        return state;
    }

    dispose() {
        this.debugPanel?.remove();
        this.debugPanel = null;
    }

    #defaultState() {
        return {
            pos: new BABYLON.Vector3(0, this.maxCameraHeight, -this.perspMaxDistance),
            target: new BABYLON.Vector3(0, 0, 0),
            projection: this.projection,
            orthoLeft: -10,
            orthoRight: 10,
            orthoTop: 5.6,
            orthoBottom: -5.6,
            fov: 0.8,
            aspect: 16 / 9
        };
    }

    #stateFromPrev(prevState) {
        return {
            pos: prevState.pos.clone(),
            target: prevState.target.clone(),
            projection: prevState.projection,
            orthoLeft: prevState.orthoLeft,
            orthoRight: prevState.orthoRight,
            orthoTop: prevState.orthoTop,
            orthoBottom: prevState.orthoBottom,
            fov: prevState.fov,
            aspect: prevState.aspect
        };
    }
}
