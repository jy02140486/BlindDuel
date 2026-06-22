import { InputSystem } from "./Systems/InputSystem.js";
import { PlayerController } from "./Systems/PlayerController.js";
import { DummyController } from "./Systems/DummyController.js";
import { TestController } from "./Systems/TestController.js";
import { NpcController } from "./Systems/NpcController.js";
import { CombatSystem } from "./Systems/CombatSystem.js";
import { ASSET_MANIFEST } from "./AssetManifest.js";
import { loadDataAssets } from "./DataLoader.js";
import { createEntityFromDef } from "./SceneDefs.js";
import { DuelCameraRig } from "./DuelCameraRig.js";
import { ExploreCameraRig } from "./ExploreCameraRig.js";
import { ScriptedCameraRig } from "./ScriptedCameraRig.js";
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
import { InventoryManager } from "./Systems/InventoryManager.js";
import { InventoryBar } from "./UI/InventoryBar.js";
import { BuffBar } from "./UI/BuffBar.js";
import { HpBar } from "./UI/HpBar.js";
import { DialogueBubble } from "./UI/DialogueBubble.js";
import { getNpcDef } from "../Data/NpcDefs.js";

const FIXED_DT = 1000 / 60;

export class Scene {
    constructor(engine, canvas, gameContext = {}) {
        this.engine = engine;
        this.canvas = canvas;
        this.worldState = gameContext.worldState ?? null;
        this.questManager = gameContext.questManager ?? null;
        this.inventoryManager = gameContext.inventoryManager ?? new InventoryManager();
        this.scene = null;
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
        this.inventoryBar = null;
        this.buffBar = null;
        this.hpBar = null;
        this._onKeyDown = null;
        this.paused = false;
        this.tickCount = 0;
        this.entityPool = [];
    }

