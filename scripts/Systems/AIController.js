import { BaseController } from "./BaseController.js";
import { AIKnowledgeRegistry } from "./AIKnowledgeRegistry.js";
import { ContactResolver } from "./ContactResolver.js";
import { AITuning } from "../../Data/AITuning.js";

/**
 * AIController - AI 控制器（Phase 1：局面感知 + Utility 选招 + Action Commitment）
 * 核心流程：
 *   fixedUpdate
 *     → committed? → skip
 *     → 100ms 到 → buildSituation → score actions → pick best → execute
 * 场景设定：AI 永远在右，玩家永远在左，AI 始终面向左
 */
export class AIController extends BaseController {
    // Feedback Memory 私有字段声明（JS 要求：先声明后赋值）
    #memory;
    #lastCommittedState;
    #consecutiveAttackUsage;  // { stateName, count } 连续使用同一 attack 的次数（非 attack 打断则 reset）

    /** 判定为「失败」的 combat outcome（类静态，避免每次评分重建） */
    static #FAIL_OUTCOMES = new Set(["parried", "guard_blocked", "clash", "miss"]);

    constructor(character = null, options = {}) {
        super(character);

        // 目标对手（玩家角色）
        this.opponent = options.opponent || null;

        // 双方知识档案（self KB 构造时加载；opponent KB 在 setOpponent 时加载）
        this.kbProfile = AIKnowledgeRegistry.getProfile(this.character);
        this.opponentKB = null;

        // AI 行为偏好参数（嵌套对象，字段分组与 AITuning.js 一一对应）
        this.tuning = options.aiTuning ?? AITuning;

        // 决策冷却
        this.attackCooldownMs = this.tuning.attackCooldownMs;
        this.lastAttackTime = -Infinity;

        // 决策间隔（避免每帧都重新决策）
        this.decisionIntervalMs = this.tuning.decisionIntervalMs;
        this.decisionAccumulatedMs = 0;

        // 统一范围模型：攻击有效阈值 & positioning hold 边界共用同一个 buffer
        // 原来 attack 用 +0.3、positioning 用 +0.5/+1.0，导致 gap 和 mobility boost 反效果
        this.rangeBuffer = this.tuning.rangeBuffer;

        // 随机扰动
        this.reactionVariance = this.tuning.reactionVariance;

        // 当前行为状态（debug 用）
        this.currentBehavior = "idle";

        // Feedback Memory: 最近战术结果存储（Step 2）
        this.#memory = {
            entries: [],           // 最近 N 条 { state, outcome, at }
            maxEntries: 10,
            decayMs: 5000          // 5 秒前的条目开始衰减（Step 3 用）
        };

        // Feedback Memory: Continuity 调节器用（Step 4）
        this.#lastCommittedState = null;

        // Repetition Cost: 连续使用同一 attack 的次数（Step 1）
        this.#consecutiveAttackUsage = null;

