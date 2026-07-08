import { WorldState } from "./WorldState.js";
import { QuestManager } from "./Systems/QuestManager.js";
import { InventoryManager } from "./Systems/InventoryManager.js";
import { Scene } from "./Scene.js";
import { SCENARIO } from "../Data/ScenarioMilestones.js";
import { BATTLE_DEFS } from "./SceneDefs.js";
import { resolveSceneDef, getSceneDefSync } from "./SceneDefRegistry.js";
import { InputSystem } from "./Systems/InputSystem.js";
import { PlayerController } from "./Systems/PlayerController.js";
import { CombatSystem } from "./Systems/CombatSystem.js";
import { DuelCameraRig } from "./DuelCameraRig.js";
import { ExploreCameraRig } from "./ExploreCameraRig.js";
import { ScriptedCameraRig } from "./ScriptedCameraRig.js";
import { CameraManager } from "./Systems/CameraManager.js";
import { GameModeManager } from "./Systems/GameModeManager.js";
import { BattleMode } from "./Systems/Modes/BattleMode.js";
import { ExploreMode } from "./Systems/Modes/ExploreMode.js";
import { SceneSequencer } from "./Systems/SceneSequencer.js";
import { InventoryBar } from "./UI/InventoryBar.js";
import { BuffBar } from "./UI/BuffBar.js";
import { HpBar } from "./UI/HpBar.js";
import { DialogueBubble } from "./UI/DialogueBubble.js";
import { ASSET_MANIFEST } from "./AssetManifest.js";
import { loadDataAssets } from "./DataLoader.js";

const DEFAULT_DUEL_CAMERA = {
    zoomMinDistance: 3.2, zoomMaxDistance: 6.4,
    orthoMinWidth: 16, orthoMaxWidth: 32,
    perspMinDistance: 15, perspMaxDistance: 35,
    minCameraHeight: 3.2, maxCameraHeight: 5.2,
    targetAspect: 16 / 9,
};

export class Game {
    constructor(engine, canvas) {
        this.engine = engine;
        this.canvas = canvas;
        this.worldState = new WorldState();
        this.inventoryManager = new InventoryManager();
        this.questManager = new QuestManager(this.worldState, this.inventoryManager);
        this.questManager.onStateChange = () => {
            const sceneDef = this.scene?.sharedContext?.sceneDef;
            if (sceneDef) {
                const spawnId = this.worldState.currentSpawnId
                    ?? Object.keys(sceneDef.spawns)[0]
                    ?? "house_door";
                this.saveCheckpoint(sceneDef.id, spawnId);
            }
        };
        this.scene = new Scene(engine, canvas, {
            worldState: this.worldState,
            questManager: this.questManager,
            inventoryManager: this.inventoryManager,
            game: this,
        });
        this._checkpoint = null;

        // 影子稳定对象（B1）：创建但不接入 Scene，Scene 仍用私有实例
        this.cameraManager = null;
        this.inputSystem = null;
        this.playerController = null;
        this.combatSystem = null;
        this.cameraRig = null;
        this.exploreCameraRig = null;
        this.scriptedCameraRig = null;
        this.gameModeManager = null;
        this.sceneSequencer = null;
        this.inventoryBar = null;
        this.buffBar = null;
        this.hpBar = null;
        this.dialogueBubble = null;
        this.sharedContext = null;
        this.assets = null;
    }

    async bootstrap() {
        console.log("[Game.bootstrap] B1: creating shadow stable objects");

        console.log("[Game.bootstrap] B2: loading assets once");
        this.assets = await loadDataAssets(ASSET_MANIFEST);
        console.log("[Game.bootstrap] B2 done — assets loaded, keys=", Object.keys(this.assets).length);

        this.inputSystem = new InputSystem({ debugEnabled: true });
        this.combatSystem = new CombatSystem({ debugTrace: true });
        this.playerController = new PlayerController(this.inputSystem, null);

        this.cameraRig = new DuelCameraRig(DEFAULT_DUEL_CAMERA);
        this.exploreCameraRig = new ExploreCameraRig();
        this.scriptedCameraRig = new ScriptedCameraRig();

        this.inventoryBar = new InventoryBar(document.getElementById("inventory-bar"));
        this.buffBar = new BuffBar(document.getElementById("buff-bar"));
        this.hpBar = new HpBar(document.getElementById("hp-bar"));
        this.dialogueBubble = new DialogueBubble(document.getElementById("dialogue-bubble-container"));

        // 影子 sharedContext（Scene 不读它，仅为后续切换准备结构）
        this.sharedContext = {
            game: this,
            worldState: this.worldState,
            questManager: this.questManager,
            inventoryManager: this.inventoryManager,
            inputSystem: this.inputSystem,
            playerController: this.playerController,
            combatSystem: this.combatSystem,
            cameraRig: this.cameraRig,
            exploreCameraRig: this.exploreCameraRig,
            scriptedCameraRig: this.scriptedCameraRig,
            inventoryBar: this.inventoryBar,
            buffBar: this.buffBar,
            hpBar: this.hpBar,
            dialogueBubble: this.dialogueBubble,
            sequenceHandlers: new Map(),
            cameraBasePosition: new BABYLON.Vector3(0, 8, -25),
            cameraTarget: new BABYLON.Vector3(0, 0, 0),
            smoothedFighterDistance: 0,
        };

        this.cameraManager = new CameraManager(this.sharedContext);
        this.cameraManager.registerRig("duel", this.cameraRig);
        this.cameraManager.registerRig("explore", this.exploreCameraRig);
        this.cameraManager.registerRig("scripted", this.scriptedCameraRig);
        this.cameraManager.state.aspect = this.canvas.width / this.canvas.height;
        this.cameraManager._createOverlay(this.canvas);
        this.sharedContext.cameraManager = this.cameraManager;

        this.gameModeManager = new GameModeManager();
        this.sceneSequencer = new SceneSequencer(this.sharedContext);
        this.sharedContext.sceneSequencer = this.sceneSequencer;

        console.log("[Game.bootstrap] B1 done — shadow objects created (not wired into Scene)");
        console.log("[Game.bootstrap] cameraManager=", !!this.cameraManager,
            "inputSystem=", !!this.inputSystem,
            "combatSystem=", !!this.combatSystem,
            "rigs=", this.cameraManager.rigs.size,
            "ui=", !!this.inventoryBar && !!this.buffBar && !!this.hpBar,
            "gameModeManager=", !!this.gameModeManager,
            "sceneSequencer=", !!this.sceneSequencer,
            "assets=", !!this.assets);
    }

