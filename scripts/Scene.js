import { InputSystem } from "./Systems/InputSystem.js";
import { PlayerController } from "./Systems/PlayerController.js";
import { TestController } from "./Systems/TestController.js";
import { CombatSystem } from "./Systems/CombatSystem.js";
import { ASSET_MANIFEST } from "./AssetManifest.js";
import { loadDataAssets } from "./DataLoader.js";
import { createHeroCharacter, createRabbleStickCharacter } from "./CharacterFactory.js";
import { DuelCameraRig } from "./DuelCameraRig.js";

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
        this._onKeyDown = null;
    }

    async init() {
        this.scene = new BABYLON.Scene(this.engine);
        this.scene.clearColor = new BABYLON.Color4(0.08, 0.08, 0.1, 1);

        const light = new BABYLON.HemisphericLight("light", new BABYLON.Vector3(0, 1, 0), this.scene);
        light.intensity = 1.0;

        const ground = BABYLON.MeshBuilder.CreateGround("ground", { width: 20, height: 12 }, this.scene);
        ground.position.y = -2.2;
        const groundMat = new BABYLON.StandardMaterial("groundMat", this.scene);
        groundMat.diffuseColor = new BABYLON.Color3(0.2, 0.2, 0.24);
        ground.material = groundMat;

        const assets = await loadDataAssets(ASSET_MANIFEST);

        this.character = createHeroCharacter(this.scene, assets);
        this.character.root.position.y = 0;

        this.rabbleStick = createRabbleStickCharacter(this.scene, assets);
        this.rabbleStick.root.position.y = 0;
        this.rabbleStick.root.position.x = 2.5;

        this.inputSystem = new InputSystem(this.scene, { debugEnabled: true });
        this.playerController = new PlayerController(this.inputSystem, this.character);
        this.rabbleController = new TestController(this.rabbleStick, assets.testScripts.rabbleBasicSequence);
        this.combatSystem = new CombatSystem();
        this.cameraRig = new DuelCameraRig();
        this.cameraRig.init(this.scene, this.canvas);

        this._onKeyDown = (e) => {
            if (e.key.toLowerCase() === "c") {
                const nextVisible = !this.character.collision.visible;
                this.character.setCollisionVisible(nextVisible);
                this.rabbleStick.setCollisionVisible(nextVisible);
            }
        };
        window.addEventListener("keydown", this._onKeyDown);
    }

    update(dtMs) {
        this.inputSystem.update();
        this.playerController.update(dtMs);
        this.rabbleController.update(dtMs);
        this.character.update(dtMs);
        this.rabbleStick.update(dtMs);
        this.combatSystem.update([this.character, this.rabbleStick]);
        this.cameraRig.update(dtMs, {
            hero: this.character,
            opponent: this.rabbleStick
        });
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
    }
}
