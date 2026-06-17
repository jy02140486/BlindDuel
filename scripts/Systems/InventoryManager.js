/**
 * InventoryManager — 背包管理
 * 管理背包中物品的增删查。
 */
export class InventoryManager {
    constructor() {
        this.items = [];
    }

    addItem(itemDef) {
        if (!itemDef) return;
        this.items.push({ ...itemDef, uid: `${itemDef.id}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` });
        console.log(`[Inventory] + ${itemDef.name} (${this.items.length} items)`);
    }

    removeItem(itemId) {
        const idx = this.items.findIndex(it => it.id === itemId);
        if (idx === -1) return null;
        const removed = this.items.splice(idx, 1)[0];
        console.log(`[Inventory] - ${removed.name} (${this.items.length} items)`);
        return removed;
    }

    hasItem(itemId) {
        return this.items.some(it => it.id === itemId);
    }

    getThrowables() {
        return this.items.filter(it => it.throwable);
    }
}