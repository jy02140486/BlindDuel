import { ContactResolver } from "./ContactResolver.js";

export class CombatSystem {
    constructor(options = {}) {
        this.resolver = options.resolver ?? new ContactResolver(options);
    }

    fixedUpdate(characters = []) {
        const result = this.resolver.resolve(characters);
        for (const effect of result.effects) {
            const target = characters.find((character) => character?.id === effect.targetId);
            if (!target) {
                continue;
            }

            if (effect.type === "parryBonus") {
                const durationFrames = effect.context?.durationFrames ?? 15;
                console.log(`[CombatSystem] parryBonus -> ${target.id}, duration=${durationFrames}`);
                if (typeof target.addTimedTag === "function") {
                    target.addTimedTag("parryBonus", durationFrames);
                }
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
                continue;
            }

            if (effect.type === "hitstop") {
                if (typeof target.applyHitstop === "function" && !target.impactContext) {
                    target.applyHitstop(effect.durationFrames);
                }
                continue;
            }

            if (effect.type === "blockstun") {
                if (typeof target.applyBlockstun === "function") {
                    target.applyBlockstun(effect.durationFrames);
                }
                continue;
            }

            if (typeof target.takeDamage === "function") {
                target.takeDamage(effect.context);
            }
        }
        return result;
    }
}
