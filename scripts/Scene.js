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
        this.rabbleController = null;
        this.sceneVisualSystem = null;
        this.battleMode = null;
        this.exploreMode = null;
        this._onKeyDown = null;
        this.paused = false;
        this._loading = true;
        this.tickCount = 0;
        this.entityPool = [];
        this._pendingSpawns = [];
        this._unsubscribeWorldState = null;
        this._actorRegistry = null;
        this._entityById = null;
        this._sceneAssets = null;
        this._sceneDef = null;
        this._rabbleControllerBound = false;
    }

    async init(sceneDef, battleDefs = {}) {
        this._battleDefs = battleDefs;
        this.entityPool = [];
        this.scene = new BABYLON.Scene(this.engine);
        this.scene.clearColor = new BABYLON.Color4(0.08, 0.08, 0.1, 1);
        this._game?.audioManager?.attachScene(this.scene);

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
        this._sceneDef = sceneDef;
        this._sceneAssets = assets;
        this._entityById = new Map();
        this._pendingSpawns = [];
        for (const entityDef of sceneDef.entities) {
            if (!this._evaluateCondition(entityDef.spawnIf, this.worldState)) {
                if (entityDef.spawnIf) {
                    this._pendingSpawns.push(entityDef);
                }
                continue;
            }
            // 跳过已拾取的物品
            if (entityDef.kind === "pickable" && this.worldState) {
                const collected = this.worldState.sceneStates?.[sceneDef.id]?.pickables?.[entityDef.id];
                if (collected) continue;
            }
            this._spawnEntity(entityDef);
        }
        const character = this._entityById.get("hero");
        const rabbleStick = this._entityById.get("enemy_1");

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
            if (triggerDef.arrow) {
                trigger.setupArrow({
                    ...triggerDef.arrow,
                    id: triggerDef.id,
                    atlasUrl: triggerDef.arrow.atlasUrl ?? "./Art/Sprite/UI/arrow.png"
                });
            }
            this.triggers.set(triggerDef.id, trigger);
        }
        // 向后兼容：scriptedCameraTrigger 仍硬编码（后续可改为遍历）
        this.scriptedCameraTrigger = this.triggers.get("sc_test_1");

        // --- 控制器 ---
        this.inputSystem = this._game.inputSystem;
        this._game.playerController.setCharacter(character);
        this._game.playerController.inputSystem = this._game.inputSystem;
        this._game.playerController.enabled = true;
        console.log("[Scene] B8: using game.inputSystem + game.playerController");
        character.buffsProvider = this._game.playerController;
        if (rabbleStick) {
            this._initRabbleController(sceneDef.entities, rabbleStick);
        } else {
            this.rabbleController = null;
        }

        // NPC 控制器
        for (const entityDef of sceneDef.entities) {
            if (entityDef.controller === "npc") {
                const npc = this._entityById.get(entityDef.id);
                if (npc) {
                    const npcDef = getNpcDef(entityDef.id);
                    npc.npcController = new NpcController(this.worldState, npcDef);
                    npc.npcController.setupDebugVisual(this.scene, npc.root);
                }
            }
        }

        // --- 战斗系统与边界 ---
        // combatSystem/cameraRig 等 Game 稳定对象直接经 this._game 访问，不再存别名
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
        // WalkArea：构建 _walkAreas 有序数组（stageMask 优先 > walkAreas 数组 > walkArea 单对象），调 _applyWalkArea() 评估首个命中
        this._walkAreas = [];
        if (stageMaskData?.walkArea) {
            this._walkAreas.push({
                if: {},
                minX: stageMaskData.walkArea.x,
                maxX: stageMaskData.walkArea.x + stageMaskData.walkArea.w,
                minY: stageMaskData.walkArea.y,
                maxY: stageMaskData.walkArea.y + stageMaskData.walkArea.h,
            });
        }
        if (Array.isArray(sceneDef.walkAreas)) {
            this._walkAreas.push(...sceneDef.walkAreas);
        }
        if (!stageMaskData?.walkArea && sceneDef.walkArea) {
            this._walkAreas.push({ if: {}, ...sceneDef.walkArea });
        }
        this._applyWalkArea();
        this.pushboxResolver = new PushboxResolver();

        // --- 相机 rigs（复用 game 的，duelRig 用场景配置更新）---
        const cameraRig = this._game.cameraRig;
        const exploreCameraRig = this._game.exploreCameraRig;
        const scriptedCameraRig = this._game.scriptedCameraRig;
        Object.assign(cameraRig, {
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
        this._actorRegistry = actorRegistry;
        for (const entity of this.entityPool) {
            if (entity.id) actorRegistry.set(entity.id, entity);
            if (entity.name) actorRegistry.set(entity.name, entity);
        }
        actorRegistry.set("hero", character);
        if (rabbleStick) actorRegistry.set("enemy", rabbleStick);

        const controllerRegistry = new Map();
        controllerRegistry.set("hero", this._game.playerController);

        const sharedContext = this._game.sharedContext;
        sharedContext.scene = this;
        sharedContext.babylonScene = this.scene;
        sharedContext.rabbleController = this.rabbleController;
        sharedContext.actorRegistry = actorRegistry;
        sharedContext.entityRegistry = actorRegistry;
        sharedContext.controllerRegistry = controllerRegistry;
        sharedContext.character = character;
        sharedContext.rabbleStick = rabbleStick || null;
        sharedContext.pushboxResolver = this.pushboxResolver;
        sharedContext.stageBoundary = this.stageBoundary;
        sharedContext.walkArea = this.walkArea;
        sharedContext.sceneVisualSystem = this.sceneVisualSystem;
        sharedContext.entityPool = this.entityPool;
        sharedContext.assets = this._sceneAssets;
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

        const cameraManager = this._game.cameraManager;
        cameraManager.rebind(this.scene, this.camera);
        sharedContext.camera = this.camera;
        this._game.combatSystem.cameraManager = cameraManager;
        console.log("[Scene] B8: using game stable objects (combatSystem/rigs/sharedContext)");

        sharedContext.inventoryManager = this.inventoryManager;
        sharedContext.questManager = this.questManager;

        this.sharedContext = sharedContext;

        // init 阶段已 spawn 的 enemy_1 此时 sharedContext 才就绪，补同步 rabbleController/rabbleStick
        if (this.rabbleController) sharedContext.rabbleController = this.rabbleController;
        if (this.rabbleStick) sharedContext.rabbleStick = this.rabbleStick;

        const gameModeManager = this._game.gameModeManager;
        this.battleMode = gameModeManager.modes.get("battle");
        this.exploreMode = gameModeManager.modes.get("explore");
        if (!this.battleMode || !this.exploreMode) {
            this.battleMode = new BattleMode(sharedContext);
            this.exploreMode = new ExploreMode(sharedContext);
            gameModeManager.registerMode(this.battleMode);
            gameModeManager.registerMode(this.exploreMode);
        }
        gameModeManager.start("explore");
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

        // 订阅 WorldState 变化，驱动动态 spawn
        if (this.worldState && typeof this.worldState.onChange === "function") {
            this._unsubscribeWorldState = this.worldState.onChange(() => this._onWorldStateChange());
        } else {
            console.warn(`[Scene] WorldState subscription skipped: worldState=${!!this.worldState}, onChange=${typeof this.worldState?.onChange}`);
        }
    }

    togglePause() {
        this.paused = !this.paused;
        console.log(this.paused ? "Paused" : "Resumed");
    }

    toggleCameraProjection() {
        this._game.cameraManager?.toggleProjection();
    }

    onResize() {
        this._game.cameraManager?.onResize();
    }

    fixedUpdate(dtMs, tickCount) {
        this.tickCount = tickCount;

        if (this.paused) return;

        const sceneSequencer = this._game.sceneSequencer;
        if (this._loading) {
            if (sceneSequencer) sceneSequencer.fixedUpdate(dtMs, tickCount);
            // sequencer 播放 outro/intro 期间需要推进 entity.fixedUpdate，否则
            // moveActorTo 写了位置但 animation.fixedUpdate 不跑 → 单帧平移
            // newScene.init 期间 sequencer 不 busy，跳过避免访问已 dispose 的旧 entity
            if (sceneSequencer?.isBusy() && this._game?.gameModeManager) {
                this._game.gameModeManager.fixedUpdate(dtMs, tickCount);
            }
            return;
        }

        sceneSequencer.fixedUpdate(dtMs, tickCount);
        this._game.gameModeManager.fixedUpdate(dtMs, tickCount);
    }

    updateRender(dtMs) {
        const cameraManager = this._game.cameraManager;
        const sceneSequencer = this._game.sceneSequencer;
        if (this._loading) {
            if (cameraManager) cameraManager.update(dtMs, this.sharedContext);
            if (sceneSequencer) sceneSequencer.updateRender(dtMs);
            return;
        }
        this._game.gameModeManager.updateRender(dtMs);
        sceneSequencer.updateRender(dtMs);
        if (cameraManager) {
            cameraManager.update(dtMs, this.sharedContext);
        }
        this._smoothedFighterDistance = this.battleMode.context.smoothedFighterDistance;
        this._game?.audioManager?.update(dtMs);
    }

    render() {
        if (!this.scene || !this.scene.activeCamera) return;
        this.scene.render();
    }

    dispose() {
        if (this._unsubscribeWorldState) {
            this._unsubscribeWorldState();
            this._unsubscribeWorldState = null;
        }
        if (this.entityPool) {
            for (const entity of this.entityPool) {
                if (entity.dispose) entity.dispose();
            }
        }
        if (this.scene) {
            this._game?.audioManager?.detachScene();
            this.scene.debugLayer.hide();
            this.scene.dispose();
        }
        if (this._onKeyDown) {
            window.removeEventListener("keydown", this._onKeyDown);
            this._onKeyDown = null;
        }
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

    _spawnEntity(entityDef) {
        // 跳过已拾取的物品
        if (entityDef.kind === "pickable" && this.worldState) {
            const collected = this.worldState.sceneStates?.[this._sceneDef.id]?.pickables?.[entityDef.id];
            if (collected) return null;
        }
        const entity = createEntityFromDef(this.scene, this._sceneAssets, entityDef);
        if (!entity) return null;
        this.entityPool.push(entity);
        this._entityById.set(entity.id, entity);
        if (entity.name) this._entityById.set(entity.name, entity);
        if (this._actorRegistry) {
            if (entity.id) this._actorRegistry.set(entity.id, entity);
            if (entity.name) this._actorRegistry.set(entity.name, entity);
        }

        // 敌人 controller 绑定（如果还没绑过）
        if ((entityDef.id === "enemy_1" || entityDef.kind === "enemy") && !this._rabbleControllerBound) {
            this._initRabbleController(this._sceneDef.entities, entity);
            // sharedContext 可能在 init 阶段还未赋值，延迟同步到 sharedContext 就绪后做
            if (this.sharedContext) {
                this.sharedContext.rabbleController = this.rabbleController;
                this.sharedContext.rabbleStick = entity;
            }
            if (this._actorRegistry) this._actorRegistry.set("enemy", entity);
        }

        // NPC controller
        if (entityDef.controller === "npc") {
            const npcDef = getNpcDef(entityDef.id);
            entity.npcController = new NpcController(this.worldState, npcDef);
            entity.npcController.setupDebugVisual(this.scene, entity.root);
        }

        // 通知 ExploreMode 重建 indices（如果在运行中）
        if (this.exploreMode?._buildIndices) {
            this.exploreMode._buildIndices();
        }

        this._applyStateMap(entity);

        return entity;
    }

    _initRabbleController(entityDefs, rabbleStick) {
        const rabbleDef = entityDefs.find(e => e.id === "enemy_1" || e.kind === "enemy");
        const controllerType = rabbleDef?.controller ?? "dummy";
        if (controllerType === "test") {
            const archetype = rabbleDef?.archetype ?? "";
            const scriptKey = archetype === "manatarms_sword" ? "manatarmsBasicSequence" : "rabbleBasicSequence";
            const scriptConfig = this._sceneAssets?.testScripts?.[scriptKey] ?? {};
            this.rabbleController = new TestController(rabbleStick, scriptConfig);
        } else {
            this.rabbleController = new DummyController(rabbleStick);
        }
        this._rabbleControllerBound = true;
    }

    _onWorldStateChange() {
        if (this._pendingSpawns?.length) {
            for (let i = this._pendingSpawns.length - 1; i >= 0; i--) {
                const def = this._pendingSpawns[i];
                if (this._evaluateCondition(def.spawnIf, this.worldState)) {
                    this._spawnEntity(def);
                    this._pendingSpawns.splice(i, 1);
                    console.log(`[Scene] dynamic spawn: ${def.id} (spawnIf satisfied)`);
                }
            }
        }

        for (const entity of this.entityPool) {
            if (entity?.stateMap?.length && !entity.isDisposed) {
                this._applyStateMap(entity);
            }
        }

        this._applyWalkArea();
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

    _applyStateMap(entity) {
        if (!entity?.stateMap?.length) return;
        if (entity.isDisposed) return;

        for (const entry of entity.stateMap) {
            if (this._evaluateCondition(entry.if, this.worldState)) {
                if (entity.currentStateName !== entry.clip) {
                    entity.enterState(entry.clip);
                }
                return;
            }
        }

        const fallback = entity._initialClip ?? Object.keys(entity.clips)[0];
        if (fallback && entity.currentStateName !== fallback) {
            entity.enterState(fallback);
        }
    }

    _applyWalkArea() {
        if (!this._walkAreas?.length) return;

        for (const def of this._walkAreas) {
            if (this._evaluateCondition(def.if, this.worldState)) {
                const current = this.walkArea;
                if (!current ||
                    current.minX !== def.minX || current.maxX !== def.maxX ||
                    current.minY !== def.minY || current.maxY !== def.maxY) {
                    if (current) current.dispose();
                    this.walkArea = new WalkArea(this.scene, {
                        minX: def.minX, maxX: def.maxX,
                        minY: def.minY, maxY: def.maxY,
                        visible: true
                    });
                    if (this.sharedContext) {
                        this.sharedContext.walkArea = this.walkArea;
                    }
                }
                return;
            }
        }
    }
}
