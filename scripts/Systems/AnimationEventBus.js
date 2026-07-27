export class AnimationEventBus {
    constructor() {
        this._typedHandlers = new Map();
        this._allHandlers = new Set();
    }

    subscribe(type, handler) {
        if (typeof type !== "string" || typeof handler !== "function") return () => {};
        let set = this._typedHandlers.get(type);
        if (!set) {
            set = new Set();
            this._typedHandlers.set(type, set);
        }
        set.add(handler);
        return () => this.unsubscribe(type, handler);
    }

    unsubscribe(type, handler) {
        const set = this._typedHandlers.get(type);
        if (!set) return;
        set.delete(handler);
        if (set.size === 0) this._typedHandlers.delete(type);
    }

    subscribeAll(handler) {
        if (typeof handler !== "function") return () => {};
        this._allHandlers.add(handler);
        return () => this._allHandlers.delete(handler);
    }

    dispatch(payload) {
        if (!payload || typeof payload.type !== "string") return;
        const set = this._typedHandlers.get(payload.type);
        if (set) {
            for (const handler of set) {
                try {
                    handler(payload);
                } catch (err) {
                    console.warn(`[AnimationEventBus] typed handler error for "${payload.type}"`, err);
                }
            }
        }
        for (const handler of this._allHandlers) {
            try {
                handler(payload);
            } catch (err) {
                console.warn(`[AnimationEventBus] all handler error for "${payload.type}"`, err);
            }
        }
    }

    clear() {
        this._typedHandlers.clear();
        this._allHandlers.clear();
    }
}