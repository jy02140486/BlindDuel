/**
 * CombatPosture - Layer 1：慢变量姿态（500ms tick）
 *
 * 职责：根据 Memory + Situation 计算 1.0-centered multipliers
 * 输出：attackMultiplier, defenseMultiplier, advanceMultiplier, retreatMultiplier
 * 语义：1.0=neutral, >1=鼓励, <1=抑制
 * 更新：target → low-pass smoothing (alpha = decayAlpha)
 *
 * 依赖：CombatMemory + Situation 对象
 */

/** 默认 AITuning.postureDefaults（Phase 0 硬编码在类内） */
const DEFAULT_POSTURE_TUNING = {
    baseAggression: 1.0,
    baseDefense: 1.0,
    cautionFromDamage: 0.15,
    cautionFromMisses: 0.10,
    defenseFromDamage: 0.12,
    punishDesire: 0.10,
    idleCaution: 0.12,
    readinessFromIdle: 0.10,
    startupDefenseBonus: 0.15,
    distanceAppetite: 0.7,
    retreatDesire: 0.6,
    decayAlpha: 0.15,
    MIN_ATTACK_MULT: 0.6,
    MAX_ATTACK_MULT: 1.4,
    MIN_DEFENSE_MULT: 0.7,
    MAX_DEFENSE_MULT: 1.3,
};

export class CombatPosture {
    /**
     * @param {CombatMemory} memory - Layer 0 数据来源
     * @param {object} postureOverrides - 可选，角色级 override（Phase 4 用，Phase 0 传 {} 即可）
     */
    constructor(memory, postureOverrides = {}) {
        this.memory = memory;
        this.tuning = { ...DEFAULT_POSTURE_TUNING, ...postureOverrides };

        // 当前 multipliers（smoothed 后）
        this.attackMultiplier = 1.0;
        this.defenseMultiplier = 1.0;
        this.advanceMultiplier = 1.0;
        this.retreatMultiplier = 1.0;

        // 上一次 target（debug 用）
        this._lastTarget = {
            attackMultiplier: 1.0,
            defenseMultiplier: 1.0,
            advanceMultiplier: 1.0,
            retreatMultiplier: 1.0,
        };

        // accumulator for 500ms tick
        this._accumulatorMs = 0;
        this._tickIntervalMs = 500;

        // 是否已经跑过 recompute
        this._initialized = false;
    }

    /**
     * 每帧喂 dtMs + situation
     * 内部累积到 500ms 时自动 recompute
     */
    update(dtMs, situation) {
        this._accumulatorMs += dtMs;

        if (this._accumulatorMs >= this._tickIntervalMs || !this._initialized) {
            this._accumulatorMs = 0;
            this._recompute(situation);
            this._initialized = true;
        }
    }

    /**
     * 立即重算（Memory 有重大变化时触发）
     */
    forceRecompute(situation) {
        this._recompute(situation);
    }

    /**
     * 核心计算：target → low-pass smoothing
     */
    _recompute(situation) {
        const mem = this.memory;
        const t = this.tuning;

        const pressureNorm = mem.pressureNorm;                          // 0~1
        const consecutiveMissesNorm = Math.min(1, mem.consecutiveMisses / 3);
        const oppIdleMs = situation?.oppIdleMs ?? 0;
        const oppVulnerable = situation?.oppVulnerable ?? 0;
        const oppPhase = situation?.opp?.phase ?? "none";

        // smoothstep helper：x 在 edge0~edge1 之间从 0 平滑到 1
        const smoothstep = (x, edge0, edge1) => {
            if (edge1 <= edge0) return x <= edge0 ? 0 : 1;
            const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
            return t * t * (3 - 2 * t);
        };

        // ============ Target 计算 ============

        // attackMultiplier target
        let tAttack = t.baseAggression
            - pressureNorm * t.cautionFromDamage
            - consecutiveMissesNorm * t.cautionFromMisses
            + (oppVulnerable > 0.5 ? t.punishDesire : 0)
            - smoothstep(oppIdleMs, 800, 2000) * t.idleCaution;
        // 注意：clamp 在 MIN/MAX 边界（Phase 0 先不 clamp，让 smoothing 吸收）

        // defenseMultiplier target
        let tDefense = t.baseDefense
            + pressureNorm * t.defenseFromDamage
            + smoothstep(oppIdleMs, 800, 2000) * t.readinessFromIdle
            + (oppPhase === "startup" ? t.startupDefenseBonus : 0);

        // advanceMultiplier 和 retreatMultiplier 由 attack/defense 派生
        // advance 想要靠近 = attackMultiplier 偏好 + 距离饥饿感
        // retreat 想拉开 = defenseMultiplier 偏好 + 撤退欲望
        let tAdvance = Math.max(0.7, Math.min(1.3, tAttack * t.distanceAppetite));
        let tRetreat = Math.max(0.7, Math.min(1.3, tDefense * t.retreatDesire));

        // ============ Low-pass Smoothing ============
        const alpha = t.decayAlpha;
        this.attackMultiplier  += alpha * (tAttack  - this.attackMultiplier);
        this.defenseMultiplier += alpha * (tDefense - this.defenseMultiplier);
        this.advanceMultiplier += alpha * (tAdvance - this.advanceMultiplier);
        this.retreatMultiplier += alpha * (tRetreat - this.retreatMultiplier);

        // ============ clamp 边界 ============
        this.attackMultiplier  = Math.max(t.MIN_ATTACK_MULT,  Math.min(t.MAX_ATTACK_MULT,  this.attackMultiplier));
        this.defenseMultiplier = Math.max(t.MIN_DEFENSE_MULT, Math.min(t.MAX_DEFENSE_MULT, this.defenseMultiplier));
        this.advanceMultiplier = Math.max(0.7, Math.min(1.3, this.advanceMultiplier));
        this.retreatMultiplier = Math.max(0.7, Math.min(1.3, this.retreatMultiplier));

        // ============ 记录 last target（debug 用）============
        this._lastTarget = {
            attackMultiplier: tAttack,
            defenseMultiplier: tDefense,
            advanceMultiplier: tAdvance,
            retreatMultiplier: tRetreat,
        };
    }

    /**
     * Debug label（1.0 附近是 neutral，偏离则有倾向性）
     */
    get label() {
        if (this.attackMultiplier > 1.1) return "AGGRESSIVE";
        if (this.defenseMultiplier > 1.1) return "DEFENSIVE";
        if (this.attackMultiplier < 0.9) return "CAUTIOUS";
        return "NEUTRAL";
    }

    get current() {
        return {
            attackMultiplier: this.attackMultiplier.toFixed(2),
            defenseMultiplier: this.defenseMultiplier.toFixed(2),
            advanceMultiplier: this.advanceMultiplier.toFixed(2),
            retreatMultiplier: this.retreatMultiplier.toFixed(2),
            label: this.label,
        };
    }

    get target() {
        return {
            attackMultiplier: this._lastTarget.attackMultiplier.toFixed(2),
            defenseMultiplier: this._lastTarget.defenseMultiplier.toFixed(2),
            advanceMultiplier: this._lastTarget.advanceMultiplier.toFixed(2),
            retreatMultiplier: this._lastTarget.retreatMultiplier.toFixed(2),
        };
    }
}
