import { BaseController } from "./BaseController.js";

export class PlayerController extends BaseController {
    constructor(inputSystem, character = null) {
        super(character);
        this.inputSystem = inputSystem;
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
