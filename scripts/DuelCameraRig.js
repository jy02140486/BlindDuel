/*
ArcRotateCamera uses spherical coordinates around a target:
- alpha/beta: orbit angles
- radius: camera-to-target distance

In this rig, "zoom" is implemented by changing `camera.radius`,
so option names keep the Babylon term `radius` for clarity.
*/
export class DuelCameraRig {
    constructor(options = {}) {
        this.camera = null;
        this.canvas = null;
        // Camera target Y offset in world units.
        this.targetHeight = options.targetHeight ?? 0;
        // Hard clamp for camera radius (zoom-in / zoom-out limits).
        this.minRadius = options.minRadius ?? 5;
        this.maxRadius = options.maxRadius ?? 12;
        // Radius when fighters are close.
        this.baseRadius = options.baseRadius ?? 6;
        // How much radius grows with fighter distance.
        this.zoomScale = options.zoomScale ?? 1.5;
        // Follow responsiveness (higher = snappier, lower = smoother).
        this.smoothing = options.smoothing ?? 8;
        // ArcRotate viewing angles.
        this.alpha = options.alpha ?? -Math.PI / 2;
        this.beta = options.beta ?? Math.PI / 2.5;
    }

    init(scene, canvas) {
        this.canvas = canvas;
        this.camera = new BABYLON.ArcRotateCamera(
            "duel_camera",
            this.alpha,
            this.beta,
            this.baseRadius,
            new BABYLON.Vector3(0, this.targetHeight, 0),
            scene
        );
        
        // 使用透视摄像机（默认模式）
        this.camera.mode = BABYLON.Camera.PERSPECTIVE_CAMERA;
        
        this.camera.attachControl(canvas, false);
        this.camera.lowerRadiusLimit = this.minRadius;
        this.camera.upperRadiusLimit = this.maxRadius;
        this.camera.inputs.clear();
        console.info("[CameraRig] mode=duel (perspective)");
    }

    update(dtMs, context) {
        if (!this.camera) {
            return;
        }
        const hero = context?.hero;
        const opponent = context?.opponent;
        if (!hero?.root || !opponent?.root) {
            return;
        }

        const heroPos = hero.root.position;
        const opponentPos = opponent.root.position;
        const centerX = (heroPos.x + opponentPos.x) * 0.5;
        const centerY = this.targetHeight;
        const centerZ = (heroPos.z + opponentPos.z) * 0.5;
        const distance = Math.abs(opponentPos.x - heroPos.x);
        const desiredRadius = BABYLON.Scalar.Clamp(
            this.baseRadius + distance * this.zoomScale,
            this.minRadius,
            this.maxRadius
        );

        const blend = 1 - Math.exp((-this.smoothing * dtMs) / 1000);
        this.camera.target.x += (centerX - this.camera.target.x) * blend;
        this.camera.target.y += (centerY - this.camera.target.y) * blend;
        this.camera.target.z += (centerZ - this.camera.target.z) * blend;
        this.camera.radius += (desiredRadius - this.camera.radius) * blend;
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