    async init(sceneDef, battleDefs = {}) {
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
        await this.sceneVisualSystem.init(sceneDef.environment ?? DEFAULT_ENVIRONMENT_CONFIG);

        const assets = await loadDataAssets(ASSET_MANIFEST);

        // --- 加载 StageMask 数据并创建深度遮罩 ---
        let stageMaskData = null;
        if (sceneDef.stageMask && assets.stageMasks?.[sceneDef.stageMask]) {
            stageMaskData = assets.stageMasks[sceneDef.stageMask];
            this.sceneVisualSystem.createDepthMasks(stageMaskData);
        }

        // --- 从 SceneDef 创建实体 ---
        const entityById = new Map();
        for (const entityDef of sceneDef.entities) {
            const entity = createEntityFromDef(this.scene, assets, entityDef);
            this.entityPool.push(entity);
            entityById.set(entity.id, entity);
            if (entity.name) entityById.set(entity.name, entity);
        }
        const character = entityById.get("hero");
        const rabbleStick = entityById.get("enemy_1");

        // --- 临时：只加载 hero 时，rabbleStick 可能不存在 ---
        // TODO: 恢复多实体后删除这行
        if (!rabbleStick) {
            console.warn("[Scene] rabbleStick not found — running in single-entity debug mode");
        }

        // --- 从 SceneDef 创建触发器 ---
        this.triggers = new Map();
        for (const triggerDef of sceneDef.triggers) {
            const trigger = new AABBTrigger(
                this.scene,
                new BABYLON.Vector3(triggerDef.pos[0], triggerDef.pos[1], triggerDef.pos[2] ?? 0),
                { width: triggerDef.size[0], height: triggerDef.size[1], depth: triggerDef.size[2] },
                {
                    debugColor: new BABYLON.Color3(...(triggerDef.debugColor ?? [0, 1, 0])),
                    debugVisible: triggerDef.debugVisible ?? false,
                }
            );
            this.triggers.set(triggerDef.id, trigger);
        }
        // 向后兼容：scriptedCameraTrigger 仍硬编码（后续可改为遍历）
        this.scriptedCameraTrigger = this.triggers.get("sc_test_1");

        // --- 控制器 ---
        this.inputSystem = new InputSystem(this.scene, { debugEnabled: true });
        this.playerController = new PlayerController(this.inputSystem, character);
        character.buffsProvider = this.playerController;
        this.rabbleController = rabbleStick ? new DummyController(rabbleStick) : null;

        // NPC 控制器
        for (const entityDef of sceneDef.entities) {
            if (entityDef.controller === "npc") {
                const npc = entityById.get(entityDef.id);
                if (npc) {
                    const npcDef = getNpcDef(entityDef.id);
                    npc.npcController = new NpcController(this.worldState, npcDef);
                    npc.npcController.setupDebugVisual(this.scene, npc.root);
                }
            }
        }

        // --- 战斗系统与边界 ---
        this.combatSystem = new CombatSystem({ debugTrace: true });
        const firstBattleTrigger = sceneDef.triggers?.find(t => t.type === "battle");
        const defaultBattleDef = firstBattleTrigger
            ? battleDefs[firstBattleTrigger.battleId]
            : battleDefs["battle_field_1"];
        this.stageBoundary = new StageBoundary(this.scene, defaultBattleDef.stageBounds);
        // WalkArea：若 StageMask JSON 中有 walkArea，优先使用；否则回退到 sceneDef.walkArea
        const walkAreaDef = stageMaskData?.walkArea
            ? {
                  minX: stageMaskData.walkArea.x,
                  maxX: stageMaskData.walkArea.x + stageMaskData.walkArea.w,
                  minY: stageMaskData.walkArea.y,
                  maxY: stageMaskData.walkArea.y + stageMaskData.walkArea.h,
              }
            : sceneDef.walkArea;
        this.walkArea = new WalkArea(this.scene, { ...walkAreaDef, visible: true });
        this.pushboxResolver = new PushboxResolver();

        // --- 相机 ---
        this.cameraRig = new DuelCameraRig(defaultBattleDef.duelCamera);
        this.exploreCameraRig = new ExploreCameraRig();
        this.scriptedCameraRig = new ScriptedCameraRig();

        // 复用 Vector3 避免每帧创建对象
        this._cameraBasePosition = new BABYLON.Vector3(0, 8, -25);
        this._cameraTarget = new BABYLON.Vector3(0, 0, 0);
        this._smoothedFighterDistance = rabbleStick
            ? Math.abs(rabbleStick.root.position.x - character.root.position.x)
            : 0;

        const actorRegistry = new Map();
        for (const entity of this.entityPool) {
            if (entity.id) actorRegistry.set(entity.id, entity);
            if (entity.name) actorRegistry.set(entity.name, entity);
        }
        actorRegistry.set("hero", character);
        if (rabbleStick) actorRegistry.set("enemy", rabbleStick);

        const controllerRegistry = new Map();
        controllerRegistry.set("hero", this.playerController);

        const sharedContext = {
            scene: this,
            babylonScene: this.scene,
            inputSystem: this.inputSystem,
            playerController: this.playerController,
            rabbleController: this.rabbleController,
            actorRegistry,
            entityRegistry: actorRegistry,
            controllerRegistry,
            character: character,
            rabbleStick: rabbleStick || null,
            pushboxResolver: this.pushboxResolver,
            stageBoundary: this.stageBoundary,
            walkArea: this.walkArea,
            combatSystem: this.combatSystem,
            cameraRig: this.cameraRig,
            exploreCameraRig: this.exploreCameraRig,
            scriptedCameraRig: this.scriptedCameraRig,
            cameraManager: null,
            sceneVisualSystem: this.sceneVisualSystem,
            entityPool: this.entityPool,
            actorRegistry,
            controllerRegistry,
            cameraBasePosition: this._cameraBasePosition,
            cameraTarget: this._cameraTarget,
            smoothedFighterDistance: this._smoothedFighterDistance,
            sceneDef: sceneDef,
            battleDefs: battleDefs,
            stageMaskData: stageMaskData,
        };
        this.cameraManager = new CameraManager(sharedContext);
        this.cameraManager.init(this.scene, this.canvas, { fov: 0.8, minZ: 0.1, maxZ: 1000 });
        this.cameraManager.registerRig("duel", this.cameraRig);
        this.cameraManager.registerRig("explore", this.exploreCameraRig);
        this.cameraManager.registerRig("scripted", this.scriptedCameraRig);
        sharedContext.cameraManager = this.cameraManager;
        this.combatSystem.cameraManager = this.cameraManager;

        this.inventoryBar = new InventoryBar(document.getElementById("inventory-bar"));
        this.buffBar = new BuffBar(document.getElementById("buff-bar"));
        this.hpBar = new HpBar(document.getElementById("hp-bar"));
        this.dialogueBubble = new DialogueBubble(document.getElementById("dialogue-bubble-container"));
        sharedContext.inventoryManager = this.inventoryManager;
        sharedContext.questManager = this.questManager;
        sharedContext.inventoryBar = this.inventoryBar;
        sharedContext.buffBar = this.buffBar;
        sharedContext.hpBar = this.hpBar;
        sharedContext.dialogueBubble = this.dialogueBubble;

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
                const first = this.entityPool[0];
                const nextVisible = !first?.collision?.visible;
                for (const entity of this.entityPool) {
                    if (typeof entity.setCollisionVisible === "function") {
                        entity.setCollisionVisible(nextVisible);
                    }
                }
                this.stageBoundary.setVisible(nextVisible);
                if (this.walkArea) {
                    this.walkArea.setVisible(nextVisible);
                }
                if (this.triggers) {
                    for (const trigger of this.triggers.values()) {
                        trigger.setDebugVisible(nextVisible);
                    }
                }
                for (const entity of this.entityPool) {
                    if (entity.npcController) {
                        entity.npcController.setDebugVisible(nextVisible);
                    }
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
        if (this.inventoryBar) {
            this.inventoryBar.dispose();
            this.inventoryBar = null;
        }
        if (this.buffBar) {
            this.buffBar.dispose();
            this.buffBar = null;
        }
        if (this.hpBar) {
            this.hpBar.dispose();
            this.hpBar = null;
        }
        this.inventoryManager = null;
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
        if (this.triggers) {
            for (const trigger of this.triggers.values()) {
                trigger.dispose();
            }
            this.triggers.clear();
            this.triggers = null;
        }
        this.battleTrigger = null;
        this.scriptedCameraTrigger = null;
        this.entityPool = null;
    }
}
