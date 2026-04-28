import { InputSystem } from "./Systems/InputSystem.js";
import { PlayerController } from "./Systems/PlayerController.js";
import { AIController } from "./Systems/AIController.js";
import { CombatSystem } from "./Systems/CombatSystem.js";
import { ASSET_MANIFEST } from "./AssetManifest.js";
import { loadDataAssets } from "./DataLoader.js";
import { createHeroCharacter, createRabbleStickCharacter } from "./CharacterFactory.js";
import { DuelCameraRig } from "./DuelCameraRig.js";
import { SceneVisualSystem, DEFAULT_ENVIRONMENT_CONFIG } from "./Enties/SceneVisualSystem.js";
import { StageBoundary } from "./Systems/StageBoundary.js";
import { PushboxResolver } from "./Systems/PushboxResolver.js";

export class Scene {
    constructor(engine, canvas) {
        this.engine = engine;
        this.canvas = canvas;
        this.scene = null;
        this.character = null;
        this.rabbleStick = null;
        this.inputSystem = null;
        this.playerController = null;
        this.rabbleController = null;
        this.combatSystem = null;
        this.cameraRig = null;
        this.sceneVisualSystem = null;
        this._onKeyDown = null;
        this.paused = false;
    }

    async init() {
        this.scene = new BABYLON.Scene(this.engine);
        this.scene.clearColor = new BABYLON.Color4(0.08, 0.08, 0.1, 1);

        // 添加调试层（按Ctrl+Shift+I打开）
        await this.scene.debugLayer.show({
            overlay: true,
            globalRoot: document.getElementById("canvas") || undefined
        });

        const light = new BABYLON.HemisphericLight("light", new BABYLON.Vector3(0, 1, 0), this.scene);
        light.intensity = 1.0;

        // 初始化视觉系统（替换原有的地面创建）
        this.sceneVisualSystem = new SceneVisualSystem(this.scene);
        await this.sceneVisualSystem.init(DEFAULT_ENVIRONMENT_CONFIG);

        const assets = await loadDataAssets(ASSET_MANIFEST);

        this.character = createHeroCharacter(this.scene, assets);
        this.character.root.position.y = 0;
        this.character.root.position.x = -3.2;

        this.rabbleStick = createRabbleStickCharacter(this.scene, assets);
        this.rabbleStick.root.position.y = 0;
        this.rabbleStick.root.position.x = 3.2;

        this.inputSystem = new InputSystem(this.scene, { debugEnabled: true });
        this.playerController = new PlayerController(this.inputSystem, this.character);
        this.rabbleController = new AIController(this.rabbleStick, { opponent: this.character });
        this.combatSystem = new CombatSystem();
        this.stageBoundary = new StageBoundary(this.scene, { minX: -8, maxX: 8 });
        this.pushboxResolver = new PushboxResolver();
        this.cameraRig = new DuelCameraRig({
            cameraHeight: 4,        // 相机高度（Y 偏移）
            cameraDistance: 25,     // 相机在人物后方的距离（Z 偏移，正数 = 后方）
            minZoomDistance: 15,    // 透视最小距离
            maxZoomDistance: 35,    // 透视最大距离
            zoomScale: 1.5,         // 人物远离时的额外距离
            baseOrthoWidth: 20,
            minOrthoWidth: 15,
            maxOrthoWidth: 40,
            orthoZoomScale: 8,
            targetAspect: 16 / 9
        });
        this.cameraRig.init(this.scene, this.canvas);

        // 复用 Vector3 避免每帧创建对象
        this._cameraBasePosition = new BABYLON.Vector3(0, 8, -25);
        this._cameraTarget = new BABYLON.Vector3(0, 0, 0);

        this._onKeyDown = (e) => {
            if (e.key.toLowerCase() === "c") {
                const nextVisible = !this.character.collision.visible;
                this.character.setCollisionVisible(nextVisible);
                this.rabbleStick.setCollisionVisible(nextVisible);
                this.stageBoundary.setVisible(nextVisible);
            }
        };
        window.addEventListener("keydown", this._onKeyDown);
    }

    togglePause() {
        this.paused = !this.paused;
        console.log(this.paused ? "Paused" : "Resumed");
    }

    toggleCameraProjection() {
        if (this.cameraRig) {
            this.cameraRig.toggleProjection();
        }
    }

    onResize() {
        if (this.cameraRig) {
            this.cameraRig.onResize();
        }
    }

    update(dtMs) {
        // 计算相机参数（无论是否暂停都需要）
        const heroPos = this.character.root.position;
        const opponentPos = this.rabbleStick.root.position;
        const centerX = (heroPos.x + opponentPos.x) * 0.5;
        const centerZ = (heroPos.z + opponentPos.z) * 0.5;
        const targetHeight = 0;

        // 复用 Vector3 避免 GC 压力
        this._cameraBasePosition.x = centerX;
        this._cameraBasePosition.y = targetHeight + 8;
        this._cameraBasePosition.z = centerZ - 25;
        this._cameraTarget.x = centerX;
        this._cameraTarget.y = targetHeight;
        this._cameraTarget.z = centerZ;

        // 暂停时只更新相机和视觉层，跳过 gameplay
        if (this.paused) {
            this.cameraRig.update(dtMs, {
                basePosition: this._cameraBasePosition,
                target: this._cameraTarget,
                fighterDistance: Math.abs(opponentPos.x - heroPos.x)
            });
            if (this.sceneVisualSystem) {
                this.sceneVisualSystem.update(dtMs, {
                    camera: this.cameraRig.camera
                });
            }
            return;
        }

        this.inputSystem.update();
        this.playerController.update(dtMs);
        this.rabbleController.update(dtMs);
        this.character.update(dtMs);
        this.rabbleStick.update(dtMs);
        this.pushboxResolver.resolve([this.character, this.rabbleStick]);
        this.stageBoundary.clampCharacter(this.character);
        this.stageBoundary.clampCharacter(this.rabbleStick);
        this.combatSystem.update([this.character, this.rabbleStick]);

        // 先更新相机，再更新视觉系统（按文档要求的顺序）
        this.cameraRig.update(dtMs, {
            basePosition: this._cameraBasePosition,
            target: this._cameraTarget,
            fighterDistance: Math.abs(opponentPos.x - heroPos.x)
        });
        
        // 更新视觉系统，传递相机信息
        if (this.sceneVisualSystem) {
            this.sceneVisualSystem.update(dtMs, {
                camera: this.cameraRig.camera
            });
        }
    }

    render() {
        this.scene.render();
    }

    dispose() {
        if (this._onKeyDown) {
            window.removeEventListener("keydown", this._onKeyDown);
            this._onKeyDown = null;
        }
        if (this.playerController) {
            this.playerController.dispose();
        }
        if (this.inputSystem) {
            this.inputSystem.dispose();
        }
        if (this.cameraRig) {
            this.cameraRig.dispose();
            this.cameraRig = null;
        }
        if (this.sceneVisualSystem) {
            this.sceneVisualSystem.dispose();
            this.sceneVisualSystem = null;
        }
        if (this.stageBoundary) {
            this.stageBoundary.dispose();
            this.stageBoundary = null;
        }
    }
}
