import { NpcBehavior } from "./NpcBehavior.js";
import { WalkAreaSampler } from "../WalkAreaSampler.js";

/**
 * FollowingBehavior — Companion Steering (force synthesis, NOT priority tree).
 *
 * Architecture (per GPT design review):
 *   1. rawTarget = player + offset
 *   2. FollowTargetSampler.sample → walkable target
 *      Player participates as a *dynamic follow constraint* (not as static blocker):
 *      when player is at walkArea boundary, raw target may be clamped onto player AABB;
 *      without player-as-constraint, Follow Force and Separation Force would compete
 *      for the same point and form a limit cycle (the "wave" bug).
 *   3. follow error + dead-zone (suppress micro-corrective Y jitter)
 *   4. separation force (Y axis only, project-specific) with enter/release hysteresis
 *   5. combine: intent = follow*followWeight + separation*separationWeight
 *   6. idle when combined intent ≈ 0
 *   7. normalize + speed = f(absDx) (Y avoidance does not change speed)
 *
 * _sepDirY hysteresis scope: controls ONLY separation force direction.
 * Does NOT participate in follow state (no cross-contamination → no positive feedback loop).
 */
export class FollowingBehavior extends NpcBehavior {
    constructor(options = {}) {
        super({
            // raw follow target = playerPos + offset (world units)
            targetOffsetX: 2.0,        // X offset to player; >0 = follow on player's right
            targetOffsetY: 0,           // Y offset to player; 0 = same Y as player

            // speed mapping (absDx-based legacy algorithm; Y-only movement uses maxAbs)
            followStart: 0.4,           // absDx/absDy above this → full speed (speedMax)
            followStop: 0.1,            // absDx/absDy below this → speed=0 (dead-zone → idle)

            // continuous follow force gain (maps follow error to [0,1] force)
            //   followX = clamp(dx * followGain, -1, 1)
            // Larger → stiffer tracking, smaller dead-zone at target; Smaller → softer,
            //   Charlotte lags more. Reducing this makes Y avoidance during crossing
            //   more pronounced (smaller pull-back force vs separation).
            followGain: 5.0,

            // speed range (world units / second)
            speedMin: 0.77,
            speedMax: 1.87,

            // force weights for Steering synthesis (intent = follow*w + separation*w)
            // Larger followWeight → stronger tracking; Larger separationWeight →
            //   stronger avoidance (Y offset during crossing becomes more pronounced)
            followWeight: 1.0,
            separationWeight: 1.0,

            // Separation hysteresis (Y-axis avoidance, project-specific)
            //   _sepDirY enters (locks) when sepDist < separationEnterRadius
            //   _sepDirY releases when sepDist > separationReleaseRadius
            // Enter < Release to avoid direction flip on boundary jitter.
            // Increasing EnterRadius triggers avoidance earlier (more pronounced Y offset).
            separationEnterRadius: 0.6,
            separationReleaseRadius: 0.72,
            // Strength multiplier on separation force. >1 → stronger push (Charlotte
            //   ends up further from player.y during crossing). Current 1.4 tuned for
            //   visible Y avoidance during traversal.
            separationStrength: 1.4,
            ...options
        });
        this._sepDirY = 0;
        this._lastSampled = null;
        this._debugData = null;
    }

