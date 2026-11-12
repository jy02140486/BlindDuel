export class EndingOverlay {
    constructor({ onContinue } = {}) {
        this._onContinue = onContinue ?? (() => {});
        this._visible = false;
        this._armed = false;
        this._onKey = (e) => {
            if (!this._armed || e.repeat) return;
            this._onContinue();
        };
        this._onPointer = () => {
            if (!this._armed) return;
            this._onContinue();
        };
        window.addEventListener("keydown", this._onKey);
        window.addEventListener("mousedown", this._onPointer);
    }

    show(text) {
        if (!this._root) {
            this._root = document.createElement("div");
            this._root.id = "ending-overlay";
            const textEl = document.createElement("div");
            textEl.className = "ending-text";
            this._root.appendChild(textEl);
            const hint = document.createElement("div");
            hint.className = "ending-hint";
            hint.textContent = "- PRESS ANY KEY -";
            this._root.appendChild(hint);
            document.body.appendChild(this._root);
        }
        this._root.querySelector(".ending-text").textContent = text;
        this._visible = true;
        this._armed = false;
        this._root.classList.remove("hidden");
        // fresh input edge（计划 §5.4）：延迟武装，吞掉 sequence 期间残留的按住键/点击
        setTimeout(() => { this._armed = true; }, 500);
    }

    hide() {
        this._visible = false;
        this._armed = false;
        this._root?.classList.add("hidden");
    }

    isVisible() {
        return this._visible;
    }

    dispose() {
        window.removeEventListener("keydown", this._onKey);
        window.removeEventListener("mousedown", this._onPointer);
        this._armed = false;
        this._visible = false;
    }
}
