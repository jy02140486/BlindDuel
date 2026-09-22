/**
 * CombatMemory - Layer 0：纯历史记录，不做解释
 *
 * 职责：存储战斗 outcome 和状态指标，供 Posture 层消费
 * 约束：不直接修改任何 Utility 分数，只提供原始数据
 *
 * outcome 枚举（与计划文档对齐，双视角统一）：
 *   attacker 视角: "attack:hit" | "attack:miss" | "attack:parried"
 *   defender 视角: "self:hit" | "guard:success" | "guard:broken" | "dodge:success" | "dodge:fail"
 *
 * 关于 opp miss / opp hit（对手的 outcome）：
 *   暂不在 Phase 0 实现 — AIController 需要通过 observer 机制观察对手状态
 *   简化方案：AIController 在 fixedUpdate 中检测对手 phase 从 active→none 且 self 未被 hit
 *   → 视为 opp miss，调用 onOppOutcome("miss")
 *
 * 关于 outcome 来源映射（来自 CombatSystem + CombatCharacter）：
 *   CombatSystem attacker-perspective:
 *     "hit"          → "attack:hit"
 *     "miss"         → "attack:miss"
 *     "parried"      → "attack:parried"
 *     "guard_blocked"→ "attack:miss" (被防住也算 miss)
 *     "interrupted"  → "attack:miss" (被打断也算 miss)
 *   CombatSystem defender-perspective (Phase 0 新增):
 *     "self:hit"     → 直接用
 *     "guard:success"→ 直接用
 *     "guard:broken" → 直接用
 *     "dodge:success"→ 直接用
 *     "dodge:fail"   → 直接用
 */
