import { NpcBehavior } from "./NpcBehavior.js";

export class IdleBehavior extends NpcBehavior {
    enter(npc, context) {
        const clip = this.options.clip ?? "idle";
        if (npc.hasState(clip)) {
            npc.enterState(clip);
        } else if (npc.animation?.play) {
            npc.animation.play(clip, { restart: false });
        }
    }
}