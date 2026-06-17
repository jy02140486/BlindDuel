import { BaseController } from "./BaseController.js";

export class PlayerController extends BaseController {
    constructor(inputSystem, character = null) {
        super(character);
        this.inputSystem = inputSystem;
        this.enabled = true;
        this.buffs = [];
    }

    addBuff(buff) {
        this.buffs.push(buff);
        console.log(`[Buff] +${buff.type} x${(1 + buff.value).toFixed(2)} (${this.buffs.length} active)`);
    }

    removeBuff(type) {
        const before = this.buffs.length;
        this.buffs = this.buffs.filter(b => b.type !== type);
        if (before !== this.buffs.length) {
            console.log(`[Buff] -${type} (${this.buffs.length} active)`);
        }
    }

    clearBuffs() {
        if (this.buffs.length > 0) {
            console.log(`[Buff] cleared all (was ${this.buffs.length} active)`);
        }
        this.buffs.length = 0;
    }

    getSpeedMultiplier() {
        return this.buffs
            .filter(b => b.type === "speedMultiplier")
            .reduce((acc, b) => acc * (1 + b.value), 1.0);
    }

    getCdMultiplier() {
        return this.buffs
            .filter(b => b.type === "cdMultiplier")
            .reduce((acc, b) => acc * (1 + b.value), 1.0);
    }

    #combineMoveIntent() {
        const keyboardMove = this.inputSystem.getKeyboardMoveVector();
        const leftStick = this.inputSystem.getLeftStickVector();

        const useStick =
            Math.abs(leftStick.x) > 0 ||
            Math.abs(leftStick.y) > 0;

        if (useStick) {
            return {
                x: leftStick.x,
                y: leftStick.y
            };
        }

        return keyboardMove;
    }

    fixedUpdate(dtMs, tickCount) {
        if (!this.enabled) {
            this.setMoveIntent({ x: 0, y: 0 });
            return;
        }

        this.setMoveIntent(this.#combineMoveIntent());

        if (this.inputSystem.consumeAction("thrust", tickCount)) {
            this.queueCommand("thrust");
        }
        if (this.inputSystem.consumeAction("quart", tickCount)) {
            this.queueCommand("quart");
        }
        if (this.inputSystem.consumeAction("zornhut", tickCount)) {
            this.queueCommand("zornhut");
        }
        if (this.inputSystem.consumeAction("guard", tickCount)) {
            this.queueCommand("guard");
        }

        this.applyToCharacter();
    }

    dispose() {
        super.dispose();
    }
}
