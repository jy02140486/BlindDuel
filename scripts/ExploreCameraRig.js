export class ExploreCameraRig {
    constructor(config = {}) {
        this.config = {
            followDistance: 15,
            followHeight: 3.2,
            smoothing: 0.15,
            orthoWidth: 20,
            clampDuration: 4000,
            ...config
        };
        this._defaultConfig = { ...this.config };

        this.projection = "perspective";
        this._targetPosition = new BABYLON.Vector3(0, 0, 0);
        this._cameraPosition = new BABYLON.Vector3(0, 0, 0);

        this._boundary = null;
        this._axisWarnedX = false;
        this._axisWarnedY = false;

        this._debugVisible = false;
        this._cornerPanels = null;

        this._clampWeightCurrent = 1;
        this._clampWeightTarget = 1;
        this._clampWeightStart = 1;
        this._clampWeightElapsed = 0;
        this._clampWeightDuration = 4000;
    }

    resetConfig() {
        this.config = { ...this._defaultConfig };
        this.setBoundary(null);
    }

    setBoundary(def) {
        if (!def || typeof def !== "object") {
            this._boundary = null;
        } else {
            const b = {};
            for (const k of ["minX", "maxX", "minY", "maxY"]) {
                if (def[k] !== undefined) b[k] = def[k];
            }
            this._boundary = Object.keys(b).length > 0 ? b : null;
        }
        this._axisWarnedX = false;
        this._axisWarnedY = false;
    }

    enter(ctx) {
        this.projection = "orthographic";
        const pos = ctx?.character?.root?.position;
        const seqBusyEnter = ctx?.sceneSequencer?.isBusy?.() ?? false;
        if (pos) {
            this._cameraPosition.set(pos.x, pos.y + this.config.followHeight, pos.z - this.config.followDistance);
            this._targetPosition.copyFrom(pos);
        } else {
            const state = ctx?.cameraManager?.state;
            if (state) {
                this._cameraPosition.copyFrom(state.pos);
                this._targetPosition.copyFrom(state.target);
            }
        }
        // 硬 clamp 无论 seqBusy 都执行：enter 用 hero 位置重置 _cameraPosition（desired），
        // 若不 clamp，desired 与 cameraBlend 终值（clamped）不一致，followBlend 会慢慢拉回产生抖动。
        // seqBusy=true 时仅跳过 setClampEnabled（weight 由 cameraBlend START 手工设 target=1，enter 不覆盖）。
        if (this.projection === "orthographic" && this._boundary) {
            this.#clampCameraPositionHard();
            if (!seqBusyEnter) {
                this.setClampEnabled(true, 0);
            }
        }
    }

    exit(ctx) {
    }

    setClampEnabled(enabled, duration = 4000) {
        const target = enabled ? 1 : 0;
        if (duration <= 0) {
            this._clampWeightCurrent = target;
            this._clampWeightStart = target;
            this._clampWeightTarget = target;
            this._clampWeightElapsed = 0;
            this._clampWeightDuration = 0;
            return;
        }
        this._clampWeightStart = this._clampWeightCurrent;
        this._clampWeightTarget = target;
        this._clampWeightElapsed = 0;
        this._clampWeightDuration = duration;
    }

    toggleProjection() {
        if (this.projection === "perspective") {
            this.projection = "orthographic";
            console.info("[ExploreCameraRig] switched to orthographic");
        } else {
            this.projection = "perspective";
            console.info("[ExploreCameraRig] switched to perspective");
        }
    }

    compute(dtMs, context, prevState) {
        const target = context?.target;
        if (!target) {
            return prevState ? this.#stateFromPrev(prevState) : this.#defaultState();
        }

        const dt = dtMs / 1000;
        const followBlend = Math.min(this.config.smoothing * dt * 60, 1);

        this._targetPosition.copyFrom(target);

        const desiredX = this._targetPosition.x;
        const desiredY = this._targetPosition.y + this.config.followHeight;
        const desiredZ = this._targetPosition.z - this.config.followDistance;

        let finalTargetX = desiredX;
        let finalTargetY = desiredY;

        if (this.projection === "orthographic" && this._boundary) {
            if (this._clampWeightElapsed < this._clampWeightDuration) {
                this._clampWeightElapsed += dtMs;
                const progress = Math.min(this._clampWeightElapsed / this._clampWeightDuration, 1);
                this._clampWeightCurrent = this._clampWeightStart + (this._clampWeightTarget - this._clampWeightStart) * progress;
            } else {
                this._clampWeightCurrent = this._clampWeightTarget;
            }

            const r = this.#computeClamped(desiredX, desiredY);
            finalTargetX = r.x;
            finalTargetY = r.y;
        }

        this._cameraPosition.x += (finalTargetX - this._cameraPosition.x) * followBlend;
        this._cameraPosition.y += (finalTargetY - this._cameraPosition.y) * followBlend;
        this._cameraPosition.z += (desiredZ - this._cameraPosition.z) * followBlend;

        this.#updateCornerPanels();

        const state = this.#defaultState();
        state.pos.copyFrom(this._cameraPosition);
        state.target = this._targetPosition.clone();
        state.projection = this.projection;

        if (this.projection === "orthographic") {
            const windowAspect = window.innerWidth / window.innerHeight;
            const halfWidth = this.config.orthoWidth / 2;
            const halfHeight = (this.config.orthoWidth / windowAspect) / 2;
            state.orthoLeft = -halfWidth;
            state.orthoRight = halfWidth;
            state.orthoTop = halfHeight;
            state.orthoBottom = -halfHeight;
        }

        return state;
    }

    onResize(ctx) {
        // 正交比例由 CameraManager 统一维护
    }

    setDebugVisible(value) {
        this._debugVisible = !!value;
        if (this._debugVisible && !this._cornerPanels) {
            this.#createCornerPanels();
        }
        if (this._cornerPanels) {
            for (const p of this._cornerPanels) {
                p.style.display = this._debugVisible ? "block" : "none";
            }
        }
    }

    #createCornerPanels() {
        const styles = [
            "left:4px;top:4px;",
            "right:4px;top:4px;",
            "left:4px;bottom:4px;",
            "right:4px;bottom:4px;"
        ];
        const labels = ["TL", "TR", "BL", "BR"];
        this._cornerPanels = labels.map((label, i) => {
            const p = document.createElement("div");
            p.style.cssText = `position:fixed;${styles[i]}pointer-events:none;background:rgba(0,0,0,0.7);color:#7fffd4;font:11px/1.2 Consolas,monospace;padding:2px 6px;border:1px solid rgba(255,255,255,0.3);border-radius:3px;white-space:nowrap;z-index:1000;display:none;`;
            p.textContent = `${label} (0.00, 0.00)`;
            document.body.appendChild(p);
            return p;
        });
    }

    #updateCornerPanels() {
        if (!this._debugVisible || !this._cornerPanels) return;
        if (this.projection !== "orthographic") {
            for (const p of this._cornerPanels) p.style.display = "none";
            return;
        }
        for (const p of this._cornerPanels) p.style.display = "block";

        const windowAspect = window.innerWidth / window.innerHeight;
        const halfWidth = this.config.orthoWidth / 2;
        const halfHeight = (this.config.orthoWidth / windowAspect) / 2;
        const cx = this._cameraPosition.x;
        const cy = this._cameraPosition.y;
        const corners = [
            [cx - halfWidth, cy + halfHeight],
            [cx + halfWidth, cy + halfHeight],
            [cx - halfWidth, cy - halfHeight],
            [cx + halfWidth, cy - halfHeight]
        ];
        const labels = ["TL", "TR", "BL", "BR"];
        for (let i = 0; i < 4; i++) {
            this._cornerPanels[i].textContent =
                `${labels[i]} (${corners[i][0].toFixed(2)}, ${corners[i][1].toFixed(2)})`;
        }
    }

    #defaultState() {
        return {
            pos: new BABYLON.Vector3(0, this.config.followHeight, -this.config.followDistance),
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

    #computeClamped(desiredX, desiredY) {
        const b = this._boundary;
        if (!b) return { x: desiredX, y: desiredY };

        const windowAspect = window.innerWidth / window.innerHeight;
        const halfWidth = this.config.orthoWidth / 2;
        const halfHeight = (this.config.orthoWidth / windowAspect) / 2;

        let clampedX = desiredX;
        let clampedY = desiredY;

        if (b.minX !== undefined || b.maxX !== undefined) {
            const minCamX = b.minX !== undefined ? b.minX + halfWidth : -Infinity;
            const maxCamX = b.maxX !== undefined ? b.maxX - halfWidth : Infinity;
            if (minCamX > maxCamX) {
                if (!this._axisWarnedX) {
                    console.warn(`[ExploreCameraRig] camera boundary X 轴区间不足 (viewsize=${halfWidth * 2})，X 轴 clamp 已跳过`);
                    this._axisWarnedX = true;
                }
            } else {
                clampedX = Math.max(minCamX, Math.min(maxCamX, desiredX));
            }
        }

        if (b.minY !== undefined || b.maxY !== undefined) {
            const minCamY = b.minY !== undefined ? b.minY + halfHeight : -Infinity;
            const maxCamY = b.maxY !== undefined ? b.maxY - halfHeight : Infinity;
            if (minCamY > maxCamY) {
                if (!this._axisWarnedY) {
                    console.warn(`[ExploreCameraRig] camera boundary Y 轴区间不足 (viewsize=${halfHeight * 2})，Y 轴 clamp 已跳过`);
                    this._axisWarnedY = true;
                }
            } else {
                clampedY = Math.max(minCamY, Math.min(maxCamY, desiredY));
            }
        }

        const w = this._clampWeightCurrent;
        return {
            x: desiredX + (clampedX - desiredX) * w,
            y: desiredY + (clampedY - desiredY) * w
        };
    }

    #clampCameraPositionHard() {
        const b = this._boundary;
        if (!b) return;

        const windowAspect = window.innerWidth / window.innerHeight;
        const halfWidth = this.config.orthoWidth / 2;
        const halfHeight = (this.config.orthoWidth / windowAspect) / 2;

        if (b.minX !== undefined || b.maxX !== undefined) {
            const minCamX = b.minX !== undefined ? b.minX + halfWidth : -Infinity;
            const maxCamX = b.maxX !== undefined ? b.maxX - halfWidth : Infinity;
            if (minCamX <= maxCamX) {
                this._cameraPosition.x = Math.max(minCamX, Math.min(maxCamX, this._cameraPosition.x));
            } else if (!this._axisWarnedX) {
                console.warn(`[ExploreCameraRig] camera boundary X 轴区间不足 (viewsize=${halfWidth * 2})，X 轴 clamp 已跳过`);
                this._axisWarnedX = true;
            }
        }

        if (b.minY !== undefined || b.maxY !== undefined) {
            const minCamY = b.minY !== undefined ? b.minY + halfHeight : -Infinity;
            const maxCamY = b.maxY !== undefined ? b.maxY - halfHeight : Infinity;
            if (minCamY <= maxCamY) {
                this._cameraPosition.y = Math.max(minCamY, Math.min(maxCamY, this._cameraPosition.y));
            } else if (!this._axisWarnedY) {
                console.warn(`[ExploreCameraRig] camera boundary Y 轴区间不足 (viewsize=${halfHeight * 2})，Y 轴 clamp 已跳过`);
                this._axisWarnedY = true;
            }
        }
    }



    dispose() {
        if (this._cornerPanels) {
            for (const p of this._cornerPanels) p.remove();
            this._cornerPanels = null;
        }
    }
}