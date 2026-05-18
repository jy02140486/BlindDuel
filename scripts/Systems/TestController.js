import { BaseController } from "./BaseController.js";

export class TestController extends BaseController {
    constructor(character = null, scriptConfig = {}) {
        super(character);
        this.loop = false;
        this.steps = [];
        this.currentStepIndex = 0;
        this.currentStepElapsedMs = 0;
        this.currentStepEntered = false;
        this.debugTrace = false;
        this.sequenceLabel = "test-sequence";
        this.loopCycle = 0;

        this.setScript(scriptConfig);
    }

    setScript(scriptConfig = {}) {
        this.loop = scriptConfig.loop === true;
        this.debugTrace = scriptConfig.debugTrace === true;
        this.sequenceLabel = scriptConfig.sequenceLabel || "test-sequence";
        this.steps = this.#normalizeSteps(scriptConfig.steps);
        this.reset();
    }

    reset() {
        this.currentStepIndex = 0;
        this.currentStepElapsedMs = 0;
        this.currentStepEntered = false;
        this.loopCycle = 0;
        this.setMoveIntent({ x: 0, y: 0 });
    }

    fixedUpdate(dtMs = 0, tickCount = null) {
        const delta = Math.max(0, Number(dtMs) || 0);
        this.#advance(delta, tickCount);
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

    #advance(dtMs, tickCount = null) {
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
                this.loopCycle += 1;
                if (this.debugTrace) {
                    console.log(`[SequenceStart] label=${this.sequenceLabel} cycle=${this.loopCycle} tick=${tickCount ?? "?"}`);
                }
            }

            const step = this.steps[this.currentStepIndex];
            if (!step) {
                break;
            }

            if (!this.currentStepEntered) {
                if (this.debugTrace && this.currentStepIndex === 0 && this.loopCycle === 0) {
                    console.log(`[SequenceStart] label=${this.sequenceLabel} cycle=0 tick=${tickCount ?? "?"}`);
                }
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
