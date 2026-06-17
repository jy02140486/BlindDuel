/**
 * HpBar — 左上角血量显示，♥ 表示
 */
export class HpBar {
    constructor(containerElement) {
        this.container = containerElement;
    }

    update(currentHp, maxHp) {
        if (!this.container) return;
        const clamped = Math.max(0, Math.min(currentHp, maxHp));
        this.container.textContent = "\u2665".repeat(clamped);
    }

    dispose() {
        if (this.container) {
            this.container.textContent = "";
        }
    }
}