export class CombatMemory {
    /** @type {Set<string>} 失败 outcome（tactical 扣分用） */
    static #FAIL_OUTCOMES = new Set([
        "attack:miss", "attack:parried",
    ]);

    constructor() {
        // 原始 outcome 日志：最近 N 条
        this.outcomes = [];
        this.maxOutcomes = 20;
        this.outcomeDecayMs = 5000; // 5 秒前的过期

        // Phase 3: per-state outcome tracking（用于 getAdaptation）
        // Map<stateName, Array<{outcome, at}>> — 某个 attack/guard state 的最近 outcomes
        this.#perStateOutcomes = new Map();
        this.perStateMax = 8; // 每个 state 最多存 8 条

        // COMMIT 日志：最近 6 次
        this.commits = [];
        this.maxCommits = 6;

        // pressure 衰减值（被击越多越高，0 ~ 3）
        this.pressure = 0;

        // consecutiveMisses：连续 attack miss 次数
        this.consecutiveMisses = 0;

        // pressure 衰减参数
        // 基准：0.995 per 500ms → half-life ≈ 135s（计划文档约定）
        // 用 dtMs 时间尺度缩放，避免固定衰减率被调用频率放大
        this._pressureDecayBase = 0.995;
        this._pressureDecayReferenceMs = 500;
    }

    /** per-state outcome tracking 私有字段声明（JS 要求先声明后赋值） */
    #perStateOutcomes;

    /**
     * 接收 combat outcome（双视角统一入口）
     * @param {string} outcome - 计划文档定义的 outcome 枚举值
     * @param {string} [stateName] - 可选：产生这个 outcome 的 state（attack/guard stateName）
     *   Phase 3 新增：用于 per-state tracking，让 getAdaptation(stateName) 能返回某招的 consecutiveFail/Success
     */
    onOutcome(outcome, stateName = null) {
        const now = performance.now();

        // 记录 outcome 日志
        this.outcomes.push({ outcome, at: now });
        if (this.outcomes.length > this.maxOutcomes) {
            this.outcomes.shift();
        }

        // Phase 3: per-state tracking
        if (stateName) {
            const list = this.#perStateOutcomes.get(stateName) || [];
            list.push({ outcome, at: now });
            if (list.length > this.perStateMax) {
                list.shift();
            }
            this.#perStateOutcomes.set(stateName, list);
        }

        // pressure 更新
        switch (outcome) {
            case "self:hit":
            case "guard:broken":
            case "dodge:fail":
                this.pressure = Math.min(3.0, this.pressure + 1.0);
                break;

            case "guard:success":
            case "dodge:success":
                this.pressure *= 0.6;
                break;

            case "attack:hit":
                // 成功打中 → 压力自然降低一些
                this.pressure *= 0.7;
                // 连续 miss 中断
                this.consecutiveMisses = 0;
                break;

            case "attack:miss":
            case "attack:parried":
                this.consecutiveMisses += 1;
                break;

            default:
                break;
        }
    }

    /**
     * 对手的 outcome（需要 AIController 观察后主动调用）
     * @param {string} oppOutcome - "hit" | "miss"
     */
    onOppOutcome(oppOutcome) {
        if (oppOutcome === "miss") {
            this.pressure *= 0.7;
        }
        // opp hit 对我方 pressure 无直接影响（我又没被打中）
    }

    /**
     * 记录一次 COMMIT（执行 attack / guard / dodge / positioning）
     */
    pushCommit(kind, stateName) {
        this.commits.push({ kind, stateName, at: performance.now() });
        if (this.commits.length > this.maxCommits) {
            this.commits.shift();
        }
    }

    /**
     * 每帧 tick：pressure 时间衰减 + outcomes 过期清理
     * @param {number} dtMs - 本帧 delta time（ms）
     *
     * 衰减：0.995 每 500ms
     *   half-life = 135s → 慢变量：被打后 AI 记仇很久
     *   用 dtMs 缩放保证不管 fixedUpdate 频率多少衰减速度一致
     */
    tick(dtMs = 16.67) {
        // pressure 衰减：× 0.995^(dtMs / 500)
        const decayFactor = Math.pow(this._pressureDecayBase, dtMs / this._pressureDecayReferenceMs);
        this.pressure *= decayFactor;

        // outcomes 过期清理
        const now = performance.now();
        this.outcomes = this.outcomes.filter(o => (now - o.at) < this.outcomeDecayMs);

        // Phase 3: per-state outcomes 也清理过期
        for (const [state, list] of this.#perStateOutcomes) {
            const filtered = list.filter(o => (now - o.at) < this.outcomeDecayMs);
            if (filtered.length > 0) {
                this.#perStateOutcomes.set(state, filtered);
            } else {
                this.#perStateOutcomes.delete(state);
            }
        }
    }

    // ==================== Clean Read API ====================

    /**
     * Phase 3: 获取某个 stateName 的 tactical adaptation
     * 返回 { consecutiveFail, consecutiveSuccess }
     *
     * consecutiveFail: 最近连续 FAIL_OUTCOMES 的次数（倒序统计，遇到非失败 break）
     * consecutiveSuccess: 最近连续 hit 的次数
     * 过期条目已在 tick 里清理
     */
    getAdaptation(stateName) {
        const now = performance.now();
        const list = this.#perStateOutcomes.get(stateName) || [];
        // 确保不过期（tick 应该已做了，但兜底）
        const recent = list.filter(o => (now - o.at) < this.outcomeDecayMs);

        let consecutiveFail = 0;
        for (let i = recent.length - 1; i >= 0; i--) {
            if (CombatMemory.#FAIL_OUTCOMES.has(recent[i].outcome)) consecutiveFail++;
            else break;
        }

        let consecutiveSuccess = 0;
        for (let i = recent.length - 1; i >= 0; i--) {
            if (recent[i].outcome === "attack:hit") consecutiveSuccess++;
            else break;
        }

        return { consecutiveFail, consecutiveSuccess };
    }

    get pressureNorm() {
        return Math.min(1, this.pressure / 3);
    }

    get recentOutcomes() {
        return [...this.outcomes];
    }

    get recentCommits() {
        return [...this.commits];
    }

    get stats() {
        return {
            pressure: this.pressure.toFixed(2),
            consecutiveMisses: this.consecutiveMisses,
            outcomesCount: this.outcomes.length,
            commitsCount: this.commits.length
        };
    }

    reset() {
        this.outcomes = [];
        this.commits = [];
        this.pressure = 0;
        this.consecutiveMisses = 0;
    }
}
