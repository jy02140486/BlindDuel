import { ContactResolver } from "./ContactResolver.js";
import { CombatTuning } from "../../Data/CombatTuning.js";

export class CombatSystem {
    constructor(options = {}) {
        this.tuning = options.combatTuning ?? CombatTuning;
        // ContactResolver 接收同一 combatTuning 对象，保证 resolve 阶段和 effect 处理阶段使用同一套手感参数
        this.resolver = options.resolver ?? new ContactResolver({ ...options, combatTuning: this.tuning });
        this.debugTrace = options.debugTrace ?? false;
        this.cameraManager = options.cameraManager ?? null;
    }

    fixedUpdate(characters = [], tickCount = null, worldContext = {}) {
        const combatants = characters.filter((c) => c?.has?.("combat"));
        const result = this.resolver.resolve(combatants, { tickCount });

        // Feedback Memory: 收集本帧产生的 combat result → outcomeMap[attackerId] = { outcome, attackInstanceId }
        // 只记录第一次（同帧多个 effect 指向同一 attacker 时优先先处理的）
        const outcomeMap = new Map();

        for (const effect of result.effects) {
            const target = characters.find((character) => character?.id === effect.targetId);

            if (!target) {
                continue;
            }

            // Feedback Memory: 本 effect 是否需要产生 outcome 回传？
            this.#collectOutcomeFromEffect(effect, outcomeMap);

            if (effect.type === "clash") {
                const hitState = effect.context?.hitState ?? "clash";
                const knockbackX = effect.context?.knockbackX ?? 0;
                if (typeof target.freezeImpact === "function") {
                    target.freezeImpact(effect.context?.freezeImpactFrames ?? this.tuning.hit.freezeImpactFrames, {
                        nextState: target.hasState(hitState) ? hitState : null,
                        knockbackX: knockbackX
                    });
                }
                this._fxShake(0.18, 120);
                continue;
            }

            if (effect.type === "hitstop") {
                if (typeof target.applyHitstop === "function") {
                    target.applyHitstop(effect.durationFrames);
                }
                continue;
            }

            if (effect.type === "blockstun") {
                if (typeof target.applyBlockstun === "function") {
                    target.applyBlockstun(effect.durationFrames);
                }
                this._fxShake(0.12, 100);
                continue;
            }

            if (effect.type === "defenseSuccess") {
                const source = effect.context?.source;
                const traits = target.stateGraph?.characterTraits || {};
                for (const [traitName, traitConfig] of Object.entries(traits)) {
                    if (!traitConfig.enabled) continue;
                    if (!traitConfig.triggers?.includes(source)) continue;
                    const durationFrames = Math.round((traitConfig.durationMs ?? 500) / (1000 / 60));
                    if (traitName === "postDefenseMobility") {
                        if (typeof target.markPostDefenseMobilityPending === "function") {
                            target.markPostDefenseMobilityPending(durationFrames);
                        }
                    } else if (traitName === "postDefenseCounter") {
                        if (typeof target.markPostDefenseCounterPending === "function") {
                            target.markPostDefenseCounterPending(durationFrames);
                        }
                    }
                }
                continue;
            }

            if (effect.type === "hit") {
                const attackerId = effect.context?.attackerId;
                let finalKnockbackX = effect.context?.knockbackX ?? 0;

                // === hitstop — 从 effect.context 读 override ===
                const hitstopFrames = effect.context?.attackHitstopFrames ?? this.tuning.hit.hitstopFrames ?? 0;
                if (hitstopFrames > 0 && typeof target.applyHitstop === "function") {
                    target.applyHitstop(hitstopFrames);
                }
                if (attackerId && hitstopFrames > 0) {
                    const attacker = characters.find(c => c?.id === attackerId);
                    if (attacker && typeof attacker.applyHitstop === "function") {
                        attacker.applyHitstop(hitstopFrames);
                    }

                    // === Pushback v2：逐帧反推（仅边界场景） ===
                    // 触判条件同时满足：
                    // 1. 有 boundary
                    // 2. victim 被推方向有边界
                    // 3. victim 到该边界的距离 < PUSHBACK_TRIGGER_THRESHOLD
                    const boundary = worldContext?.boundary;
                    const PUSHBACK_TRIGGER_THRESHOLD = this.tuning.hit.pushbackTriggerThreshold ?? 1.0;
                    if (attacker && boundary && finalKnockbackX !== 0) {
                        const pushDir = Math.sign(finalKnockbackX); // victim 被推的方向
                        const victimX = target.root.position.x;
                        // victim 被推方向到该侧边界的距离
                        const victimAvailable = pushDir > 0
                            ? boundary.maxX - victimX  // 往右推 → 看右边界
                            : victimX - boundary.minX;  // 往左推 → 看左边界
                        const isNearBoundary = victimAvailable < PUSHBACK_TRIGGER_THRESHOLD;
                        if (isNearBoundary) {
                            const dir = Math.sign(target.root.position.x - attacker.root.position.x);
                            const PUSHBACK_KNOCKBACK_SCALE = this.tuning.hit.pushbackKnockbackScale ?? 2;
                            const attackerPushX = -dir * Math.abs(finalKnockbackX) * PUSHBACK_KNOCKBACK_SCALE;
                            const slipFrames = Math.max(1, hitstopFrames);
                            const perFrame = attackerPushX / slipFrames;
                            const tc = attacker.timeControl;
                            tc.hitstopPushbackFrames = slipFrames;
                            tc.hitstopPushbackPerFrame = perFrame;
                            attacker._suppressFrameSpeeds = true;
                            const curFrameIdx = attacker.animation.currentFrameIndex;
                            const totalFrames = attacker.animation.frameCount;
                            const isLastFrame = curFrameIdx >= totalFrames - 1;
                            tc.hitstopPushbackPending = !isLastFrame;
                            tc.hitstopPushbackStartFrameIndex = curFrameIdx;
                        }
                    }
                }
                // Feedback Memory: 通知攻击者自己的攻击命中了
                const attackerChar = attackerId ? characters.find(c => c?.id === attackerId) : null;
                if (attackerChar && typeof attackerChar.markAttackHit === "function") {
                    attackerChar.markAttackHit();
                }
                // Feedback Memory: 若被击中者在 committed attack 且尚未 resolved → 产生 interrupted outcome
                // 必须在 takeDamage 之前检测，此时 target.currentStateName 还是攻击状态
                if (target.currentStateDef?.attackActive === true
                    && typeof target.isCurrentAttackResolved === "function"
                    && !target.isCurrentAttackResolved()
                    && !outcomeMap.has(target.id)) {
                    outcomeMap.set(target.id, {
                        outcome: "interrupted",
                        attackInstanceId: target._currentAttackInstanceId,
                        targetState: target.currentStateName,
                        counteredBy: attackerId
                    });
                }
                if (typeof target.takeDamage === "function") {
                    const modifiedCtx = { ...effect.context, knockbackX: finalKnockbackX };
                    target.takeDamage(modifiedCtx);
                }
                this._fxShake(0.25, 180);
                this._fxFlash(80);
                continue;
            }

            // 兜底：未知 effect.type 仍尝试 takeDamage（兼容未来扩展）
            if (typeof target.takeDamage === "function") {
                target.takeDamage(effect.context);
            }
            this._fxShake(0.25, 180);
            this._fxFlash(80);
        }

        // Feedback Memory: 统一回传 outcome 给各 attacker 的 controller
        this.#dispatchOutcomes(outcomeMap, characters);

        return result;
    }

