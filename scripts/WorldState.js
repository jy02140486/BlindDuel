export class WorldState {
    constructor() {
        this.scenario = 0;
        this.flags = {};
        this.quests = {};
    }

    getQuest(questId) {
        return this.quests[questId] ?? { stage: 0, completed: false };
    }
}