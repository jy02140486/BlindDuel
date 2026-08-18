import { NpcBehavior } from "./NpcBehavior.js";
import { WalkAreaSampler } from "../WalkAreaSampler.js";

function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
}

export class FollowingBehavior extends NpcBehavior {
    constructor(options = {}) {
        super({
            targetOffsetX: 2.0,
            targetOffsetY: 0,
            followStart: 0.4,
            followStop: 0.1,
            followDeadbandY: 0.15,
            followStopY: 0.05,
            speedMin: 0.77,
            speedMax: 1.87,
        separationRadius: 0.6,
        separationStrength: 1.0,
        ...options
    });
    this._moving = false;
    this._movingY = false;
    this._sepDirY = 1;
}

    enter(npc, context) {
        this._moving = false;
        this._movingY = false;
        this._sepDirY = 1;
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

        const playerPos = player.root.position;
        const npcPos = npc.root.position;

        const rawTargetX = playerPos.x + this.options.targetOffsetX;
        const rawTargetY = playerPos.y + this.options.targetOffsetY;
        const sampleBlockers = [...(context.blockers ?? [])];
        if (typeof player.getBlockerAabb === "function") sampleBlockers.push(player);
        const npcAabb = npc.getBlockerAabb?.();
        const padX = npcAabb ? (npcAabb.maxX - npcAabb.minX) * 0.5 : 0;
        const padY = npcAabb ? (npcAabb.maxY - npcAabb.minY) * 0.5 : 0;
        const sampled = WalkAreaSampler.sample(
            rawTargetX, rawTargetY,
            context.walkArea ?? null, sampleBlockers,
            { padding: Math.max(padX, padY), agentX: npcPos.x, agentY: npcPos.y }
        );
        const targetX = sampled.x;
        const dx = targetX - npcPos.x;
        const absDx = Math.abs(dx);

        const movingX = this._moving
            ? absDx > this.options.followStop
            : absDx > this.options.followStart;
        this._moving = movingX;

        const targetY = sampled.y;
        const dy = targetY - npcPos.y;
        const absDy = Math.abs(dy);
        const movingY = this._movingY
            ? absDy > this.options.followStopY
            : absDy > this.options.followDeadbandY;
        this._movingY = movingY;

        if (movingX) {
            npc.setFacing(dx >= 0 ? 1 : -1);
        } else {
            const playerDx = playerPos.x - npcPos.x;
            npc.setFacing(playerDx >= 0 ? 1 : -1);
        }

        // Separation：靠近 player 时 Y 方向避让（不影响 X，保留引路 seek）
        const sepDx = npcPos.x - playerPos.x;
        const sepDy = npcPos.y - playerPos.y;
        const sepDist = Math.hypot(sepDx, sepDy);
        let sepForce = 0;
        let sepIy = 0;
        if (sepDist < this.options.separationRadius && sepDist > 0.0001) {
            sepForce = (1 - sepDist / this.options.separationRadius) * this.options.separationStrength;
            if (Math.abs(sepDy) > 0.0001) {
                this._sepDirY = Math.sign(sepDy);
            }
            sepIy = this._sepDirY * sepForce;
        }

        if (!movingX && !movingY && sepForce === 0) {
            npc.setMoveIntent({ x: 0, y: 0 });
            const idleClip = this.options.idleClip ?? "idle";
            if (npc.currentStateName !== idleClip && npc.hasState(idleClip)) {
                npc.enterState(idleClip);
            }
            return;
        }

        let ix = movingX ? Math.sign(dx) : 0;
        let iy;
        if (sepForce > 0) {
            iy = sepIy;
        } else {
            iy = movingY ? Math.sign(dy) : 0;
        }
        const len = Math.hypot(ix, iy);
        if (len > 0) {
            ix /= len;
            iy /= len;
        }

        const o = this.options;
        let speed;
        if (absDx >= o.followStart) {
            speed = o.speedMax;
        } else {
            const t = (absDx - o.followStop) / (o.followStart - o.followStop);
            speed = o.speedMin + (o.speedMax - o.speedMin) * Math.max(0, t);
        }
        npc.baseWalkSpeed = speed;
        npc.setMoveIntent({ x: ix, y: iy });
        if (npc.currentStateName !== "walk" && npc.hasState("walk")) {
            npc.enterState("walk");
        }
    }
}