    enter(npc, context) {
        this._sepDirY = 0;
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

        // 1. raw follow target (player + offset)
        const rawTargetX = playerPos.x + this.options.targetOffsetX;
        const rawTargetY = playerPos.y + this.options.targetOffsetY;

        // 2. sample → walkable target
        //    Player participates as a *dynamic follow constraint* (see class doc).
        const staticBlockers = context.blockers ?? [];
        const dynamicConstraints = (typeof player.getBlockerAabb === "function") ? [player] : [];
        const npcAabb = npc.getBlockerAabb?.();
        const padX = npcAabb ? (npcAabb.maxX - npcAabb.minX) * 0.5 : 0;
        const padY = npcAabb ? (npcAabb.maxY - npcAabb.minY) * 0.5 : 0;
        const sampled = WalkAreaSampler.sample(
            rawTargetX, rawTargetY,
            context.walkArea ?? null,
            staticBlockers,
            dynamicConstraints,
            { padding: Math.max(padX, padY), agentX: npcPos.x, agentY: npcPos.y }
        );
        // On sample failure (e.g. player wedged against wall + large padding) hold previous target
        let targetX, targetY;
        if (sampled.failed && this._lastSampled) {
            targetX = this._lastSampled.x;
            targetY = this._lastSampled.y;
        } else {
            targetX = sampled.x;
            targetY = sampled.y;
            this._lastSampled = { x: targetX, y: targetY };
        }

        // 3. follow error (target → npc)
        const dx = targetX - npcPos.x;
        const dy = targetY - npcPos.y;
        const absDx = Math.abs(dx);
        const absDy = Math.abs(dy);

        const o = this.options;

        // 4. follow force — continuous proportional control (no bang-bang dead-zone)
        //    Continuity prevents the limit cycle where followY flips between 0 and ±1
        //    at the dead-zone boundary while sepIy pushes the other way (wave bug).
        //    X uses the same continuous form for symmetry; speed algorithm below still
        //    keys off absDx (followStart/Stop) so X continuity does not affect speed.
        const followX = Math.max(-1, Math.min(1, dx * o.followGain));
        const followY = Math.max(-1, Math.min(1, dy * o.followGain));

        // 5. separation force (Y axis only — project-specific)
        //    _sepDirY hysteresis: enter when within enterRadius (lock direction from current
        //    sepDy), release when beyond releaseRadius. While locked, direction does NOT flip
        //    on sepDy sign change (prevents oscillation when crossing player Y).
        const sepDx = npcPos.x - playerPos.x;
        const sepDy = npcPos.y - playerPos.y;
        const sepDist = Math.hypot(sepDx, sepDy);

        let sepForce = 0;
        let sepIy = 0;
        if (sepDist > 0.0001) {
            if (this._sepDirY === 0) {
                if (sepDist < o.separationEnterRadius) {
                    this._sepDirY = Math.abs(sepDy) > 0.0001 ? Math.sign(sepDy) : 1;
                }
            } else if (sepDist > o.separationReleaseRadius) {
                this._sepDirY = 0;
            }
        }
        if (this._sepDirY !== 0 && sepDist < o.separationReleaseRadius) {
            const ratio = 1 - sepDist / o.separationEnterRadius;
            sepForce = (ratio > 0 ? ratio : 0) * o.separationStrength;
            sepIy = this._sepDirY * sepForce;
        }

        // 6. combine forces (Steering synthesis — NOT priority tree)
        const ixRaw = followX * o.followWeight;
        const iyRaw = followY * o.followWeight + sepIy * o.separationWeight;

        // 7. idle when combined force is zero
        if (ixRaw === 0 && iyRaw === 0) {
            npc.setMoveIntent({ x: 0, y: 0 });
            const idleClip = this.options.idleClip ?? "idle";
            if (npc.currentStateName !== idleClip && npc.hasState(idleClip)) {
                npc.enterState(idleClip);
            }
            return;
        }

        // 8. facing — prefer follow direction; if X follow idle, face player
        if (followX !== 0) {
            npc.setFacing(followX > 0 ? 1 : -1);
        } else {
            const playerDx = playerPos.x - npcPos.x;
            npc.setFacing(playerDx >= 0 ? 1 : -1);
        }

        // 9. normalize combined intent
        const len = Math.hypot(ixRaw, iyRaw);
        let ix = ixRaw, iy = iyRaw;
        if (len > 0) {
            ix = ixRaw / len;
            iy = iyRaw / len;
        }

        // 10. speed — based on maxAbs = max(absDx, absDy)
        //    Pure Y movement (player moves vertically while Charlotte's X is aligned)
        //    must still produce speed. Using absDx alone would zero speed when X is
        //    aligned but Y is not, causing Charlotte to not follow Y-only movement.
        //    maxAbs preserves the dead-zone: when both dx and dy are small (Charlotte
        //    at target), speed=0 → idle (prevents high-frequency jitter from
        //    followGain continuous control on small dx/dy perturbations).
        const maxAbs = Math.max(absDx, absDy);
        let speed;
        if (maxAbs < o.followStop) {
            speed = 0;
        } else if (maxAbs >= o.followStart) {
            speed = o.speedMax;
        } else {
            const t = (maxAbs - o.followStop) / (o.followStart - o.followStop);
            speed = o.speedMin + (o.speedMax - o.speedMin) * t;
        }
        npc.baseWalkSpeed = speed;

        // If speed is 0 (Charlotte at target), enter idle and return.
        // ixRaw/iyRaw may be non-zero (followGain produces ~0.25 at dx=0.05), so
        // Step 7's ixRaw===0 check fails, leading to walk animation without
        // movement. This guard ensures Charlotte visually stops at target.
        if (speed === 0) {
            npc.setMoveIntent({ x: 0, y: 0 });
            const idleClip = this.options.idleClip ?? "idle";
            if (npc.currentStateName !== idleClip && npc.hasState(idleClip)) {
                npc.enterState(idleClip);
            }
            return;
        }

        // 11. output
        npc.setMoveIntent({ x: ix, y: iy });

        // 12. store debug data for force visualization panel (above character head)
        this._debugData = {
            targetX: targetX.toFixed(2),
            targetY: targetY.toFixed(2),
            dx: dx.toFixed(3),
            dy: dy.toFixed(3),
            absDx: absDx.toFixed(3),
            absDy: absDy.toFixed(3),
            followX: followX.toFixed(3),
            followY: followY.toFixed(3),
            sepDist: sepDist.toFixed(3),
            sepDirY: this._sepDirY.toFixed(0),
            sepForce: sepForce.toFixed(3),
            sepIy: sepIy.toFixed(3),
            ixRaw: ixRaw.toFixed(3),
            iyRaw: iyRaw.toFixed(3),
            ix: ix.toFixed(3),
            iy: iy.toFixed(3),
            speed: speed.toFixed(2),
            failed: sampled.failed ? "Y" : ""
        };

        if (npc.currentStateName !== "walk" && npc.hasState("walk")) {
            npc.enterState("walk");
        }
    }
}