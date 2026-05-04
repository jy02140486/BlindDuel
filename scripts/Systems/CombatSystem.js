import { ContactResolver } from "./ContactResolver.js";

export class CombatSystem {
    constructor(options = {}) {
        this.resolver = options.resolver ?? new ContactResolver(options);
    }

    update(characters = []) {
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

            if (typeof target.takeDamage === "function") {
                target.takeDamage(effect.context);
            }
        }
        return result;
    }
}
