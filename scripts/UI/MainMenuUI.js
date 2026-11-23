const HOW_TO_PLAY_COLUMNS = [
    {
        title: "Keyboard",
        lines: [
            "WASD : Move",
            "K/L : Thrust(Heavy/Light)",
            "I/O : Cut (Light/Heavy)",
            "J : Guard, Action",
            "Q : Dodge",
            "; : Throw (uses ammo)",
            "P / Esc : Pause",
        ],
    },
    {
        title: "Gamepad",
        lines: [
            "Left Stick : Move",
            "A/B : Thrust(Heavy/Light)",
            "Y/RB : Cut (Light/Heavy)",
            "X : Guard, Action",
            "LB : Dodge",
            "RT : Throw (uses ammo)",
        ],
    },
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
        this._openSubview("How to Play", HOW_TO_PLAY_COLUMNS);
    }

    async openCredits() {
        let lines;
        try {
            const [creditsResp, audioResp] = await Promise.all([
                fetch("./docs/Credits.MD", { cache: "no-cache" }),
                fetch("./docs/AudioLicensesInfo.MD", { cache: "no-cache" }),
            ]);
            if (!creditsResp.ok) throw new Error(`HTTP ${creditsResp.status}`);
            const creditsText = await creditsResp.text();
            const audioLines = audioResp.ok
                ? (await audioResp.text()).split(/\r?\n/).map(l => l.trim()).filter(Boolean)
                : ["Failed to load audio license info."];
            lines = [];
            for (const rawLine of creditsText.split(/\r?\n/)) {
                const line = rawLine.trim();
                if (!line) continue;
                if (/AudioLicensesInfo\.MD/i.test(line)) {
                    lines.push(...audioLines.map(text => ({ level: 0, text })));
                    continue;
                }
                const headingMatch = line.match(/^(#{1,3})\s+(.*)$/);
                if (headingMatch) {
                    lines.push({ level: headingMatch[1].length, text: headingMatch[2] });
                } else {
                    lines.push({ level: 0, text: line.replace(/^-\s*/, "") });
                }
            }
        } catch (err) {
            console.warn("[MainMenuUI] credits load failed", err);
            lines = ["Failed to load credits."];
        }
        this._openSubview("Credits", lines);
    }

    _openSubview(title, content) {
        if (this._subviewTitle) this._subviewTitle.textContent = title;
        if (this._subviewContent) {
            this._subviewContent.innerHTML = "";
            if (content.length > 0 && Array.isArray(content[0]?.lines)) {
                const wrap = document.createElement("div");
                wrap.className = "menu-columns";
                for (const col of content) {
                    const colDiv = document.createElement("div");
                    colDiv.className = "menu-column";
                    const heading = document.createElement("div");
                    heading.className = "menu-column-title";
                    heading.textContent = col.title;
                    colDiv.appendChild(heading);
                    for (const line of col.lines) {
                        const div = document.createElement("div");
                        div.className = "menu-subview-line";
                        div.textContent = line;
                        colDiv.appendChild(div);
                    }
                    wrap.appendChild(colDiv);
                }
                this._subviewContent.appendChild(wrap);
            } else {
                for (const item of content) {
                    const div = document.createElement("div");
                    if (typeof item === "object") {
                        div.className = item.level >= 1 && item.level <= 3
                            ? `menu-md-h${item.level}`
                            : "menu-md-body";
                        div.textContent = item.text;
                    } else {
                        div.className = "menu-subview-line";
                        div.textContent = item;
                    }
                    this._subviewContent.appendChild(div);
                }
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
