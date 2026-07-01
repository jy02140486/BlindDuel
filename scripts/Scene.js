import { DummyController } from "./Systems/DummyController.js";
import { TestController } from "./Systems/TestController.js";
import { NpcController } from "./Systems/NpcController.js";
import { createEntityFromDef } from "./SceneDefs.js";
import { SceneVisualSystem, DEFAULT_ENVIRONMENT_CONFIG } from "./Enties/SceneVisualSystem.js";
import { AABBTrigger } from "./Enties/AABBTrigger.js";
import { WalkArea } from "./Enties/WalkArea.js";
import { StageBoundary } from "./Systems/StageBoundary.js";
import { PushboxResolver } from "./Systems/PushboxResolver.js";
import { BattleMode } from "./Systems/Modes/BattleMode.js";
import { ExploreMode } from "./Systems/Modes/ExploreMode.js";
import { InventoryManager } from "./Systems/InventoryManager.js";
import { getNpcDef } from "../Data/NpcDefs.js";

const FIXED_DT = 1000 / 60;

export class Scene {
    constructor(engine, canvas, gameContext = {}) {
        this.engine = engine;
        this.canvas = canvas;
        this.worldState = gameContext.worldState ?? null;
        this.questManager = gameContext.questManager ?? null;
        this.inventoryManager = gameContext.inventoryManager ?? new InventoryManager();
        this._game = gameContext.game ?? null;
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
        this._battleDefs = battleDefs;
        this.entityPool = [];
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

        const assets = this._game?.assets;
        console.log("[Scene] assets from game.assets, keys=", Object.keys(assets ?? {}).length);

        // --- 加载 StageMask 数据并创建深度遮罩 ---
        let stageMaskData = null;
        if (sceneDef.stageMask && assets.stageMasks?.[sceneDef.stageMask]) {
            stageMaskData = assets.stageMasks[sceneDef.stageMask];
            this.sceneVisualSystem.createDepthMasks(stageMaskData);
        }

        // --- 从 SceneDef 创建实体 ---
        const entityById = new Map();
        for (const entityDef of sceneDef.entities) {
            if (!this._evaluateCondition(entityDef.spawnIf, this.worldState)) {
                continue;
            }
            // 跳过已拾取的物品
            if (entityDef.kind === "pickable" && this.worldState) {
                const collected = this.worldState.sceneStates?.[sceneDef.id]?.pickables?.[entityDef.id];
                if (collected) continue;
            }
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
                    name: triggerDef.id,
                    debugColor: new BABYLON.Color3(...(triggerDef.debugColor ?? [0, 1, 0])),
                    debugVisible: triggerDef.debugVisible ?? false,
                }
            );
            this.triggers.set(triggerDef.id, trigger);
        }
        // 向后兼容：scriptedCameraTrigger 仍硬编码（后续可改为遍历）
        this.scriptedCameraTrigger = this.triggers.get("sc_test_1");

        // --- 控制器 ---
        this.inputSystem = this._game.inputSystem;
        this.playerController = this._game.playerController;
        this.playerController.setCharacter(character);
        this.playerController.inputSystem = this.inputSystem;
        this.playerController.enabled = true;
        console.log("[Scene] B8: using game.inputSystem + game.playerController");
        character.buffsProvider = this.playerController;
        if (rabbleStick) {
            const rabbleDef = sceneDef.entities.find(e => e.id === "enemy_1" || e.kind === "enemy");
            const controllerType = rabbleDef?.controller ?? "dummy";
            if (controllerType === "test") {
                const archetype = rabbleDef?.archetype ?? "";
                const scriptKey = archetype === "manatarms_sword" ? "manatarmsBasicSequence" : "rabbleBasicSequence";
                const scriptConfig = assets?.testScripts?.[scriptKey] ?? {};
                this.rabbleController = new TestController(rabbleStick, scriptConfig);
            } else {
                this.rabbleController = new DummyController(rabbleStick);
            }
        } else {
            this.rabbleController = null;
        }

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
        this.combatSystem = this._game.combatSystem;
        const firstBattleTrigger = sceneDef.triggers?.find(t => t.type === "battle");
        const DEFAULT_DUEL_CAMERA = {
            zoomMinDistance: 3.2, zoomMaxDistance: 6.4,
            orthoMinWidth: 16, orthoMaxWidth: 32,
            perspMinDistance: 15, perspMaxDistance: 35,
            minCameraHeight: 3.2, maxCameraHeight: 5.2,
            targetAspect: 16 / 9,
        };
        const DEFAULT_STAGE_BOUNDS = { minX: -8, maxX: 8, minY: -0.05, maxY: 0.05 };
        let stageBounds;
        let duelCameraCfg;
        if (firstBattleTrigger) {
            const battleDef = battleDefs[firstBattleTrigger.battleId];
            stageBounds = battleDef.stageBounds;
            duelCameraCfg = battleDef.duelCamera;
        } else {
            stageBounds = DEFAULT_STAGE_BOUNDS;
            duelCameraCfg = DEFAULT_DUEL_CAMERA;
        }
        this.stageBoundary = new StageBoundary(this.scene, stageBounds);
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

        // --- 相机 rigs（复用 game 的，duelRig 用场景配置更新）---
        this.cameraRig = this._game.cameraRig;
        this.exploreCameraRig = this._game.exploreCameraRig;
        this.scriptedCameraRig = this._game.scriptedCameraRig;
        Object.assign(this.cameraRig, {
            zoomMinDistance: duelCameraCfg.zoomMinDistance,
            zoomMaxDistance: duelCameraCfg.zoomMaxDistance,
            orthoMinWidth: duelCameraCfg.orthoMinWidth,
            orthoMaxWidth: duelCameraCfg.orthoMaxWidth,
            perspMinDistance: duelCameraCfg.perspMinDistance,
            perspMaxDistance: duelCameraCfg.perspMaxDistance,
            minCameraHeight: duelCameraCfg.minCameraHeight,
            maxCameraHeight: duelCameraCfg.maxCameraHeight,
            targetAspect: duelCameraCfg.targetAspect,
        });

        // 复用 Vector3 避免每帧创建对象
        this._cameraBasePosition = this._game.sharedContext.cameraBasePosition;
        this._cameraTarget = this._game.sharedContext.cameraTarget;
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

        const sharedContext = this._game.sharedContext;
        sharedContext.scene = this;
        sharedContext.babylonScene = this.scene;
        sharedContext.inputSystem = this.inputSystem;
        sharedContext.playerController = this.playerController;
        sharedContext.rabbleController = this.rabbleController;
        sharedContext.actorRegistry = actorRegistry;
        sharedContext.entityRegistry = actorRegistry;
        sharedContext.controllerRegistry = controllerRegistry;
        sharedContext.character = character;
        sharedContext.rabbleStick = rabbleStick || null;
        sharedContext.pushboxResolver = this.pushboxResolver;
        sharedContext.stageBoundary = this.stageBoundary;
        sharedContext.walkArea = this.walkArea;
        sharedContext.combatSystem = this.combatSystem;
        sharedContext.cameraRig = this.cameraRig;
        sharedContext.exploreCameraRig = this.exploreCameraRig;
        sharedContext.scriptedCameraRig = this.scriptedCameraRig;
        sharedContext.sceneVisualSystem = this.sceneVisualSystem;
        sharedContext.entityPool = this.entityPool;
        sharedContext.cameraBasePosition = this._cameraBasePosition;
        sharedContext.cameraTarget = this._cameraTarget;
        sharedContext.smoothedFighterDistance = this._smoothedFighterDistance;
        sharedContext.sceneDef = sceneDef;
        sharedContext.battleDefs = battleDefs;
        sharedContext.stageMaskData = stageMaskData;
        sharedContext.worldState = this.worldState;
        this.camera = new BABYLON.UniversalCamera(
            "main_camera",
            new BABYLON.Vector3(0, 8, -25),
            this.scene
        );
        this.camera.mode = BABYLON.Camera.PERSPECTIVE_CAMERA;
        this.camera.fov = 0.8;
        this.camera.minZ = 0.1;
        this.camera.maxZ = 1000;
        this.camera.inputs.clear();
        this.scene.activeCamera = this.camera;

        this.cameraManager = this._game.cameraManager;
        this.cameraManager.rigs.clear();
        this.cameraManager.registerRig("duel", this.cameraRig);
        this.cameraManager.registerRig("explore", this.exploreCameraRig);
        this.cameraManager.registerRig("scripted", this.scriptedCameraRig);
        this.cameraManager.activeRig = null;
        this.cameraManager.activeRigId = null;
        this.cameraManager.rebind(this.scene, this.camera);
        sharedContext.cameraManager = this.cameraManager;
        sharedContext.camera = this.camera;
        this.combatSystem.cameraManager = this.cameraManager;
        console.log("[Scene] B8: using game stable objects (combatSystem/rigs/sharedContext)");

        this.inventoryBar = this._game.inventoryBar;
        this.buffBar = this._game.buffBar;
        this.hpBar = this._game.hpBar;
        this.dialogueBubble = this._game.sharedContext.dialogueBubble;
        sharedContext.inventoryManager = this.inventoryManager;
        sharedContext.questManager = this.questManager;
        sharedContext.inventoryBar = this.inventoryBar;
        sharedContext.buffBar = this.buffBar;
        sharedContext.hpBar = this.hpBar;
        sharedContext.dialogueBubble = this.dialogueBubble;

        this.sharedContext = sharedContext;

        this.sceneSequencer = this._game.sceneSequencer;
        sharedContext.sceneSequencer = this.sceneSequencer;

        this.gameModeManager = this._game.gameModeManager;
        this.battleMode = this.gameModeManager.modes.get("battle");
        this.exploreMode = this.gameModeManager.modes.get("explore");
        if (!this.battleMode || !this.exploreMode) {
            this.battleMode = new BattleMode(sharedContext);
            this.exploreMode = new ExploreMode(sharedContext);
            this.gameModeManager.registerMode(this.battleMode);
            this.gameModeManager.registerMode(this.exploreMode);
        }
        this.gameModeManager.start("explore");
        console.log("[Scene] B8: using game UI + sceneSequencer + gameModeManager");

        this._onKeyDown = (e) => {
            if (e.key.toLowerCase() === "x") {
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

        if (this.paused || this._loading) {
            return;
        }

        this.sceneSequencer.fixedUpdate(dtMs, tickCount);
        this.gameModeManager.fixedUpdate(dtMs, tickCount);
    }

    updateRender(dtMs) {
        if (this._loading) return;
        this.gameModeManager.updateRender(dtMs);
        this.sceneSequencer.updateRender(dtMs);
        if (this.cameraManager) {
            this.cameraManager.update(dtMs, this.sharedContext);
        }
        this._smoothedFighterDistance = this.battleMode.context.smoothedFighterDistance;
    }

    render() {
        if (this._loading) return;
        if (!this.scene || !this.scene.activeCamera) return;
        this.scene.render();
    }

    dispose() {
        if (this.entityPool) {
            for (const entity of this.entityPool) {
                if (entity.dispose) entity.dispose();
            }
        }
        if (this.scene) {
            this.scene.debugLayer.hide();
            this.scene.dispose();
        }
        if (this._onKeyDown) {
            window.removeEventListener("keydown", this._onKeyDown);
            this._onKeyDown = null;
        }
        if (this.inputSystem && this.inputSystem !== this._game?.inputSystem) {
            this.inputSystem.dispose();
        }
        if (this.inventoryBar && this.inventoryBar !== this._game?.inventoryBar) {
            this.inventoryBar.dispose();
        }
        if (this.buffBar && this.buffBar !== this._game?.buffBar) {
            this.buffBar.dispose();
        }
        if (this.hpBar && this.hpBar !== this._game?.hpBar) {
            this.hpBar.dispose();
        }
        if (this.cameraRig && this.cameraRig !== this._game?.cameraRig) {
            this.cameraRig.dispose();
        }
        if (this.exploreCameraRig && this.exploreCameraRig !== this._game?.exploreCameraRig) {
            this.exploreCameraRig.dispose();
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

    _evaluateCondition(cond, worldState) {
        if (!cond || Object.keys(cond).length === 0) return true;
        if (cond.flag !== undefined && !worldState.flags[cond.flag]) return false;
        if (cond.flagNot !== undefined && worldState.flags[cond.flagNot]) return false;
        if (cond.scenario !== undefined && worldState.scenario !== cond.scenario) return false;
        if (cond.scenarioMin !== undefined && worldState.scenario < cond.scenarioMin) return false;
        if (cond.scenarioMax !== undefined && worldState.scenario > cond.scenarioMax) return false;
        if (cond.quest !== undefined) {
            const q = worldState.getQuest(cond.quest);
            if (cond.stage !== undefined && q.stage !== cond.stage) return false;
            if (cond.completed !== undefined && q.completed !== cond.completed) return false;
        }
        return true;
    }
}
