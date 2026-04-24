import { BaseController } from "./BaseController.js";

export class PlayerController extends BaseController {
    constructor(inputSystem, character = null) {
        super(character);
        this.inputSystem = inputSystem;

        this._unsubscribeAction = this.inputSystem.onActionPressed((event) => {
            this.#handleActionPressed(event);
        });
    }

    #handleActionPressed(event) {
        if (event.action === "thrust") {
            this.queueCommand("thrust");
        }
        if (event.action === "quart") {
            this.queueCommand("quart");
        }
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

    update() {
        this.setMoveIntent(this.#combineMoveIntent());
        this.applyToCharacter();
    }

    dispose() {
        this._unsubscribeAction?.();
        super.dispose();
    }
}
