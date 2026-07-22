export class GameplayEventBus {
    constructor() {
        this._handlers = new Map();
    }

    on(type, handler) {
        if (typeof type !== "string" || typeof handler !== "function") return () => {};
        let set = this._handlers.get(type);
        if (!set) {
            set = new Set();
            this._handlers.set(type, set);
        }
        set.add(handler);
        return () => this.off(type, handler);
    }

    off(type, handler) {
        const set = this._handlers.get(type);
        if (!set) return;
        set.delete(handler);
        if (set.size === 0) this._handlers.delete(type);
    }

    emit(event) {
        if (!event || typeof event.type !== "string") return;
        const set = this._handlers.get(event.type);
        if (!set) return;
        for (const handler of set) {
            try {
                handler(event);
            } catch (err) {
                console.warn(`[GameplayEventBus] handler error for "${event.type}"`, err);
            }
        }
    }

    clear() {
        this._handlers.clear();
    }
}