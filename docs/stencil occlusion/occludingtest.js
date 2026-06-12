const canvas = document.getElementById("renderCanvas");
const engine = new BABYLON.Engine(canvas, true, { stencil: true });

const createScene = function () {
    const scene = new BABYLON.Scene(engine);
    scene.clearColor = new BABYLON.Color4(0.1, 0.1, 0.15, 1);

    const camera = new BABYLON.ArcRotateCamera(
        "camera",
        -Math.PI / 2,
        Math.PI / 2.5,
        300,
        BABYLON.Vector3.Zero(),
        scene
    );
    camera.attachControl(canvas, true);

    // ========== 正交/透视相机切换 ==========
    let isOrtho = false;
    let orthoCamera = null;

    const switchToOrtho = () => {
        if (orthoCamera) {
            orthoCamera.dispose();
        }
        orthoCamera = new BABYLON.ArcRotateCamera(
            "orthoCamera",
            -Math.PI / 2,
            Math.PI / 2.5,
            300,
            BABYLON.Vector3.Zero(),
            scene
        );
        orthoCamera.mode = BABYLON.Camera.ORTHOGRAPHIC_CAMERA;
        const aspect = engine.getAspectRatio(orthoCamera);
        const orthoSize = 200;
        orthoCamera.orthoLeft = -orthoSize * aspect;
        orthoCamera.orthoRight = orthoSize * aspect;
        orthoCamera.orthoTop = orthoSize;
        orthoCamera.orthoBottom = -orthoSize;
        orthoCamera.attachControl(canvas, true);
        scene.activeCamera = orthoCamera;
        isOrtho = true;
    };

    const switchToPerspective = () => {
        scene.activeCamera = camera;
        isOrtho = false;
    };

    const light = new BABYLON.HemisphericLight("light", new BABYLON.Vector3(0, 1, -1), scene);
    light.intensity = 1.0;

    const baseImagePath = "../../Art/Sprite/longswordman/longswordman_standing.png";
    const merchantImagePath = "../../Art/Sprite/NPCs/merchant.png";
    const bgImagePath = "../../Art/Environment/Tavern_indoorstage.png";
    const BASE_WIDTH = 84;
    const BASE_HEIGHT = 128;
    const MERCHANT_WIDTH = 128;
    const MERCHANT_HEIGHT = 128;
    const OCCLUDER_SIZE = 48;
    const BG_WIDTH = 800;
    const BG_HEIGHT = 300;

    let baseX = 0;
    let baseY = 0;
    const MOVE_SPEED = 2;
    const Z_FACTOR = 0.1;

    // ========== 背景图（Tavern_indoorstage.png）==========
    const bgPlane = BABYLON.MeshBuilder.CreatePlane("bgPlane", {
        width: BG_WIDTH,
        height: BG_HEIGHT
    }, scene);
    bgPlane.position = new BABYLON.Vector3(0, 0, 1);
    bgPlane.rotation.x = Math.PI;
    bgPlane.renderingGroupId = 0;

    const bgMat = new BABYLON.StandardMaterial("bgMat", scene);
    const bgTex = new BABYLON.Texture(bgImagePath, scene);
    bgTex.hasAlpha = true;
    bgTex.vScale = -1;
    bgTex.vOffset = 1;
    bgMat.diffuseTexture = bgTex;
    bgMat.useAlphaFromDiffuseTexture = true;
    bgMat.backFaceCulling = false;
    bgMat.disableLighting = true;
    bgMat.emissiveColor = new BABYLON.Color3(1, 1, 1);
    bgPlane.material = bgMat;

    // ========== Stencil Plane（正常 draw call，用黑色隐藏）==========
    const stencilPlane = BABYLON.MeshBuilder.CreatePlane("stencil", {
        width: OCCLUDER_SIZE,
        height: OCCLUDER_SIZE
    }, scene);
    stencilPlane.position = new BABYLON.Vector3(20, 20, 20 * Z_FACTOR);
    stencilPlane.rotation.x = Math.PI;
    stencilPlane.renderingGroupId = 1;

    const stencilMat = new BABYLON.StandardMaterial("stencilMat", scene);
    stencilMat.diffuseColor = new BABYLON.Color3(0, 0, 0);
    stencilMat.disableLighting = true;
    stencilMat.backFaceCulling = false;
    stencilPlane.material = stencilMat;

    // 用 WebGL 原生 API 操作 stencil
    const gl = engine._gl;

    stencilPlane.onBeforeRenderObservable.add(() => {
        gl.colorMask(false, false, false, false); // 禁用颜色写入，只写 stencil
        gl.enable(gl.STENCIL_TEST);
        gl.stencilFunc(gl.ALWAYS, 1, 0xFF);
        gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
    });

    stencilPlane.onAfterRenderObservable.add(() => {
        gl.colorMask(true, true, true, true); // 恢复颜色写入
        gl.stencilFunc(gl.NOTEQUAL, 1, 0xFF);
    });

    // ========== Outline Plane（只显示绿色边框）==========
    const outlinePlane = BABYLON.MeshBuilder.CreatePlane("outline", {
        width: OCCLUDER_SIZE + 2,
        height: OCCLUDER_SIZE + 2
    }, scene);
    outlinePlane.position = new BABYLON.Vector3(20, 20, 20 * Z_FACTOR + 0.01);
    outlinePlane.rotation.x = Math.PI;
    outlinePlane.renderingGroupId = 1;

    const outlineMat = new BABYLON.StandardMaterial("outlineMat", scene);
    outlineMat.wireframe = true;
    outlineMat.diffuseColor = new BABYLON.Color3(0, 1, 0);
    outlineMat.disableLighting = true;
    outlineMat.backFaceCulling = false;
    outlinePlane.material = outlineMat;

    // ========== longswordman 底图 ==========
    const basePlane = BABYLON.MeshBuilder.CreatePlane("basePlane", {
        width: BASE_WIDTH,
        height: BASE_HEIGHT
    }, scene);
    basePlane.position = new BABYLON.Vector3(baseX, baseY, baseY * Z_FACTOR);
    basePlane.rotation.x = Math.PI;
    basePlane.renderingGroupId = 1;

    const baseMat = new BABYLON.StandardMaterial("baseMat", scene);
    const tex = new BABYLON.Texture(baseImagePath, scene);
    tex.hasAlpha = true;
    tex.uScale = 0.5;
    tex.uOffset = 0;
    tex.vScale = -1;
    tex.vOffset = 1;
    baseMat.diffuseTexture = tex;
    baseMat.useAlphaFromDiffuseTexture = true;
    baseMat.transparencyMode = BABYLON.Material.MATERIAL_ALPHATEST;
    baseMat.alphaCutOff = 0.4;
    baseMat.backFaceCulling = false;
    baseMat.disableLighting = true;
    baseMat.emissiveColor = new BABYLON.Color3(1, 1, 1);
    basePlane.material = baseMat;

    // ========== merchant 图 ==========
    const merchantPlane = BABYLON.MeshBuilder.CreatePlane("merchantPlane", {
        width: MERCHANT_WIDTH,
        height: MERCHANT_HEIGHT
    }, scene);
    merchantPlane.position = new BABYLON.Vector3(60, 0, 0);
    merchantPlane.rotation.x = Math.PI;
    merchantPlane.renderingGroupId = 1;

    const merchantMat = new BABYLON.StandardMaterial("merchantMat", scene);
    const merchantTex = new BABYLON.Texture(merchantImagePath, scene);
    merchantTex.hasAlpha = true;
    merchantTex.uScale = 0.25; // 4 frames in a row, show first frame
    merchantTex.uOffset = 0;
    merchantTex.vScale = -1;
    merchantTex.vOffset = 1;
    merchantMat.diffuseTexture = merchantTex;
    merchantMat.useAlphaFromDiffuseTexture = true;
    merchantMat.transparencyMode = BABYLON.Material.MATERIAL_ALPHATEST;
    merchantMat.alphaCutOff = 0.4;
    merchantMat.backFaceCulling = false;
    merchantMat.disableLighting = true;
    merchantMat.emissiveColor = new BABYLON.Color3(1, 1, 1);
    merchantPlane.material = merchantMat;

    // basePlane 绘制后关闭 stencil
    basePlane.onAfterRenderObservable.add(() => {
        gl.disable(gl.STENCIL_TEST);
    });

    // ========== Inspector ==========
    scene.debugLayer.show({
        embedMode: false,
        overlay: true
    });

    // ========== WASD 控制 ==========
    const keys = {};
    window.addEventListener("keydown", (e) => {
        const key = e.key.toLowerCase();
        keys[key] = true;
        if (key === "o") {
            if (isOrtho) {
                switchToPerspective();
            } else {
                switchToOrtho();
            }
        }
    });
    window.addEventListener("keyup", (e) => {
        keys[e.key.toLowerCase()] = false;
    });

    scene.onBeforeRenderObservable.add(() => {
        let dx = 0;
        let dy = 0;
        if (keys["a"]) dx -= MOVE_SPEED;
        if (keys["d"]) dx += MOVE_SPEED;
        if (keys["w"]) dy += MOVE_SPEED;
        if (keys["s"]) dy -= MOVE_SPEED;

        if (dx !== 0 || dy !== 0) {
            baseX += dx;
            baseY += dy;
            basePlane.position.x = baseX;
            basePlane.position.y = baseY;
            basePlane.position.z = baseY * Z_FACTOR;
        }
    });

    return scene;
};

const scene = createScene();
engine.runRenderLoop(() => scene.render());
window.addEventListener("resize", () => engine.resize());
