import { BaseController } from "./BaseController.js";

export class DummyController extends BaseController {
    constructor(character = null, options = {}) {
        super(character);
        this.fixedMoveIntent = {
            x: Number(options.fixedMoveIntent?.x ?? 0),
            y: Number(options.fixedMoveIntent?.y ?? 0)
        };
        this.initialCommands = Array.isArray(options.initialCommands)
            ? [...options.initialCommands]
            : [];
        this.emitInitialCommands = options.emitInitialCommands === true;
        this._didEmitInitialCommands = false;
    }

    setFixedMoveIntent(intent) {
        this.fixedMoveIntent = {
            x: Number(intent?.x ?? 0),
            y: Number(intent?.y ?? 0)
        };
    }

    fixedUpdate(dtMs) {
        this.setMoveIntent(this.fixedMoveIntent);

        if (this.emitInitialCommands && !this._didEmitInitialCommands) {
            this.queueCommands(this.initialCommands);
            this._didEmitInitialCommands = true;
        }

        this.applyToCharacter();
    }
}
