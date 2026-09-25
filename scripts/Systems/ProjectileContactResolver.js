// ProjectileContactResolver — collision rules for Projectile ↔ Character
// Designed per plans/26.9.24 投掷物实现计划.MD §5
// Independent from ContactResolver (character↔character) — no shared state, no dedup.
// Two-phase: cut-first (weaponbox ↔ projectile), hit-second (surviving projectile ↔ hitbox).

export class ProjectileContactResolver {
    constructor(options = {}) {
        this.debugTrace = options.debugTrace ?? false;
    }

    /**
     * Resolve all projectile-character contacts this tick.
     * @param {Projectile[]} projectiles — live projectiles (not yet destroyed)
     * @param {CombatCharacter[]} characters — combat characters
     * @returns {{ effects: Array }} effects for CombatSystem to process
     */
    resolve(projectiles = [], characters = []) {
        const effects = [];
        if (projectiles.length === 0 || characters.length === 0) {
            return { effects };
        }

        // Build character snapshots (same as ContactResolver does)
        const snapshots = [];
        for (const character of characters) {
            if (!character || typeof character.getCombatSnapshot !== "function") continue;
            snapshots.push(character.getCombatSnapshot());
        }

        // Collect character weaponboxes and hitboxes from snapshots
        const allWeaponBoxes = [];  // { snap, box }
        const allHitboxes = [];    // { snap, box }
        for (const snap of snapshots) {
            for (const box of snap.boxes) {
                if (box.type === "weaponbox") {
                    allWeaponBoxes.push({ snap, box });
                } else if (box.type === "hitbox") {
                    allHitboxes.push({ snap, box });
                }
            }
        }

        // Track which projectiles were cut this tick — they skip hit phase
        const cutIds = new Set();

        // ===== SubPhase A: projectile ↔ weaponbox (CUT FIRST) =====
        for (const proj of projectiles) {
            if (proj.isDestroyed) continue;
            if (!proj.cuttable) continue;  // only cuttable projectiles can be cut

            const projBox = proj.getCombatBox();

            for (const { snap, box } of allWeaponBoxes) {
                // Cut condition: slash-type attack only (boxRole==="attack" ensures it's an active attack frame)
                if (box.boxRole !== "attack") continue;
                if (box.attackTrajectory !== "slash") continue;

                if (this.#intersects(projBox, box)) {
                    this.#trace(`[ProjectileResolver] cut proj=${proj.id} by ${snap.characterId} box=${box.id}`);

                    // projectile_cut: informational effect (no character-side processing needed yet)
                    effects.push({
                        type: "projectile_cut",
                        targetId: proj.id,
                        context: {
                            projectileId: proj.id,
                            cutterId: snap.characterId,
                            cutterAttackId: box.attackInstanceId,
                            contactType: "weapon_vs_projectile"
                        }
                    });

                    // projectile_destroy: CombatSystem uses this to call pm.requestDestroy
                    effects.push({
                        type: "projectile_destroy",
                        targetId: proj.id,
                        context: { reason: "cut" }
                    });

                    cutIds.add(proj.id);
                    break;  // one projectile can only be cut once per tick
                }
            }
        }

        // ===== SubPhase B: surviving projectile ↔ hitbox (HIT SECOND) =====
        for (const proj of projectiles) {
            if (proj.isDestroyed) continue;
            if (cutIds.has(proj.id)) continue;  // already cut this tick — skip hit phase

            const projBox = proj.getCombatBox();

            for (const { snap, box } of allHitboxes) {
                // Skip invincible/dodging characters (same rule as ContactResolver Phase 2)
                if (box.invincible) continue;
                if (snap.dodgeActive) continue;

                // Self-damage exemption: projectile owner cannot be hit by their own projectile
                if (snap.characterId === proj.ownerId) continue;

                if (this.#intersects(projBox, box)) {
                    this.#trace(`[ProjectileResolver] hit proj=${proj.id} → ${snap.characterId}`);

                    // Reuse "hit" effect type — CombatSystem already knows how to process it.
                    // BUT: set attackHitstopFrames to 0 so the owner doesn't get hitstop
                    // (projectile owner already released the throw — no melee-style hitstop for owner).
                    effects.push({
                        type: "hit",
                        targetId: snap.characterId,
                        context: {
                            attackInstanceId: null,
                            attackerId: proj.ownerId,  // for Feedback Memory (markAttackHit)
                            targetId: snap.characterId,
                            attackLevel: null,
                            contactType: "projectile_vs_hitbox",
                            damage: proj.damage,
                            hitState: "hit",
                            knockbackX: this.#signedKnockback(
                                box.center.x,
                                projBox.center.x,
                                1.0
                            ),
                            attackHitstopFrames: 0,    // NO hitstop for projectile owner
                            pushbackMultiplier: 0.05,
                            source: "projectile"
                        }
                    });

                    // Destroy projectile on hit
                    effects.push({
                        type: "projectile_destroy",
                        targetId: proj.id,
                        context: { reason: "hit" }
                    });

                    break;  // one projectile can only hit one character per tick
                }
            }
        }

        return { effects };
    }

    // ---------------------------------------------------------------
    // Collision helpers — duplicated from ContactResolver
    // (ContactResolver.#obbIntersect2D is private; don't refactor in prototype phase)
    // ---------------------------------------------------------------
    #intersects(a, b) {
        return this.#obbIntersect2D(a, b);
    }

    #obbIntersect2D(a, b) {
        const aAngle = (a.angle ?? 0) * Math.PI / 180;
        const bAngle = (b.angle ?? 0) * Math.PI / 180;

        const aCos = Math.cos(aAngle);
        const aSin = Math.sin(aAngle);
        const bCos = Math.cos(bAngle);
        const bSin = Math.sin(bAngle);

        const axes = [
            { x: aCos, y: aSin },
            { x: -aSin, y: aCos },
            { x: bCos, y: bSin },
            { x: -bSin, y: bCos }
        ];

        for (const axis of axes) {
            if (this.#separatedOnAxis(a, b, axis)) return false;
        }
        return true;
    }

    #separatedOnAxis(a, b, axis) {
        const aAngle = (a.angle ?? 0) * Math.PI / 180;
        const bAngle = (b.angle ?? 0) * Math.PI / 180;

        const aCos = Math.cos(aAngle);
        const aSin = Math.sin(aAngle);
        const bCos = Math.cos(bAngle);
        const bSin = Math.sin(bAngle);

        const aRx = Math.abs(axis.x * aCos + axis.y * aSin);
        const aRy = Math.abs(axis.x * -aSin + axis.y * aCos);
        const aProj = a.half.x * aRx + a.half.y * aRy;

        const bRx = Math.abs(axis.x * bCos + axis.y * bSin);
        const bRy = Math.abs(axis.x * -bSin + axis.y * bCos);
        const bProj = b.half.x * bRx + b.half.y * bRy;

        const dx = b.center.x - a.center.x;
        const dy = b.center.y - a.center.y;
        const dist = Math.abs(dx * axis.x + dy * axis.y);

        return dist > (aProj + bProj);
    }

    #signedKnockback(targetPos, sourcePos, amount) {
        return targetPos >= sourcePos ? Math.abs(amount) : -Math.abs(amount);
    }

    #trace(message) {
        if (this.debugTrace) console.log(message);
    }
}
