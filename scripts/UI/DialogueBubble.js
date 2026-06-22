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
        if (this._bubble) this._bubble.textContent = text;
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

        if (projected.z > 0 && projected.z < 1) {
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