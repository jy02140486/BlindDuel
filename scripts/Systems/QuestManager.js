export class QuestManager {
    constructor(worldState, inventoryManager = null) {
        this.world = worldState;
        this.inventory = inventoryManager;
    }

    setScenario(value) {
        this.world.scenario = value;
    }

    setFlag(key, value) {
        this.world.flags[key] = value;
    }

    startQuest(questId) {
        this.world.quests[questId] = { stage: 1, completed: false };
    }

    setQuestStage(questId, stage) {
        const q = this.world.quests[questId];
        if (q) q.stage = stage;
    }

    completeQuest(questId) {
        const q = this.world.quests[questId];
        if (q) {
            q.stage = q.stage + 1;
            q.completed = true;
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
}