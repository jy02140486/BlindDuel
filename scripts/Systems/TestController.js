import { BaseController } from "./BaseController.js";

export class TestController extends BaseController {
    constructor(character = null, scriptConfig = {}) {
        super(character);
        this.loop = false;
        this.steps = [];
        this.currentStepIndex = 0;
        this.currentStepElapsedMs = 0;
        this.currentStepEntered = false;

        this.setScript(scriptConfig);
    }

    setScript(scriptConfig = {}) {
        this.loop = scriptConfig.loop === true;
        this.steps = this.#normalizeSteps(scriptConfig.steps);
        this.reset();
    }

    reset() {
        this.currentStepIndex = 0;
        this.currentStepElapsedMs = 0;
        this.currentStepEntered = false;
        this.setMoveIntent({ x: 0, y: 0 });
    }

    update(dtMs = 0) {
        const delta = Math.max(0, Number(dtMs) || 0);
        this.#advance(delta);
        this.applyToCharacter();
    }

    #normalizeSteps(steps) {
        if (!Array.isArray(steps)) {
            return [];
        }

        const normalized = [];
        for (const rawStep of steps) {
            const repeat = Math.max(1, Math.floor(Number(rawStep?.repeat ?? 1) || 1));
            const step = {
                waitMs: Math.max(0, Number(rawStep?.waitMs ?? 0) || 0),
                moveIntent: rawStep?.moveIntent
                    ? {
                        x: Number(rawStep.moveIntent.x ?? 0),
                        y: Number(rawStep.moveIntent.y ?? 0)
                    }
                    : null,
                commands: this.#normalizeCommands(rawStep)
            };

            for (let i = 0; i < repeat; i += 1) {
                normalized.push({
                    waitMs: step.waitMs,
                    moveIntent: step.moveIntent ? { ...step.moveIntent } : null,
                    commands: [...step.commands]
                });
            }
        }
        return normalized;
    }

    #normalizeCommands(step) {
        const commands = [];
        if (typeof step?.command === "string" && step.command.length > 0) {
            commands.push(step.command);
        }
        if (Array.isArray(step?.commands)) {
            for (const command of step.commands) {
                if (typeof command === "string" && command.length > 0) {
                    commands.push(command);
                }
            }
        }
        return commands;
    }

    #advance(dtMs) {
        if (this.steps.length === 0) {
            return;
        }

        let remainingMs = dtMs;
        let safety = 0;
        const maxSafety = Math.max(32, this.steps.length * 4);

        while (safety < maxSafety) {
            if (this.currentStepIndex >= this.steps.length) {
                if (!this.loop) {
                    break;
                }
                this.currentStepIndex = 0;
                this.currentStepElapsedMs = 0;
                this.currentStepEntered = false;
            }

            const step = this.steps[this.currentStepIndex];
            if (!step) {
                break;
            }

            if (!this.currentStepEntered) {
                if (step.moveIntent) {
                    this.setMoveIntent(step.moveIntent);
                }
                this.queueCommands(step.commands);
                this.currentStepEntered = true;
            }

            if (step.waitMs <= 0) {
                this.#advanceStep();
                safety += 1;
                continue;
            }

            if (remainingMs <= 0) {
                break;
            }

            const remainInStep = step.waitMs - this.currentStepElapsedMs;
            const consumeMs = Math.min(remainingMs, remainInStep);
            this.currentStepElapsedMs += consumeMs;
            remainingMs -= consumeMs;

            if (this.currentStepElapsedMs >= step.waitMs) {
                this.#advanceStep();
            }

            safety += 1;
        }
    }

    #advanceStep() {
        this.currentStepIndex += 1;
        this.currentStepElapsedMs = 0;
        this.currentStepEntered = false;
    }
}
