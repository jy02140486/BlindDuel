/**
 * BuffBar — 屏幕左侧 buff 图标显示
 * 支持 unicode 图标和自定义图片两种模式。
 */
export class BuffBar {
    constructor(containerElement) {
        this.container = containerElement;
        this.slots = [];
    }

    update(buffs) {
        if (!this.container) return;
        this.container.innerHTML = "";
        this.slots = [];

        for (const buff of buffs) {
            const slot = document.createElement("div");
            slot.className = "buff-slot";

            if (buff.iconType === "image" && buff.icon) {
                const img = document.createElement("img");
                img.src = buff.icon;
                img.alt = buff.type;
                img.title = buff.type;
                slot.appendChild(img);
            } else if (buff.icon) {
                const span = document.createElement("span");
                span.className = "buff-icon-unicode";
                span.textContent = buff.icon;
                slot.appendChild(span);
            }

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