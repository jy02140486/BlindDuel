/**
 * Apply-time boundary-aware impact displacement resolver.
 *
 * ContactResolver 负责在 resolve-time 确定 "intent"（比如 victimKnockbackX = 0.18）；
 * ImpactMovementResolver 在位移真正要落地时，根据双方当前位置 + stage boundary，
 * 算出 victim 实际能退多少，以及 residual 转给 attacker 多少。
 *
 * 纯函数，无状态，不依赖 StateGraph / CombatTuning / ContactResolver。
 */
export class ImpactMovementResolver {

    /**
     * @param {Object} args
     * @param {import("../Enties/CombatCharacter.js").CombatCharacter} args.attacker
     * @param {import("../Enties/CombatCharacter.js").CombatCharacter} args.victim
     * @param {number} args.victimKnockbackX  带符号的 intent（ContactResolver 已算好方向）
     * @param {import("./StageBoundary.js").StageBoundary} args.boundary
     * @returns {{ victimActualX: number, attackerCompX: number }}
     */
    static resolve({ attacker, victim, victimKnockbackX, boundary }) {
        if (!boundary || !attacker || !victim || victimKnockbackX === 0) {
            return { victimActualX: victimKnockbackX ?? 0, attackerCompX: 0 };
        }

        const attackerX = attacker.root.position.x;
        const victimX = victim.root.position.x;

        // 战斗接触方向：attacker → victim，不用 facing（facing 可能被修正）
        const dir = victimX >= attackerX ? 1 : -1;
        const requested = victimKnockbackX; // 已经带符号

        // --- Victim 侧：最多能向 requested 方向移动多少 ---
        let victimAvailable;
        if (dir > 0) {
            victimAvailable = boundary.maxX - victimX; // 右边界约束
        } else {
            victimAvailable = victimX - boundary.minX; // 左边界约束
        }

        const victimMagnitude = Math.min(Math.abs(requested), Math.abs(victimAvailable));
        const victimActualX = Math.sign(requested) * victimMagnitude;

        // --- Residual：没推出去的量 ---
        const residual = requested - victimActualX;
        if (Math.abs(residual) < 1e-6) {
            return { victimActualX, attackerCompX: 0 };
        }

        // --- Attacker 侧：反向推 attacker ---
        const attackerDir = -dir; // 相反方向
        let attackerAvailable;
        if (attackerDir > 0) {
            attackerAvailable = boundary.maxX - attackerX;
        } else {
            attackerAvailable = attackerX - boundary.minX;
        }

        const attackerRequested = -Math.sign(requested) * Math.abs(residual);
        const attackerMagnitude = Math.min(Math.abs(attackerRequested), Math.abs(attackerAvailable));
        const attackerCompX = Math.sign(attackerRequested) * attackerMagnitude;

        return { victimActualX, attackerCompX };
    }
}