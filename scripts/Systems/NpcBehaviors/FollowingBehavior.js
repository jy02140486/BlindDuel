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
            { padding: Math.max(padX, padY), agentX: npcPos.x, agentY: npcPos.y,
              edgeInset: Math.max(padX, padY) * 0.5 }
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

        // ── DEBUG: Move target disc to sampled point for visualization ──
        //    The disc is created by NpcController.setupDebugVisual and positioned here.
        const targetDisc = npc.npcController?._targetDisc;
        if (targetDisc) {
            targetDisc.position.set(targetX, targetY, -0.02);
            // Enable target disc: visible only when global debug is ON (stored on NpcController)
            targetDisc.setEnabled(npc.npcController._debugVisible === true);
        }
        // ── END DEBUG ──

        // ── DEBUG: Phase isolation for stepping through the movement pipeline ──
        // globalThis.__moveDebug.mode controls which phases are active:
        //   1 = sampling only      → teleport NPC to sampled target, skip force + collision
        //   2 = sampling + force   → run force synthesis, skip collision resolution
        //   3 = full pipeline      → normal operation
        const dbgMode = globalThis.__moveDebug?.mode ?? 3;

        if (dbgMode === 1) {
            // Phase 1 only: use the project's own walk pipeline to move NPC toward
            // the WalkAreaSampler output. Force synthesis (Phase 2) and collision
            // resolution (Phase 3) are both skipped. Only the sampling constrains the target.
            const dx = targetX - npcPos.x;
            const dy = targetY - npcPos.y;
            const dist = Math.hypot(dx, dy);
            const stopThreshold = this.options.followStop ?? 0.1;

            if (dist <= stopThreshold) {
                // At target — stop, return to idle
                npc.setMoveIntent({ x: 0, y: 0 });
                if (npc.currentStateName !== "idle" && npc.hasState("idle")) {
                    npc.enterState("idle");
                }
                // Update arrows to show zero-force state
                this._updateForceArrows(npc, npcPos, {
                    followX: 0, followY: 0,
                    sepForce: 0, sepIy: 0,
                    ixRaw: 0, iyRaw: 0,
                });
                this._debugData = {
                    targetX: targetX.toFixed(2),
                    targetY: targetY.toFixed(2),
                    dx: dx.toFixed(3),
                    dy: dy.toFixed(3),
                    followX: "——",
                    followY: "——",
                    ix: "0",
                    iy: "0",
                    speed: "0",
                    failed: sampled.failed ? "Y" : "",
                    mode: "Phase1-only",
                };
                return;
            }

            // Normalize direction → feed into standard walk pipeline
            const ix = dx / dist;
            const iy = dy / dist;
            npc.baseWalkSpeed = this.options.speedMax ?? 2.0;
            npc.setMoveIntent({ x: ix, y: iy });

            if (npc.currentStateName !== "walk" && npc.hasState("walk")) {
                npc.enterState("walk");
            }

            // Update arrows with Phase1 direction (follow only, no separation)
            this._updateForceArrows(npc, npcPos, {
                followX: ix, followY: iy,
                sepForce: 0, sepIy: 0,
                ixRaw: ix, iyRaw: iy,
            });
            this._debugData = {
                targetX: targetX.toFixed(2),
                targetY: targetY.toFixed(2),
                dx: dx.toFixed(3),
                dy: dy.toFixed(3),
                followX: "——",
                followY: "——",
                ix: ix.toFixed(3),
                iy: iy.toFixed(3),
                speed: (this.options.speedMax ?? 2.0).toFixed(2),
                failed: sampled.failed ? "Y" : "",
                mode: "Phase1-only",
            };
            return;
        }
        // ── END DEBUG ──

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

        // ── DEBUG: Update force visualization arrows ──
        this._updateForceArrows(npc, npcPos, {
            followX: followX, followY: followY,
            sepForce: sepForce, sepIy: sepIy,
            ixRaw: ixRaw, iyRaw: iyRaw,
        });
        // ── END DEBUG ──

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

        // ── CORNER-STUCK DETECTION ──
        // When the follow target is at or beyond a walkArea boundary and Charlotte
        // is already at that boundary, the follow force pushes her into the wall.
        // walkArea.clampPosition then cancels the displacement every frame,
        // causing "walk in place" (walk animation plays but no actual movement).
        // Solution: detect this case and enter idle instead of walk.
        if (this._isStuckAtBoundary(npc, npcPos, ixRaw, iyRaw, context.walkArea)) {
            npc.setMoveIntent({ x: 0, y: 0 });
            const idleClip = this.options.idleClip ?? "idle";
            if (npc.currentStateName !== idleClip && npc.hasState(idleClip)) {
                npc.enterState(idleClip);
            }
            return;
        }
        // ── END CORNER-STUCK ──

        // 10. speed — based on maxAbs = max(absDx, absDy)
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

    /**
     * Detect corner-stuck scenario:
     * - NPC is at a walkArea boundary (within 0.01 units tolerance)
     * - The combined follow+separation force points INTO that boundary
     *
     * When both conditions hold, every frame:
     *   1. follow force pushes NPC toward target (into the wall)
     *   2. walkArea.clampPosition pulls NPC back to boundary
     *   3. Net displacement = 0, but walk animation still plays
     *
     * This causes the "walk in place" behavior at walkArea corners.
     * The fix: enter idle instead of walk when stuck.
     *
     * @param {NpcCharacter} npc
     * @param {BABYLON.Vector3} npcPos
     * @param {number} ixRaw combined raw force X
     * @param {number} iyRaw combined raw force Y
     * @param {object} walkArea
     * @returns {boolean}
     */
    _isStuckAtBoundary(npc, npcPos, ixRaw, iyRaw, walkArea) {
        if (!walkArea) return false;

        const tol = 0.01; // boundary tolerance
        const atLeft   = npcPos.x <= walkArea.minX + tol;
        const atRight  = npcPos.x >= walkArea.maxX - tol;
        const atBottom = npcPos.y <= walkArea.minY + tol;
        const atTop    = npcPos.y >= walkArea.maxY - tol;

        const absFx = Math.abs(ixRaw);
        const absFy = Math.abs(iyRaw);

        // ── X-axis stuck (NPC at left/right boundary) ──
        // Only truly stuck if the X-component of force dominates.
        // If Y-component dominates, NPC is sliding along the wall — not stuck.
        //
        // Example: Charlotte at right boundary, target is above (player moved up).
        //   forceX = 0.01 (tiny, slightly into wall), forceY = 0.54 (large, along wall)
        //   → NOT stuck: Charlotte slides up along right wall toward target.
        if ((atLeft  && ixRaw < 0) ||
            (atRight && ixRaw > 0)) {
            if (absFx >= absFy) return true;   // force INTO wall dominates → stuck
            // force ALONG wall dominates → sliding, allow walk
        }

        // ── Y-axis stuck (NPC at top/bottom boundary) ──
        if ((atBottom && iyRaw < 0) ||
            (atTop    && iyRaw > 0)) {
            if (absFy >= absFx) return true;   // force INTO wall dominates → stuck
            // force ALONG wall dominates → sliding, allow walk
        }

        return false;
    }

    /**
     * Update force visualization arrows (follow=blue, separation=red, combined=yellow)
     * Arrow lengths are scaled so they are visible without cluttering:
     *   - Follow:     magnitude 0..1  →  scale × 0.5  (max 0.5 units)
     *   - Separation: magnitude ~0..2 →  scale × 0.3  (kept shorter to avoid overlap)
     *   - Combined:   unit vector     →  fixed 0.4 units (always points forward)
     *
     * @param {NpcCharacter} npc
     * @param {BABYLON.Vector3} npcPos current NPC position
     * @param {object} forces computed force components
     */
    _updateForceArrows(npc, npcPos, forces) {
        const arrows = npc.npcController?._forceArrows;
        if (!arrows) return;

        // Respect global debug visibility toggle (X key).
        // If debug is OFF, force-hide all arrows and skip per-frame updates.
        if (npc.npcController._debugVisible !== true) {
            for (const key of Object.keys(arrows)) {
                arrows[key].group.setEnabled(false);
            }
            return;
        }

        const { followX, followY, sepForce, sepIy, ixRaw, iyRaw } = forces;
        const originX = npcPos.x;
        const originY = npcPos.y;

        // --- Follow force (blue) ---
        const fLen = Math.hypot(followX, followY);
        if (fLen > 0.001) {
            arrows.follow.update(
                originX, originY,
                followX / fLen, followY / fLen,
                fLen * 0.5
            );
        } else {
            arrows.follow.group.setEnabled(false);
        }

        // --- Separation force (red, Y-axis only) ---
        if (sepForce > 0.001) {
            // sepIy = direction * sepStrength. Extract direction and magnitude.
            const sDirY = sepIy !== 0 ? Math.sign(sepIy) : 0;
            arrows.separation.update(
                originX, originY,
                0, sDirY,
                sepForce * 0.3
            );
        } else {
            arrows.separation.group.setEnabled(false);
        }

        // --- Combined / Synthesized intent (yellow) ---
        const cLen = Math.hypot(ixRaw, iyRaw);
        if (cLen > 0.001) {
            arrows.combined.update(
                originX, originY,
                ixRaw / cLen, iyRaw / cLen,
                0.4 // fixed length since it's a unit intent
            );
        } else {
            arrows.combined.group.setEnabled(false);
        }
    }
}