    /**
     * 从单个 effect 中提取 combat result，写入 outcomeMap
     * 优先级：同帧内同一 attackerId 只保留第一个 outcome（先处理的为准）
     */
    #collectOutcomeFromEffect(effect, outcomeMap) {
        const type = effect.type;
        const ctx = effect.context ?? {};

        // hit → outcome="hit" 给 attacker
        if (type === "hit") {
            const attackerId = ctx.attackerId;
            if (attackerId && !outcomeMap.has(attackerId)) {
                outcomeMap.set(attackerId, {
                    outcome: "hit",
                    attackInstanceId: ctx.attackInstanceId ?? null,
                    counteredBy: effect.targetId
                });
            }
            return;
        }

        // clash → 区分 parry（无 contactType）vs 普通拼刀（有 contactType）
        if (type === "clash") {
            // parry 专用 clash：ContactResolver 手动 push 的，context 只有 { attackerId, knockbackX }
            // 没有 contactType 字段 → 判定为 parry
            const isParryClash = ctx.attackerId && !ctx.contactType;
            // 普通 clash：buildClashEffect 生成的，有 contactType + attackerId
            const isNormalClash = ctx.attackerId && ctx.contactType;

            if (isParryClash) {
                const attackerId = effect.targetId;  // clash effect 的 targetId 是被 parry 的攻击方
                if (attackerId && !outcomeMap.has(attackerId)) {
                    outcomeMap.set(attackerId, {
                        outcome: "parried",
                        attackInstanceId: ctx.attackInstanceId ?? null,
                        counteredBy: ctx.attackerId  // 防守方（parry 来源）
                    });
                }
            } else if (isNormalClash) {
                // contactType="clash_tie" 或 "clash_lose" 都是输方
                const loserId = effect.targetId;
                if (loserId && !outcomeMap.has(loserId)) {
                    outcomeMap.set(loserId, {
                        outcome: "clash",
                        attackInstanceId: ctx.attackInstanceId ?? null,
                        counteredBy: ctx.attackerId  // 赢方
                    });
                }
            }
            return;
        }