        // Debug 可视化
        this.debugVisible = options.debugVisible ?? true;
        this.#initDebugVisuals();
        this.#updateDebugVisuals();
    }

    setOpponent(opponent) {
        this.opponent = opponent;
        if (opponent) {
            this.opponentKB = AIKnowledgeRegistry.getProfile(opponent);
        }
    }

    /**
     * Feedback Memory: CombatSystem 回传本角色攻击结果时调用
     * Step 2 实现：存入 #memory.entries，暂不影响评分（Step 3 接入）
     */
    onCombatResult({ outcome, targetState, counteredBy } = {}) {
        const entry = {
            state: targetState,
            outcome,
            counteredBy: counteredBy ?? null,
            at: performance.now()
        };
        this.#memory.entries.push(entry);
        if (this.#memory.entries.length > this.#memory.maxEntries) {
            this.#memory.entries.shift();
        }
        // Step 4 Continuity: 只有成功才更新 lastCommittedState（失败不覆盖成功记录）
        if (outcome === "hit") {
            this.#lastCommittedState = targetState;
        }
    }

    setDebugVisible(value) {
        this.debugVisible = value;
        if (this.debugMeshes) {
            for (const mesh of this.debugMeshes) {
                mesh.setEnabled(value);
            }
        }
    }

    fixedUpdate(dtMs = 0) {
        if (!this.character || !this.opponent) {
            this.applyToCharacter();
            return;
        }

        // Opponent KB lazy load（如果 setOpponent 没在构造前被调过）
        if (!this.opponentKB) {
            this.opponentKB = AIKnowledgeRegistry.getProfile(this.opponent);
        }

        // Action Commitment：self 正在 committed action（attack/guard/dodge）就跳过决策
        if (this.#isCommitted()) {
            this.decisionAccumulatedMs = 0; // 重置，让 committed action 有完整生命周期
            this.#updateDebugVisuals();
            this.applyToCharacter();
            return;
        }

        // 累积决策时间
        this.decisionAccumulatedMs += dtMs;
        if (this.decisionAccumulatedMs >= this.decisionIntervalMs) {
            this.decisionAccumulatedMs = 0;
            this.#makeDecision();
        }

        // 更新 debug 可视化位置
        this.#updateDebugVisuals();

        this.applyToCharacter();
    }

    /**
     * self 是否处于 committed action（执行中不重决策）
     */
    #isCommitted() {
        const def = this.character.currentStateDef;
        if (!def) return false;
        const hasCounterTag = this.character.hasTag("postDefenseCounterActive");
        const result = (def.guardActive === true && hasCounterTag)
            ? (def.attackActive === true || def.dodgeActive === true)
            : (def.attackActive === true || def.dodgeActive === true || def.guardActive === true);
        console.log(`[dbg-ai] isCommitted=${result} state=${this.character.currentStateName} guardActive=${def.guardActive} attackActive=${def.attackActive} dodgeActive=${def.dodgeActive} hasCounterTag=${hasCounterTag}`);
        return result;
    }

    /**
     * Phase 1 核心决策：构建 Combat Situation → Utility 评分 → 选最高分 → 执行
     */
    #makeDecision() {
        const sit = this.#buildSituation();
        const dist = sit.distance.toFixed(2);

        // 对 self 的所有 attacks + dodges + guards 打分
        const scored = [];

        for (const atk of this.kbProfile?.attacks || []) {
            scored.push({ kind: "attack", action: atk, score: this.#scoreAttack(atk, sit) });
        }
        for (const d of this.kbProfile?.dodges || []) {
            scored.push({ kind: "dodge", action: d, score: this.#scoreDefense(d, sit, "dodge") });
        }
        for (const g of this.kbProfile?.guards || []) {
            scored.push({ kind: "guard", action: g, score: this.#scoreDefense(g, sit, "guard") });
        }

        // 打印 KB 攻击 profile 摘要（每秒打一次够了）
        if (!this._lastKbLogMs || performance.now() - this._lastKbLogMs > 1000) {
            this._lastKbLogMs = performance.now();
            const atkSumm = (this.kbProfile?.attacks || []).map(a => {
                const fwd = (a.displacement ?? 0) < 0 ? -a.displacement.toFixed(2) : 0;
                return `${a.stateName}[reach=${(a.range?.maxReach ?? 0).toFixed(2)},disp=${(a.displacement ?? 0).toFixed(2)},fwdBoost=${fwd},totalReach=${((a.range?.maxReach ?? 0) + fwd).toFixed(2)},traj=${a.trajectory},wt=${a.weight}]`;
            }).join(" | ");
            console.log(`[dbg-ai] KB attacks: ${atkSumm}`);
        }

        // 打印所有评分
        const scoreDump = scored.map(s => {
            if (s.kind === "attack") {
                const r = s.action.range?.maxReach ?? 0;
                const d = s.action.activeDisplacement ?? s.action.displacement ?? 0;
                const fb = d < 0 ? -d : 0;
                const er = r + fb + this.rangeBuffer;
                return `${s.action.stateName}[score=${s.score.toFixed(3)},reach=${r.toFixed(2)},fwd=${fb.toFixed(2)},effR=${er.toFixed(2)},dist=${dist}]`;
            }
            return `${s.kind}[score=${s.score.toFixed(3)}]`;
        }).join(" | ");
        console.log(`[dbg-ai] decision dist=${dist} oppPhase=${sit.opp.phase} oppGuardType=${sit.opp.guardType ?? 'none'}: ${scoreDump}`);

        // 轻微随机扰动 + 排序
        for (const entry of scored) {
            entry.score *= (1 + (Math.random() - 0.5) * this.reactionVariance);
        }
        scored.sort((a, b) => b.score - a.score);

        const best = scored[0];
        console.log(`[dbg-ai] BEST: ${best?.kind ?? 'none'} ${best?.action?.stateName ?? ''} score=${best?.score?.toFixed(3)} threshold=${this.tuning.committedScoreThreshold}`);

        // 有足够好的 committed action 就执行
        if (best && best.score > this.tuning.committedScoreThreshold) {
            this.#executeCommitted(best);
            return;
        }

        // 否则 fallback 到 positioning
        this.#executePositioning(sit);
    }

    // ==================== Combat Situation ====================

    /**
     * 构造 Combat Situation：双方状态 + 距离 + 威胁 + vulnerability
     */
    #buildSituation() {
        const self = this.character;
        const opp = this.opponent;
        const distance = this.#getDistanceToOpponent();

        const selfState = self.currentStateName;
        const selfDef = self.currentStateDef;
        const selfNormTime = self.animation?.normalizedTime ?? 0;

        const oppState = opp.currentStateName;
        const oppDef = opp.currentStateDef;
        const oppNormTime = opp.animation?.normalizedTime ?? 0;

        // 对手是否在攻击中 + 当前阶段
        let oppAttackProfile = null;
        let oppPhase = "none";   // "startup" | "active" | "recovery" | "none"
        let oppRemainingMs = 0;
        if (oppDef?.attackActive === true && this.opponentKB) {
            oppAttackProfile = this.opponentKB.attacks.find(a => a.stateName === oppState);
            if (oppAttackProfile) {
                oppPhase = this.#getAttackPhase(oppAttackProfile, oppNormTime);
                oppRemainingMs = (1 - oppNormTime) * oppAttackProfile.timing.totalMs;
            }
        }

        // opponent threat：综合 phase + reach + distance + self 当前状态
        // threat 必须随距离连续衰减到 0，超远距离 threat≈0 → 防御评分直接被门控挡掉
        let oppThreat = 0; // 0~1
        if (oppAttackProfile) {
            const oppReach = oppAttackProfile.range?.maxReach ?? 0;
            const oppEffRange = oppReach + this.rangeBuffer;
            // rangeFactor: 距离在 effRange ~ effRange×2 之间线性衰减到 0
            let rangeFactor = 1.0;
            if (distance > oppEffRange) {
                const farThreshold = oppEffRange * 2;
                if (distance > farThreshold) {
                    rangeFactor = 0;
                } else {
                    rangeFactor = 1 - (distance - oppEffRange) / (farThreshold - oppEffRange);
                }
            }
            const selfIsBusy = selfDef?.attackActive === true;

            if (oppPhase === "active") {
                oppThreat = this.tuning.threatPerPhase.active * rangeFactor;
            } else if (oppPhase === "startup") {
                oppThreat = this.tuning.threatPerPhase.startup * rangeFactor;
            } else if (oppPhase === "recovery") {
                oppThreat = this.tuning.threatPerPhase.recovery;
            }
            // self 正在攻击中（不可响应窗口）→ 放大威胁
            if (selfIsBusy && oppPhase !== "recovery") oppThreat = Math.min(1, oppThreat + this.tuning.selfBusyThreatBonus);
        }

        // opponent 当前防御状态（用于 Phase 2 queryInteraction）
        const oppGuardType = oppDef?.guardActive === true ? (oppDef.guardType ?? null) : null;
        const oppIsDodging = oppDef?.dodgeActive === true;
        const oppCanParry = oppDef?.guardActive === true && this.#opponentHasParry(oppState);

        // opponent vulnerability：recovery 阶段 + 在我 attack range 内
        let oppVulnerable = 0;
        const selfMaxReach = this.#getMaxReach();

        // Step 2 新增：统一距离模型字段
        const preferredCombatRange = selfMaxReach;
        const distanceError = distance - preferredCombatRange;
        // distanceError > 0 → 当前偏远（应该 approach）
        // distanceError ≈ 0 → 已在攻击边缘
        // distanceError < 0 → 过近（可能需要 retreat）

        if (oppPhase === "recovery" && distance <= selfMaxReach + this.rangeBuffer) {
            oppVulnerable = this.tuning.vulnerabilityPerPhase.recovery;
        } else if (oppPhase === "startup") {
            oppVulnerable = this.tuning.vulnerabilityPerPhase.startup; // 反制窗口
        }

        const selfMobilityTrait = this.kbProfile?.traits?.postDefenseMobility ?? null;
        const selfHasMobilityBoost = self.hasTag("postDefenseMobilityActive");

        return {
            distance,
            self:   { stateName: selfState, def: selfDef, normTime: selfNormTime },
            opp:    { stateName: oppState, def: oppDef, normTime: oppNormTime,
                      attackProfile: oppAttackProfile, phase: oppPhase, remainingMs: oppRemainingMs,
                      guardType: oppGuardType, isDodging: oppIsDodging, canParry: oppCanParry },
            oppThreat,
            oppVulnerable,
            selfMaxReach,
            // Step 2 新增：供 Step 4 Distance Consequence 消费
            preferredCombatRange,
            distanceError,
            now: performance.now(),
            selfMobility: {
                hasTrait: selfMobilityTrait?.enabled === true,
                hasActiveBoost: selfHasMobilityBoost,
                traitConfig: selfMobilityTrait
            }
        };
    }

    /**
     * 判断 opponent 当前 guard 状态是否有 parry 反击 transition
     */
    #opponentHasParry(oppState) {
        const traits = this.opponent?.stateGraph?.characterTraits || null;
        return !!traits?.postDefenseCounter?.enabled;
    }

    /**
     * 根据 KB timing 和 normalizedTime 计算攻击阶段
     */
    #getAttackPhase(attackProfile, normTime) {
        const timing = attackProfile.timing;
        if (!timing || timing.totalMs === 0) return "active";
        const startRatio = timing.startupMs / timing.totalMs;
        const activeEndRatio = (timing.startupMs + timing.activeMs) / timing.totalMs;
        if (normTime < startRatio) return "startup";
        if (normTime < activeEndRatio) return "active";
        return "recovery";
    }

    // ==================== Utility 评分 ====================

    /**
     * Feedback Memory: 计算某个 stateName 的 recent tactical adaptation
     * 返回 { consecutiveFail, consecutiveSuccess }
     * 只看最近 10 条里 stateName 匹配的，从近往远数
     */
    #computeAdaptationFactor(stateName) {
        const recent = this.#memory.entries.filter(e => e.state === stateName);

        let consecutiveFail = 0;
        for (let i = recent.length - 1; i >= 0; i--) {
            if (AIController.#FAIL_OUTCOMES.has(recent[i].outcome)) consecutiveFail++;
            else break;
        }

        let consecutiveSuccess = 0;
        for (let i = recent.length - 1; i >= 0; i--) {
            if (recent[i].outcome === "hit") consecutiveSuccess++;
            else break;
        }

        return { consecutiveFail, consecutiveSuccess };
    }

    /**
     * Feedback Memory Phase 3: Startup Utility
     * 计算 startupFactor（乘法因子，影响 #scoreAttack 最终得分）
     *
     * startupRatio = self 最快攻击 startupMs / 当前攻击 startupMs（范围 (0, 1]）
     *   ratio 越大 = 越快 = 越好
     *
     * startupFactor = 1.0
     *   + recoveryStartupBonus * startupRatio        // opp recovery 时快招加分
     *   - activeStartupPenalty * (1 - startupRatio)  // opp active 时慢招扣分
     *
     * 距离平滑：在 effectiveRange * (1 - distanceStartupSmooth) ~ effectiveRange 之间衰减到 1.0
     * clamp 到 [0.5, 1.2]
     */
    #computeStartupFactor(attack, sit) {
        const timing = attack.timing;
        if (!timing?.startupMs || this.kbProfile?.attacks?.length === 0) return 1.0;

        // effectiveRange（与 #scoreAttack 计算逻辑一致）
        const range = attack.range?.maxReach ?? 0;
        const effectiveDisplacement = attack.activeDisplacement ?? attack.displacement ?? 0;
        const fwdBoost = effectiveDisplacement < 0 ? -effectiveDisplacement : 0;
        const effectiveRange = range + fwdBoost + this.rangeBuffer;

        // startupRatio: self 最快攻击 / 当前攻击
        const minStartupMs = Math.min(...this.kbProfile.attacks.map(a => a.timing.startupMs));
        const startupRatio = Math.min(1.0, minStartupMs / (timing.startupMs ?? minStartupMs));

        // startupReward: opp recovery 时快招加分
        let startupReward = 0;
        if (sit.opp.phase === "recovery") {
            startupReward = this.tuning.attack.recoveryStartupBonus * startupRatio;
        }

        // startupRiskPenalty: opp active + in-range 时慢招扣分
        let startupRiskPenalty = 0;
        if (sit.opp.phase === "active"
            && sit.distance <= (sit.opp.attackProfile?.range?.maxReach ?? 99)) {
            startupRiskPenalty = this.tuning.attack.activeStartupPenalty * (1 - startupRatio);
        }

        // 距离平滑：接近 effectiveRange 时 startupFactor 衰减到 1.0
        const smoothWindow = this.tuning.attack.distanceStartupSmooth;
        const nearThreshold = effectiveRange * (1 - smoothWindow);
        let smoothFactor = 1.0;
        if (sit.distance >= nearThreshold && effectiveRange > nearThreshold) {
            smoothFactor = 1 - (sit.distance - nearThreshold) / (effectiveRange - nearThreshold);
        }
        smoothFactor = Math.max(0, Math.min(1, smoothFactor));

        // 组合：rawFactor 表示 startup 对得分的影响倍率
        const rawFactor = 1.0 + startupReward - startupRiskPenalty;
        // smoothFactor 从 1.0 降到 0.0，让 rawFactor 渐变为 1.0
        const startupFactor = rawFactor * smoothFactor + 1.0 * (1 - smoothFactor);

        return Math.max(0.5, Math.min(1.2, startupFactor));
    }

    #scoreAttack(attack, sit) {
        const range = attack.range?.maxReach ?? 0;
        const timing = attack.timing;

        // frameSpeeds 位移加成：activeDisplacement 是 weaponbox 实际覆盖期间的位移（负=向对手前冲）
        // 用 activeDisplacement 而不是全动画 displacement，避免 dash 这类 weaponbox 只在短窗口存在的动作
        // 被高估可达距离（dash 全位移 ~3.8 但 weaponbox 只覆盖 ~1.7 的位移）
        const effectiveDisplacement = attack.activeDisplacement ?? attack.displacement ?? 0;
        const fwdBoost = effectiveDisplacement < 0 ? -effectiveDisplacement : 0;
        const effectiveRange = range + fwdBoost + this.rangeBuffer;

        // ---- Phase 2: Continuous Range Utility ----
        // 硬门控改平滑衰减：距离在 effectiveRange ~ effectiveRange × (1 + rangeSmoothWindow) 之间
        // 线性衰减到 0，让 reach 稍小但有其他优势（startup 快、trajectory 好）的攻击不被直接挡掉
        const rangeSmoothWindow = this.tuning.attack.distanceStartupSmooth ?? 0.3;
        const maxRange = effectiveRange * (1 + rangeSmoothWindow);
        let rangeFactor = 1.0;
        if (sit.distance > effectiveRange && sit.distance < maxRange) {
            rangeFactor = Math.max(0, 1 - (sit.distance - effectiveRange) / (maxRange - effectiveRange));
        }
        if (sit.distance > maxRange) return 0;

        let score = this.tuning.attack.baseWeight; // base: 距离可达就有基础分

        const canAttack = sit.now - this.lastAttackTime >= this.attackCooldownMs;
        if (!canAttack) score -= this.tuning.attack.cooldownPenalty; // 冷却中 → 大幅扣分

        // ---- Phase 2: 克制关系查询 ----
        // 我的攻击 → opponent 当前防御状态，能不能打中？
        const interaction = ContactResolver.evaluateInteraction({
            offenseTrajectory: attack.trajectory,
            offenseWeight: attack.weight,
            defenseGuardType: sit.opp.guardType,
            defenseIsDodging: sit.opp.isDodging,
            defenseCanParry: sit.opp.canParry
        });
        if (interaction.willMiss) {
            // opponent dodge 了或 guard 防住了 → 大幅扣分
            const penalty = interaction.parryable ? this.tuning.attack.parryRiskPenalty : this.tuning.attack.missPenalty; // parry 更危险（有反击）
            score -= penalty;
        } else if (sit.opp.guardType && !interaction.blocked) {
            // opponent 在 guard 但防不住我的攻击 → 加分（抓漏洞）
            score += this.tuning.attack.guardLeakBonus;
        }
        // --------------------------------

        // opponent vulnerability 高 → 加分（punish 窗口）
        score += sit.oppVulnerable * this.tuning.attack.vulnReward;

        // opponent 正在 active 且在我 range 内 → 攻击风险高 → 扣分
        if (sit.opp.phase === "active" && sit.distance <= (sit.opp.attackProfile?.range?.maxReach ?? 99)) {
            score -= sit.oppThreat * this.tuning.attack.threatPenalty;
        }

        // opponent 在 startup 且我能在他 active 前出手 → 加分（抢先）
        if (sit.opp.phase === "startup" && timing) {
            const myStartupMs = timing.startupMs ?? 0;
            if (myStartupMs <= sit.opp.remainingMs) score += this.tuning.attack.preemptiveBonus;
        }

        // 距离接近 range 上限 → 微加分（稳定命中点，Step 1：与 effectiveRange 对齐）
        if (sit.distance >= range && sit.distance <= effectiveRange) score += this.tuning.attack.rangeEdgeBonus;

        // ---- Feedback Memory Step 3: Adaptation 调节器 ----
        const adaptation = this.#computeAdaptationFactor(attack.stateName);

        // 失败累积惩罚（第 1 次半罚，第 2 次起满罚 + 累积）
        if (adaptation.consecutiveFail >= 2) {
            score -= this.tuning.attack.feedbackFailPenalty * adaptation.consecutiveFail;
        } else if (adaptation.consecutiveFail === 1) {
            score -= this.tuning.attack.feedbackFailPenalty * 0.5;
        }

        // 成功累积奖励（保持惯性，封顶 Step 3: 只反映最近短期成功）
        const cappedSuccess = Math.min(adaptation.consecutiveSuccess, this.tuning.attack.successMaxCount ?? 3);
        if (cappedSuccess >= 1) {
            score += this.tuning.attack.feedbackSuccessBonus * cappedSuccess;
        }

        // ---- Feedback Memory Step 4: Continuity 调节器 ----
        // 上一招成功过 + 当前 adaptation 未强烈反对 → 给惯性加分
        if (attack.stateName === this.#lastCommittedState && adaptation.consecutiveFail < 2) {
            score += this.tuning.attack.continuityBonus;
        }

        // ---- Repetition Cost: 重复行为成本（Step 2）----
        // 同一 attack 连续使用次数越多，边际吸引力递减
        const usageCount = (this.#consecutiveAttackUsage?.stateName === attack.stateName)
            ? this.#consecutiveAttackUsage.count
            : 0;
        if (usageCount >= 2) {
            const rcRate = this.tuning.attack.repetitionCostRate ?? 0.06;
            const rcMax  = this.tuning.attack.repetitionCostMax ?? 0.18;
            const repetitionCost = Math.min(rcMax, rcRate * (usageCount - 1));
            score -= repetitionCost;
        }

        // ---- Phase 3: Startup Utility ----
        const startupFactor = this.#computeStartupFactor(attack, sit);
        score *= startupFactor;

        // ---- Phase 2: Continuous Range Utility（距离平滑衰减）----
        score *= rangeFactor;

        return Math.max(0, Math.min(1, score));
    }

    /**
     * 防御动作 Utility 评分（Phase 2 扩展：evaluateInteraction 区分 dodge/guard 对不同攻击的有效性）
     */
    #scoreDefense(defenseAction, sit, kind) {
        // opponent 没有攻击 → 防御无意义
        if (sit.opp.phase === "none" || sit.oppThreat < this.tuning.defense.activationThreshold) return 0;

        let score = 0;

        // ---- Phase 2: 我的防御 → opponent 当前攻击，能不能防住？----
        let defenseGuardType = null;
        if (kind === "guard") {
            defenseGuardType = defenseAction.guardType ?? null;
        }
        const defenseCanParry = kind === "guard" && (defenseAction.canParry === true);

        const oppAtk = sit.opp.attackProfile;
        if (oppAtk) {
            const interaction = ContactResolver.evaluateInteraction({
                offenseTrajectory: oppAtk.trajectory,
                offenseWeight: oppAtk.weight,
                defenseGuardType,
                defenseIsDodging: kind === "dodge",
                defenseCanParry
            });

            if (interaction.dodged || interaction.blocked) {
                // 我能防住/躲开 → 这防御动作有效
                if (interaction.parryable) {
                    // parry 有反击收益 → 额外加分
                    score += this.tuning.defense.parryReward;
                }
            } else if (oppAtk.trajectory && !interaction.blocked && !interaction.dodged) {
                // 我的防御对对手这个攻击完全没用（比如 guard 遇到 thrust）→ 大幅扣分
                score -= this.tuning.defense.badDefensePenalty;
            }
        }
        // -----------------------------------------------------------

        if (sit.opp.phase === "active") {
            // 对手刀正在挥 → 必须防御
            // Step 3 改动：拉平 dodge 和 guard 基数（原 dodge 0.9 / guard 0.8）
            score += this.tuning.defense.activeBase;
        } else if (sit.opp.phase === "startup") {
            // 对手还在起手 → 预判防御有价值
            const myStartupMs = defenseAction.timing?.totalMs ?? 200;
            if (myStartupMs <= sit.opp.remainingMs) {
                // Step 3 改动：拉平 dodge 和 guard 基数（原 dodge 0.7 / guard 0.6）
                score += this.tuning.defense.startupCanActBase;
            } else {
                score += this.tuning.defense.startupTooLateBase; // 可能来不及
            }
        }

        // Step 4 新增：Distance Consequence — 防御动作后的距离后果
        // 核心思想：防御选择不只是"哪个更安全"，还应该考虑"哪个更符合距离目标"
        // 如果当前距离已经合适 → guard 保住地盘（displacement≈0）更好，dodge 反而退远送空间
        // 如果当前距离偏近 → dodge 拉开回 preferred range 更好
        const currentDistance    = sit.distance;
        const preferredRange     = sit.preferredCombatRange;
        const actionDisplacement = defenseAction.displacement ?? 0;

        // 预测执行防御动作后的距离
        // 项目约束：AI 永远在右侧朝左，displacement > 0 总是代表远离对手
        const predictedDistance = currentDistance + actionDisplacement;

        // 计算距离偏差的变化（执行后 vs 执行前）
        const errorNow   = Math.abs(currentDistance - preferredRange);
        const errorAfter = Math.abs(predictedDistance - preferredRange);
        const consequenceDelta = errorAfter - errorNow;
        // consequenceDelta > 0 → 动作让距离变糟（远离 preferred range）→ 应该扣分
        // consequenceDelta < 0 → 动作让距离变好（回归 preferred range）→ 应该加分

        // 转换成评分调整量，系数控制敏感度，限幅避免盖过威胁评分
        const dc = this.tuning.distanceConsequence;
        const consequenceAdjustment = Math.max(-dc.clamp, Math.min(dc.clamp, -consequenceDelta * dc.multiplier));
        score += consequenceAdjustment;

        return Math.max(0, Math.min(1, score));
    }

    // ==================== 执行 ====================

    /**
     * 执行 committed action：停位 + queueCommand
     */
    #executeCommitted({ kind, action }) {
        this.currentBehavior = kind;
        this.setMoveIntent({ x: 0, y: 0 });
        this.queueCommand(action.stateName);
        if (kind === "attack") {
            this.lastAttackTime = performance.now();
            // Step 1: Repetition Cost 计数器更新
            if (this.#consecutiveAttackUsage?.stateName === action.stateName) {
                this.#consecutiveAttackUsage.count++;
            } else {
                this.#consecutiveAttackUsage = { stateName: action.stateName, count: 1 };
            }
        } else {
            // dodge / guard / positioning 打断连续 attack → reset
            this.#consecutiveAttackUsage = null;
        }
    }

    /**
     * Positioning fallback：根据距离和 threat 选 approach / hold / retreat
     */
    #executePositioning(sit) {
        const maxReach = sit.selfMaxReach;
        const minReach = this.#getMinReach();
        const jitteredDistance = sit.distance * (1 + (Math.random() - 0.5) * this.reactionVariance);
        const hasBoost = sit.selfMobility?.hasActiveBoost === true;

        // Step 1：删除 approachReachMargin 变量，rangeBuffer 统一来自构造函数
        // mobility boost 时 rangeBuffer 保持 0.2（不扩大！boost 让 AI 冲得更近，不是停得更远）
        const retreatThreatThreshold = hasBoost ? this.tuning.retreat.mobilityBoostThreat : this.tuning.retreat.normalThreat;

        // 高威胁时优先后撤保持距离
        if (sit.oppThreat > retreatThreatThreshold && jitteredDistance <= maxReach + this.rangeBuffer) {
            this.currentBehavior = "retreat";
            this.#retreat();
            return;
        }

        if (jitteredDistance > maxReach + this.rangeBuffer) {
            this.currentBehavior = "approach";
            this.#approach();
        } else if (jitteredDistance > minReach && jitteredDistance <= maxReach + this.rangeBuffer) {
            this.currentBehavior = "hold";
            this.#holdPosition();
        } else {
            this.currentBehavior = "retreat";
            this.#retreat();
        }
    }

    /**
     * 接近对手（向左走）
     */
    #approach() {
        this.setMoveIntent({ x: -1, y: 0 });
    }

    /**
     * 后退（向右走）
     */
    #retreat() {
        this.setMoveIntent({ x: 1, y: 0 });
    }

    /**
     * 保持位置
     */
    #holdPosition() {
        this.setMoveIntent({ x: 0, y: 0 });
    }

    /**
     * 发起攻击
     */
    #attack() {
        this.setMoveIntent({ x: 0, y: 0 });

        const attack = this.#selectAttack();
        if (attack) {
            this.queueCommand(attack.stateName);
            this.lastAttackTime = performance.now();
        }
    }

    /**
     * 选择攻击招式
     * 简单策略：随机选择一个可用的攻击
     */
    #selectAttack() {
        if (!this.kbProfile || !this.kbProfile.attacks || this.kbProfile.attacks.length === 0) {
            return null;
        }

        const attacks = this.kbProfile.attacks;
        const idx = Math.floor(Math.random() * attacks.length);
        return attacks[idx];
    }

    /**
     * 获取与对手的距离（AI 在右，玩家在左，距离为正）
     */
    #getDistanceToOpponent() {
        const aiX = this.character.root.position.x;
        const playerX = this.opponent.root.position.x;
        return Math.max(0, aiX - playerX);
    }

    /**
     * 获取最大攻击范围
     */
    #getMaxReach() {
        if (!this.kbProfile || !this.kbProfile.attacks) {
            return 0;
        }
        let max = 0;
        for (const attack of this.kbProfile.attacks) {
            if (attack.range && attack.range.maxReach > max) {
                max = attack.range.maxReach;
            }
        }
        return max;
    }

    /**
     * 获取最小攻击范围
     */
    #getMinReach() {
        if (!this.kbProfile || !this.kbProfile.attacks) {
            return 0;
        }
        let min = Infinity;
        for (const attack of this.kbProfile.attacks) {
            if (attack.range && attack.range.maxReach < min) {
                min = attack.range.maxReach;
            }
        }
        return min === Infinity ? 0 : min;
    }

    // ==================== Debug 可视化 ====================

    #initDebugVisuals() {
        if (!this.character || !this.character.scene) return;

        const scene = this.character.scene;
        this.debugMeshes = [];

        // 三个距离圈的颜色：蓝 -> 绿 -> 红
        const colors = [
            new BABYLON.Color3(0.2, 0.5, 1.0),   // 蓝：远距离（接近圈）
            new BABYLON.Color3(0.2, 0.8, 0.4),   // 绿：中距离（攻击圈）
            new BABYLON.Color3(1.0, 0.3, 0.2)    // 红：近距离（危险圈）
        ];

        for (let i = 0; i < 3; i++) {
            const material = new BABYLON.StandardMaterial(`ai_debug_ring_${i}`, scene);
            material.diffuseColor = colors[i];
            material.emissiveColor = colors[i];
            material.alpha = 0.15;
            material.backFaceCulling = false;
            material.disableLighting = true;
            material.wireframe = true;

            const disc = BABYLON.MeshBuilder.CreateDisc(`ai_debug_disc_${i}`, {
                radius: 1,
                tessellation: 64
            }, scene);
            disc.material = material;
            disc.rotation.x = Math.PI / 2;
            // parent 到 character.root：ExploreMode 不调 rabbleController.fixedUpdate，
            // #updateDebugVisuals 不会被调用，mesh 必须靠 parent 自动跟随 enemy_1 位置
            if (this.character?.root) {
                disc.parent = this.character.root;
            }
            disc.setEnabled(this.debugVisible);

            this.debugMeshes.push(disc);
        }
    }

    #updateDebugVisuals() {
        if (!this.character || !this.debugMeshes || this.debugMeshes.length === 0) return;

        const maxReach = this.#getMaxReach();
        const minReach = this.#getMinReach();

        // 三个圈的半径（Step 1 后同步：蓝圈 = positioning hold 上边界 = maxReach + rangeBuffer）
        const radii = [
            maxReach + this.rangeBuffer,  // 蓝圈：远距离边界（approach/hold 分界）
            maxReach,                     // 绿圈：最大攻击范围
            minReach                      // 红圈：最小攻击范围
        ];

        for (let i = 0; i < 3; i++) {
            const mesh = this.debugMeshes[i];
            if (!mesh) continue;

            // mesh 已 parent 到 character.root，只需更新 local 偏移（贴地）和 scaling
            mesh.position.x = 0;
            mesh.position.y = 0.01;
            mesh.position.z = 0;
            mesh.scaling.x = radii[i];
            mesh.scaling.y = radii[i];
            mesh.setEnabled(this.debugVisible);
        }
    }

    dispose() {
        if (this.debugMeshes) {
            for (const mesh of this.debugMeshes) {
                if (mesh) mesh.dispose();
            }
            this.debugMeshes = null;
        }
        super.dispose();
    }
}
