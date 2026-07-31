/**
 * TimeControlSystem — Character Temporal Effects（角色级冻结/停滞状态机）
 *
 * 职责：管理单个 CombatCharacter 的 hitstop / blockstun / hitstun / impactContext
 * （整数帧计数），与全局 FrameClock 完全正交。
 *
 * 与 FrameClock 的关系：
 * - 不自己读 clock，通过 tick(character, dtMs, tickCount) 参数注入
 *   （dtMs 来源 = caller 传入的 clock.fixedDeltaMs）
 * - 每个 CombatCharacter 实例自己持有一个 TimeControlSystem
 * - 全局暂停（clock.paused）由 FrameClock 控制，本系统不感知
 *
 * 详见 plans/统一时间源与 Render 采样架构设计.MD §5
 */
import { ImpactContext } from "../Components/TimeControlComponent.js";

export class TimeControlSystem {
    applyHitstop(character, frames) {
        const tc = character?.timeControl;
        if (!tc) return false;
        if (tc.impactContext) return false;
        if (tc.hitstopFrames > 0) return false;
        tc.hitstopFrames = frames;
        tc.preHitstopTimeScale = character.animation.timeScale;
        character.animation.setTimeScale(0);
        return true;
    }

    applyBlockstun(character, frames) {
        const tc = character?.timeControl;
        if (!tc) return;
        tc.blockstunFrames = frames;
    }

    freezeImpact(character, durationFrames, options = {}) {
        const tc = character?.timeControl;
        if (!tc) return;
        if (tc.impactContext) {
            console.log(`[freezeImpact] ${character.id}: already has impactContext, skip`);
            return;
        }
        console.log(`[freezeImpact] ${character.id}: start freeze, frames=${durationFrames}, nextState=${options.nextState}, currentState=${character.currentStateName}`);
        tc.impactContext = new ImpactContext({
            frames: durationFrames,
            nextState: options.nextState ?? null,
            knockbackX: options.knockbackX ?? 0,
            preTimeScale: character.animation.timeScale,
            expectedStateAtResolve: character.currentStateName,
            stateEntrySerialAtCreate: character.stateEntrySerial,
            startTick: Number.isFinite(options.startTick) ? options.startTick : null
        });
        character.animation.setTimeScale(0);
    }

    isFrozen(character) {
        const tc = character?.timeControl;
        if (!tc) return false;
        return Boolean(tc.impactContext) || tc.hitstopFrames > 0 || tc.blockstunFrames > 0 || tc.hitstunFrames > 0;
    }

    tick(character, dtMs, tickCount) {
        const tc = character?.timeControl;
        if (!tc) {
            return {
                mode: "none",
                effectiveDeltaMs: dtMs,
                shouldAdvanceAnimation: true,
                shouldRunStateLogic: true,
                shouldAdvanceTimedTags: true
            };
        }

        const wasFrozenAtFrameStart = this.isFrozen(character);

        if (tc.impactContext) {
            tc.impactContext.frames--;
            if (tc.impactContext.frames <= 0) {
                const ctx = tc.impactContext;
                console.log(`[fixedUpdate] ${character.id}: impactContext end, nextState=${ctx.nextState}, currentState=${character.currentStateName}`);
                tc.impactContext = null;
                character.animation.setTimeScale(ctx.preTimeScale);
                if (ctx.knockbackX !== 0) {
                    character.root.position.x += ctx.knockbackX;
                }
                const canResolveNextState = Boolean(ctx.nextState) &&
                    character.currentStateName === ctx.expectedStateAtResolve &&
                    character.stateEntrySerial === ctx.stateEntrySerialAtCreate;
                if (canResolveNextState) {
                    character.enterState(ctx.nextState, tickCount);
                } else if (ctx.nextState) {
                    console.log(
                        `[fixedUpdate] ${character.id}: skip stale impact transition, nextState=${ctx.nextState},` +
                        ` expectedState=${ctx.expectedStateAtResolve}, currentState=${character.currentStateName},` +
                        ` expectedEntry=${ctx.stateEntrySerialAtCreate}, currentEntry=${character.stateEntrySerial}`
                    );
                }
            }
            return {
                mode: "impact",
                effectiveDeltaMs: 0,
                shouldAdvanceAnimation: false,
                shouldRunStateLogic: false,
                shouldAdvanceTimedTags: !wasFrozenAtFrameStart
            };
        }

        if (tc.hitstopFrames > 0) {
            tc.hitstopFrames--;
            if (tc.hitstopFrames <= 0) {
                character.animation.setTimeScale(tc.preHitstopTimeScale);
            }
            return {
                mode: "hitstop",
                effectiveDeltaMs: 0,
                shouldAdvanceAnimation: false,
                shouldRunStateLogic: false,
                shouldAdvanceTimedTags: !wasFrozenAtFrameStart
            };
        }

        if (tc.blockstunFrames > 0) {
            tc.blockstunFrames--;
            return {
                mode: "blockstun",
                effectiveDeltaMs: dtMs,
                shouldAdvanceAnimation: true,
                shouldRunStateLogic: false,
                shouldAdvanceTimedTags: !wasFrozenAtFrameStart
            };
        }

        if (tc.hitstunFrames > 0) {
            tc.hitstunFrames--;
            return {
                mode: "hitstun",
                effectiveDeltaMs: dtMs,
                shouldAdvanceAnimation: true,
                shouldRunStateLogic: false,
                shouldAdvanceTimedTags: !wasFrozenAtFrameStart
            };
        }

        return {
            mode: "none",
            effectiveDeltaMs: dtMs,
            shouldAdvanceAnimation: true,
            shouldRunStateLogic: true,
            shouldAdvanceTimedTags: !wasFrozenAtFrameStart
        };
    }
}
