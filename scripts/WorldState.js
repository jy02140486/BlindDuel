export class WorldState {
    constructor() {
        this.scenario = 0;
        this.flags = {};
        this.quests = {};
        this.sceneStates = {};
        this.currentSceneId = "prologue";
        this.currentSpawnId = null;
        this._listeners = [];
    }

    onChange(fn) {
        this._listeners.push(fn);
        return () => {
            this._listeners = this._listeners.filter(f => f !== fn);
        };
    }

    setScenario(value) {
        if (this.scenario === value) return;
        this.scenario = value;
        this._notify();
    }

    setFlag(key, value = true) {
        if (this.flags[key] === value) return;
        this.flags[key] = value;
        this._notify();
    }

    _notify() {
        for (const fn of this._listeners) {
            try { fn(this); } catch (e) { console.warn("[WorldState] listener error", e); }
        }
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