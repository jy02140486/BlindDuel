export class NpcBehavior {
    constructor(options = {}) {
        this.options = { ...options };
    }

    enter(npc, context) {}

    update(dtMs, npc, context) {}

    exit(npc, context) {}
}