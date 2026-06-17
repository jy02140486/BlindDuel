/**
 * InventoryBar — 屏幕左侧竖排背包精灵图标
 * 监听 InventoryManager 变化，增删 DOM 元素。
 */
export class InventoryBar {
    constructor(containerElement) {
        this.container = containerElement;
        this.slots = [];
    }

    update(items) {
        if (!this.container) return;
        this.container.innerHTML = "";
        this.slots = [];

        for (const item of items) {
            const slot = document.createElement("div");
            slot.className = "inventory-slot";

            const img = document.createElement("img");
            img.src = item.textureUrl ?? "";
            img.alt = item.name ?? item.id;
            img.title = item.name ?? item.id;
            slot.appendChild(img);

            this.container.appendChild(slot);
            this.slots.push(slot);
        }
    }

    dispose() {
        if (this.container) {
            this.container.innerHTML = "";
        }
        this.slots = [];
    }
}