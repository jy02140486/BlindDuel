export class InputSystem {
    constructor(options = {}) {
        this.deadzone = options.deadzone ?? 0.2;
        this.actionListeners = new Set();
        this.debugEnabled = options.debugEnabled ?? true;
        this.debugPanel = this.debugEnabled ? this.#createDebugPanel() : null;

        this.keyboard = {
            w: false,
            a: false,
            s: false,
            d: false,
            l: false,
            i: false,
            k: false,
            j: false,
            e: false,
            q: false,
            o: false
        };

        this.gamepad = {
            connected: false,
            id: null,
            index: -1,
            leftStickX: 0,
            leftStickY: 0,
            a: false,
            b: false,
            x: false,
            y: false,
            lb: false,
            rb: false
        };

        this.bufferedInputs = [];
        this.BUFFER_WINDOW = 1;
        this.currentTick = 0;

        this._onKeyDown = (event) => this.#setKeyState(event, true);
        this._onKeyUp = (event) => this.#setKeyState(event, false);
        this._onGamepadConnected = (event) => {
            const pad = event.gamepad;
            this.gamepad.connected = true;
            this.gamepad.id = pad?.id ?? "unknown";
            this.gamepad.index = typeof pad?.index === "number" ? pad.index : 0;
        };
        this._onGamepadDisconnected = (event) => {
            const padIndex = typeof event?.gamepad?.index === "number" ? event.gamepad.index : this.gamepad.index;
            if (padIndex === this.gamepad.index) {
                this.#resetGamepadState();
            }
        };

        window.addEventListener("keydown", this._onKeyDown);
        window.addEventListener("keyup", this._onKeyUp);
        window.addEventListener("gamepadconnected", this._onGamepadConnected);
        window.addEventListener("gamepaddisconnected", this._onGamepadDisconnected);
    }

    #setKeyState(event, isDown) {
        const key = event.key.toLowerCase();
        if (key in this.keyboard) {
            const wasDown = this.keyboard[key];
            this.keyboard[key] = isDown;
            if (!wasDown && isDown && key === "l") {
                this.#bufferAction("thrust", { source: "keyboard", key: "l" });
            }
            if (!wasDown && isDown && key === "i") {
                this.#bufferAction("quart", { source: "keyboard", key: "i" });
            }
            if (!wasDown && isDown && key === "k") {
                this.#bufferAction("fullthrust", { source: "keyboard", key: "k" });
            }
            if (!wasDown && isDown && key === "o") {
                this.#bufferAction("zornhut", { source: "keyboard", key: "o" });
            }
            if (!wasDown && isDown && key === "q") {
                this.#bufferAction("dodge", { source: "keyboard", key: "q" });
            }
            if (!wasDown && isDown && key === "j") {
                this.#bufferAction("guard", { source: "keyboard", key: "j" });
                this.#bufferAction("interact", { source: "keyboard", key: "j" });
            }
            if (!wasDown && isDown && key === "e") {
                this.#bufferAction("interact", { source: "keyboard", key: "e" });
            }
        }
    }

    #bufferAction(action, payload = {}) {
        this.bufferedInputs.push({
            action,
            ...payload,
            tick: this.currentTick,
            consumed: false
        });
    }

    #emitActionPressed(action, payload = {}) {
        for (const listener of this.actionListeners) {
            listener({
                action,
                ...payload
            });
        }
    }

    #createDebugPanel() {
        const panel = document.createElement("pre");
        panel.style.position = "fixed";
        panel.style.left = "12px";
        panel.style.bottom = "12px";
        panel.style.margin = "0";
        panel.style.padding = "10px 12px";
        panel.style.background = "rgba(0, 0, 0, 0.55)";
        panel.style.color = "#d8e7ff";
        panel.style.font = "12px/1.5 Consolas, monospace";
        panel.style.zIndex = "10";
        panel.style.pointerEvents = "none";
        panel.style.border = "1px solid rgba(255,255,255,0.12)";
        panel.textContent = "Input Debug";
        document.body.appendChild(panel);
        return panel;
    }

    #renderDebugPanel() {
        if (!this.debugPanel) {
            return;
        }
        
        const snapshot = this.getSnapshot();
        const { keyboard, gamepad, move } = snapshot;
        const stickX = move.leftStick.x.toFixed(2);
        const stickY = move.leftStick.y.toFixed(2);

        this.debugPanel.textContent = [
            "Input Debug",
            `W: ${keyboard.w}  A: ${keyboard.a}  S: ${keyboard.s}  D: ${keyboard.d}`,
            `L: ${keyboard.l}  I: ${keyboard.i}  K: ${keyboard.k}  O: ${keyboard.o}  Q: ${keyboard.q}`,
            `Pad Connected: ${gamepad.connected}`,
            `A: ${gamepad.a}  B: ${gamepad.b}  X: ${gamepad.x}  Y: ${gamepad.y}  LB: ${gamepad.lb}  RB: ${gamepad.rb}`,
            `Left Stick: (${stickX}, ${stickY})`
        ].join("\n");
    }

    #resetGamepadState() {
        this.gamepad.connected = false;
        this.gamepad.id = null;
        this.gamepad.index = -1;
        this.gamepad.leftStickX = 0;
        this.gamepad.leftStickY = 0;
        this.gamepad.a = false;
        this.gamepad.b = false;
        this.gamepad.x = false;
        this.gamepad.y = false;
        this.gamepad.lb = false;
        this.gamepad.rb = false;
    }

    #applyDeadzone(value) {
        return Math.abs(value) >= this.deadzone ? value : 0;
    }

    fixedUpdate(tickCount) {
        this.currentTick = tickCount;

        const pads = navigator.getGamepads ? navigator.getGamepads() : [];
        const connectedPad = Array.from(pads || []).find((pad) => pad && pad.connected);

        if (!connectedPad) {
            this.#resetGamepadState();
            this.#cleanupBufferedInputs();
            this.#renderDebugPanel();
            return;
        }

        this.gamepad.connected = true;
        this.gamepad.id = connectedPad.id || "unknown";
        this.gamepad.index = connectedPad.index;
        this.gamepad.leftStickX = this.#applyDeadzone(connectedPad.axes?.[0] ?? 0);
        this.gamepad.leftStickY = this.#applyDeadzone(connectedPad.axes?.[1] ?? 0);
        const nextA = Boolean(connectedPad.buttons?.[0]?.pressed);
        if (!this.gamepad.a && nextA) {
            this.#bufferAction("fullthrust", { source: "gamepad", button: "a" });
        }
        this.gamepad.a = nextA;

        const nextB = Boolean(connectedPad.buttons?.[1]?.pressed);
        if (!this.gamepad.b && nextB) {
            this.#bufferAction("thrust", { source: "gamepad", button: "b" });
        }
        this.gamepad.b = nextB;

        const nextX = Boolean(connectedPad.buttons?.[2]?.pressed);
        if (!this.gamepad.x && nextX) {
            this.#bufferAction("guard", { source: "gamepad", button: "x" });
            this.#bufferAction("interact", { source: "gamepad", button: "x" });
        }
        this.gamepad.x = nextX;

        const nextY = Boolean(connectedPad.buttons?.[3]?.pressed);
        if (!this.gamepad.y && nextY) {
            this.#bufferAction("quart", { source: "gamepad", button: "y" });
        }
        this.gamepad.y = nextY;

        const nextLB = Boolean(connectedPad.buttons?.[4]?.pressed);
        if (!this.gamepad.lb && nextLB) {
            this.#bufferAction("dodge", { source: "gamepad", button: "lb" });
        }
        this.gamepad.lb = nextLB;

        const nextRB = Boolean(connectedPad.buttons?.[5]?.pressed);
        if (!this.gamepad.rb && nextRB) {
            this.#bufferAction("zornhut", { source: "gamepad", button: "rb" });
        }
        this.gamepad.rb = nextRB;

        this.#cleanupBufferedInputs();
        this.#renderDebugPanel();
    }

    #cleanupBufferedInputs() {
        this.bufferedInputs = this.bufferedInputs.filter(
            (input) => this.currentTick - input.tick <= this.BUFFER_WINDOW
        );
    }

    consumeAction(action, tickCount) {
        const input = this.bufferedInputs.find(
            (input) => input.action === action && !input.consumed && tickCount - input.tick <= this.BUFFER_WINDOW
        );
        if (input) {
            input.consumed = true;
            return true;
        }
        return false;
    }

    onActionPressed(listener) {
        this.actionListeners.add(listener);
        return () => {
            this.actionListeners.delete(listener);
        };
    }

    isDown(name) {
        switch (name) {
        case "w":
        case "a":
        case "s":
        case "d":
        case "l":
        case "q":
            return this.keyboard[name];
        case "gamepadA":
            return this.gamepad.a;
        case "gamepadB":
            return this.gamepad.b;
        default:
            return false;
        }
    }

    getKeyboardMoveVector() {
        let x = 0;
        let y = 0;

        if (this.keyboard.a) x -= 1;
        if (this.keyboard.d) x += 1;
        if (this.keyboard.w) y += 1;
        if (this.keyboard.s) y -= 1;

        return { x, y };
    }

    getLeftStickVector() {
        return {
            x: this.gamepad.leftStickX,
            y: -this.gamepad.leftStickY
        };
    }

    getSnapshot() {
        return {
            keyboard: { ...this.keyboard },
            gamepad: {
                connected: this.gamepad.connected,
                id: this.gamepad.id,
                index: this.gamepad.index,
                leftStickX: this.gamepad.leftStickX,
                leftStickY: this.gamepad.leftStickY,
                b: this.gamepad.b,
                x: this.gamepad.x
            },
            move: {
                keyboard: this.getKeyboardMoveVector(),
                leftStick: this.getLeftStickVector()
            }
        };
    }

    dispose() {
        window.removeEventListener("keydown", this._onKeyDown);
        window.removeEventListener("keyup", this._onKeyUp);
        window.removeEventListener("gamepadconnected", this._onGamepadConnected);
        window.removeEventListener("gamepaddisconnected", this._onGamepadDisconnected);
        this.debugPanel?.remove();
    }
}
