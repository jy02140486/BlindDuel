import { WorldState } from "./WorldState.js";
import { QuestManager } from "./Systems/QuestManager.js";
import { InventoryManager } from "./Systems/InventoryManager.js";
import { Scene } from "./Scene.js";
import { SCENARIO } from "../Data/ScenarioMilestones.js";
import { ALL_SCENES, OUTDOOR_VILLAGE } from "./SceneDefs.js";

export class Game {
    constructor(engine, canvas) {
        this.worldState = new WorldState();
        this.inventoryManager = new InventoryManager();
        this.questManager = new QuestManager(this.worldState, this.inventoryManager);
        this.questManager.onStateChange = () => {
            const sceneDef = this.scene?.sharedContext?.sceneDef;
            if (sceneDef) {
                const spawnId = Object.keys(sceneDef.spawns)[0] ?? "house_door";
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
    }

    async init(sceneDef, battleDefs) {
        await this.scene.init(sceneDef, battleDefs);
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
        this.scene.dispose();
    }

    resetWorldState() {
        this.worldState.scenario = SCENARIO.CHAPTER_1_START;
        this.worldState.flags = {};
        this.worldState.quests = {};
        this.worldState.sceneStates = {};
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
            this.scene._pendingRestore = { hp: 3, maxHp: 3, buffs: [] };
            this.scene._pendingSceneLoad = { sceneDef: OUTDOOR_VILLAGE, spawnId: "house_door" };
            return;
        }

        this.worldState.scenario = cp.scenario;
        this.worldState.flags = JSON.parse(JSON.stringify(cp.flags));
        this.worldState.quests = JSON.parse(JSON.stringify(cp.quests));
        this.worldState.sceneStates = JSON.parse(JSON.stringify(cp.sceneStates));
        this.inventoryManager.items = JSON.parse(JSON.stringify(cp.inventory));

        this.scene._pendingRestore = { hp: cp.hp, maxHp: cp.maxHp, buffs: JSON.parse(JSON.stringify(cp.buffs)) };
        this.scene._pendingSceneLoad = { sceneDef: ALL_SCENES[cp.sceneId], spawnId: cp.spawnId };

        console.log('[Checkpoint] restored', { sceneId: cp.sceneId, spawnId: cp.spawnId, scenario: cp.scenario, hp: cp.hp });
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