    async init() {
        const sceneId = this.worldState.currentSceneId;
        const sceneDef = await resolveSceneDef(sceneId);
        this.scene._loading = true;
        await this.scene.init(sceneDef, BATTLE_DEFS);
        this.scene._loading = false;
        this._playIntro(sceneDef);
    }

    _playIntro(sceneDef) {
        const url = sceneDef?.introSequenceUrl;
        if (!url) return;
        const flagKey = `intro_played_${sceneDef.id}`;
        if (this.worldState.flags[flagKey]) return;
        fetch(url, { cache: "no-cache" })
            .then(r => r.json())
            .then(seq => {
                console.log("[Game] intro sequence loaded", seq.id, "tracks=", seq.tracks?.length);
                this.sceneSequencer.play(seq, {});
                this.worldState.flags[flagKey] = true;
            })
            .catch(err => console.warn("[Game] intro sequence load failed", url, err));
    }

    fixedUpdate(dtMs, tickCount) {
        this.scene.fixedUpdate(dtMs, tickCount);
    }

    updateRender(dtMs) {
        this.scene.updateRender(dtMs);
    }

    render() {
        this.scene.render();
    }

    onResize() {
        this.scene.onResize();
    }

    dispose() {
        this.scene?.dispose();
        this.cameraManager?.dispose();
        this.inputSystem?.dispose();
        this.cameraRig?.dispose?.();
        this.exploreCameraRig?.dispose?.();
        this.scriptedCameraRig?.dispose?.();
        this.inventoryBar?.hide?.();
        this.buffBar?.hide?.();
        this.hpBar?.hide?.();
        this.dialogueBubble?.dispose?.();
        this.gameModeManager = null;
        this.sceneSequencer = null;
        this.combatSystem = null;
        this.playerController = null;
    }

    resetWorldState() {
        this.worldState.scenario = SCENARIO.CHAPTER_1_START;
        this.worldState.flags = {};
        this.worldState.quests = {};
        this.worldState.sceneStates = {};
        this.worldState.currentSceneId = "prologue";
        this.worldState.currentSpawnId = null;
        console.log('[Game] WorldState reset to scenario', this.worldState.scenario);
    }

    saveCheckpoint(sceneId, spawnId) {
        const hero = this.scene?.entityPool?.find(e => e.id === "hero");
        this._checkpoint = {
            sceneId,
            spawnId,
            scenario: this.worldState.scenario,
            flags: JSON.parse(JSON.stringify(this.worldState.flags)),
            quests: JSON.parse(JSON.stringify(this.worldState.quests)),
            sceneStates: JSON.parse(JSON.stringify(this.worldState.sceneStates)),
            hp: hero?.hp ?? 3,
            maxHp: hero?.maxHp ?? 3,
            inventory: JSON.parse(JSON.stringify(this.inventoryManager.items)),
            buffs: JSON.parse(JSON.stringify(this.scene?.playerController?.buffs ?? [])),
        };
        console.log('[Checkpoint] saved', { sceneId, spawnId, scenario: this._checkpoint.scenario, hp: this._checkpoint.hp, items: this._checkpoint.inventory.length, buffs: this._checkpoint.buffs.length });
    }

