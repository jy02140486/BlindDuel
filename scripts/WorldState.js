export class WorldState {
    constructor() {
        this.scenario = 0;
        this.flags = {};
        this.quests = {};
        this.sceneStates = {};
    }

    getQuest(questId) {
        return this.quests[questId] ?? { stage: 0, completed: false };
    }

    ensureScene(sceneId) {
        if (!this.sceneStates[sceneId]) {
            this.sceneStates[sceneId] = { encounters: {}, pickables: {} };
        }
        return this.sceneStates[sceneId];
    }
}