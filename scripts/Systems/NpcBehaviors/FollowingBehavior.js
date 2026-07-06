import { NpcBehavior } from "./NpcBehavior.js";

function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
}

export class FollowingBehavior extends NpcBehavior {
    constructor(options = {}) {
        super({
            targetOffsetX: 1.0,
            followStart: 0.4,
            followStop: 0.1,
            speedMin: 0.7,
            speedMax: 1.4,
            baseSpeed: 1.1,
            speedMapSpan: 1.5,
            speedMapAnchor: 1.0,
            ...options
        });
        this._moving = false;
    }

    enter(npc, context) {
        this._moving = false;
        if (context?.dialogueBubble) context.dialogueBubble.hide();
        if (npc.hasState("walk")) {
            npc.enterState("walk");
        } else if (npc.hasState("idle")) {
            npc.enterState("idle");
        }
    }

    update(dtMs, npc, context) {
        const player = context.player;
        if (!player) return;

        const targetX = player.root.position.x + this.options.targetOffsetX;
        const dx = targetX - npc.root.position.x;
        const absDx = Math.abs(dx);

        const moving = this._moving
            ? absDx > this.options.followStop
            : absDx > this.options.followStart;
        this._moving = moving;

        npc.setFacing(dx >= 0 ? 1 : -1);

        if (!moving) {
            npc.setMoveIntent({ x: 0, y: 0 });
            if (npc.currentStateName !== "idle" && npc.hasState("idle")) {
                npc.enterState("idle");
            }
            return;
        }

        const o = this.options;
        const m = clamp((absDx - o.speedMapAnchor) / o.speedMapSpan, o.speedMin, o.speedMax);
        npc.baseWalkSpeed = o.baseSpeed * m;
        npc.setMoveIntent({ x: Math.sign(dx), y: 0 });
        if (npc.currentStateName !== "walk" && npc.hasState("walk")) {
            npc.enterState("walk");
        }
    }
}