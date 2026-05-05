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
                console.log(`[CombatSystem] Applying parryBonus to ${target.id}, has addTag=${typeof target.addTag === "function"}`);
                if (typeof target.addTag === "function") {
                    target.addTag("parryBonus");
                    console.log(`[CombatSystem] parryBonus added, tags=${[...target.stateTags].join(",")}`);
                }
                continue;
            }

            if (effect.type === "hitstop") {
                if (typeof target.applyHitstop === "function") {
                    target.applyHitstop(effect.durationFrames);
                }
                continue;
            }

            if (effect.type === "clash") {
                const hitState = effect.context?.hitState ?? "clash";
                if (typeof target.enterState === "function" && target.hasState(hitState)) {
                    target.enterState(hitState);
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
