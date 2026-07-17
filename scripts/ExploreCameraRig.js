export class ExploreCameraRig {
    constructor(config = {}) {
        this.config = {
            followDistance: 15,
            followHeight: 3.2,
            smoothing: 0.15,
            orthoWidth: 20,
            ...config
        };

        this.projection = "perspective";
        this._targetPosition = new BABYLON.Vector3(0, 0, 0);
        this._cameraPosition = new BABYLON.Vector3(0, 0, 0);
    }

    enter(ctx) {
        this.projection = "orthographic";
        const pos = ctx?.character?.root?.position;
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
    }

    exit(ctx) {
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

    dispose() {
    }
}