export class ScriptedCameraRig {
    constructor(config = {}) {
        this._center = new BABYLON.Vector3(0, 0, 0);
        this._height = config.defaultHeight ?? 4.2;
        this._orthoWidth = config.defaultOrthoWidth ?? 18;
        this._zOffset = config.defaultZOffset ?? -25;
        this._followTarget = null;
        this._followOffset = new BABYLON.Vector3(0, 0, 0);
        this._followLerp = 0.12;
    }

    enter(ctx) {
        this._followTarget = null;
        const state = ctx?.cameraManager?.state;
        if (state) {
            this._center.copyFrom(state.target);
            this._height = state.pos.y;
        }
        console.log(`[ScriptedCameraRig] enter center=(${this._center.x.toFixed(2)},${this._center.y.toFixed(2)},${this._center.z.toFixed(2)}) height=${this._height.toFixed(2)}`);
    }

    setFollowTarget(actor, opts = {}) {
        if (!actor || !actor.root) {
            console.warn("[ScriptedCameraRig] setFollowTarget: actor or actor.root missing");
            return;
        }
        this._followTarget = actor;
        this._followOffset.set(
            opts.offsetX ?? 0,
            opts.offsetY ?? 0,
            opts.offsetZ ?? 0
        );
        this._followLerp = opts.lerp ?? 0.12;
        if (opts.height !== undefined) this._height = opts.height;
        if (opts.orthoWidth !== undefined) this._orthoWidth = opts.orthoWidth;
        console.log(`[ScriptedCameraRig] setFollowTarget actor=${actor.id ?? actor.name} lerp=${this._followLerp} offset=(${this._followOffset.x},${this._followOffset.y},${this._followOffset.z})`);
    }

    clearFollow() {
        if (this._followTarget) {
            console.log(`[ScriptedCameraRig] clearFollow`);
        }
        this._followTarget = null;
    }

    exit(_ctx) {
        this.clearFollow();
        console.log(`[ScriptedCameraRig] exit`);
    }

    setFrame({ center, height, orthoWidth, zOffset }) {
        if (center) {
            this._center.set(center[0], center[1], center[2]);
        }
        if (height !== undefined) this._height = height;
        if (orthoWidth !== undefined) this._orthoWidth = orthoWidth;
        if (zOffset !== undefined) this._zOffset = zOffset;
        this._followTarget = null;
        console.log(`[ScriptedCameraRig] setFrame center=(${this._center.x.toFixed(2)},${this._center.y.toFixed(2)},${this._center.z.toFixed(2)}) height=${this._height.toFixed(2)} orthoWidth=${this._orthoWidth}`);
    }

    compute(dtMs, _frameCtx, prevState) {
        if (this._followTarget && this._followTarget.root) {
            const targetPos = this._followTarget.root.position;
            const desiredX = targetPos.x + this._followOffset.x;
            const desiredY = targetPos.y + this._followOffset.y;
            const desiredZ = targetPos.z + this._followOffset.z;
            const k = 1 - Math.pow(1 - this._followLerp, dtMs / 16.67);
            this._center.x += (desiredX - this._center.x) * k;
            this._center.y += (desiredY - this._center.y) * k;
            this._center.z += (desiredZ - this._center.z) * k;
        }

        const aspect = window.innerWidth / window.innerHeight;
        const halfWidth = this._orthoWidth / 2;
        const halfHeight = (this._orthoWidth / aspect) / 2;

        // [JITTER_DEBUG] disabled: too verbose during normal operation

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