import { WorldState } from "./WorldState.js";
import { QuestManager } from "./Systems/QuestManager.js";
import { InventoryManager } from "./Systems/InventoryManager.js";
import { Scene } from "./Scene.js";
import { SCENARIO } from "../Data/ScenarioMilestones.js";
import { BATTLE_DEFS } from "./SceneDefs.js";
import { resolveSceneDef, getSceneDefSync } from "./SceneDefRegistry.js";

export class Game {
    constructor(engine, canvas) {
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
    }

    async init() {
        const sceneId = this.worldState.currentSceneId;
        const sceneDef = await resolveSceneDef(sceneId);
        await this.scene.init(sceneDef, BATTLE_DEFS);
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
            this.scene._pendingRestore = { hp: 3, maxHp: 3, buffs: [] };
            this.scene._pendingSceneLoad = {
                sceneDef: getSceneDefSync(this.worldState.currentSceneId),
                spawnId: this.worldState.currentSpawnId ?? "house_door",
            };
            return;
        }

        this.worldState.scenario = cp.scenario;
        this.worldState.flags = JSON.parse(JSON.stringify(cp.flags));
        this.worldState.quests = JSON.parse(JSON.stringify(cp.quests));
        this.worldState.sceneStates = JSON.parse(JSON.stringify(cp.sceneStates));
        this.inventoryManager.items = JSON.parse(JSON.stringify(cp.inventory));

        this.scene._pendingRestore = { hp: cp.hp, maxHp: cp.maxHp, buffs: JSON.parse(JSON.stringify(cp.buffs)) };
        this.scene._pendingSceneLoad = { sceneDef: getSceneDefSync(cp.sceneId), spawnId: cp.spawnId };

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