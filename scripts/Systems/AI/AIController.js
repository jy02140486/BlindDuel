import { BaseController } from "../BaseController.js";
import { AIKnowledgeRegistry } from "./AIKnowledgeRegistry.js";
import { ContactResolver } from "../ContactResolver.js";
import { AITuning } from "../../../Data/AITuning.js";
import { CombatMemory } from "./CombatMemory.js";
import { CombatPosture } from "./CombatPosture.js";
import { ProjectileDefs } from "../../../Data/ProjectileDefs.js";

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

        // 随机扰动（评分阶段乘入，微小波动打破 tie）
        this.reactionVariance = this.tuning.reactionVariance;

        // 反应延迟：每个决策 tick 抽取 0~reflexMaxMs 的随机偏移，加到防御 decisionBuffer 上。
        // reflexMaxMs=0 → 和现在一样（默认）；reflexMaxMs=200 → AI 反应窗口变为 [100ms, 300ms]。
        this.reflexMaxMs = this.tuning.defense?.reflexMaxMs ?? 0;
        // 每个决策 tick 更新（供 #scoreDefense 消费）
        this._reflexOffset = 0;

        // 当前行为状态（debug 用）
        this.currentBehavior = "idle";

        // Feedback Memory: 最近战术结果存储（Step 2）— Phase 3 迁移到 CombatMemory
        this.#memory = {
            entries: [],           // 最近 N 条 { state, outcome, at }
            maxEntries: 10,
            decayMs: 5000          // 5 秒前的条目开始衰减（Step 3 用）
        };

        // Feedback Memory: Continuity 调节器用（Step 4）
        this.#lastCommittedState = null;

        // Repetition Cost: 连续使用同一 attack 的次数（Step 1）
        this.#consecutiveAttackUsage = null;

        // === Layer 0: CombatMemory（Phase 0 新增）===
        this.combatMemory = new CombatMemory();

        // === Layer 1: CombatPosture（Phase 0 新增，500ms 慢变量）===
        // 实例级 aiProfile 的姿态类 knob（baseAggression/baseDefense/decayAlpha/
        // distanceAppetite/retreatDesire）经 tuning.aiProfile 注入；无 profile 时 {} = 系统默认
        this.combatPosture = new CombatPosture(
            this.combatMemory,
            this.#extractPostureOverrides(this.tuning?.aiProfile)
        );

        // === Projectile defense 依赖（Phase 3 Step 5）===
        // ProjectileManager 在 BattleMode.enter() 时才创建 — 通过 setProjectileManager() 延迟注入
        // ProjectileDefs 是静态模块，构造时直接 import 即可
        this.projectileManager = null;
        this.projectileDefs = ProjectileDefs;

        // oppIdleMs / oppLastActiveMs 追踪
        this._oppLastPhase = "none";       // opp 上一次的 phase（用于检测 phase 变化）
        this._oppLastActiveTs = performance.now(); // 初始假设 opp 刚进入 idle → oppIdleMs=0 正确
        this._selfJustHitByOpp = false;     // 本 tick 内 self 是否刚被 opp 击中（opp miss 判定用）

        // Debug 可视化
        this.debugVisible = options.debugVisible ?? true;
        this.#initDebugVisuals();
        this.#updateDebugVisuals();

        // Step C: 攻击意图模式（独立于 tuning，用于隔离 PROACTIVE/PREEMPTIVE/PUNISH 三条路径）
        // normal — 三条路径全开（正常游戏行为）
        // proactive_only — 关掉 PREEMPTIVE 和 PUNISH（只剩 opp.idle 时的主动进攻）
        // preemptive_only — 只剩 PREEMPTIVE（opp.startup 抢先截断）
        // punish_only — 只剩 PUNISH（opp.recovery 惩罚攻击）
        this.attackIntentMode = options.attackIntentMode ?? "normal";
    }

    /**
     * 从 aiProfile 提取作用于 Posture 层的旋钮（7 knob 中的 5 个姿态类）。
     * repetitionCostRate 与 attackPreferences/throwPreference 属 Utility 层，在评分处直读。
     * 无 profile 或字段非 number 时缺省（由 CombatPosture 的 DEFAULT_POSTURE_TUNING 兜底）。
     */
    #extractPostureOverrides(profile) {
        if (!profile) return {};
        const out = {};
        for (const key of ["baseAggression", "baseDefense", "decayAlpha", "distanceAppetite", "retreatDesire"]) {
            if (typeof profile[key] === "number") out[key] = profile[key];
        }
        return out;
    }

    setOpponent(opponent) {
        this.opponent = opponent;
        if (opponent) {
            this.opponentKB = AIKnowledgeRegistry.getProfile(opponent);
        }
    }

    /**
     * BattleMode.enter() 创建完 ProjectileManager 后注入。
     * AIController 构造时 ProjectileManager 不存在（BattleMode 尚未 enter），
     * 所以用 setter 延迟注入，时机是 BattleMode.enter() 末尾。
     * @param {import("../ProjectileManager.js").ProjectileManager} pm
     */
    setProjectileManager(pm) {
        this.projectileManager = pm;
    }

    /**
     * Feedback Memory: CombatSystem 回传本角色的 combat outcome 时调用
     *
     * Phase 0 新增：同时把 outcome 映射到计划文档枚举，喂给 CombatMemory
     * Phase 0 防御方视角：perspective="defender" 时是 opponent 打我 → self:hit 等
     */
    onCombatResult({ outcome, targetState, counteredBy, perspective } = {}) {
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

        // === Phase 3: 喂 CombatMemory + 传 stateName 做 per-state tracking ===
        const mapped = this.#mapToCombatMemoryOutcome(outcome, perspective);
        if (mapped) {
            this.combatMemory.onOutcome(mapped, targetState);
            // 标记：本 tick 内被 opp 击中过（opp miss observer 用来排除）
            if (mapped === "self:hit" || mapped === "guard:broken" || mapped === "dodge:fail") {
                this._selfJustHitByOpp = true;
            }
        }
    }

    /**
     * 把 CombatSystem 回传的 outcome 映射到计划文档的 CombatMemory 枚举
     *
     * attacker 视角（perspective 未设或 undefined）：
     *   hit / miss / parried / guard_blocked / interrupted → 计划枚举
     *
     * defender 视角（perspective="defender"，Phase 0 新增）：
     *   CombatSystem 直接回传 "self:hit" / "guard:success" / "guard:broken" / "dodge:success" / "dodge:fail"
     *   → 直接用
     */
    #mapToCombatMemoryOutcome(outcome, perspective) {
        if (perspective === "defender") {
            // defender 视角的枚举值和计划文档一致，直接用
            return outcome; // "self:hit" | "guard:success" | "guard:broken" | "dodge:success" | "dodge:fail"
        }
        // attacker 视角映射
        switch (outcome) {
            case "hit":         return "attack:hit";
            case "miss":        return "attack:miss";
            case "parried":     return "attack:parried";
            case "guard_blocked": return "attack:miss";  // 被防住 = 也算 miss
            case "interrupted": return "attack:miss";  // 被打断 = 也算 miss
            case "clash":       return null;             // 拼刀不算 outcome
            default:            return null;
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

        // Phase 0: tick CombatMemory（每帧衰减 pressure + 清理过期 outcomes）
        this.combatMemory.tick(dtMs);

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

            // Phase 0: 决策后更新 CombatPosture（吃最新的 Situation）
            const sit = this._lastSituation ?? this.#buildSituation();
            this.combatPosture.update(this.decisionIntervalMs, sit);

            // Phase 0: opp miss observer — 检查 opp 上一 tick 是否结束攻击且 self 没被打到
            this.#checkOppMiss();

            // Phase 0: debug log（每 decision tick 一次，约 5Hz）
            this.#logPhase0Status(sit);
        }

        // 更新 debug 可视化位置
        this.#updateDebugVisuals();

        this.applyToCharacter();
    }

    /**
     * Phase 0: opp miss observer
     * opp 从 "in attack state" (active/recovery) 进入 "none" → opp 的这招打完了
     * 如果 self 这招期间没被 opp 击中 → 视为 opp miss → pressure *= 0.7
     *
     * 修复 v1：_selfJustHitByOpp 只在 opp 进入 active 时重置（新招开始）
     * 不再每 tick 无条件清，确保 active→none 时 flag 恰好反映"这招打到我了吗"
     */
    #checkOppMiss() {
        if (!this.opponent) return;

        const oppDef = this.opponent.currentStateDef;
        const oppPhase = oppDef?.attackActive === true
            ? "in_attack"  // active 或 recovery 都算 attack 进行中
            : "none";

        // opp 进入新的 attack（none → in_attack）→ 重置这招的 hit 标记
        if (this._oppLastPhase !== "in_attack" && oppPhase === "in_attack") {
            this._selfJustHitByOpp = false;
        }

        // opp 打完收招（in_attack → none）→ 判定这招的结果
        if (this._oppLastPhase === "in_attack" && oppPhase === "none") {
            if (!this._selfJustHitByOpp) {
                // 这招没打到我 → opp miss
                this.combatMemory.onOppOutcome("miss");
            }
            // 无论如何，这招处理完了
        }

        this._oppLastPhase = oppPhase;
        if (oppPhase === "in_attack") {
            this._oppLastActiveTs = performance.now();
        }
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
        return result;
    }

    /**
     * Phase 1 核心决策：构建 Combat Situation → Utility 评分 → 选最高分 → 执行
     */
    #makeDecision() {
        // 为本决策 tick 抽取 reflex 偏移（0 ~ reflexMaxMs 均匀分布）
        this._reflexOffset = this.reflexMaxMs > 0
            ? Math.random() * this.reflexMaxMs
            : 0;

        const sit = this.#buildSituation();

        const scored = [];

        // Attack / Defense 候选
        for (const atk of this.kbProfile?.attacks || []) {
            scored.push({ kind: "attack", action: atk, score: this.#scoreAttack(atk, sit) });
        }
        for (const d of this.kbProfile?.dodges || []) {
            scored.push({ kind: "dodge", action: d, score: this.#scoreDefense(d, sit, "dodge") });
        }
        for (const g of this.kbProfile?.guards || []) {
            scored.push({ kind: "guard", action: g, score: this.#scoreDefense(g, sit, "guard") });
        }

        // Throw 候选（计划 Step 3）：独立 kind 进同一 Utility 池，无「远距离优先投掷」硬编码分支
        // 评分内部门控 canThrow/物理射程；执行层 transition gate 为双层合法性兜底
        this._throwDiag = [];
        for (const t of this.kbProfile?.throws || []) {
            scored.push({ kind: "throw", action: t, score: this.#scoreThrow(t, sit) });
        }

        // Phase 2: Positioning 三候选（正式进入同池竞争）
        // B5: 先生成 positioningPlan（events 驱动的阈值跨越可行性），接入评分微调
        const _posPlan = this.#buildPositioningPlan(sit);
        const pos = this.#scorePositioning(sit, _posPlan);

        // Phase 3 Step 7: 投掷物防御候选
        // 两条路径：reactive（in-flight projectile）+ preemptive（throw_windup 预测）
        // 不互斥——windup 阶段 preemptive 先触发，release 后 reactive 接管
        const projResults = [];

        // --- reactive 路径：真实已发射的 projectile ---
        const reactiveResults = (sit.activeProjectileThreats?.length > 0)
            ? this.#evaluateProjectileDefense(sit)
            : [];
        projResults.push(...reactiveResults);

        // --- preemptive 路径：opp 抬手预测 projectile ---
        // Step 2b 迁移：从统一 events 层读，不再依赖 sit.predictedProjectile* 孤立字段
        // 门控简化：arrivalEvent != null 已隐含「cuttable + 有预测到达时刻」两个条件
        // 加上 oppPhase=throw_windup 确保只有 throw_windup 阶段触发
        const arrivalEvent = this.#findPredictedEvent(
            sit.predictedOpponentEvents, "opp_projectile_arrival_estimate"
        );
        const releaseEvent = this.#findPredictedEvent(
            sit.predictedOpponentEvents, "opp_throw_release"
        );

        if (sit.opp.phase === "throw_windup" && arrivalEvent && releaseEvent) {

            // 找到所有 slash 中最早的 activeEnd（最快的斩招）
            const slashAttacks = (this.kbProfile?.attacks ?? [])
                .filter(a => a.trajectory === "slash");

            if (slashAttacks.length > 0) {
                const bestActiveEnd = Math.min(...slashAttacks.map(
                    s => s.timing.startupMs + s.timing.activeMs));
                const _canPreemptive = arrivalEvent.startMs <= bestActiveEnd;
                const flightMs = arrivalEvent.startMs - releaseEvent.startMs;

                if (this.debugVisible) {
                    console.log(
                        `[AI-Diag] preemptive_gate: predictedTTI=${arrivalEvent.startMs.toFixed(0)}ms ` +
                        `bestActiveEnd=${bestActiveEnd}ms ` +
                        `flightMs=${flightMs.toFixed(0)}ms → ` +
                        `${_canPreemptive ? "VIABLE" : "SKIP (tts>activeEnd, projectile arrives after weaponbox ends)"}`
                    );
                }

                if (_canPreemptive) {
                    const preemptiveResults = this.#evaluateProjectileDefense(sit, {
                        overrideTTI: arrivalEvent.startMs,
                        overrideCuttable: true,
                        overrideDistance: arrivalEvent.properties.estimatedDistance,
                        isPreemptive: true,
                    });
                    projResults.push(...preemptiveResults);
                }
                // else: 远距离，跳过 preemptive。AI 保持不动，release 后 reactive 接管
            }
        }

        for (const r of projResults) {
            scored.push(r);
        }

        scored.push({ kind: "approach", action: null, score: pos.score });
        scored.push({ kind: "hold", action: null, score: pos.holdScore });
        scored.push({ kind: "retreat", action: null, score: pos.retreatScore });

        // 排序（#scoreAttack/#scoreDefense 已有各自 jitter，positioning 内部也有 jitter）
        scored.sort((a, b) => b.score - a.score);

        const best = scored[0];

        // === DIAGNOSTIC LOG ===
        if (this.debugVisible) {
            const _top3 = scored.slice(0, 3).map(s => {
                const actionLabel = s.action?.stateName ?? "(pos)";
                return `${s.kind}:${actionLabel}=${s.score.toFixed(3)}`;
            }).join(" | ");

            const _atkBreakdown = (this.kbProfile?.attacks || []).map(a => {
                const s = scored.find(x => x.action === a && x.kind === "attack");
                const r = a.range;
                const disp = a.activeDisplacement ?? a.displacement ?? 0;
                const fwd = disp < 0 ? -disp : 0;
                const effR = (r?.maxReach ?? 0) + fwd + this.rangeBuffer;
                const smoothW = this.tuning.attack.distanceStartupSmooth ?? 0.3;
                const maxR = effR * (1 + smoothW);
                let rf = 1.0;
                if (sit.distance > effR && sit.distance < maxR) {
                    rf = Math.max(0, 1 - (sit.distance - effR) / (maxR - effR));
                }
                if (sit.distance > maxR) rf = 0;
                return `${a.stateName}(minR=${(r?.minReach ?? 0).toFixed(2)} maxR=${(r?.maxReach ?? 0).toFixed(2)} effR=${effR.toFixed(2)} rf=${rf.toFixed(2)} sc=${(s?.score ?? 0).toFixed(3)})`;
            }).join(", ");

            const _posDetail = `POS: approach=${pos.score.toFixed(3)} hold=${pos.holdScore.toFixed(3)} retreat=${pos.retreatScore.toFixed(3)}`;

            const _throwBreakdown = (this._throwDiag || []).map(d => {
                const ammoStr = d.ammo === null ? "-" : d.ammo;
                if (d.gate) {
                    return `${d.stateName}(ammo=${ammoStr} can=${d.can} dist=${d.dist.toFixed(2)} GATE:${d.gate})`;
                }
                return `${d.stateName}(ammo=${ammoStr} can=${d.can} dist=${d.dist.toFixed(2)} ` +
                    `R_eff=${d.rEff.toFixed(2)} rf=${d.rf.toFixed(2)} riskA=${d.riskA.toFixed(2)} riskB=${d.riskB.toFixed(2)} ` +
                    `idle=${d.idle >= 0 ? "+" : ""}${d.idle.toFixed(2)} recov=${d.recov.toFixed(2)} ` +
                    `cd=${d.cd.toFixed(2)} rep=${d.rep.toFixed(2)} pref=${d.pref.toFixed(1)} → sc=${d.score.toFixed(3)})`;
            }).join(", ");

            const _bestLabel = best?.action?.stateName ?? "(pos)";
            console.log(
                `[AI-Diag] dist=${sit.distance.toFixed(2)} oppPhase=${sit.opp.phase} oppThreat=${sit.oppThreat.toFixed(2)} ` +
                `→ best=${best?.kind}:${_bestLabel}(${best?.score?.toFixed(3) ?? "0"}) ` +
                `top3=[${_top3}] ${_posDetail} attacks: ${_atkBreakdown}` +
                `${_throwBreakdown ? ` throws: ${_throwBreakdown}` : ""}`
            );
        }
        // ================================

        // Phase 2: 直接执行最高分（不再有 threshold 硬门控，positioning 已进 pool）
        if (best && best.score > 0) {
            this.#executeCommitted(best);
        } else {
            // 极端情况：所有分数都是 0 → hold（保底）
            this.currentBehavior = "hold";
            this.setMoveIntent({ x: 0, y: 0 });
        }
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
        let oppPhase = "none";   // "startup" | "active" | "recovery" | "throw_windup" | "none"
        let oppRemainingMs = 0;
        if (oppDef?.attackActive === true && this.opponentKB) {
            oppAttackProfile = this.opponentKB.attacks.find(a => a.stateName === oppState);
            if (oppAttackProfile) {
                oppPhase = this.#getAttackPhase(oppAttackProfile, oppNormTime);
                oppRemainingMs = (1 - oppNormTime) * oppAttackProfile.timing.totalMs;
            }
        }

        // Phase 3 Step 6 新增：对手是否在投掷准备中（独立于 attack 链路）
        // throwActive 是独立标记，不蹭 attackActive
        let oppThrowProfile = null;
        if (oppPhase === "none" && oppDef?.throwActive === true && this.opponentKB?.throws) {
            oppThrowProfile = this.opponentKB.throws.find(t => t.stateName === oppState);
            if (oppThrowProfile) {
                oppPhase = "throw_windup";
            }
        }

        // opponent threat：综合 phase + reach + distance + self 当前状态
        // threat 必须随距离连续衰减到 0，超远距离 threat≈0 → 防御评分直接被门控挡掉
        let oppThreat = 0; // 0~1
        // Bug 1 fix: recovery 阶段用 opp 整体最大 reach（即将恢复能出任何一招）
        const oppMaxReach = this.opponentKB?.attacks?.length
            ? Math.max(...this.opponentKB.attacks.map(a => a.range?.maxReach ?? 0))
            : 0;
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
                // oppThreat 保留给 attack 评分的 threatPenalty 和 positioning retreat 使用
                // 但不再是防御评分的门控（防御已改为精确时序驱动）
                oppThreat = this.tuning.threatPerPhase.startup * rangeFactor;
            } else if (oppPhase === "recovery") {
                // Bug 1 fix: recovery 也乘 rangeFactor，但用 oppMaxReach（对手即将恢复能出任何一招）
                const recoveryEffRange = Math.max(oppMaxReach, oppReach) + this.rangeBuffer;
                let recoveryRangeFactor = 1.0;
                if (distance > recoveryEffRange) {
                    const farThreshold = recoveryEffRange * 2;
                    if (distance > farThreshold) {
                        recoveryRangeFactor = 0;
                    } else {
                        recoveryRangeFactor = 1 - (distance - recoveryEffRange) / (farThreshold - recoveryEffRange);
                    }
                }
                oppThreat = this.tuning.threatPerPhase.recovery * recoveryRangeFactor;
            }
            // self 正在攻击中（不可响应窗口）→ 放大威胁
            if (selfIsBusy && oppPhase !== "recovery") oppThreat = Math.min(1, oppThreat + this.tuning.selfBusyThreatBonus);
        }

        // Phase 3 Step 6 新增：throw_windup phase 给一个基础威胁（preemptive 窗口）
        if (oppPhase === "throw_windup") {
            oppThreat = Math.max(oppThreat, this.tuning.threatPerPhase?.throw_windup ?? 0.5);
        }

        // Phase 3 Step 6 新增：查询 in-flight projectiles（独立于 oppPhase）
        // activeProjectileThreats 是 Situation 独立字段，不覆盖 oppPhase
        // oppPhase 反映 opponent 当前动作；projectile threat 是并行存在的 threat source
        const activeProjectileThreats = [];
        if (this.projectileManager && this.opponent) {
            const selfX = self.root.position.x;
            for (const p of this.projectileManager.getActiveProjectiles()) {
                if (p.ownerId !== this.opponent.id) continue;
                if (p.isDestroyed) continue;

                // === direction check：projectile 必须朝 self 飞来 ===
                const dirX = selfX - p.simPos.x;  // >0 = self 在 projectile 右侧
                const velocityTowardsSelf = Math.sign(dirX) === Math.sign(p.velocity.x);
                if (!velocityTowardsSelf) continue;  // 远离我，不是威胁

                // === 简化 TTI：假设 self 停在当前位置（v1 简化假设）===
                const distanceToSelf = Math.abs(dirX);
                const vx = Math.abs(p.velocity.x);
                const estTimeToCurrentPositionMs = vx > 0 ? (distanceToSelf / vx) * 1000 : 9999;

                activeProjectileThreats.push({
                    projectile: p,
                    profile: this.projectileDefs[p.projectileType] ?? null,
                    position: { x: p.simPos.x, y: p.simPos.y },
                    velocity: { x: p.velocity.x, y: p.velocity.y },
                    distanceToSelf,
                    estTimeToCurrentPositionMs,
                    cuttable: p.cuttable,
                });
            }
        }

        // in-flight projectile 存在时，叠加 oppThreat（但不改 oppPhase）
        if (activeProjectileThreats.length > 0) {
            const maxUrgency = Math.max(...activeProjectileThreats.map(
                t => Math.max(0, 1 - t.estTimeToCurrentPositionMs / 1500)
            ));
            oppThreat = Math.max(oppThreat, maxUrgency * 0.8);
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

        // === Phase 0: oppIdleMs / oppLastActiveMs 追踪 ===
        // oppLastActiveTs = opp 上一次 phase !== "none" 的时间戳
        // oppIdleMs = opp 连续 idle (phase === "none") 的时长
        const now = performance.now();
        if (oppPhase !== "none") {
            this._oppLastActiveTs = now;
        }
        const oppIdleMs = oppPhase === "none"
            ? (now - (this._oppLastActiveTs || now))
            : 0;
        const oppLastActiveMs = oppPhase === "none"
            ? (this._oppLastActiveTs > 0 ? (now - this._oppLastActiveTs) : 0)
            : 0;

        // === DIAGNOSTIC LOG: opp attack perception ===
        if (oppAttackProfile && this.debugVisible) {
            const _ap = oppAttackProfile;
            const _timing = _ap.timing;
            const _normMs = oppNormTime * _timing.totalMs;
            console.log(
                `[AI-Diag] oppAttack=${_ap.stateName} phase=${oppPhase} ` +
                `normTime=${oppNormTime.toFixed(3)} (${_normMs.toFixed(0)}ms/${_timing.totalMs}ms) ` +
                `timing=[s:${_timing.startupMs} a:${_timing.activeMs} r:${_timing.recoveryMs}] ` +
                `threat=${oppThreat.toFixed(2)} remainingMs=${oppRemainingMs.toFixed(0)} distance=${distance.toFixed(2)}`
            );
        }
        // Phase 3 Step 6 新增：throw / projectile 感知诊断
        if (this.debugVisible) {
            if (oppThrowProfile) {
                const _tp = oppThrowProfile;
                // Step 2b: 旧 _predInfo 已删除（引用已迁移字段 predictedProjectileTTI/throwRemainingMs 等）
                // events 诊断日志 [AI-Diag] predictedEvents=... 已覆盖 release startMs 和 arrival startMs
                console.log(
                    `[AI-Diag] oppThrow=${_tp.stateName} projectileType=${_tp.projectileType} ` +
                    `cuttable=${_tp.cuttable} startupMs=${_tp.timing.startupMs}ms oppPhase=throw_windup ` +
                    `oppThreat=${oppThreat.toFixed(2)}`
                );
            }
            if (activeProjectileThreats.length > 0) {
                const threats = activeProjectileThreats.map(t =>
                    `${t.projectile.projectileType ?? "?"}(estTTI=${t.estTimeToCurrentPositionMs.toFixed(0)}ms dist=${t.distanceToSelf.toFixed(2)} cuttable=${t.cuttable})`
                ).join(", ");
                console.log(
                    `[AI-Diag] activeProjectileThreats=${activeProjectileThreats.length} [${threats}] ` +
                    `oppPhase=${oppPhase} oppThreat=${oppThreat.toFixed(2)}`
                );
            }
        }
        // ===============================================

        // === Phase 5 Step 2a: 统一预测事件生成器 ===
        // 根据 opp 当前 state + KB profile 生成未来时间线事件
        // 第一版：只观测不消费（评分函数仍读旧字段）
        const predictedOpponentEvents = this.#buildPredictedOpponentEvents(
            oppState, oppNormTime, oppAttackProfile, oppThrowProfile,
            oppPhase, distance
        );

        const situation = {
            distance,
            self:   { stateName: selfState, def: selfDef, normTime: selfNormTime },
            opp:    { stateName: oppState, def: oppDef, normTime: oppNormTime,
                      attackProfile: oppAttackProfile, phase: oppPhase, remainingMs: oppRemainingMs,
                      guardType: oppGuardType, isDodging: oppIsDodging, canParry: oppCanParry,
                      throwProfile: oppThrowProfile },
            oppThreat,
            oppVulnerable,
            // Phase 3 Step 6 新增
            activeProjectileThreats,
            // Phase 0 新增
            oppIdleMs,
            oppLastActiveMs,
            selfMaxReach,
            // Step 2 新增：供 Step 4 Distance Consequence 消费
            preferredCombatRange,
            distanceError,
            now,
            // Phase 5 Step 2a: 统一预测层
            predictedOpponentEvents,
            selfMobility: {
                hasTrait: selfMobilityTrait?.enabled === true,
                hasActiveBoost: selfHasMobilityBoost,
                traitConfig: selfMobilityTrait
            }
        };

        // 缓存，供 Phase 0 Posture.update 消费（每 decision tick 一次）
        this._lastSituation = situation;
        return situation;
    }

    /**
     * Phase 5 Step 2a: 根据 opp 当前 committed state + KB profile 生成未来事件时间线
     * 纯数据层 — 不做战术判断，只产出时间线事件，不消费任何评分函数
     *
     * 事件类型：
     *   "opp_attack_active_window"        // 普通攻击 weaponbox 激活窗口
     *   "opp_throw_release"               // 投掷物 release 时刻（瞬时）
     *   "opp_projectile_arrival_estimate" // 投掷物预计到达时刻（瞬时）
     *
     * 时间基准：startMs / endMs = "距现在多少 ms"
     * 上限：最多 5 个事件，startMs > 2000ms 丢弃（太远的未来不关心）
     */
    #buildPredictedOpponentEvents(oppState, oppNormTime, oppAttackProfile, oppThrowProfile, oppPhase, distance) {
        const events = [];
        const MAX_EVENTS = 5;
        const MAX_FUTURE_MS = 2000;

        // === 1. 普通攻击 active window ===
        // 只有 opp 还在 startup 阶段（weaponbox 尚未激活）才产事件
        // active / recovery 阶段不产 — 已经在进行中了，没有"未来"可预测
        if (oppAttackProfile && oppPhase === "startup") {
            const timing = oppAttackProfile.timing;
            const reach = oppAttackProfile.range?.maxReach ?? 0;
            const startupMs = timing.startupMs ?? 0;
            const activeMs = timing.activeMs ?? 0;
            const elapsedMs = oppNormTime * timing.totalMs;
            const remainingStartupMs = Math.max(0, startupMs - elapsedMs);

            events.push({
                eventType: "opp_attack_active_window",
                startMs: remainingStartupMs,
                endMs: remainingStartupMs + activeMs,
                sourceState: oppState,
                properties: {
                    startupMs,
                    activeDurationMs: activeMs,
                    recoveryMs: timing.recoveryMs ?? 0,
                    reach,
                    trajectory: oppAttackProfile.trajectory ?? null,
                    weight: oppAttackProfile.weight ?? null,
                }
            });
        }

        // === 2. 投掷物事件链 ===
        // throw 状态产两个瞬时事件：release → arrival estimate
        // 时间计算逻辑与 #buildSituation 里的 throw_windup 预测完全一致（保持同一物理模型）
        if (oppThrowProfile) {
            const timing = oppThrowProfile.timing;
            const startupMs = timing.startupMs ?? 0;
            const elapsedMs = oppNormTime * timing.totalMs;
            const throwReleaseRemainingMs = Math.max(0, startupMs - elapsedMs);
            const projectileSpeed = oppThrowProfile.speed ?? 6;
            const flightMs = (distance / projectileSpeed) * 1000;
            const tti = throwReleaseRemainingMs + flightMs;

            // 事件 1: release 时刻（瞬时）
            events.push({
                eventType: "opp_throw_release",
                startMs: throwReleaseRemainingMs,
                endMs: throwReleaseRemainingMs,
                sourceState: oppState,
                properties: {
                    startupMs,
                    projectileType: oppThrowProfile.projectileType,
                    cuttable: oppThrowProfile.cuttable,
                    speed: projectileSpeed,
                }
            });

            // 事件 2: projectile 预计到达时刻（瞬时）
            if (oppThrowProfile.cuttable) {
                events.push({
                    eventType: "opp_projectile_arrival_estimate",
                    startMs: tti,
                    endMs: tti,
                    sourceState: oppState,
                    properties: {
                        projectileType: oppThrowProfile.projectileType,
                        cuttable: oppThrowProfile.cuttable,
                        speed: projectileSpeed,
                        estimatedDistance: distance,
                    }
                });
            }
        }

        // === 3. 排序 + 裁剪 ===
        events.sort((a, b) => a.startMs - b.startMs);
        const filtered = events
            .filter(e => e.startMs <= MAX_FUTURE_MS)
            .slice(0, MAX_EVENTS);

        // === 4. 诊断日志 ===
        if (this.debugVisible && filtered.length > 0) {
            const summary = filtered.map(e =>
                `${e.eventType}(start=${e.startMs.toFixed(0)}ms,end=${e.endMs.toFixed(0)}ms,src=${e.sourceState})`
            ).join(", ");
            console.log(`[AI-Diag] predictedEvents=${filtered.length} [${summary}] oppPhase=${oppPhase}`);
        }

        return filtered;
    }

    /**
     * Phase 5 Step 2b: 从 predictedOpponentEvents 数组里查第一个匹配 eventType 的事件
     * @param {Array} events - predictedOpponentEvents
     * @param {string} eventType - 要找的事件类型
     * @returns {object|null} - 事件对象或 null
     */
    #findPredictedEvent(events, eventType) {
        if (!events || events.length === 0) return null;
        return events.find(e => e.eventType === eventType) ?? null;
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
     * [DEPRECATED Phase 3] 迁移到 CombatMemory.getAdaptation(stateName)。
     * 暂时保留作为 wrapper，内部改调 combatMemory.getAdaptation（读映射后的 outcomes）。
     * 但旧 #memory.entries 仍存原始枚举，所以这个 wrapper 已不等价于原始实现 — 直接调 combatMemory.getAdaptation 更准确。
     */
    #computeAdaptationFactor(stateName) {
        // 过渡 wrapper：读 CombatMemory 的 per-state tracking
        return this.combatMemory.getAdaptation(stateName);
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

        // ---- 太近打不到：minReach 门控 ----
        const minReach = attack.range?.minReach ?? 0;
        if (sit.distance < minReach) return 0; // weaponbox gap 覆盖不到对手

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
        const baseScore = score;

        // === Step B: 意图分项诊断 ===
        // 记录每个分项归属，最后输出 breakdown 日志
        // 归属规则（来自 Step A 审计）：
        //   common: 所有基础/风险/历史类分项，不区分意图
        //   preemptive: events.startup 时的抢先加分（唯一的 PREEMPTIVE 入口）
        //   punish: opp.recovery 时 vulnReward 的主要贡献
        let _breakdown = { common: score, preemptive: 0, punish: 0 };

        const canAttack = sit.now - this.lastAttackTime >= this.attackCooldownMs;
        // cooldownPenalty scope: 只惩罚 opp 空闲时的主动追击
        // 豁免：opp.startup — PREEMPTIVE 被迫应对，冷却中也该能触发
        // 仍扣：opp.active — opp 正在打，冷却中不该硬上
        // 仍扣：opp.recovery — opp 还没恢复好，冷却中不该连打（vulnReward 等冷却完再拿）
        const oppInStartup = sit.opp?.phase === "startup";
        if (!canAttack && !oppInStartup) {
            const _cdPenalty = this.tuning.attack.cooldownPenalty;
            score -= _cdPenalty;
            _breakdown.common -= _cdPenalty;
        }

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
            _breakdown.common -= penalty;
        } else if (sit.opp.guardType && !interaction.blocked) {
            // opponent 在 guard 但防不住我的攻击 → 加分（抓漏洞）
            const _leak = this.tuning.attack.guardLeakBonus;
            score += _leak;
            _breakdown.common += _leak;
        }
        // --------------------------------

        // opponent vulnerability 高 → 加分（punish 窗口）
        const vulnDelta = sit.oppVulnerable * this.tuning.attack.vulnReward;
        score += vulnDelta;
        // vulnReward 语义：opp.recovery 时 0.8 → PUNISH 主贡献
        // opp.startup 时 0.3 → 和 PREEMPTIVE 轻微重叠（Step C 再明确归属）
        _breakdown.punish += vulnDelta;

        // Bug 2 fix: opp 有招在身上（任何阶段）→ 攻击风险高 → 扣分
        // sit.oppThreat 已经编码了 phase + range + distance，不需要额外检查
        let threatPenaltyApplied = 0;
        if (sit.opp.phase !== "none") {
            threatPenaltyApplied = sit.oppThreat * this.tuning.attack.threatPenalty;
            score -= threatPenaltyApplied;
            _breakdown.common -= threatPenaltyApplied;
        }

        // Phase 5 Step 3a: preemptive bonus 迁移到 events 层
        // 旧逻辑 bug: 用 sit.opp.remainingMs（整个 state 剩余时间）→ 比真正 timeUntilActive 大得多
        // 新逻辑: 从 events 查 opp_attack_active_window.startMs（精确的距 opp weaponbox 激活还剩多久）
        const oppAtkWindow = this.#findPredictedEvent(
            sit.predictedOpponentEvents, "opp_attack_active_window"
        );
        if (oppAtkWindow && timing) {
            const myStartupMs = timing.startupMs ?? 0;
            const oppTimeUntilActive = oppAtkWindow.startMs;

            // 物理条件：我的攻击能在 opp weaponbox 激活前先激活 + 够得着
            if (myStartupMs < oppTimeUntilActive
                && sit.distance <= effectiveRange) {

                // trajectory-aware scaling（B1 gap: AI 区分 opp 招式类型）
                // opp 出 thrust（快招）→ AI 很难真抢先，抑制 bonus
                // opp 出 slash（慢招）→ AI 容易抢先，full bonus
                // trajectory=null（dash 等）→ 默认 full
                const oppTrajectory = oppAtkWindow.properties.trajectory;
                let preemptiveMult = 1.0;
                if (oppTrajectory === "thrust") {
                    const oppStartupMs = oppAtkWindow.properties.startupMs ?? 250;
                    if (myStartupMs >= oppStartupMs) {
                        preemptiveMult = 0;   // 我不比 opp 快，根本赶不上
                    } else {
                        preemptiveMult = 0.3; // 勉强能赶（需 opp 已过部分 startup），小奖励
                    }
                }

                const bonus = this.tuning.attack.preemptiveBonus * preemptiveMult;
                score += bonus;
                _breakdown.preemptive += bonus;
                // === DIAGNOSTIC LOG: PREEMPTIVE 专属标记 ===
                // grep PREEMPTIVE 即可确认哪个 attack 是新拦截逻辑触发的
                if (this.debugVisible) {
                    console.log(
                        `[AI-Diag] PREEMPTIVE: attack=${attack.stateName} preempts ${oppAtkWindow.sourceState} ` +
                        `(myStartup=${myStartupMs}ms < oppTimeUntilActive=${oppTimeUntilActive.toFixed(0)}ms, ` +
                        `oppTrajectory=${oppTrajectory ?? "?"}, mult=${preemptiveMult}, bonus=+${bonus.toFixed(2)})`
                    );
                }
                // ==========================================
            }
        }

        // 距离接近 range 上限 → 微加分（稳定命中点，Step 1：与 effectiveRange 对齐）
        if (sit.distance >= range && sit.distance <= effectiveRange) {
            const _reb = this.tuning.attack.rangeEdgeBonus;
            score += _reb;
            _breakdown.common += _reb;
        }

        // ---- Phase 3 Feedback Memory: Adaptation 调节器 ----
        // 改调 CombatMemory.getAdaptation（映射后的 outcomes，per-state tracking）
        const adaptation = this.combatMemory.getAdaptation(attack.stateName);

        // 失败累积惩罚（第 1 次半罚，第 2 次起满罚 + 累积）
        let failDelta = 0;
        if (adaptation.consecutiveFail >= 2) {
            failDelta = -(this.tuning.attack.feedbackFailPenalty * adaptation.consecutiveFail);
            score += failDelta;
            _breakdown.common += failDelta;
        } else if (adaptation.consecutiveFail === 1) {
            failDelta = -(this.tuning.attack.feedbackFailPenalty * 0.5);
            score += failDelta;
            _breakdown.common += failDelta;
        }

        // 成功累积奖励（保持惯性，封顶 Step 3: 只反映最近短期成功）
        const cappedSuccess = Math.min(adaptation.consecutiveSuccess, this.tuning.attack.successMaxCount ?? 3);
        let successDelta = 0;
        if (cappedSuccess >= 1) {
            successDelta = this.tuning.attack.feedbackSuccessBonus * cappedSuccess;
            score += successDelta;
            _breakdown.common += successDelta;
        }

        // ---- Feedback Memory Step 4: Continuity 调节器 ----
        // 上一招成功过 + 当前 adaptation 未强烈反对 → 给惯性加分
        let continuityDelta = 0;
        if (attack.stateName === this.#lastCommittedState && adaptation.consecutiveFail < 2) {
            continuityDelta = this.tuning.attack.continuityBonus;
            score += continuityDelta;
            _breakdown.common += continuityDelta;
        }

        // ---- Repetition Cost: 重复行为成本（Step 2）----
        // 同一 attack 连续使用次数越多，边际吸引力递减
        const usageCount = (this.#consecutiveAttackUsage?.stateName === attack.stateName)
            ? this.#consecutiveAttackUsage.count
            : 0;
        let repetitionCost = 0;
        if (usageCount >= 2) {
            // aiProfile.repetitionCostRate（性格 knob，Utility 层）优先于系统级 tuning
            const rcRate = this.tuning.aiProfile?.repetitionCostRate ?? this.tuning.attack.repetitionCostRate ?? 0.06;
            const rcMax  = this.tuning.attack.repetitionCostMax ?? 0.18;
            repetitionCost = Math.min(rcMax, rcRate * (usageCount - 1));
            score -= repetitionCost;
            _breakdown.common -= repetitionCost;
        }

        // === Step C: 意图级权重（绕过共享乘数，让三条进攻意图可独立配置）===
        const _mode = this.attackIntentMode ?? "normal";
        const oppIsIdle = sit.opp?.phase === "none";
        let commonW = 1.0, preemptiveW = 1.0, punishW = 1.0;
        switch (_mode) {
            case "proactive_only":
                preemptiveW = 0.0; punishW = 0.0; break;
            case "preemptive_only":
                // 只保留 PREEMPTIVE：common 减半（够抢攻击但不主动追）
                if (oppIsIdle) commonW = 0.0;  // opp 空闲时 common 归零 → 不主动追
                preemptiveW = 1.0; punishW = 0.0; break;
            case "punish_only":
                if (oppIsIdle) commonW = 0.0;  // opp 空闲时 common 归零 → 不主动追
                preemptiveW = 0.0; punishW = 1.0; break;
            case "normal":
            default:
                break;
        }
        _breakdown.common     *= commonW;
        _breakdown.preemptive *= preemptiveW;
        _breakdown.punish     *= punishW;
        score = _breakdown.common + _breakdown.preemptive + _breakdown.punish;

        // ---- Phase 3: Startup Utility ----
        const startupFactor = this.#computeStartupFactor(attack, sit);
        score *= startupFactor;

        // === Step B FINAL: 输出意图分项 breakdown ===
        // 放在所有加法完成后（还没乘 rangeFactor/postureMult）
        // 只在有非 common 分项时输出（避免刷屏）
        if (this.debugVisible && (_breakdown.preemptive > 0 || _breakdown.punish > 0)) {
            const _total = _breakdown.common + _breakdown.preemptive + _breakdown.punish;
            console.log(
                `[AI-Diag] attackBreakdown(${attack.stateName}): ` +
                `common=${_breakdown.common.toFixed(2)}` +
                `${_breakdown.preemptive > 0 ? ` +PREEMPTIVE=${_breakdown.preemptive.toFixed(2)}` : ``}` +
                `${_breakdown.punish > 0 ? ` +PUNISH=${_breakdown.punish.toFixed(2)}` : ``}` +
                ` → rawTotal=${_total.toFixed(2)} (×startupFactor=${startupFactor.toFixed(2)})`
            );
        }

        // ---- Phase 2: Continuous Range Utility（距离平滑衰减）----
        score *= rangeFactor;

        // ---- Phase 1: Posture multiplier（Layer 1 慢变量）----
        // neutral = 1.0 不变，DEFENSIVE/CAUTIOUS 时压低 attack 分
        score *= this.combatPosture.attackMultiplier;

        // Phase 1: per-attack 偏好（角色 aiProfile.attackPreferences，默认全 1.0）
        const pref = this.tuning?.aiProfile?.attackPreferences?.[attack.stateName] ?? 1.0;
        score *= pref;

        return score;
    }

    /**
     * 防御动作 Utility 评分（Phase 2 扩展：evaluateInteraction 区分 dodge/guard 对不同攻击的有效性）
     */
    #scoreDefense(defenseAction, sit, kind) {
        // ======== 精确时序驱动的防御评分重构 ========
        // 用户洞察：所有变量 AI 已知 — 对手状态、距离、reach、还剩多少时间 hit。
        // 防御不该用 threat 近似门控，应该直接回答两个精确问题：
        //   1. 这招能不能够到我 + 我的防御能不能防住？
        //   2. 现在是不是出防御的正确时机？

        const oppPhase = sit.opp.phase;
        const oppAtk = sit.opp.attackProfile;

        // --- 问题 2a: 对手有没有在攻击？---
        // Phase 1 改动：oppPhase === "none" 不再硬 return 0
        // 新增 defensiveReadiness 分支 — opp idle 2s+ 时 guard 可以有小分进候选池
        // 这是让 AI 在对手收招后还能保持警惕的关键改动
        if (oppPhase === "recovery") {
            return 0; // 对手已收招，防御意义不大
        }

        if (oppPhase === "none") {
            // Phase 1 新增：defensiveReadiness — 对手 idle 时的警惕待命
            // 条件：pressure 高（被打怕了）+ opp idle 足够久（2s+）
            // 分数很小（0.08 * smoothstep），保证只有 attack 分也低时 guard 才会赢
            // 这样既能警惕待命，又不会变成"没事就瞎防"
            const pressureNorm = this.combatMemory?.pressureNorm ?? 0;
            const oppIdleMs = sit.oppIdleMs ?? 0;
            const smoothstep = (x, e0, e1) => {
                if (e1 <= e0) return x <= e0 ? 0 : 1;
                const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
                return t * t * (3 - 2 * t);
            };
            const readiness = smoothstep(oppIdleMs, 800, 2000);
            // pressureNorm 加权：没被打过时（pressure=0）readiness 也不给分
            const score = 0.08 * readiness * pressureNorm;
            // Phase 1: 这里不乘 defenseMultiplier（defensiveReadiness 是独立小分支）
            return score;
        }

        if (!oppAtk) {
            return 0; // 无攻击 profile，防御无从谈起
        }

        // --- 问题 1a: 这招能不能够到我？---
        const oppReach = oppAtk.range?.maxReach ?? 0;
        // 攻击位移也能缩短距离 — 算上 forward displacement
        const oppEffReach = oppReach + this.rangeBuffer;
        // startup 阶段对手可能还没前冲到位 — 保守判断
        if (sit.distance > oppEffReach * 1.5) {
            return 0; // 明显够不着
        }

        // --- 问题 2b: 现在是不是正确时机？---
        if (oppPhase === "startup") {
            // Phase 5 Step 3b: timeUntilActive 从统一 events 层读
            // opp_attack_active_window.startMs 数值等价于 startupMs - elapsedMs（logs 已验证）
            // 但 events 是统一数据源，减少多处重复计算
            const oppAtkWindow = this.#findPredictedEvent(
                sit.predictedOpponentEvents, "opp_attack_active_window"
            );
            let timeUntilActive;
            if (oppAtkWindow) {
                timeUntilActive = oppAtkWindow.startMs;
            } else {
                // Fallback: events 缺失时手动计算（理论上 opp startup 总会产 events）
                const totalMs = oppAtk.timing.totalMs;
                const startupMs = oppAtk.timing.startupMs;
                const elapsedMs = sit.opp.normTime * totalMs;
                timeUntilActive = startupMs - elapsedMs;
            }

            // AI 每隔 decisionIntervalMs 才能做一次决策 + 防御瞬时生效
            // 窗口定义：timeUntilActive 在 [0, decisionBuffer] 之间 = 该按了
            // decisionBuffer 覆盖：1个决策间隔 + 少许生效延迟余量 + reflex 延迟
            // reflex 延迟每次决策 tick 重新抽取（0 ~ reflexMaxMs），表达 AI 反应速度的随机分布
            const decisionBuffer = this.decisionIntervalMs + this._reflexOffset;

            if (timeUntilActive > decisionBuffer) {
                // 还早！对手距离 active 还有 ~300-500ms
                // 此时不该出 guard — 让攻击/走位竞争，留着 guard 给 hit 真要来的时候
                return 0;
            }
            // timeUntilActive <= decisionBuffer → 进入反应窗口，开始打分
            // 越低分越高（越接近 active，反应越紧急）
            const urgency = Math.max(0, 1 - timeUntilActive / decisionBuffer);
            // === DIAGNOSTIC LOG: timing window ===
            if (this.debugVisible) {
                console.log(
                    `[AI-Diag] defenseScore ${kind}:${defenseAction.stateName} ` +
                    `startup timing → timeUntilActive=${timeUntilActive.toFixed(0)}ms ` +
                    `decisionBuffer=${decisionBuffer} urgency=${urgency.toFixed(2)} ` +
                    `(src=events oppTrajectory=${oppAtkWindow?.properties?.trajectory ?? "?"})`
                );
            }
            // ===============================================
        }
        // oppPhase === "active" → 已经在 hit 帧了，当然该防

        // --- 问题 1b: 我的防御对这招有效吗？---
        let defenseGuardType = null;
        if (kind === "guard") {
            defenseGuardType = defenseAction.guardType ?? null;
        }
        const defenseCanParry = kind === "guard" && (defenseAction.canParry === true);

        let score = this.tuning.defense.activeBase; // 基础分（active 阶段）或 startupCanActBase（startup 窗口）
        if (oppPhase === "startup") {
            score = this.tuning.defense.startupCanActBase;
        }

        const interaction = ContactResolver.evaluateInteraction({
            offenseTrajectory: oppAtk.trajectory,
            offenseWeight: oppAtk.weight,
            defenseGuardType,
            defenseIsDodging: kind === "dodge",
            defenseCanParry
        });

        if (interaction.dodged || interaction.blocked) {
            if (interaction.parryable) {
                score += this.tuning.defense.parryReward;
            }
        } else if (oppAtk.trajectory && !interaction.blocked && !interaction.dodged) {
            // 完全没用的防御 — 大幅扣分
            score -= this.tuning.defense.badDefensePenalty;
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

        // ---- Phase 1: Posture multiplier（Layer 1 慢变量）----
        // neutral = 1.0 不变，CAUTIOUS/DEFENSIVE 时提高 defense 分
        score *= this.combatPosture.defenseMultiplier;

        return Math.max(0, Math.min(1, score));
    }

    // =========================================================================
    // Phase 3 Step 7: Projectile Defense 评分（dodge + cut）
    // =========================================================================

    /**
     * 入口：选最紧急的 projectile threat（或接受 override），同时评分 dodge 和 cut。
     * 返回 scored 候选数组，每个候选的 action 是评分阶段选好的真实 dodge/slash。
     *
     * @param {object} sit Combat Situation
     * @param {object} [options] 可选参数——仅 preemptive 路径传入
     * @param {number} [options.overrideTTI]       预测 TTI（throw_windup 外推）
     * @param {boolean} [options.overrideCuttable] 强制 cuttable（throwProfile.cuttable）
     * @param {number} [options.overrideDistance]  预测 distance（fighter-to-fighter，保守简化）
     * @param {boolean} [options.isPreemptive]     标记来源（diagnostic log 用）
     *
     * 下游函数（#findBestDodge/#scoreDodge/#findBestSlash/#scoreCut）签名不变，
     * 统一吃合成的 effectiveThreat 对象——无论来源是 reactive 还是 preemptive。
     */
    #evaluateProjectileDefense(sit, options = {}) {
        const threats = sit.activeProjectileThreats ?? [];
        const hasReactive = threats.length > 0;
        const hasPreemptive = options.overrideTTI != null;
        if (!hasReactive && !hasPreemptive) return [];

        // 选最紧急的 real threat（reactive 路径需要）
        const realThreat = hasReactive
            ? threats.reduce((a, b) =>
                a.estTimeToCurrentPositionMs < b.estTimeToCurrentPositionMs ? a : b)
            : null;

        // TTI 来源优先级：override > real threat
        const tti = options.overrideTTI ?? realThreat.estTimeToCurrentPositionMs;
        const cuttable = options.overrideCuttable ?? realThreat.cuttable;
        const distanceToSelf = options.overrideDistance ?? realThreat.distanceToSelf;

        // speed：从 realThreat.velocity.x 或 override 路径的 throwProfile.speed 拿
        // distanceAlignment 修复需要 projectileSpeed 来预测 slash-active 时刻的距离
        const projectileSpeed = realThreat
            ? Math.abs(realThreat.velocity?.x ?? realThreat.profile?.speed ?? 6)
            : (sit.opp?.throwProfile?.speed ?? 6);

        // 合成 effectiveThreat：保留 realThreat 的 velocity/profile 供下游 distance 预测用
        const effectiveThreat = realThreat
            ? { ...realThreat, distanceToSelf, cuttable }
            : { distanceToSelf, cuttable, speed: projectileSpeed };

        const projResults = [];
        const isPreemptive = options.isPreemptive === true;

        // --- dodge 分支（仅 reactive 路径）---
        // preemptive 路径不产出 dodge：设计目的是「提前斩」，不是「提前躲」
        // dodge 不需要提前——reactive dodge 窗口（totalMs + peak ≈ 600ms）足够，
        // 等 projectile 飞过来再 dodge 完全来得及。
        // 如果 preemptive evaluator 在 windup 早期产出了高分 dodge，
        // AI 会提前 commit → 被锁 dodge recovery → 堵死 release 后的 reactive 路径。
        if (!isPreemptive) {
            const bestDodge = this.#findBestDodgeForProjectile(tti, effectiveThreat);
            if (bestDodge) {
                const dodgeScore = this.#scoreDodgeForProjectile(bestDodge, tti, effectiveThreat);
                projResults.push({
                    kind: "dodge",
                    action: bestDodge,
                    score: dodgeScore,
                    reason: "projectile",
                    isProjectileDefense: true,
                });
            }
        }

        // --- cut 分支（仅 cuttable=true）---
        if (cuttable) {
            const bestSlash = this.#findBestSlashForProjectile(tti, effectiveThreat);
            if (bestSlash) {
                const cutScore = this.#scoreCutForProjectile(bestSlash, tti, effectiveThreat);

                // === DIAGNOSTIC: preemptive cut 评分详情 ===
                if (isPreemptive && this.debugVisible) {
                    const activeStart = bestSlash.timing.startupMs;
                    const activeEnd = bestSlash.timing.startupMs + bestSlash.timing.activeMs;
                    const timingAlignment = this.#computeTimingAlignment(tti, activeStart, activeEnd);
                    console.log(
                        `[AI-Diag] preemptive_cut: predictedTTI=${tti.toFixed(0)}ms ` +
                        `slash=${bestSlash.stateName} active=[${activeStart},${activeEnd}]ms ` +
                        `timingAlignment=${timingAlignment.toFixed(2)} score=${cutScore.toFixed(3)} ` +
                        `distanceToSelf=${distanceToSelf.toFixed(2)}`
                    );
                }
                // ============================================

                if (cutScore > 0) {
                    projResults.push({
                        kind: "attack",
                        action: bestSlash,
                        score: cutScore,
                        reason: isPreemptive ? "projectile_preemptive_cut" : "projectile_cut",
                        isProjectileCut: true,
                        isPreemptive,
                    });
                }
            }
        }

        return projResults;
    }

    /**
     * 纯函数：计算 slash 的 timingAlignment（三段式）
     * 抽到独立方法是为了 diagnostic log 能直接调用，
     * 不重复写三段判断逻辑。
     */
    #computeTimingAlignment(tti, activeStart, activeEnd) {
        // projectile 到达 AI 时 weaponbox 必须还在（或刚结束）
        if (tti < activeStart) {
            return 0;   // weaponbox 还没激活 projectile 就到了 → 物理不可能
        }
        if (tti > activeEnd) {
            return 0;   // weaponbox 已经结束 projectile 才到 → 物理不可能
        }
        return 1.0;     // 完整窗口 [activeStart, activeEnd] 内到达
    }

    /**
     * 从 kbProfile.dodges 里选 timeWindowFactor 最优的 dodge。
     * 不选最快的，选在 tti 时刻的窗口里命中率最高的那个。
     */
    #findBestDodgeForProjectile(tti, threat) {
        const dodges = this.kbProfile?.dodges ?? [];
        if (dodges.length === 0) return null;

        const tun = this.tuning.projectileDefense;
        let bestDodge = null;
        let bestF = -Infinity;

        for (const dodge of dodges) {
            const totalMs = dodge.timing.totalMs;
            let f;
            if (tti >= totalMs && tti <= totalMs + tun.dodgeTimeWindowPeak) {
                f = 1.0;  // 完美窗口
            } else if (tti < totalMs) {
                // 太晚：我还没闪完它就到了
                f = Math.max(0, tti / totalMs * tun.dodgeTooLateRatio);
            } else {
                // 太早：还早不用急，衰减
                f = Math.max(0, 1 - (tti - totalMs - tun.dodgeTimeWindowPeak) / tun.dodgeTooEarlySpan);
            }
            if (f > bestF) { bestF = f; bestDodge = dodge; }
        }
        return bestDodge;
    }

    #scoreDodgeForProjectile(dodge, tti, threat) {
        const tun = this.tuning.projectileDefense;
        const totalMs = dodge.timing.totalMs;
        let timeWindowFactor;
        if (tti >= totalMs && tti <= totalMs + tun.dodgeTimeWindowPeak) {
            timeWindowFactor = 1.0;
        } else if (tti < totalMs) {
            timeWindowFactor = Math.max(0, tti / totalMs * tun.dodgeTooLateRatio);
        } else {
            timeWindowFactor = Math.max(0, 1 - (tti - totalMs - tun.dodgeTimeWindowPeak) / tun.dodgeTooEarlySpan);
        }

        let score = tun.dodgeBase * timeWindowFactor;
        score *= this.combatPosture.defenseMultiplier;

        // 距离门控：已经飞过了
        if (threat.distanceToSelf < 0.2) score *= tun.nearSelfDecay;

        return Math.max(0, Math.min(1, score));
    }

    /**
     * 从 kbProfile.attacks 里 trajectory==="slash" 的选 timing 最优的。
     * timingAlignment: projectile 到达时刻是否在 slash active 窗口内
     */
    #findBestSlashForProjectile(tti, threat) {
        const slashAttacks = (this.kbProfile?.attacks ?? [])
            .filter(a => a.trajectory === "slash");
        if (slashAttacks.length === 0) return null;

        const tun = this.tuning.projectileDefense;
        let bestSlash = null;
        let bestTimingScore = -Infinity;

        for (const slash of slashAttacks) {
            const activeStart = slash.timing.startupMs;
            // timingAlignment 只判断一个条件：weaponbox 能否在 projectile 到达前激活
            // 物理语义：projectile 是恒速直线飞行直到命中的物理物体
            // weaponbox 激活后 projectile 继续飞，只要在 reach 内（distanceAlignment 管）就能斩到
            // 不存在 "too late"——activeEnd 只是武器挥完，但 projectile 还在飞
            let timingAlignment;
            if (tti < activeStart) {
                // weaponbox 还没激活 projectile 就到了 → 物理上不可能命中
                timingAlignment = 0;
            } else {
                // weaponbox 能先激活 → timing 达标
                // tti 越大 projectile 越慢到（越安全），但不额外加分
                timingAlignment = 1.0;
            }
            if (timingAlignment > bestTimingScore) {
                bestTimingScore = timingAlignment;
                bestSlash = slash;
            }
        }
        return bestTimingScore > 0 ? bestSlash : null;
    }

    #scoreCutForProjectile(slash, tti, threat) {
        const tun = this.tuning.projectileDefense;
        const activeStart = slash.timing.startupMs;
        const activeEnd = slash.timing.startupMs + slash.timing.activeMs;

        // timingAlignment：只判断 weaponbox 能否先激活（物理语义修复）
        // projectile 是恒速飞行的物理物体，不存在 "too late" 窗口
        let timingAlignment;
        if (tti < activeStart) {
            // weaponbox 还没激活 projectile 就到了 → 物理上不可能命中
            timingAlignment = 0;
        } else {
            // weaponbox 能先激活 → timing 达标（distanceAlignment 管 reach 覆盖）
            timingAlignment = 1.0;
        }

        // === Bug 修复：distanceAlignment 用「预测 slash 激活时刻的距离」而非「当前距离」===
        // 物理假设：projectile 恒速直线飞行（与 reactive TTI 模型一致）
        // threat.velocity.x 有值（reactive 路径），fallback 到 threat.profile.speed 或 threat.speed（preemptive 路径合成的）
        const projectileSpeed = Math.abs(
            threat.velocity?.x ?? threat.profile?.speed ?? threat.speed ?? 6);
        const slashReach = slash.range?.maxReach ?? 0;
        // slash 激活时刻（commit + startupMs）projectile 飞了多远？
        const distTraveledByActive = projectileSpeed * (activeStart / 1000);
        // slash 激活时 projectile 到 AI 的距离
        const predictedDistAtActive = Math.max(0,
            threat.distanceToSelf - distTraveledByActive);

        // 同时也要考虑 projectile 到 slash 结束时刻可能已经飞得太近（fast projectile）
        // 用 active 窗口中间点来估算更保守
        const activeMidpointMs = (activeStart + activeEnd) / 2;
        const distTraveledByMid = projectileSpeed * (activeMidpointMs / 1000);
        const predictedDistAtMid = Math.max(0,
            threat.distanceToSelf - distTraveledByMid);

        // 取两者的较小值（最紧约束）
        const criticalDist = Math.min(predictedDistAtActive, predictedDistAtMid);

        let distanceAlignment;
        if (criticalDist <= slashReach) {
            distanceAlignment = 1.0;
        } else {
            // 每超 1m 线性衰减到 0
            distanceAlignment = Math.max(0, 1 - (criticalDist - slashReach) / 1.0);
        }

        let score = tun.cutBase;
        score *= timingAlignment;
        score *= distanceAlignment;
        score *= this.combatPosture.attackMultiplier;
        score *= (1 + tun.cutBoostBonus);

        return Math.max(0, Math.min(1, score));
    }

    /**
     * B5 Step 1: 根据 predictedOpponentEvents 生成 positioningPlan
     * 纯数据层 — 只计算阈值跨越可行性，不做任何评分消费（Step 2 才接入 #scorePositioning）
     *
     * 核心约束: AI moveSpeed=0.4 m/s，一个典型 opp startup 窗口（~380ms）内 AI 最多移动 ~0.15m
     * 可行性判断 = 距离差 / moveSpeed ≤ event.startMs / 1000
     *
     * 事件消费优先级：opp_attack_active_window > opp_throw_release
     * （同一个 tick 可能有多个 events，取最早的窗口，因为最早的事件最紧迫）
     *
     * @param {object} sit - 决策时刻 Situation 对象
     * @returns {object|null} plan - 如果有 events 则返回 plan，否则 null
     *   {
     *     recommend: "retreat" | "approach" | "hold",
     *     primaryEvent: Event,
     *     retreatViable: boolean,    // 退到安全阈值内是否赶得上
     *     approachViable: boolean,   // 压进目标阈值内是否赶得上
     *     holdViable: boolean,       // hold 是否在所有事件下都合理
     *     distance: number,
     *     moveSpeed: number,
     *     moveLimitMs: number,       // 窗口内可移动的距离上限（米）
     *   }
     */
    #buildPositioningPlan(sit) {
        const events = sit.predictedOpponentEvents;
        if (!events || events.length === 0) return null;

        const moveSpeed = this.kbProfile?.movement?.moveSpeed ?? 0.4;
        const distance = sit.distance;

        // 近战最远有效距离（和 #scorePositioning/#scoreThrow 同口径，计划 §5.3）
        const selfEffRange = this.#getMeleeMaxEffReach();

        // 安全余量: 阈值跨越后再留 15cm buffer
        const SAFETY_BUFFER = 0.15;

        // --- 优先处理 opp_attack_active_window（最常见、影响最直接）---
        const activeWindow = this.#findPredictedEvent(events, "opp_attack_active_window");
        if (activeWindow) {
            const startMs = activeWindow.startMs;
            const moveLimit = moveSpeed * (startMs / 1000);
            const oppReach = activeWindow.properties?.reach ?? 3.0;

            // 场景 A: 我在 opp reach 边缘内 → 退到 reach 外 + buffer
            // distToEscape = 我在 opp reach 内多少（正数=在 reach 内需要退）
            const oppReachInner = oppReach - distance;  // >0 表示我在 opp reach 里
            const distToEscape = oppReachInner + SAFETY_BUFFER;  // 退到 oppReach+SAFETY_BUFFER
            const retreatTimeMs = (distToEscape / moveSpeed) * 1000;
            const retreatViable = oppReachInner > 0 && distToEscape <= moveLimit && retreatTimeMs <= startMs;

            // 场景 B: 我在 PREEMPTIVE range 边缘外 → 压进 selfEffRange 内 - buffer
            // distToPreemptive = 我离 selfEffRange 还差多少（正数=还差需要压）
            const distToPreemptive = distance - (selfEffRange - SAFETY_BUFFER);
            const approachTimeMs = (Math.max(0, distToPreemptive) / moveSpeed) * 1000;
            const approachViable = distToPreemptive > 0 && distToPreemptive <= moveLimit && approachTimeMs <= startMs;

            // 推荐逻辑：两个都可行选收益更大的，都不可行则 hold
            let recommend = "hold";
            let holdViable = true;
            if (retreatViable && !approachViable) {
                recommend = "retreat";
                holdViable = false;  // retreat 可行时 hold 次优
            } else if (approachViable && !retreatViable) {
                recommend = "approach";
                holdViable = false;  // approach 可行时 hold 次优
            } else if (retreatViable && approachViable) {
                // 都可行：prefer approach（PREEMPTIVE 截断是更强的奖励）
                recommend = "approach";
                holdViable = false;
            }
            // 都不可行 → recommend=hold

            // Step 1 日志：只观测，先跑几轮验证数值
            if (this.debugVisible) {
                const _distInOppReach = oppReachInner > 0
                    ? `${oppReachInner.toFixed(2)}m内`
                    : `${(-oppReachInner).toFixed(2)}m外`;
                console.log(
                    `[AI-Diag] positioningPlan: moveSpeed=${moveSpeed.toFixed(2)} 窗口可移=${moveLimit.toFixed(3)}m ` +
                    `dist=${distance.toFixed(2)} selfEffR=${selfEffRange.toFixed(2)} oppReach=${oppReach.toFixed(2)} ` +
                    `oppReach内${_distInOppReach} ` +
                    `| retreat: 退${distToEscape.toFixed(2)}m/${retreatTimeMs.toFixed(0)}ms≤${startMs.toFixed(0)} → ${retreatViable ? "✅" : "❌"} ` +
                    `| approach: 压${Math.max(0, distToPreemptive).toFixed(2)}m/${approachTimeMs.toFixed(0)}ms≤${startMs.toFixed(0)} → ${approachViable ? "✅" : "❌"} ` +
                    `| recommend=${recommend}`
                );
            }

            return {
                recommend,
                primaryEvent: activeWindow,
                retreatViable,
                approachViable,
                holdViable,
                distance,
                moveSpeed,
                moveLimitMs: startMs,
                moveLimitDist: moveLimit,
                oppReach,
                selfEffRange,
                oppReachInner,
                distToPreemptive,
            };
        }

        // --- 处理 throw 事件链（opp_throw_release + opp_projectile_arrival_estimate）---
        // 目前只做 arrival 时刻的 cut 窗口预判
        const releaseEvent = this.#findPredictedEvent(events, "opp_throw_release");
        const arrivalEvent = this.#findPredictedEvent(events, "opp_projectile_arrival_estimate");
        if (releaseEvent && arrivalEvent) {
            const startMs = releaseEvent.startMs;  // release 窗口
            const moveLimit = moveSpeed * (startMs / 1000);
            const releaseTimeMs = (distance / moveSpeed) * 1000;
            const selfEffReachForCut = selfEffRange;  // cut projectile 也要够得着

            // 场景: 我能不能在 release 前压到 cut range 内
            const distToCutRange = distance - selfEffReachForCut;
            const approachViable = distToCutRange > 0
                && distToCutRange <= moveLimit
                && releaseTimeMs <= startMs;

            // retreat 对 projectile 没用（projectile 会飞过来）→ recommend hold
            const retreatViable = false;

            // 日志
            if (this.debugVisible) {
                console.log(
                    `[AI-Diag] positioningPlan: moveSpeed=${moveSpeed.toFixed(2)} 窗口可移=${moveLimit.toFixed(3)}m ` +
                    `dist=${distance.toFixed(2)} selfEffR=${selfEffReachForCut.toFixed(2)} ` +
                    `| throw_release 在 ${startMs.toFixed(0)}ms ` +
                    `| approach: 压${distToCutRange.toFixed(2)}m/${releaseTimeMs.toFixed(0)}ms≤${startMs.toFixed(0)} → ${approachViable ? "✅" : "❌"} ` +
                    `| recommend=${approachViable ? "approach" : "hold"}`
                );
            }

            return {
                recommend: approachViable ? "approach" : "hold",
                primaryEvent: releaseEvent,
                retreatViable,
                approachViable,
                holdViable: !approachViable,
                distance,
                moveSpeed,
                moveLimitMs: startMs,
                moveLimitDist: moveLimit,
                selfEffRange: selfEffReachForCut,
                distToPreemptive: Math.max(0, distToCutRange),
            };
        }

        return null;
    }

    /**
     * Phase 2: Positioning Utility — approach / hold / retreat 三候选正式评分
     *
     * 替代旧的硬编码 #executePositioning 阈值逻辑。
     * 放进和 attack/defense 同一个 pool 里选最高分。
     *
     * distanceHunger: 距离越远越想靠近（smoothstep 连续值，非硬门控）
     * 三个 positioning 动作乘入 Posture multiplier（advance/retreat）
     * hold 不乘 multiplier（是基线）
     */
    #scorePositioning(sit, posPlan = null) {
        const closestMinReach = this.#getClosestMinReach();
        // 近战最远有效距离：与 #scoreThrow 共用 #getMeleeMaxEffReach 唯一口径（计划 §5.3）
        const maxEffReach = this.#getMeleeMaxEffReach();
        const distance = sit.distance;

        // distanceHunger: distance 在 maxEffReach*1.5 ~ maxEffReach*3 之间 smoothstep 从 0→1
        const smoothstep = (x, e0, e1) => {
            if (e1 <= e0) return x <= e0 ? 0 : 1;
            const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
            return t * t * (3 - 2 * t);
        };
        const farThreshold = maxEffReach * 3;
        const nearFarZone = maxEffReach * 1.5;
        const distanceHunger = smoothstep(distance, nearFarZone, farThreshold);

        // Posture multiplier（Phase 1 已接线）
        const advMult = this.combatPosture.advanceMultiplier;
        const retMult = this.combatPosture.retreatMultiplier;

        // === Approach ===
        // 远距离才想靠近（distanceHunger smoothstep 加权）
        // 分数低于 attack.baseWeight(0.4)，让 attack 在范围内赢
        let approachScore = 0;
        if (distance > maxEffReach) {
            approachScore = 0.35 * Math.min(1, distanceHunger + 0.5);
        }
        // === Step 新增：throw_windup suppress ===
        // opp 在抬手准备投掷 + projectile 可被斩时，suppress approach
        // 原因：AI approach 会改变 release 时的距离，导致 reactive cut timing 窗口不稳定
        // 让 AI 保持距离原地等 reactive cut 窗口
        // Step 2b: 从统一 events 层查 arrivalEvent（存在即隐含 cuttable=true）
        const _hasCuttableThrow = this.#findPredictedEvent(
            sit.predictedOpponentEvents, "opp_projectile_arrival_estimate"
        ) != null;
        if (sit.opp?.phase === "throw_windup" && _hasCuttableThrow) {
            approachScore *= 0.1;  // 几乎归零，但不完全 0（避免 tie-break 问题）
        }
        // Phase 5: opp 普通 attack startup 也 suppress approach
        // 让 AI 原地 hold 住等 preemptive window，而不是往前冲错过时机
        // 条件：opp 有明确的 attack active window 事件（startup 中）
        const _oppInAttackStartup = sit.opp?.phase === "startup"
            && this.#findPredictedEvent(sit.predictedOpponentEvents, "opp_attack_active_window") != null;
        if (_oppInAttackStartup) {
            approachScore *= 0.1;
        }
        // 攻击圈内不需要 approach（hold/attack 应该赢）
        approachScore *= advMult;

        // === Hold ===
        // 攻击圈内保底（hold 住准备攻击）
        // 分数低于 attack.baseWeight(0.4)，让 attack 正常赢
        let holdScore = 0;
        if (distance > closestMinReach && distance <= maxEffReach) {
            holdScore = 0.15;
            // cooldown 中 → hold 加分（等攻击冷却）
            if (this.lastAttackTime !== null
                && sit.now - this.lastAttackTime < this.attackCooldownMs) {
                holdScore += 0.08;
            }
        }
        // === Step 新增：throw_windup hold 保底 ===
        // opp 在抬手准备投掷 + projectile 可被斩时，给 hold 一个小保底分
        // 让 AI 原地站住等 reactive cut 窗口，而不是 approach 改变距离
        // Step 2b: 复用上面的 _hasCuttableThrow（同一决策 tick 内不变）
        if (sit.opp?.phase === "throw_windup" && _hasCuttableThrow) {
            holdScore = Math.max(holdScore, 0.05);
        }
        // hold 不乘 Posture multiplier（是基线）

        // === Retreat ===
        // 太近必须退（closestMinReach）
        // oppThreat 高也想拉开
        let retreatScore = 0;
        if (distance <= closestMinReach + 0.3) {
            retreatScore = 0.5; // 底线：真太近必须退
        }
        const hasBoost = sit.selfMobility?.hasActiveBoost === true;
        const retreatThreatThreshold = hasBoost ? this.tuning.retreat.mobilityBoostThreat : this.tuning.retreat.normalThreat;
        if (sit.oppThreat > retreatThreatThreshold && distance <= maxEffReach) {
            retreatScore = Math.max(retreatScore, 0.3);
        }
        retreatScore *= retMult;

        // === B5 Step 2: positioningPlan 评分加成 ===
        // 在现有静态阈值全部算完之后微调，不覆盖原逻辑
        // events 为空时 posPlan=null → 完全跳过，零回归
        let _planBonusLog = "";
        if (posPlan) {
            const recommend = posPlan.recommend;
            const before = { ap: approachScore, hd: holdScore, rt: retreatScore };

            if (recommend === "retreat") {
                // opp reach 边缘内 → 主动避弹加分
                retreatScore += 0.15;
                holdScore = Math.max(0, holdScore - 0.05);
                _planBonusLog = `plan:retreat+0.15 hold-0.05`;
            } else if (recommend === "approach") {
                // PREEMPTIVE / cut 边缘外、赶得上 → 压线加分
                // 注意：这在上面的 approach×0.1 抑制之后，能覆盖掉抑制效果
                approachScore += 0.12;
                _planBonusLog = `plan:approach+0.12`;
            } else if (recommend === "hold") {
                // 两个阈值跨越都赶不上 → 明确 hold，approach 压饿
                holdScore += 0.08;
                approachScore *= 0.5;
                _planBonusLog = `plan:hold+0.08 approach×0.5`;
            }

            if (this.debugVisible && _planBonusLog) {
                const after = { ap: approachScore, hd: holdScore, rt: retreatScore };
                console.log(
                    `[AI-Diag] posPlanBonus: ${_planBonusLog} ` +
                    `before(a=${before.ap.toFixed(3)},h=${before.hd.toFixed(3)},r=${before.rt.toFixed(3)}) ` +
                    `→ after(a=${after.ap.toFixed(3)},h=${after.hd.toFixed(3)},r=${after.rt.toFixed(3)})`
                );
            }
        }

        // 加微小随机扰动打破 tie（和 attack/defense 一样）
        const jitter = (1 + (Math.random() - 0.5) * this.reactionVariance);
        return {
            kind: "approach",
            action: null,
            score: Math.max(0, approachScore) * jitter,
            holdScore: Math.max(0, holdScore) * jitter,
            retreatScore: Math.max(0, retreatScore) * jitter,
        };
    }

    /**
     * Throw 候选 Utility 评分（计划 §6）。
     * 与 attack/defense/positioning 同池竞争；不加任何「远距离优先投掷」硬编码分支。
     * 两类风险独立计分：A=release 前被近战打断；B=出手后被 slash 斩落（仅 cuttable）。
     * 分项写入 this._throwDiag 供诊断日志；返回分允许为负（候选池惯例，不 clamp）。
     */
    #scoreThrow(t, sit) {
        const tun = this.tuning.throw ?? {};
        const diag = {
            stateName: t.stateName,
            ammo: this.character.throwComponent ? this.character.throwComponent.ammo : null,
            can: 0,
            dist: sit.distance,
            rEff: t.flight?.effectiveRange ?? 0,
            rf: 0, riskA: 0, riskB: 0, idle: 0, recov: 0, cd: 0, rep: 0,
            // 统一偏好读取路径：实例注入 tuning.aiProfile 优先，StateGraph 共享 profile 兜底，缺省 1.0
            pref: this.tuning?.aiProfile?.throwPreference
                ?? this.character.stateGraph?.aiProfile?.throwPreference
                ?? 1.0,
            gate: null, score: 0,
        };
        this._throwDiag.push(diag);

        // ---- 硬门控 1：无 ThrowComponent / 无弹（双层合法性的决策层）----
        if (this.character.canThrow() !== true) {
            diag.gate = "no_throw_component";
            return 0;
        }
        diag.can = 1;

        // ---- 距离模型：R_eff 来自弹道物理射程（KB 扫描期算好，评分层只读不算）----
        const effectiveRange = t.flight?.effectiveRange ?? 0;
        const smooth = this.tuning.attack.distanceStartupSmooth ?? 0.3;
        const maxRange = effectiveRange * (1 + smooth);

        // ---- 硬门控 2：物理不可达 ----
        if (sit.distance > maxRange) {
            diag.gate = "out_of_range";
            return 0;
        }

        // ---- 距离三区间（rangeFactor，连续衰减非二元）；近战边界用唯一口径 ----
        const maxEffMeleeReach = this.#getMeleeMaxEffReach();
        let rangeFactor;
        if (sit.distance <= maxEffMeleeReach) {
            rangeFactor = tun.meleeZoneFactor ?? 0.35;   // 近战够得到，throw 留弹性不禁止
        } else if (sit.distance <= effectiveRange) {
            rangeFactor = 1.0;                            // 投掷甜点
        } else {
            // effectiveRange ~ effectiveRange×(1+smooth)：1→0 线性衰减
            rangeFactor = Math.max(0, 1 - (sit.distance - effectiveRange) / (maxRange - effectiveRange));
        }
        diag.rf = rangeFactor;

        let score = (tun.baseWeight ?? 0.35) * rangeFactor;
        const startupMs = t.timing?.startupMs ?? 0;

        // 对手近战最远有效距离（与 self 同构：maxReach + maxFwdBoost + rangeBuffer）
        const _oppReaches = (this.opponentKB?.attacks ?? []).map(a => {
            const r = a.range?.maxReach ?? 0;
            const disp = a.activeDisplacement ?? a.displacement ?? 0;
            return r + (disp < 0 ? -disp : 0);
        });
        const oppMaxEffReach = _oppReaches.length > 0 ? Math.max(..._oppReaches) + this.rangeBuffer : 0;
        const oppCanReachMe = sit.distance <= oppMaxEffReach;

        // ---- 风险 A：release 前被近战打断（独立项）----
        let riskA = 0;
        if (oppCanReachMe) {
            if (sit.opp.phase === "active") {
                // weaponbox 已在场且够得到 → 满额
                riskA = tun.interruptRiskPenalty ?? 0.25;
            } else if (sit.opp.phase === "startup") {
                // 优先消费预测事件的 active_window.startMs；startup 阶段必有事件，无事件不伪造
                const activeWindow = this.#findPredictedEvent(
                    sit.predictedOpponentEvents, "opp_attack_active_window"
                );
                if (activeWindow) {
                    const margin = tun.startupInterruptMarginMs ?? 50;
                    // startMs ≤ startupMs 满额；startupMs~startupMs+margin 之间线性降到 0
                    const f = Math.max(0, Math.min(1, (startupMs + margin - activeWindow.startMs) / margin));
                    riskA = f * (tun.interruptRiskPenalty ?? 0.25);
                }
            }
            // opp idle/none/recovery → 0；throw_windup → 0（对手无近战出手，其投掷物威胁由防御候选表达）
        }
        diag.riskA = riskA;
        score -= riskA;

        // ---- 风险 B：出手后被 slash 斩落（仅 cuttable；不可斩类型免 B 不免 A）----
        let riskB = 0;
        if (t.cuttable === true) {
            const slashAttacks = (this.opponentKB?.attacks ?? []).filter(a => a.trajectory === "slash");
            if (slashAttacks.length > 0) {
                const oppActiveSlash = sit.opp.phase === "active"
                    && sit.opp.attackProfile?.trajectory === "slash";
                let factor;
                if (oppActiveSlash) {
                    factor = 1.0;   // weaponbox 可能已在场
                } else {
                    // opp 反应线 = 最快 slash startup + 反应延迟；飞行时间占比即被斩可行性
                    const flightMs = sit.distance / Math.max(1e-6, t.speed ?? 6) * 1000;
                    const fastestSlashStartup = Math.min(...slashAttacks.map(s => s.timing?.startupMs ?? 0));
                    const cutReadyMs = fastestSlashStartup + (this.tuning.defense?.reflexMaxMs ?? 0);
                    factor = cutReadyMs > 0 ? Math.min(1, flightMs / cutReadyMs) : 0;
                }
                riskB = factor * (tun.cutRiskPenalty ?? 0.20);
            }
        }
        diag.riskB = riskB;
        score -= riskB;

        // ---- 相位/窗口加减项 ----
        let idleBonus = 0;
        if (sit.opp.phase === "none") {
            idleBonus = tun.idleOpportunityBonus ?? 0.05;  // 弱主动机会
        }
        // recovery 不凭相位加分：仅当预测事件证明「release+飞到时 opp 仍未恢复」才加分。
        // 当前预测层在 recovery 阶段不产事件（计划 §12 Backlog: recovery 精确剩余时间）→ v1 恒 0。
        const recoveryBonus = 0;
        // startup/active：无加分，仅承受风险 A
        diag.idle = idleBonus;
        diag.recov = recoveryBonus;
        score += idleBonus + recoveryBonus;

        // ---- 冷却：throw 独立节奏间隔（throw.cooldownMs，默认回退 attackCooldownMs）----
        // 共享 lastAttackTime：throw→throw 受长间隔约束形成「扔-推进」交替；attack→throw 同受约束
        // （近战连击优先）；throw→attack 不受影响（attack 仍读 500ms，投完可立刻贴脸近战）。
        // 不享 startup 豁免（对手 startup 时扔东西是风险动作，风险 A 另计）。
        let cdPenalty = 0;
        const throwCooldownMs = tun.cooldownMs ?? this.attackCooldownMs;
        if (sit.now - this.lastAttackTime < throwCooldownMs) {
            cdPenalty = this.tuning.attack.cooldownPenalty ?? 0.5;
            score -= cdPenalty;
        }
        diag.cd = cdPenalty;

        // ---- 重复成本（复用 #consecutiveAttackUsage，key=throw stateName）----
        const usageCount = (this.#consecutiveAttackUsage?.stateName === t.stateName)
            ? this.#consecutiveAttackUsage.count
            : 0;
        let repetitionCost = 0;
        if (usageCount >= 2) {
            const rcRate = tun.repetitionCostRate ?? this.tuning.attack.repetitionCostRate ?? 0.06;
            const rcMax = tun.repetitionCostMax ?? this.tuning.attack.repetitionCostMax ?? 0.18;
            repetitionCost = Math.min(rcMax, rcRate * (usageCount - 1));
            score -= repetitionCost;
        }
        diag.rep = repetitionCost;

        // ---- 终分：进攻行为乘 posture.attackMultiplier；throwPreference 直读 stateGraph（方案 a）----
        score *= this.combatPosture.attackMultiplier;
        score *= diag.pref;
        score *= (1 + (Math.random() - 0.5) * this.reactionVariance);  // tie-break 扰动

        diag.score = score;
        return score;
    }

    /**
     * 执行 committed action
     * Phase 0: 同时记录 COMMIT 到 CombatMemory
     * Phase 2: positioning kind（approach/hold/retreat）只设 moveIntent，不 queueCommand
     */
    #executeCommitted({ kind, action }) {
        this.currentBehavior = kind;

        // Phase 2: Positioning 三候选 — 只设 moveIntent，没有 stateName 可 queue
        if (kind === "approach" || kind === "hold" || kind === "retreat") {
            if (kind === "approach") {
                this.setMoveIntent({ x: -1, y: 0 });  // AI 在右，向左=靠近对手
            } else if (kind === "retreat") {
                this.setMoveIntent({ x: 1, y: 0 });   // 向右=远离对手
            } else {
                this.setMoveIntent({ x: 0, y: 0 });   // hold
            }
            // Phase 0: 记录 COMMIT（positioning 也算一次 commit）
            this.combatMemory.pushCommit(kind, kind);
            // positioning 打断连续 attack
            this.#consecutiveAttackUsage = null;
            return;
        }

        // Attack / Defense — 原逻辑
        this.setMoveIntent({ x: 0, y: 0 });
        this.queueCommand(action.stateName);

        // Phase 0: 记录 COMMIT
        this.combatMemory.pushCommit(kind, action.stateName);

        if (kind === "attack" || kind === "throw") {
            // 近战↔投掷共享冷却（计划 §2.7）
            this.lastAttackTime = performance.now();
            // Repetition Cost：key=stateName，throw→throw 计成本，throw→近战 key 不同自然切换
            if (this.#consecutiveAttackUsage?.stateName === action.stateName) {
                this.#consecutiveAttackUsage.count++;
            } else {
                this.#consecutiveAttackUsage = { stateName: action.stateName, count: 1 };
            }
        } else {
            // dodge / guard 打断连续 attack/throw → reset（positioning 在上方提前 return 处 reset）
            this.#consecutiveAttackUsage = null;
        }
    }

    /**
     * Phase 0: debug log — 每 decision tick 输出 Memory + Posture 状态
     * 验证 Posture 对事件响应合理后，Phase 1 再接入 Utility
     */
    #logPhase0Status(sit) {
        if (!this.debugVisible) return;
        if (!this.combatMemory || !this.combatPosture) return;

        const mem = this.combatMemory.stats;
        const cur = this.combatPosture.current;
        const tgt = this.combatPosture.target;
        const oppIdleSec = (sit?.oppIdleMs ?? 0) / 1000;

        console.log(
            `[Phase0] oppIdleMs=${(oppIdleSec).toFixed(1)}s ` +
            `oppPhase=${sit?.opp?.phase ?? "?"} oppVuln=${(sit?.oppVulnerable ?? 0).toFixed(2)} | ` +
            `Mem: pressure=${mem.pressure} consecMiss=${mem.consecutiveMisses} outCnt=${mem.outcomesCount} | ` +
            `Posture: cur={att=${cur.attackMultiplier},def=${cur.defenseMultiplier},adv=${cur.advanceMultiplier},ret=${cur.retreatMultiplier}} ` +
            `tgt={att=${tgt.attackMultiplier},def=${tgt.defenseMultiplier},adv=${tgt.advanceMultiplier},ret=${tgt.retreatMultiplier}} ` +
            `→ ${cur.label}`
        );
    }

    // ==================== 距离辅助 ====================

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
     * 近战最远有效距离 — positioning / buildPositioningPlan / #scoreThrow 的唯一口径。
     * = 所有 attack 最大 maxReach + 最大前冲位移 boost + rangeBuffer。
     * 禁止 throw 等其它评分自造第二份近战边界（计划 §5.3）。
     */
    #getMeleeMaxEffReach() {
        const maxFwdBoost = Math.max(0, ...(this.kbProfile?.attacks || []).map(a => {
            const disp = a.activeDisplacement ?? a.displacement ?? 0;
            return disp < 0 ? -disp : 0;
        }));
        return this.#getMaxReach() + maxFwdBoost + this.rangeBuffer;
    }

    /**
     * 获取最宽松的贴脸无效区（所有 attack 中最小的 minReach）
     * 语义：distance < 此值时，**没有任何一招**能打到（全部被 weaponbox gap 挡住）
     * 用于 positioning 的 close-range retreat 阈值。
     *
     * 与旧 #getMinReach() 的区别：
     *   旧 #getMinReach() = min(所有 attack 的 maxReach) — 取的是最短那招的最大射程
     *     → 错误地把"最短 maxReach"当成了"太近阈值"，在 distance=1.5 时
     *       swing(minReach=1.38) 和 dash(minReach=0.66) 都能打到，
     *       但 positioning 却让 AI retreat，完全反效果。
     *   新 #getClosestMinReach() = min(所有 attack 的 minReach) — 取的是最贴脸的 weaponbox gap
     *     → 只在真正"哪招都打不到"时才触发 retreat。
     */
    #getClosestMinReach() {
        if (!this.kbProfile || !this.kbProfile.attacks) {
            return 0;
        }
        let closest = Infinity;
        for (const attack of this.kbProfile.attacks) {
            const mr = attack.range?.minReach ?? 0;
            if (mr < closest) closest = mr;
        }
        return closest === Infinity ? 0 : closest;
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
        const closestMinReach = this.#getClosestMinReach();

        // 三个圈的半径（Step 1 后同步：蓝圈 = positioning hold 上边界 = maxReach + rangeBuffer）
        const radii = [
            maxReach + this.rangeBuffer,  // 蓝圈：远距离边界（approach/hold 分界）
            maxReach,                     // 绿圈：最大攻击范围
            closestMinReach               // 红圈：真正的贴脸无效区（< 此距离哪招都打不到）
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
