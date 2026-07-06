import { getItemDef } from "../../Data/ItemDefs.js";

export class QuestManager {
    constructor(worldState, inventoryManager = null) {
        this.world = worldState;
        this.inventory = inventoryManager;
        this.onStateChange = null;
    }

    setScenario(value) {
        this.world.scenario = value;
    }

    advanceTo(milestone) {
        if (milestone > this.world.scenario) {
            this.world.scenario = milestone;
            this.onStateChange?.();
        }
    }

    setFlag(key, value) {
        this.world.flags[key] = value;
        this.onStateChange?.();
    }

    startQuest(questId) {
        this.world.quests[questId] = { stage: 1, completed: false };
    }

    setQuestStage(questId, stage) {
        const q = this.world.quests[questId];
        if (q) {
            q.stage = stage;
            this.onStateChange?.();
        }
    }

    completeQuest(questId) {
        const q = this.world.quests[questId];
        if (q) {
            q.stage = q.stage + 1;
            q.completed = true;
            this.onStateChange?.();
        }
    }

    startDaggerQuest() {
        this.startQuest("dagger");
    }

    completeDaggerQuest() {
        if (this.inventory) {
            this.inventory.removeItem("dagger");
        }
        this.completeQuest("dagger");
    }

    executeAction(actionName) {
        if (typeof this[actionName] === "function") {
            this[actionName]();
        }
    }

    executeDirectives(directives) {
        if (!Array.isArray(directives)) return;
        for (const d of directives) {
            switch (d.type) {
                case "advanceScenario": this.advanceTo(d.value); break;
                case "setScenario": this.setScenario(d.value); break;
                case "setFlag": this.setFlag(d.key, d.value ?? true); break;
                case "clearFlag": this.setFlag(d.key, false); break;
                case "startQuest": this.startQuest(d.id); break;
                case "setQuestStage": this.setQuestStage(d.id, d.stage); break;
                case "completeQuest": this.completeQuest(d.id); break;
                case "removeItem": this.inventory?.removeItem(d.item); break;
                case "addItem": {
                    const itemDef = getItemDef(d.item);
                    if (itemDef) this.inventory?.addItem(itemDef);
                    break;
                }
                default: console.warn(`[QuestManager] unknown directive: ${d.type}`);
            }
        }
    }

    markEncounterDefeated(sceneId, encounterId) {
        this.world.ensureScene(sceneId).encounters[encounterId] = true;
    }

    isEncounterDefeated(sceneId, encounterId) {
        return !!this.world.sceneStates[sceneId]?.encounters[encounterId];
    }

    markPickableCollected(sceneId, pickableId) {
        this.world.ensureScene(sceneId).pickables[pickableId] = true;
    }

    isPickableCollected(sceneId, pickableId) {
        return !!this.world.sceneStates[sceneId]?.pickables[pickableId];
    }
}