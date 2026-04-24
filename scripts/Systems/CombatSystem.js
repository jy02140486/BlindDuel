import { ContactResolver } from "./ContactResolver.js";

export class CombatSystem {
    constructor(options = {}) {
        this.resolver = options.resolver ?? new ContactResolver(options);
    }

    update(characters = []) {
        const result = this.resolver.resolve(characters);
        for (const effect of result.effects) {
            const target = characters.find((character) => character?.id === effect.targetId);
            if (!target || typeof target.takeDamage !== "function") {
                continue;
            }
            target.takeDamage(effect.context);
        }
        return result;
    }
}
