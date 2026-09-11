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

    fixedUpdate(characters = [], tickCount = null) {
        const combatants = characters.filter((c) => c?.has?.("combat"));
        const result = this.resolver.resolve(combatants, { tickCount });
        for (const effect of result.effects) {
            const target = characters.find((character) => character?.id === effect.targetId);

            if (!target) {
                continue;
            }

            if (effect.type === "clash") {
                const hitState = effect.context?.hitState ?? "clash";
                const knockbackX = effect.context?.knockbackX ?? 0;
                if (typeof target.freezeImpact === "function") {
                    target.freezeImpact(this.tuning.hit.freezeImpactFrames, {
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
                // 命中处理：双方 hitstop + 被击中 takeDamage + 震屏
                const hitstopFrames = this.tuning.hit.hitstopFrames ?? 0;
                if (hitstopFrames > 0 && typeof target.applyHitstop === "function") {
                    target.applyHitstop(hitstopFrames);
                }
                // 给攻击者也加 hitstop（从 context 读 attackerId）
                const attackerId = effect.context?.attackerId;
                if (attackerId && hitstopFrames > 0) {
                    const attacker = characters.find(c => c?.id === attackerId);
                    if (attacker && typeof attacker.applyHitstop === "function") {
                        attacker.applyHitstop(hitstopFrames);
                    }
                }
                if (typeof target.takeDamage === "function") {
                    target.takeDamage(effect.context);
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
        return result;
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
