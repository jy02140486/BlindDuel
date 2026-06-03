import { ContactResolver } from "./ContactResolver.js";

export class CombatSystem {
    constructor(options = {}) {
        this.resolver = options.resolver ?? new ContactResolver(options);
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
            if (this.debugTrace) {
                console.log(
                    `[CombatEffect] tick=${tickCount ?? "?"} type=${effect.type} target=${effect.targetId} context=${JSON.stringify(effect.context ?? {})}`
                );
            }

            if (effect.type === "parryBonus") {
                const durationFrames = effect.context?.durationFrames ?? 15;
                if (typeof target.addTimedTag === "function") {
                    target.addTimedTag("parryBonus", durationFrames);
                }
                this._fxShake(0.35, 250);
                this._fxFlash(100);
                continue;
            }

            if (effect.type === "clash") {
                const hitState = effect.context?.hitState ?? "clash";
                const knockbackX = effect.context?.knockbackX ?? 0;
                if (typeof target.freezeImpact === "function") {
                    target.freezeImpact(24, {
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
