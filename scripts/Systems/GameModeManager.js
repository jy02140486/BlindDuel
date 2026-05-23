export class GameModeManager {
    constructor() {
        this.modes = new Map();
        this.currentMode = null;
        this.listeners = new Map();
    }

    addListener(event, callback) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event).add(callback);
    }

    removeListener(event, callback) {
        const set = this.listeners.get(event);
        if (set) {
            set.delete(callback);
        }
    }

    _emit(event, payload) {
        const set = this.listeners.get(event);
        if (set) {
            for (const cb of set) {
                cb(payload);
            }
        }
    }

    registerMode(mode) {
        if (!mode || !mode.id) {
            throw new Error("GameModeManager.registerMode requires mode.id");
        }
        this.modes.set(mode.id, mode);
    }

    start(initialModeId, payload) {
        const mode = this.modes.get(initialModeId);
        if (!mode) {
            throw new Error(`GameModeManager.start unknown mode: ${initialModeId}`);
        }
        this.currentMode = mode;
        if (this.currentMode.enter) {
            this.currentMode.enter(payload);
        }
    }

    switchMode(nextModeId, payload) {
        const nextMode = this.modes.get(nextModeId);
        if (!nextMode) {
            throw new Error(`GameModeManager.switchMode unknown mode: ${nextModeId}`);
        }
        const prevMode = this.currentMode;
        if (prevMode && prevMode.exit) {
            prevMode.exit();
        }
        this.currentMode = nextMode;
        if (this.currentMode.enter) {
            this.currentMode.enter(payload);
        }
        this._emit("onModeChanged", { prevModeId: prevMode?.id ?? null, nextModeId });
    }

    fixedUpdate(dtMs, tickCount) {
        if (this.currentMode && this.currentMode.fixedUpdate) {
            this.currentMode.fixedUpdate(dtMs, tickCount);
        }
    }

    updateRender(dtMs) {
        if (this.currentMode && this.currentMode.updateRender) {
            this.currentMode.updateRender(dtMs);
        }
    }
}