        // defenseSuccess + source="guard_block" → outcome="guard_blocked" 给 attacker
        // （parry 的 outcome 已经由 clash effect 覆盖了，这里跳过；dodge 暂不回传）
        if (type === "defenseSuccess") {
            if (ctx.source === "guard_block") {
                const attackerId = ctx.attackerId;
                if (attackerId && !outcomeMap.has(attackerId)) {
                    outcomeMap.set(attackerId, {
                        outcome: "guard_blocked",
                        attackInstanceId: ctx.attackInstanceId ?? null,
                        counteredBy: effect.targetId  // 防守方
                    });
                }
            }
            return;
        }
    }

    /**
     * 统一回传 outcome 给各 attacker 的 controller.onCombatResult
     * 同时通知 CombatCharacter.markAttackResolved（用于去重 miss 检测）
     */
    #dispatchOutcomes(outcomeMap, characters) {
        for (const [attackerId, { outcome, attackInstanceId, counteredBy, targetState }] of outcomeMap) {
            const attackerChar = characters.find(c => c?.id === attackerId);
            if (!attackerChar?.controller?.onCombatResult) continue;

            // 先标记该攻击实例已被 resolved（让 CombatCharacter 退出攻击状态时不会重复回传 miss）
            if (attackInstanceId && typeof attackerChar.markAttackResolved === "function") {
                attackerChar.markAttackResolved(attackInstanceId);
            }

            const defenderChar = counteredBy ? characters.find(c => c?.id === counteredBy) : null;
            attackerChar.controller.onCombatResult({
                outcome,
                targetState: targetState ?? attackerChar.currentStateName,
                counteredBy: defenderChar?.currentStateName ?? null
            });
        }
    }

    _fxShake(amplitude, durationMs) {
        this.cameraManager?.enqueueEffect({
            type: "shake",
            durationMs,
            params: { amplitude, frequency: 35 }
        });
    }

    _fxFlash(durationMs) {
        this.cameraManager?.enqueueEffect({
            type: "flash",
            durationMs,
            params: { color: "white", maxAlpha: 1.0 }
        });
    }
}
