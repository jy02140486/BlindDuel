const HOW_TO_PLAY_LINES = [
    "A / D : Move",
    "J : Attack",
    "K : Heavy Attack",
    "L : Throw (uses ammo)",
    "P / Esc : Pause",
    "C : Toggle camera projection",
];

export class MainMenuUI {
    constructor({ onNewGame, onContinue, hasCheckpoint, playClickSound } = {}) {
        this._onNewGame = onNewGame ?? (() => {});
        this._onContinue = onContinue ?? (() => {});
        this._hasCheckpoint = hasCheckpoint ?? (() => false);
        this._playClickSound = playClickSound ?? (() => {});
        this._root = document.getElementById("main-menu");
        this._subview = document.getElementById("menu-subview");
        this._subviewTitle = document.getElementById("menu-subview-title");
        this._subviewContent = document.getElementById("menu-subview-content");
        this._visible = false;
        this._bindButtons();
    }

    _bindButtons() {
        document.getElementById("menu-btn-new-game")?.addEventListener("click", () => {
            this._playClickSound();
            this._onNewGame();
        });
        document.getElementById("menu-btn-continue")?.addEventListener("click", () => {
            this._playClickSound();
            this._onContinue();
        });
        document.getElementById("menu-btn-how-to-play")?.addEventListener("click", () => {
            this._playClickSound();
            this.openHowToPlay();
        });
        document.getElementById("menu-btn-credits")?.addEventListener("click", () => {
            this._playClickSound();
            this.openCredits();
        });
        document.getElementById("menu-subview-back")?.addEventListener("click", () => {
            this._playClickSound();
            this._showMenuButtons();
        });
    }

    refresh() {
        const btnContinue = document.getElementById("menu-btn-continue");
        if (btnContinue) btnContinue.disabled = !this._hasCheckpoint();
    }

    show() {
        this._visible = true;
        this.refresh();
        this._subview?.classList.add("hidden");
        this._root?.classList.remove("hidden");
    }

    hide() {
        this._visible = false;
        this._root?.classList.add("hidden");
        this._subview?.classList.add("hidden");
    }

    isVisible() {
        return this._visible;
    }

    openHowToPlay() {
        this._openSubview("How to Play", HOW_TO_PLAY_LINES);
    }

    async openCredits() {
        let lines;
        try {
            const resp = await fetch("./docs/AudioLicensesInfo.MD", { cache: "no-cache" });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const text = await resp.text();
            lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        } catch (err) {
            console.warn("[MainMenuUI] credits load failed", err);
            lines = ["Failed to load audio credits."];
        }
        this._openSubview("Credits", lines);
    }

    _openSubview(title, lines) {
        if (this._subviewTitle) this._subviewTitle.textContent = title;
        if (this._subviewContent) {
            this._subviewContent.innerHTML = "";
            for (const line of lines) {
                const div = document.createElement("div");
                div.className = "menu-subview-line";
                div.textContent = line;
                this._subviewContent.appendChild(div);
            }
        }
        this._root?.classList.add("hidden");
        this._subview?.classList.remove("hidden");
    }

    _showMenuButtons() {
        this._subview?.classList.add("hidden");
        this._root?.classList.remove("hidden");
        this.refresh();
    }
}
