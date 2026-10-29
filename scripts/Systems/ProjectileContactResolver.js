// ProjectileContactResolver — collision rules for Projectile ↔ Character
// Designed per plans/26.9.24 投掷物实现计划.MD §5
// Independent from ContactResolver (character↔character) — no shared state, no dedup.
// Two-phase: cut-first (weaponbox ↔ projectile), hit-second (surviving projectile ↔ hitbox).

import { getProjectileDef } from "../../Data/ProjectileDefs.js";

export class ProjectileContactResolver {
    // === 弹飞（deflect）随机公式常量 ===
    // 所有 projectile 的弹飞速度/旋转参数都从这些常量算，不单独配置。
    static DEFLECT_X_RATIO = 0.25;        // 弹飞水平速度上限 = 0.25 × 掷出时水平速度
    static DEFLECT_SPIN_MIN = 1080;         // 弹飞旋转角速度下限（度/秒）
    static DEFLECT_SPIN_MAX = 2060;        // 弹飞旋转角速度上限（度/秒）

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

        // Track which projectiles entered a "terminal or deflect" state this tick — SubPhase B skips them
        // (covers both projectiles that will be destroyed and projectiles that will be deflected)
        const deflectIds = new Set();

        // ===== SubPhase A: projectile ↔ weaponbox (CUT FIRST) =====
        for (const proj of projectiles) {
            if (proj.isDestroyed) continue;
            if (proj.state !== "flying") continue;    // 弹飞中的 projectile 不参与判定
            if (!proj.cuttable) continue;              // only cuttable projectiles can be cut

            const projBox = proj.getCombatBox();

            for (const { snap, box } of allWeaponBoxes) {
                // Cut condition: slash-type attack only (boxRole==="attack" ensures it's an active attack frame)
                if (box.boxRole !== "attack") continue;
                if (box.attackTrajectory !== "slash") continue;

                if (this.#intersects(projBox, box)) {
                    this.#trace(`[ProjectileResolver] cut proj=${proj.id} by ${snap.characterId} box=${box.id}`);

                    // 无论 destroy 还是 deflect，都先推 projectile_cut（informational + hitstop 4帧）
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

                    // === 查 ProjectileDefs 决定响应 ===
                    const def = getProjectileDef(proj.projectileType);
                    const response = def?.contactResponses?.weaponCut ?? "destroy";  // fallback: 兼容没有配置的旧 projectile

                    if (response === "deflect") {
                        const deflectConfig = this.#buildDeflectConfig(proj);
                        effects.push({
                            type: "projectile_deflect",
                            targetId: proj.id,
                            context: { deflectConfig, contactType: "weaponCut" }
                        });
                    } else {
                        // destroy — 现有逻辑
                        effects.push({
                            type: "projectile_destroy",
                            targetId: proj.id,
                            context: { reason: "cut" }
                        });
                    }

                    deflectIds.add(proj.id);  // 两种情况都标记，SubPhase B 跳过
                    break;  // one projectile can only be cut once per tick
                }
            }
        }

        // ===== SubPhase B: surviving projectile ↔ hitbox (HIT SECOND) =====
        for (const proj of projectiles) {
            if (proj.isDestroyed) continue;
            if (proj.state !== "flying") continue;    // 弹飞中的 projectile 不参与判定
            if (deflectIds.has(proj.id)) continue;     // 本 tick 已被 cut/弹飞 — 跳过

            const projBox = proj.getCombatBox();

            for (const { snap, box } of allHitboxes) {
                // Skip invincible/dodging characters (same rule as ContactResolver Phase 2)
                if (box.invincible) continue;
                if (snap.dodgeActive) continue;

                // Self-damage exemption: projectile owner cannot be hit by their own projectile
                if (snap.characterId === proj.ownerId) continue;

                if (this.#intersects(projBox, box)) {
                    this.#trace(`[ProjectileResolver] hit proj=${proj.id} → ${snap.characterId}`);

                    // === 查 ProjectileDefs 决定响应 ===
                    const def = getProjectileDef(proj.projectileType);
                    const response = def?.contactResponses?.characterHit ?? "destroy";
                    const kbMultiplier = def?.hitKnockbackMultiplier ?? 1.0;

                    // knockbackX 用 ProjectileDefs 的 multiplier（替代硬编码 1.0）
                    const knockback = this.#signedKnockback(
                        box.center.x,
                        projBox.center.x,
                        kbMultiplier
                    );

                    // hit effect — 无论 destroy 还是 deflect 都正常结算伤害
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
                            knockbackX: knockback,
                            attackHitstopFrames: 0,    // NO hitstop for projectile owner
                            pushbackMultiplier: 0.05,
                            source: "projectile"
                        }
                    });

                    if (response === "deflect") {
                        const deflectConfig = this.#buildDeflectConfig(proj);
                        effects.push({
                            type: "projectile_deflect",
                            targetId: proj.id,
                            context: { deflectConfig, contactType: "characterHit" }
                        });
                    } else {
                        // destroy — 现有逻辑
                        effects.push({
                            type: "projectile_destroy",
                            targetId: proj.id,
                            context: { reason: "hit" }
                        });
                    }

                    deflectIds.add(proj.id);  // 标记，本 tick 不再重复 hit
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

    /**
     * 为一个 projectile 生成弹飞（deflect）时的新速度和旋转参数。
     * 全随机：x 符号随机，y 符号随机，spin 符号随机。
     * 两个 SubPhase 共用此方法，保证弹飞行为统一。
     * @param {Projectile} proj
     * @returns {{ newVelX: number, newVelY: number, spinDegPerSec: number }}
     */
    #buildDeflectConfig(proj) {
        const randSign = () => Math.random() < 0.5 ? -1 : 1;
        const Ctor = ProjectileContactResolver;

        // x: 符号随机，绝对值 ∈ [0, 0.25 × 掷出时水平速度]
        const xMax = Math.abs(proj.initialVelX ?? proj.velocity.x);
        const newVelX = randSign() * Math.random() * xMax * Ctor.DEFLECT_X_RATIO;

        // y: 符号随机，绝对值 ∈ [0, 掷出时 launchVy]
        // launchVy 是构造时的初始向上速度，不是弹飞时刻被 gravity 积分后的当前 velocity.y
        const yMax = proj.launchVy ?? 0;
        const newVelY = randSign() * Math.random() * yMax;

        // spin: 符号随机，绝对值 ∈ [90, 360] 度/秒
        const spinMag = Ctor.DEFLECT_SPIN_MIN + Math.random() * (Ctor.DEFLECT_SPIN_MAX - Ctor.DEFLECT_SPIN_MIN);
        const spinDegPerSec = randSign() * spinMag;

        return { newVelX, newVelY, spinDegPerSec };
    }
}
