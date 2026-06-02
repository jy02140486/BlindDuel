export class ScriptedCameraRig {
    constructor(config = {}) {
        this._center = new BABYLON.Vector3(0, 0, 0);
        this._height = config.defaultHeight ?? 4.2;
        this._orthoWidth = config.defaultOrthoWidth ?? 18;
        this._zOffset = config.defaultZOffset ?? -25;
    }

    enter(ctx) {
        const state = ctx?.cameraManager?.state;
        if (state) {
            this._center.copyFrom(state.target);
            this._height = state.pos.y;
        }
        console.log(`[ScriptedCameraRig] enter center=(${this._center.x.toFixed(2)},${this._center.y.toFixed(2)},${this._center.z.toFixed(2)}) height=${this._height.toFixed(2)}`);
    }

    exit(_ctx) {
        console.log(`[ScriptedCameraRig] exit`);
    }

    setFrame({ center, height, orthoWidth, zOffset }) {
        if (center) {
            this._center.set(center[0], center[1], center[2]);
        }
        if (height !== undefined) this._height = height;
        if (orthoWidth !== undefined) this._orthoWidth = orthoWidth;
        if (zOffset !== undefined) this._zOffset = zOffset;
        console.log(`[ScriptedCameraRig] setFrame center=(${this._center.x.toFixed(2)},${this._center.y.toFixed(2)},${this._center.z.toFixed(2)}) height=${this._height.toFixed(2)} orthoWidth=${this._orthoWidth}`);
    }

    compute(_dtMs, _frameCtx, prevState) {
        const aspect = window.innerWidth / window.innerHeight;
        const halfWidth = this._orthoWidth / 2;
        const halfHeight = (this._orthoWidth / aspect) / 2;

        console.log(`[ScriptedCameraRig] compute center=(${this._center.x.toFixed(2)},${this._center.y.toFixed(2)},${this._center.z.toFixed(2)}) height=${this._height.toFixed(2)}`);

        return {
            pos: new BABYLON.Vector3(
                this._center.x,
                this._height,
                this._center.z + this._zOffset
            ),
            target: this._center.clone(),
            projection: "orthographic",
            orthoLeft: -halfWidth,
            orthoRight: halfWidth,
            orthoTop: halfHeight,
            orthoBottom: -halfHeight,
            fov: prevState?.fov ?? 0.8,
            aspect: aspect
        };
    }
}