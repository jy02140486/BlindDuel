import { InputSystem } from "./Systems/InputSystem.js";
import { PlayerController } from "./Systems/PlayerController.js";
import { DummyController } from "./Systems/DummyController.js";
import { TestController } from "./Systems/TestController.js";
import { CombatSystem } from "./Systems/CombatSystem.js";
import { ASSET_MANIFEST } from "./AssetManifest.js";
import { loadDataAssets } from "./DataLoader.js";
import { createHeroCharacter, createRabbleStickCharacter } from "./CharacterFactory.js";
import { DuelCameraRig } from "./DuelCameraRig.js";
import { ExploreCameraRig } from "./ExploreCameraRig.js";
import { SceneVisualSystem, DEFAULT_ENVIRONMENT_CONFIG } from "./Enties/SceneVisualSystem.js";
import { AABBTrigger } from "./Enties/AABBTrigger.js";
import { WalkArea } from "./Enties/WalkArea.js";
import { StageBoundary } from "./Systems/StageBoundary.js";
import { PushboxResolver } from "./Systems/PushboxResolver.js";
import { GameModeManager } from "./Systems/GameModeManager.js";
import { BattleMode } from "./Systems/Modes/BattleMode.js";
import { ExploreMode } from "./Systems/Modes/ExploreMode.js";
import { SceneSequencer } from "./Systems/SceneSequencer.js";
import { CameraManager } from "./Systems/CameraManager.js";

const FIXED_DT = 1000 / 60;

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
        this.exploreCameraRig = null;
        this.sceneVisualSystem = null;
        this.gameModeManager = null;
        this.battleMode = null;
        this.exploreMode = null;
        this.sceneSequencer = null;
        this.cameraManager = null;
        this._onKeyDown = null;
        this.paused = false;
        this.tickCount = 0;
    }

    async init() {
        this.scene = new BABYLON.Scene(this.engine);
        this.scene.clearColor = new BABYLON.Color4(0.08, 0.08, 0.1, 1);

        // 添加调试层（按Ctrl+Shift+I打开�?
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
        this.character.root.position.x = -16;
        this.character.debugTrace = false;

        // 战斗触发器（左边界）
        this.battleTrigger = new AABBTrigger(this.scene, new BABYLON.Vector3(-6, 0, 0), {
            width: 4, height: 8, depth: 4
        }, {
            debugColor: new BABYLON.Color3(0, 1, 0),
            debugVisible: false
        });

        this.rabbleStick = createRabbleStickCharacter(this.scene, assets);
        this.rabbleStick.root.position.y = 0;
        this.rabbleStick.root.position.x = 3.2;
        this.rabbleStick.debugTrace = false;

        this.inputSystem = new InputSystem(this.scene, { debugEnabled: true });
        this.playerController = new PlayerController(this.inputSystem, this.character);
        this.rabbleController = new DummyController(this.rabbleStick);
        this.combatSystem = new CombatSystem({ debugTrace: true });
        this.stageBoundary = new StageBoundary(this.scene, { minX: -8, maxX: 8 });
        this.walkArea = new WalkArea(this.scene, { minX: -24, maxX: -7, minY: -1, maxY: 0.7, visible: true });
        this.pushboxResolver = new PushboxResolver();
        this.cameraRig = new DuelCameraRig({
            zoomMinDistance: 3.2,
            zoomMaxDistance: 6.4,
            orthoMinWidth: 16,
            orthoMaxWidth: 46,
            perspMinDistance: 15,
            perspMaxDistance: 35,
            minCameraHeight: 3.2,
            maxCameraHeight: 10,
            targetAspect: 16 / 9
        });

        this.exploreCameraRig = new ExploreCameraRig();

        // 复用 Vector3 避免每帧创建对象
        this._cameraBasePosition = new BABYLON.Vector3(0, 8, -25);
        this._cameraTarget = new BABYLON.Vector3(0, 0, 0);
        this._smoothedFighterDistance = Math.abs(this.rabbleStick.root.position.x - this.character.root.position.x);

        const sharedContext = {
            scene: this,
            inputSystem: this.inputSystem,
            playerController: this.playerController,
            rabbleController: this.rabbleController,
            character: this.character,
            rabbleStick: this.rabbleStick,
            pushboxResolver: this.pushboxResolver,
            stageBoundary: this.stageBoundary,
            walkArea: this.walkArea,
            combatSystem: this.combatSystem,
            cameraRig: this.cameraRig,
            exploreCameraRig: this.exploreCameraRig,
            cameraManager: null,
            sceneVisualSystem: this.sceneVisualSystem,
            cameraBasePosition: this._cameraBasePosition,
            cameraTarget: this._cameraTarget,
            smoothedFighterDistance: this._smoothedFighterDistance
        };
        this.cameraManager = new CameraManager(sharedContext);
        this.cameraManager.init(this.scene, this.canvas, { fov: 0.8, minZ: 0.1, maxZ: 1000 });
        this.cameraManager.registerRig("duel", this.cameraRig);
        this.cameraManager.registerRig("explore", this.exploreCameraRig);
        sharedContext.cameraManager = this.cameraManager;
        this.sharedContext = sharedContext;

        this.sceneSequencer = new SceneSequencer(sharedContext);
        sharedContext.sceneSequencer = this.sceneSequencer;

        this.gameModeManager = new GameModeManager();
        this.battleMode = new BattleMode(sharedContext);
        this.exploreMode = new ExploreMode(sharedContext);

        this.gameModeManager.registerMode(this.battleMode);
        this.gameModeManager.registerMode(this.exploreMode);
        this.gameModeManager.start("explore");

        this._onKeyDown = (e) => {
            if (e.key.toLowerCase() === "c") {
                const nextVisible = !this.character.collision.visible;
                this.character.setCollisionVisible(nextVisible);
                this.rabbleStick.setCollisionVisible(nextVisible);
                this.stageBoundary.setVisible(nextVisible);
                if (this.walkArea) {
                    this.walkArea.setVisible(nextVisible);
                }
                if (this.battleTrigger) {
                    this.battleTrigger.setDebugVisible(nextVisible);
                }
            }
        };
        window.addEventListener("keydown", this._onKeyDown);
    }

    togglePause() {
        this.paused = !this.paused;
        console.log(this.paused ? "Paused" : "Resumed");
    }

    toggleCameraProjection() {
        this.cameraManager?.toggleProjection();
    }

    onResize() {
        this.cameraManager?.onResize();
    }

    fixedUpdate(dtMs, tickCount) {
        this.tickCount = tickCount;

        if (this.paused) {
            return;
        }

        this.sceneSequencer.fixedUpdate(dtMs, tickCount);
        this.gameModeManager.fixedUpdate(dtMs, tickCount);
    }

    updateRender(dtMs) {
        this.gameModeManager.updateRender(dtMs);
        this.sceneSequencer.updateRender(dtMs);
        this.cameraManager.update(dtMs, this.sharedContext);
        this._smoothedFighterDistance = this.battleMode.context.smoothedFighterDistance;
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
        if (this.exploreCameraRig) {
            this.exploreCameraRig.dispose();
            this.exploreCameraRig = null;
        }
        this.cameraManager = null;
        if (this.sceneVisualSystem) {
            this.sceneVisualSystem.dispose();
            this.sceneVisualSystem = null;
        }
        if (this.stageBoundary) {
            this.stageBoundary.dispose();
            this.stageBoundary = null;
        }
        if (this.battleTrigger) {
            this.battleTrigger.dispose();
            this.battleTrigger = null;
        }
    }
}
