export class BaseController {
    constructor(character = null) {
        this.character = character;
        this.moveIntent = { x: 0, y: 0 };
        this.pendingCommands = [];
    }

    setCharacter(character) {
        this.character = character;
    }

    setMoveIntent(intent) {
        this.moveIntent = {
            x: Number(intent?.x ?? 0),
            y: Number(intent?.y ?? 0)
        };
    }

    getMoveIntent() {
        return { ...this.moveIntent };
    }

    queueCommand(command) {
        if (!command) {
            return;
        }
        this.pendingCommands.push(command);
    }

    queueCommands(commands) {
        if (!Array.isArray(commands)) {
            return;
        }
        for (const command of commands) {
            this.queueCommand(command);
        }
    }

    consumeCommands() {
        const commands = [...this.pendingCommands];
        this.pendingCommands.length = 0;
        return commands;
    }

    applyToCharacter() {
        if (!this.character) {
            return;
        }

        if (typeof this.character.setMoveIntent === "function") {
            this.character.setMoveIntent(this.moveIntent);
        }

        if (typeof this.character.pushCommand !== "function") {
            return;
        }

        while (this.pendingCommands.length > 0) {
            const command = this.pendingCommands.shift();
            this.character.pushCommand(command);
        }
    }

    dispose() {
        // Intentionally empty. Subclasses can override.
    }
}