    restoreCheckpoint() {
        const cp = this._checkpoint;
        if (!cp) {
            console.log('[Checkpoint] none saved, resetting to initial state');
            this.resetWorldState();
            this.inventoryManager.items = [];
            this._pendingRestore = { hp: 3, maxHp: 3, buffs: [] };
            this.requestSceneSwitch(
                getSceneDefSync(this.worldState.currentSceneId),
                this.worldState.currentSpawnId ?? "house_door"
            );
            return;
        }

        this.worldState.scenario = cp.scenario;
        this.worldState.flags = JSON.parse(JSON.stringify(cp.flags));
        this.worldState.quests = JSON.parse(JSON.stringify(cp.quests));
        this.worldState.sceneStates = JSON.parse(JSON.stringify(cp.sceneStates));
        this.inventoryManager.items = JSON.parse(JSON.stringify(cp.inventory));

        this._pendingRestore = { hp: cp.hp, maxHp: cp.maxHp, buffs: JSON.parse(JSON.stringify(cp.buffs)) };
        this.requestSceneSwitch(getSceneDefSync(cp.sceneId), cp.spawnId);

        console.log('[Checkpoint] restored', { sceneId: cp.sceneId, spawnId: cp.spawnId, scenario: cp.scenario, hp: cp.hp });
    }

    async requestSceneSwitch(sceneDef, spawnId) {
        console.log("[Game] B9: requestSceneSwitch", sceneDef?.id, "spawn=", spawnId);
        this.scene._loading = true;
        await this._loadSceneInternal(sceneDef, spawnId);
    }

    async _loadSceneInternal(sceneDef, spawnId) {
        const oldScene = this.scene;
        const oldSceneId = this.worldState.currentSceneId;
        const oldSceneDef = oldSceneId ? await resolveSceneDef(oldSceneId) : null;
        const hero = oldScene?.entityPool?.find(e => e.id === "hero");
        const savedHp = hero?.combat?.hp ?? 3;
        const restoreData = this._pendingRestore;
        this._pendingRestore = null;

        const newScene = new Scene(this.engine, this.canvas, {
            worldState: this.worldState,
            questManager: this.questManager,
            inventoryManager: this.inventoryManager,
            game: this,
        });
        newScene._loading = true;

        const transition = sceneDef.transition || {};
        const fadeOutMs = transition.fadeOutMs ?? 400;
        const fadeInMs = transition.fadeInMs ?? 600;

        console.log("[Game] _loadSceneInternal begin outro+fadeout, old=", oldSceneId, "new=", sceneDef.id);
        await this._playOutro(oldSceneDef, { fadeOutMs });
        await this._awaitOutroAndFadeComplete();

        this.scene = newScene;
        console.log("[Game] _loadSceneInternal dispose old scene, savedHp=", savedHp);
        oldScene.dispose();

        await newScene.init(sceneDef, BATTLE_DEFS);

        const newHero = newScene.entityPool?.find(e => e.id === "hero");
        if (newHero) {
            newHero.combat.hp = restoreData?.hp ?? savedHp;
        }

        if (restoreData?.buffs && newScene.playerController) {
            newScene.playerController.buffs = restoreData.buffs;
        }

        if (this.inventoryBar) {
            this.inventoryBar.update(this.inventoryManager.items);
        }
        if (newScene.playerController && this.buffBar) {
            this.buffBar.update(newScene.playerController.buffs);
        }

        const spawnPoint = sceneDef.spawns?.[spawnId];
        if (spawnPoint && newHero) {
            newHero.root.position.set(spawnPoint[0], spawnPoint[1], spawnPoint[2] ?? 0);
        }

        console.log("[Game] _loadSceneInternal fadeIn+intro, new=", sceneDef.id);
        this.cameraManager.enqueueEffect({
            type: "fade",
            durationMs: fadeInMs,
            params: { from: 1, to: 0, color: "black" }
        });
        this._playIntro(sceneDef);

        newScene._loading = false;
        this.worldState.currentSceneId = sceneDef.id;
        this.worldState.currentSpawnId = spawnId;
        console.log("[Game] _loadSceneInternal done, new scene=", sceneDef.id);
    }

    async _playOutro(sceneDef, opts = {}) {
        if (!sceneDef?.outroSequenceUrl) {
            this.cameraManager.enqueueEffect({
                type: "fade",
                durationMs: opts.fadeOutMs ?? 400,
                params: { from: 0, to: 1, color: "black" }
            });
            return;
        }
        try {
            const seq = await fetch(sceneDef.outroSequenceUrl, { cache: "no-cache" }).then(r => r.json());
            console.log("[Game] outro sequence loaded", seq.id, "tracks=", seq.tracks?.length);
            this.sceneSequencer.play(seq, {});
        } catch (err) {
            console.warn("[Game] outro sequence load failed", sceneDef.outroSequenceUrl, err);
            this.cameraManager.enqueueEffect({
                type: "fade",
                durationMs: opts.fadeOutMs ?? 400,
                params: { from: 0, to: 1, color: "black" }
            });
        }
    }

    async _awaitOutroAndFadeComplete() {
        const seq = this.sceneSequencer;
        const cm = this.cameraManager;
        while (seq.isBusy() || cm.hasActiveEffects()) {
            await this._nextFrame();
        }
    }

    _nextFrame() {
        return new Promise(resolve => requestAnimationFrame(resolve));
    }

    hasCheckpoint() {
        return !!this._checkpoint;
    }

    togglePause() {
        this.scene.togglePause();
    }

    toggleCameraProjection() {
        this.scene.toggleCameraProjection();
    }
}