// e:\se\BlindDuel\scripts\UI\DialogueBubble.js
export class DialogueBubble {
    constructor(containerElement) {
        this._container = containerElement;
        this._bubble = null;
        this._targetNpc = null;
        this._create();
    }

    _create() {
        if (!this._container) return;
        this._bubble = document.createElement("div");
        this._bubble.className = "dialogue-bubble";
        this._bubble.style.display = "none";
        this._container.appendChild(this._bubble);
    }

    show(npc) {
        this._targetNpc = npc;
        if (this._bubble) this._bubble.style.display = "block";
    }

    setText(text) {
        if (!this._bubble) return;
        this._clear();
        this._bubble.innerHTML = text;
    }

    setContent(segments) {
        if (!this._bubble) return;
        this._clear();
        if (!Array.isArray(segments)) return;
        for (const seg of segments) {
            if (!seg || typeof seg !== "object") continue;
            if (seg.type === "text" && typeof seg.value === "string") {
                this._bubble.appendChild(document.createTextNode(seg.value));
            } else if (seg.type === "image" && typeof seg.src === "string") {
                const img = document.createElement("img");
                img.src = seg.src;
                img.alt = seg.alt ?? "";
                img.style.verticalAlign = "middle";
                if (seg.width != null) img.style.width = `${seg.width}px`;
                if (seg.height != null) img.style.height = `${seg.height}px`;
                if (seg.style && typeof seg.style === "object") {
                    for (const [k, v] of Object.entries(seg.style)) {
                        img.style[k] = v;
                    }
                }
                this._bubble.appendChild(img);
            }
        }
    }

    _clear() {
        if (this._bubble) this._bubble.innerHTML = "";
    }

    hide() {
        this._targetNpc = null;
        if (this._bubble) this._bubble.style.display = "none";
    }

    get isVisible() {
        return this._targetNpc !== null;
    }

    update(scene) {
        if (!this._targetNpc || !this._bubble || !scene) return;

        const canvas = scene.getEngine().getRenderingCanvas();
        if (!canvas) return;

        const npc = this._targetNpc;
        const worldPos = npc.root.position.clone();

        const pxToWorld = npc.pxToWorld ?? 0.03;
        const frameH = npc.baseFrameHeightPx ?? 100;
        worldPos.y += frameH * pxToWorld * 0.9;

        const projected = BABYLON.Vector3.Project(
            worldPos,
            BABYLON.Matrix.Identity(),
            scene.getTransformMatrix(),
            scene.activeCamera.viewport.toGlobal(canvas.width, canvas.height)
        );

        const inView = projected.z > 0 && projected.z < 1;
        if (inView) {
            this._bubble.style.display = "block";
            this._bubble.style.left = `${projected.x}px`;
            this._bubble.style.top = `${projected.y}px`;
        } else {
            this._bubble.style.display = "none";
        }
    }

    dispose() {
        if (this._bubble) {
            this._bubble.remove();
            this._bubble = null;
        }
        this._targetNpc = null;
    }
}