import { BaseController } from "../BaseController.js";
import { AIKnowledgeRegistry } from "./AIKnowledgeRegistry.js";
import { ContactResolver } from "../ContactResolver.js";
import { AITuning } from "../../../Data/AITuning.js";
import { CombatTuning } from "../../../Data/CombatTuning.js";
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
    #holdCommitStart;          // 首次连续 commit hold 时的 timestamp（ms），非 hold commit 时重置
    #disengageUntilTs;         // 失败驱动脱离锁存到期时间（ms）；0 = 未激活
    #disengageLine;            // 脱离锁存期间的退离目标线（触发时冻结）
    #attackFailBudget;         // Map<stateName, 自上轮脱离预算清零以来的失败次数>（Step 4c 触发依据）

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

        // D8/Step 2.2: fatigueAwareness 疲劳感知 knob（场景 entityDef.aiProfile；缺省 1.0 = 全感知档）
        this.fatigueAwareness = this.tuning.aiProfile?.fatigueAwareness ?? 1.0;
        this._fatigueGateActive = false;      // 本决策 tick 的统一疲劳周期结果（感知层：在管与否）
        this._fatigueGuardSuppressed = false; // guard 物理风险线压制（周期在管 且 耐力 < guard 消耗）
        this._fatigueCycleLatchUntil = 0;     // 疲劳意识周期锁存到期时间（ms），0 = 未激活
        this._fatigueAttackGateLogUntil = 0;  // 26.11.9 Step 2：攻击耐力门影子日志节流（ms）

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

        // Hold 超时计时：hold commit 起始时间戳（null = 当前不在 hold 中）
        this.#holdCommitStart = null;

        // 失败驱动脱离（26.11.2 Step 4c）
        this.#disengageUntilTs = 0;
        this.#disengageLine = 0;
        this.#attackFailBudget = new Map();

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
        // [AI-Diag] 命中事件观测（26.11.2 Step 1c）：决策侧日志没有命中事件，
        // 无法回答"AI 在什么距离被连续命中"。CombatSystem 在命中解析时刻回调，
        // 此刻距离 ≈ 命中距离。defender 视角 = 我被打，attacker 视角 = 我打中。
        this.#logCombatOutcomeDiag(outcome, targetState, perspective, counteredBy);
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

        // === 26.11.2 Step 4c: 失败驱动脱离的尝试预算 ===
        // attacker 视角的失败（miss/parried/guard_blocked/interrupted）计 1 次，
        // 单招命中（attack:hit）清零该招预算——"试过但成了"重新计数。
        // 触发条件与预算消耗见 #scorePositioning 的 disengage 块。
        if ((mapped === "attack:miss" || mapped === "attack:parried") && targetState) {
            this.#attackFailBudget.set(targetState, (this.#attackFailBudget.get(targetState) ?? 0) + 1);
        } else if (mapped === "attack:hit" && targetState) {
            this.#attackFailBudget.delete(targetState);
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

    /**
     * [AI-Diag] 命中/防住事件日志（26.11.2 Step 1c 观测补强）
     * 记录：视角、outcome、双方当前状态、命中距离、对手攻击相位。
     * 用途：验证可达性门边界（"特定距离连续命中"问题的定位数据）。
     */
    #logCombatOutcomeDiag(outcome, targetState, perspective, counteredBy) {
        if (!this.debugVisible) return;
        const self = this.character;
        const opp = this.opponent;
        if (!self || !opp) return;
        const distance = this.#getDistanceToOpponent();
        const oppState = opp.currentStateName;
        const oppDef = opp.currentStateDef;
        let oppAtkTag = "none";
        if (oppDef?.attackActive === true && this.opponentKB) {
            const ap = this.opponentKB.attacks.find(a => a.stateName === oppState);
            if (ap) {
                oppAtkTag = `${ap.stateName}/${this.#getAttackPhase(ap, opp.animation?.normalizedTime ?? 0)}`;
            }
        }
        console.log(
            `[AI-Diag] COMBAT: view=${perspective ?? "attacker"} outcome=${outcome} state=${targetState ?? "?"}` +
            `${counteredBy ? ` by=${counteredBy}` : ""} dist=${distance.toFixed(2)}` +
            ` selfState=${self.currentStateName ?? "?"} oppState=${oppState ?? "?"} oppAtk=${oppAtkTag}` +
            ` stamina=${(self.stamina ?? 0).toFixed(0)}/${self.combat?.maxStamina ?? 100} fatigueCycle=${this._fatigueGateActive ? "on" : "off"}`
        );
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

        // D8/Step 5: 统一疲劳意识周期（R1）——每决策 tick 更新一次，guard 压制与攻击过滤共享同一周期
        this.#updateFatigueCycle();

        const sit = this.#buildSituation();

        const scored = [];

        // Attack / Defense 候选
        for (const atk of this.kbProfile?.attacks || []) {
            const _atkScore = this.#scoreAttack(atk, sit);
            // 26.11.9 Step 4：#scoreAttack 侧信道带出最终化机会分量（D4/R4：机会分量 > 0 ⇔ 资格通过）
            scored.push({ kind: "attack", action: atk, score: _atkScore, fatigueOpportunity: this._lastAttackOpportunity });
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
                    s => {
                        const _eff = this.#getEffectiveTiming(s.timing, this.character);
                        return _eff.startupMs + _eff.activeMs;
                    }));
                const _canPreemptive = arrivalEvent.startMs <= bestActiveEnd;
                const flightMs = arrivalEvent.startMs - releaseEvent.startMs;

                if (this.debugVisible) {
                    const relRemaining = releaseEvent.startMs;
                    const speedForErr = sit.opp?.throwProfile?.speed ?? 6;
                    const distErr = (relRemaining / 1000) * speedForErr;
                    console.log(
                        `[AI-Diag] preemptive_gate: predictedTTI=${arrivalEvent.startMs.toFixed(0)}ms ` +
                        `bestActiveEnd=${bestActiveEnd}ms ` +
                        `flightMs=${flightMs.toFixed(0)}ms ` +
                        `releaseRemaining=${relRemaining.toFixed(0)}ms ` +
                        `distErr≈${distErr.toFixed(2)}m ` +
                        `(scoreCut 未扣 releaseRemaining 飞行距离 → alignment 虚高) → ` +
                        `${_canPreemptive ? "VIABLE" : "SKIP (tti>activeEnd, projectile arrives after weaponbox ends)"}`
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

        // === 26.11.9 攻击耐力计划 Step 2：Fatigue Attack Eligibility Gate（影子模式，不过滤）===
        // D1：位于全部候选生成与评分之后、排序 / committedScoreThreshold 仲裁之前
        this.#applyFatigueAttackGate(scored);

        // 排序（#scoreAttack/#scoreDefense 已有各自 jitter，positioning 内部也有 jitter）
        scored.sort((a, b) => b.score - a.score);

        // === 26.11.2 Step 2: committedScoreThreshold 仲裁（计划 §4）===
        // committed action（attack/dodge/guard/throw）需 score ≥ 阈值才留在候选池；
        // positioning（approach/hold/retreat）有自己的距离门控，不受阈值约束。
        // 根治"评分全零塌缩 → 0 分 dodge 靠候选遍历顺序平局获胜"（失败 N 次出一次 dodge 的根因）：
        // 无达标 committed 候选时不提交战斗动作，宁可原地待机——玩家看到的每个
        // dodge/guard 都对应真实评分动机。
        // 有效阈值按角色攻击量纲归一化（26.11.2 Step 4 复测修正）：
        // committedScoreThreshold(0.15) 是按系统默认 baseWeight(0.4) 的分数量纲定的。
        // 防御偏好型人格（manatarms：attack.baseWeight=0.10、baseAggression=0.25）
        // 攻击分天花板 ≈0.09，绝对阈值使其攻击候选池结构性为空 → 无限 hold
        // （与 26.10.25 归档计划"防御偏好型人物无限 hold"同病灶，被 Step 2 重新引出）。
        // 有效阈值 = 全局阈值 × (角色 baseWeight / 系统默认)，钳制 [0.25, 1.5]：
        // manatarms → 0.0375（0.085 的 quart 通过），rabble 等默认量纲角色不变；
        // 阈值恒 >0，0.000 平局/负分候选仍被稳定过滤（Step 2 的原始目标不回退）。
        const _baseWeightScale =
            (this.tuning.attack?.baseWeight ?? AITuning.attack.baseWeight) / (AITuning.attack.baseWeight || 0.4);
        const commitThreshold = (this.tuning.committedScoreThreshold ?? 0.15)
            * Math.min(1.5, Math.max(0.25, _baseWeightScale));
        const isPositioningKind = (k) => k === "approach" || k === "hold" || k === "retreat";
        const arbitrated = scored.filter(
            (s) => isPositioningKind(s.kind) || s.score >= commitThreshold
        );
        const best = arbitrated[0] ?? null;
        if (this.debugVisible && arbitrated.length !== scored.length) {
            const filteredLabel = scored
                .filter((s) => !arbitrated.includes(s))
                .map((s) => `${s.kind}:${s.action?.stateName ?? "?"}=${s.score.toFixed(3)}`)
                .join(" | ");
            console.log(
                `[AI-Diag] commitArbitration: threshold=${commitThreshold} ` +
                `filtered=[${filteredLabel}] → ` +
                `best=${best ? `${best.kind}:${best.action?.stateName ?? "(pos)"}(${best.score.toFixed(3)})` : "none"}`
            );
        }

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
                // 26.11.2 Step 4A：诊断副本同步近距侧衰减口径（否则 rf 显示与实际 sc 不符）
                {
                    const minR = r?.minReach ?? 0;
                    const span = effR - minR;
                    if (sit.distance < effR && span > 0.01) {
                        const nearFloor = this.tuning.attack.nearDecayFloor ?? 0.5;
                        const t = Math.max(0, Math.min(1, (sit.distance - minR) / span));
                        rf *= nearFloor + (1 - nearFloor) * t;
                    }
                }
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

        // 执行最高分（26.11.2 Step 2：committed 候选已经过阈值仲裁，positioning 候选
        // 有自己的距离门控；无达标候选 → 原地待机，不强制提交战斗动作）
        if (best && best.score > 0) {
            this.#executeCommitted(best);
        } else {
            // 全零塌缩或 committed 全被仲裁过滤 → 原地待机（不 fallback 到 hold 候选：
            // hold 自己可能已被清零，见计划 §4 对 v1 写法的否决）
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

        // 被动守卫识别：Manatarms 等有 config 级 guardType 但无原生 guard 状态的角色
        const passiveGuardProfile = (this.kbProfile?.guards || []).find(g => g.passive === true);
        const selfGuardType = passiveGuardProfile?.guardType ?? null;

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
            selfGuardType,
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
     * 疲劳计划 Step 2.1: base timing × 目标角色当前疲劳倍率
     * 所有绝对 ms 消费点（预测事件 / dodge 资格门 / 自招窗口）统一经此换算，
     * 保证"动画实际变慢"与"AI 预测窗口"同一口径。攻击状态内耐力不变，
     * 实时 staminaRatio 即 commit 时刻倍率；startup/total 同乘 slowdown 保持减法公式自洽
     */
    #getEffectiveTiming(timing, char) {
        if (!timing) return timing;
        const slow = char?.staminaSlowdown ?? 1.0;
        if (slow === 1.0) return timing;
        const scale = (v) => (typeof v === "number" ? v * slow : v);
        return {
            ...timing,
            startupMs: scale(timing.startupMs),
            activeMs: scale(timing.activeMs),
            recoveryMs: scale(timing.recoveryMs),
            totalMs: scale(timing.totalMs),
        };
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
            const timing = this.#getEffectiveTiming(oppAttackProfile.timing, this.opponent);
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
            const timing = this.#getEffectiveTiming(oppThrowProfile.timing, this.opponent);
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
        // 26.11.9 Step 4：机会分量侧信道（每调用重置，防早退路径残留上一候选的值）
        this._lastAttackOpportunity = null;
        const range = attack.range?.maxReach ?? 0;
        const timing = this.#getEffectiveTiming(attack.timing, this.character);

        // frameSpeeds 位移加成：activeDisplacement 是 weaponbox 实际覆盖期间的位移（负=向对手前冲）
        // 用 activeDisplacement 而不是全动画 displacement，避免 dash 这类 weaponbox 只在短窗口存在的动作
        // 被高估可达距离（dash 全位移 ~3.8 但 weaponbox 只覆盖 ~1.7 的位移）
        const effectiveDisplacement = attack.activeDisplacement ?? attack.displacement ?? 0;
        const fwdBoost = effectiveDisplacement < 0 ? -effectiveDisplacement : 0;
        const effectiveRange = range + fwdBoost + this.rangeBuffer;

        // ---- 太近打不到：minReach 门控 ----
        const minReach = attack.range?.minReach ?? 0;
        if (sit.distance < minReach) return 0; // weaponbox gap 覆盖不到对手

        // === Clash Seeker 前置数据：oppAtkWindow（提前到距离门槛之前，供资格检查用）===
        // 原位置 Line 1024（preemptive bonus 处），现提前到这里
        const oppAtkWindow = this.#findPredictedEvent(
            sit.predictedOpponentEvents, "opp_attack_active_window"
        );

        // ---- Phase 2: Continuous Range Utility ----
        // 硬门控改平滑衰减：距离在 effectiveRange ~ effectiveRange × (1 + rangeSmoothWindow) 之间
        // 线性衰减到 0，让 reach 稍小但有其他优势（startup 快、trajectory 好）的攻击不被直接挡掉
        const rangeSmoothWindow = this.tuning.attack.distanceStartupSmooth ?? 0.3;
        const maxRange = effectiveRange * (1 + rangeSmoothWindow);
        let rangeFactor = 1.0;
        if (sit.distance > effectiveRange && sit.distance < maxRange) {
            rangeFactor = Math.max(0, 1 - (sit.distance - effectiveRange) / (maxRange - effectiveRange));
        }
        // === 26.11.2 Step 4A: 近距侧衰减（锚定单招自己的射程带）===
        // 远端已有 rangeFactor 衰减（effectiveRange ~ ×1.3），近端原本恒 1.0
        // → 近距带攻击欲望无制衡、AI 基本不后退（计划 §2）。
        // 以该招自己的 [minReach, effectiveRange] 为参照：distance 从 effectiveRange
        // 收缩到 minReach 时衰减到 nearDecayFloor——长招先于短招感受贴脸劣势，
        // 短招在自己的舒适带不受罚（v2 采纳 GPT 的招式个体锚点方案）。
        // 与 retreat 中间档（Step 4B）成对生效。
        const rangeSpan = effectiveRange - minReach;
        if (sit.distance < effectiveRange && rangeSpan > 0.01) {
            const nearFloor = this.tuning.attack.nearDecayFloor ?? 0.5;
            const t = Math.max(0, Math.min(1, (sit.distance - minReach) / rangeSpan));
            rangeFactor *= nearFloor + (1 - nearFloor) * t;
        }
        let clashEligible = false;
        if (sit.distance > maxRange) {
            // === Clash Seeker 6 项资格检查 ===
            // 资格独立于普通距离门：overlap + reachSum + weightMatch + knob 全满足才放行
            clashEligible = this.#checkClashSeekerEligible(attack, sit, oppAtkWindow);

            if (this.debugVisible) {
                const clashSeekerWeight = this.tuning.aiProfile?.clashSeekerWeight ?? 0;
                const oppPhase = sit.opp?.phase;
                const oppPhaseOk = oppPhase === "startup";
                const oppHasProfile = oppAtkWindow != null;

                let timingOk = false;
                let overlapStart = 0, overlapEnd = 0;
                if (oppHasProfile && timing) {
                    const myStartupMs = timing.startupMs ?? 0;
                    const myActiveMs = timing.activeMs ?? 0;
                    const myActiveStart = myStartupMs;
                    const myActiveEnd = myStartupMs + myActiveMs;
                    const oppTimeUntilActive = oppAtkWindow.startMs;
                    const oppActiveMs = oppAtkWindow.properties?.activeDurationMs ?? 0;
                    const oppActiveStart = oppTimeUntilActive;
                    const oppActiveEnd = oppTimeUntilActive + oppActiveMs;
                    overlapStart = Math.max(myActiveStart, oppActiveStart);
                    overlapEnd = Math.min(myActiveEnd, oppActiveEnd);
                    timingOk = overlapStart <= overlapEnd;
                }

                const oppReach = oppAtkWindow?.properties?.reach ?? 0;
                const myEffR = effectiveRange;
                const reachSum = myEffR + oppReach;
                const reachSumOk = reachSum >= sit.distance;

                const knobOk = clashSeekerWeight > 0;

                // ⑥ weight matchup
                const myWeight = attack.weight;
                const oppWeight = oppAtkWindow?.properties?.weight ?? null;
                const weightRank = { light: 0, heavy: 1 };
                const weightOk = myWeight && oppWeight
                    ? (weightRank[myWeight] ?? 0) >= (weightRank[oppWeight] ?? 0)
                    : true; // null weight（如 dash）视为中性，不额外限制

                console.log(
                    `[AI-Diag] clashSeekCheck ${attack.stateName}(w=${myWeight}) oppPhase=${oppPhase}`
                );
                console.log(`  ① oppPhaseValid=${oppPhaseOk}`);
                console.log(`  ② oppHasProfile=${oppHasProfile}`);
                console.log(`  ③ timingOk=${timingOk} (overlap=[${overlapStart.toFixed(0)}, ${overlapEnd.toFixed(0)}]ms)`);
                console.log(`  ④ reachSumOk=${reachSumOk} (${myEffR.toFixed(2)}+${oppReach.toFixed(2)}=${reachSum.toFixed(2)} ≥ ${sit.distance.toFixed(2)})`);
                console.log(`  ⑤ knobOk=${knobOk} (clashSeekerWeight=${clashSeekerWeight})`);
                console.log(`  ⑥ weightOk=${weightOk} (my=${myWeight} vs opp=${oppWeight})`);
                console.log(`  → allClashEligible=${clashEligible}`);
            }

            if (!clashEligible) return 0;
            // clash 合格 → 放行，rangeFactor 保持 1.0，继续往下走
        }

        let score = this.tuning.attack.baseWeight; // base: 距离可达就有基础分
        const baseScore = score;

        // === Step B: 意图分项诊断 ===
        // 记录每个分项归属，最后输出 breakdown 日志
        // 归属规则（来自 Step A 审计）：
        //   common: 所有基础/风险/历史类分项，不区分意图
        //   preemptive: events.startup 时的抢先加分（唯一的 PREEMPTIVE 入口）
        //   punish: opp.recovery 时 vulnReward 的主要贡献
        let _breakdown = { common: score, preemptive: 0, punish: 0, clashSeeker: 0 };

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
            // 被动守卫减免：self 有 shield 且对手当前攻击能被挡 → threat 只算 10%
            let effectiveThreat = sit.oppThreat;
            if (sit.selfGuardType && sit.opp.attackProfile) {
                const canBlock = ContactResolver.evaluateInteraction({
                    offenseTrajectory: sit.opp.attackProfile.trajectory,
                    offenseWeight: sit.opp.attackProfile.weight,
                    defenseGuardType: sit.selfGuardType,
                    defenseIsDodging: false,
                }).blocked;
                if (canBlock) effectiveThreat *= 0.1;
            }
            threatPenaltyApplied = effectiveThreat * this.tuning.attack.threatPenalty;
            score -= threatPenaltyApplied;
            _breakdown.common -= threatPenaltyApplied;
        }

        // Phase 5 Step 3a: preemptive bonus 迁移到 events 层
        // 旧逻辑 bug: 用 sit.opp.remainingMs（整个 state 剩余时间）→ 比真正 timeUntilActive 大得多
        // 新逻辑: 从 events 查 opp_attack_active_window.startMs（精确的距 opp weaponbox 激活还剩多久）
        // oppAtkWindow 已在函数开头提前声明（供 clash seeker 资格检查用）
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
                if (this.debugVisible) {
                    console.log(
                        `[AI-Diag] PREEMPTIVE: attack=${attack.stateName} preempts ${oppAtkWindow.sourceState} ` +
                        `(myStartup=${myStartupMs}ms < oppTimeUntilActive=${oppTimeUntilActive.toFixed(0)}ms, ` +
                        `oppTrajectory=${oppTrajectory ?? "?"}, mult=${preemptiveMult}, bonus=+${bonus.toFixed(2)})`
                    );
                }
            }
        }

        // === Clash Seeker Bonus（主动寻求武器碰撞）===
        // 与 preemptive bonus 同级的 attack 分项，不冲突独立计算
        // 只有 opp.startup + overlap + reachSum + weightMatch + knob 全满足才给分
        if (oppAtkWindow && oppAtkWindow.startMs !== undefined) {
            const clashSeekerWeight = this.tuning.aiProfile?.clashSeekerWeight ?? 0;
            if (clashSeekerWeight > 0) {
                const bonus = this.#computeClashSeekerBonus(attack, sit, oppAtkWindow);
                if (bonus > 0) {
                    const finalBonus = bonus * clashSeekerWeight;
                    score += finalBonus;
                    _breakdown.clashSeeker += finalBonus;

                    if (this.debugVisible) {
                        console.log(
                            `[AI-Diag] CLASH_SEEKER: attack=${attack.stateName} vs opp=${oppAtkWindow.sourceState} ` +
                            `(bonus=${bonus.toFixed(2)} × knob=${clashSeekerWeight} = +${finalBonus.toFixed(2)})`
                        );
                    }
                }
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
        score = _breakdown.common + _breakdown.preemptive + _breakdown.punish + _breakdown.clashSeeker;

        // 26.11.9 Step 4：意图权重后、乘性阶段前的机会分量快照（Gate 放行判据）
        this._lastAttackOpportunity = {
            preemptive: _breakdown.preemptive,
            punish: _breakdown.punish,
            clashSeeker: _breakdown.clashSeeker,
        };

        // ---- Phase 3: Startup Utility ----
        const startupFactor = this.#computeStartupFactor(attack, sit);
        score *= startupFactor;

        // === Step B FINAL: 输出意图分项 breakdown ===
        // 放在所有加法完成后（还没乘 rangeFactor/postureMult）
        // 只在有非 common 分项时输出（避免刷屏）
        const _hasNonCommon = _breakdown.preemptive > 0 || _breakdown.punish > 0 || _breakdown.clashSeeker > 0;
        if (this.debugVisible && _hasNonCommon) {
            const _total = _breakdown.common + _breakdown.preemptive + _breakdown.punish + _breakdown.clashSeeker;
            console.log(
                `[AI-Diag] attackBreakdown(${attack.stateName}): ` +
                `common=${_breakdown.common.toFixed(2)}` +
                `${_breakdown.preemptive > 0 ? ` +PREEMPTIVE=${_breakdown.preemptive.toFixed(2)}` : ``}` +
                `${_breakdown.punish > 0 ? ` +PUNISH=${_breakdown.punish.toFixed(2)}` : ``}` +
                `${_breakdown.clashSeeker > 0 ? ` +CLASH_SEEK=${_breakdown.clashSeeker.toFixed(2)}` : ``}` +
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
     * Clash Seeker 6 项资格检查（独立函数，给硬门槛绕过 + bonus 计算共用）
     *
     * 返回 true 当且仅当以下全部满足：
     *   ① opp.phase === "startup"
     *   ② oppAtkWindow 存在（opp 有明确 attack profile）
     *   ③ overlap 时序（双方 weaponbox active 窗口有交集）
     *   ④ reachSum 空间（myEffR + oppReach ≥ distance）
     *   ⑤ clashSeekerWeight > 0
     *   ⑥ weight matchup（myWeight ≥ oppWeight，拼刀不输）
     *
     * @param {object} attack - 攻击候选 profile
     * @param {object} sit - 决策时刻 Situation
     * @param {object|null} oppAtkWindow - opp_attack_active_window 事件
     * @returns {boolean}
     */
    #checkClashSeekerEligible(attack, sit, oppAtkWindow) {
        // ① opp 正在起手
        if (sit.opp?.phase !== "startup") return false;

        // ② opp 有明确 attack profile
        if (!oppAtkWindow) return false;

        // ⑤ aggressiveness knob（提前检查，避免后续无谓计算）
        const clashSeekerWeight = this.tuning.aiProfile?.clashSeekerWeight ?? 0;
        if (clashSeekerWeight <= 0) return false;

        const timing = this.#getEffectiveTiming(attack.timing, this.character);
        if (!timing) return false;

        // ③ overlap 时序（区间重叠，非单端检查；双方均为真实 ms 口径）
        const myStartupMs = timing.startupMs ?? 0;
        const myActiveMs = timing.activeMs ?? 0;
        const myActiveStart = myStartupMs;
        const myActiveEnd = myStartupMs + myActiveMs;
        const oppTimeUntilActive = oppAtkWindow.startMs;
        const oppActiveMs = oppAtkWindow.properties?.activeDurationMs ?? 0;
        const oppActiveStart = oppTimeUntilActive;
        const oppActiveEnd = oppTimeUntilActive + oppActiveMs;
        const overlapStart = Math.max(myActiveStart, oppActiveStart);
        const overlapEnd = Math.min(myActiveEnd, oppActiveEnd);
        if (overlapStart > overlapEnd) return false; // 无重叠窗口

        // ④ reachSum 空间
        // 先做空值保护再取负值，避免一元负号与 ?? 的优先级 NaN bug
        const disp = attack.activeDisplacement ?? 0;
        const myEffR = (attack.range?.maxReach ?? 0) + (disp < 0 ? -disp : 0) + this.rangeBuffer;
        const oppReach = oppAtkWindow.properties?.reach ?? 0;
        if (myEffR + oppReach < sit.distance) return false;

        // ⑥ weight matchup：myWeight >= oppWeight（拼刀只能赢或平局，不能输）
        // weight 不存在时视为中性（null weight 如 dash，不额外限制）
        const myWeight = attack.weight;
        const oppWeight = oppAtkWindow.properties?.weight ?? null;
        if (myWeight && oppWeight) {
            const weightRank = { light: 0, heavy: 1 };
            if ((weightRank[myWeight] ?? 0) < (weightRank[oppWeight] ?? 0)) return false;
        }

        return true;
    }

    /**
     * Clash Seeker Bonus 计算（资格检查之外的评分部分）
     *
     * 基础分 baseBonus，乘两个调节器：
     *   timingAlign — myActiveStart 越接近 oppActiveStart，越高（0.3~1.0）
     *   urgencyMult — opp 攻击能被自己挡（有 shield）→ 0.5；挡不住 → 1.0
     *
     * @returns {number} bonus 值（0 或正数，无副作用）
     */
    #computeClashSeekerBonus(attack, sit, oppAtkWindow) {
        // 资格检查（冗余但安全，确保单独调用时不会越界）
        if (!this.#checkClashSeekerEligible(attack, sit, oppAtkWindow)) return 0;

        const timing = this.#getEffectiveTiming(attack.timing, this.character);
        const oppTimeUntilActive = oppAtkWindow.startMs;

        // baseBonus
        let bonus = this.tuning.attack.clashSeeker?.baseBonus ?? 0.25;

        // timingAlign：我 active 起点越接近对手 active 起点（在对手 active 之前），越高
        // timingDiff 越小（我越早启动 vs opp 启动），越能在 overlap 区间靠前
        const timingDiff = Math.abs((timing.startupMs ?? 0) - oppTimeUntilActive);
        const timingAlign = Math.max(0.3, 1 - timingDiff / Math.max(1, oppTimeUntilActive));
        bonus *= timingAlign;

        // urgencyMult：opp 攻击我能不能防住？
        // 防不住（如被动盾挡 heavy slash）→ 必须 rush，urgency=1.0
        // 防住 → 个性表达，urgency=0.5
        const selfGuardType = sit.selfGuardType ?? null;
        let urgencyMult = 1.0;
        if (selfGuardType && sit.opp?.attackProfile) {
            const interaction = ContactResolver.evaluateInteraction({
                offenseTrajectory: sit.opp.attackProfile.trajectory,
                offenseWeight: sit.opp.attackProfile.weight,
                defenseGuardType: selfGuardType,
                defenseIsDodging: false,
            });
            if (interaction.blocked) urgencyMult = 0.5;
        }
        bonus *= urgencyMult;

        return bonus;
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
        // 物理可达判定（26.11.2 Step 1 + 1b）：命中需要 weaponbox 与受击方 hitbox 重叠，
        // 而 AI 距离口径是 root-to-root——受击方身体朝攻击者一侧有 ~bodyReachAllowance 的
        // hitbox 延伸，"尖端擦身命中"就发生在这段延伸里（allowance 由实测命中反推校准，
        // 见 AITuning 注释；初版 0.45 被复测命中 4.90-5.10m 推翻，现为 0.7）。
        // 不含 rangeBuffer：那是攻击评分的决策外缘（提前量），不是物理可达。
        const bodyAllow = this.tuning.defense.bodyReachAllowance ?? 0.7;
        const oppEffectiveDisplacement = oppAtk.activeDisplacement ?? oppAtk.displacement ?? 0;
        const oppFwdBoost = oppEffectiveDisplacement < 0 ? -oppEffectiveDisplacement : 0;
        // 自身闭合法则（26.11.2 Step 1c）：AI 自己在向对手移动时，命中时刻的距离比当前
        // 读数更近——尖端延伸与自身闭合同步发生（实证：AI 匀速 approach 时在门外 ~4.9m
        // 被玩家 thrust 尖端反复命中）。closure 窗口算到 active 结束（AI 在 startup+active
        // 全程都在走），只在"朝对手移动"时计入，上限 0.3m；active 阶段窗口 ≤ 0 → 0
        // （武器已伸出，距离每 tick 刷新，×1.05 余量已覆盖）。
        // 对手侧的 speed×time 仍被否决（速度不可靠），自身侧成立：方向是自己的 intent、
        // 速度是引擎实测值（currentSpd）。
        const _self = this.character;
        const _oppDirX = Math.sign(this.opponent.root.position.x - _self.root.position.x);
        const _intentX = _self.moveIntent?.x ?? 0;
        const _movingToward = _oppDirX !== 0 && Math.sign(_intentX) === _oppDirX;
        const _oppAtkWindowEarly = this.#findPredictedEvent(
            sit.predictedOpponentEvents, "opp_attack_active_window"
        );
        const _oppEff = this.#getEffectiveTiming(oppAtk.timing, this.opponent);
        const _timeUntilActiveEnd = _oppAtkWindowEarly
            ? _oppAtkWindowEarly.startMs + _oppEff.activeMs
            : Math.max(0, _oppEff.startupMs + _oppEff.activeMs - sit.opp.normTime * _oppEff.totalMs);
        const _selfClosureM = _movingToward
            ? Math.min(0.3, (_self.currentSpd ?? 0) * Math.max(0, _timeUntilActiveEnd) / 1000)
            : 0;
        // 远端：×1.05 仅覆盖决策 tick 离散化
        const oppDangerFar = (oppAtk.range?.maxReach + oppFwdBoost + bodyAllow) * 1.05 + _selfClosureM;
        if (sit.distance > oppDangerFar) {
            // [AI-Diag] 门拒观测（Step 1c 验证）：closure 三个输入哪个在运行时不符合预期，
            // 一行看全（toward/spd/win 任一为 0 都说明闭合法则没生效）
            if (this.debugVisible) {
                console.log(
                    `[AI-Diag] defenseGate REJECT ${kind}: dist=${sit.distance.toFixed(2)} ` +
                    `dangerFar=${oppDangerFar.toFixed(2)} (maxR=${oppAtk.range?.maxReach?.toFixed(2)} ` +
                    `fwd=${oppFwdBoost.toFixed(2)} body=${bodyAllow} closure=${_selfClosureM.toFixed(3)} ` +
                    `toward=${_movingToward} spd=${(_self.currentSpd ?? 0).toFixed(2)} ` +
                    `intent=${_intentX} win=${_timeUntilActiveEnd.toFixed(0)}ms)`
                );
            }
            return 0; // 明显够不着
        }
        // 近端（Step 1b）：AI 站进 minR 死区（贴脸）时该攻击物理上打不到，防御是浪费
        const oppMinReach = oppAtk.range?.minReach ?? 0;
        if (oppMinReach > 0 && sit.distance < oppMinReach - bodyAllow) {
            return 0; // 贴脸死区：weaponbox 近端越过身体，够不到
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
                // Fallback: events 缺失时手动计算（有效时序口径，与 events 主路径一致）
                const elapsedMs = sit.opp.normTime * _oppEff.totalMs;
                timeUntilActive = Math.max(0, _oppEff.startupMs - elapsedMs);
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

        // === 26.11.2 Step 5: dodge i-frame 资格门（计划 §5a）===
        // dodge 的安全机制是 dodgeActive 全状态免疫（stateDef 级标志，无相位窗口），
        // 但免疫从 dodge 状态实际生效才开始。若预测命中时刻早于 dodge 能生效的时刻，
        // 这个 dodge 无论分数多高都躲不掉 → 0 分退出（资格问题，硬规则，不进软评分）。
        // escapeLatency（从现在到 dodgeActive=true 的预计延迟）：
        //   - idle/移动等可立即打断的状态 → 0（本决策拍即可 commit）
        //   - 自身攻击状态（不可取消）→ 当前攻击剩余时长（KB timing，与 oppRemainingMs 同口径）
        //   - guard/dodge 等其他状态 → 0（guard→dodge 切换成本无数据，不做口径外建模；
        //     dodge 中 dodgeActive 已生效，无需再判）
        // timeUntilHit：startup → active 窗口起始（events 层，同 closure 复用）；active → 0
        if (kind === "dodge") {
            const _selfStateName = sit.self?.stateName ?? this.character.currentStateName;
            const _selfDefNow = sit.self?.def ?? this.character.currentStateDef;
            let escapeLatency = 0;
            if (_selfDefNow?.attackActive === true) {
                const _selfAtk = this.kbProfile?.attacks?.find(a => a.stateName === _selfStateName);
                const _selfTotalMs = this.#getEffectiveTiming(_selfAtk?.timing, this.character)?.totalMs ?? 0;
                if (_selfTotalMs > 0) {
                    escapeLatency = Math.max(0, (1 - (sit.self?.normTime ?? 0)) * _selfTotalMs);
                }
            }
            const timeUntilHit = oppPhase === "active"
                ? 0
                : (_oppAtkWindowEarly?.startMs
                    ?? Math.max(0, _oppEff.startupMs - sit.opp.normTime * _oppEff.totalMs));
            if (timeUntilHit < escapeLatency) {
                if (this.debugVisible) {
                    console.log(
                        `[AI-Diag] dodgeGate REJECT ${defenseAction.stateName}: ` +
                        `hitIn=${timeUntilHit.toFixed(0)}ms < dodgeReadyIn=${escapeLatency.toFixed(0)}ms ` +
                        `(selfState=${_selfStateName ?? "?"})`
                    );
                }
                return 0;
            }
        }

        // --- 问题 1b: 我的防御对这招有效吗？---
        let defenseGuardType = null;
        if (kind === "guard") {
            defenseGuardType = defenseAction.guardType ?? null;
        }
        const defenseCanParry = kind === "guard" && (defenseAction.canParry === true);

        // D8/Step 5: fatigueAwareness guard 资格门（统一疲劳周期 + guard 物理风险线，dodge 自然接管）
        if (kind === "guard" && this._fatigueGuardSuppressed) {
            return 0;
        }

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

    /**
     * 26.11.9 攻击耐力计划 Step 2：攻击族疲劳资格 Gate（影子模式）
     * D1 逐候选标注（不改分数、不删候选——实际过滤由 attackGate.enabled 控制，Step 3 起）
     * D2 阈值 = 0.7 - 0.5 × clamp(baseAggression,0,1)；D3 projected = (stamina - commitCost)/max，
     *    不预扣 miss/outcome 追加费；成本经 CombatCharacter.getAttackCommitCost（与实际扣费同源）
     * D8 双重短路：stamina.enabled=false 或 fatigueAwareness<=0 → 完全不参与，行为回归原系统
     */
    #applyFatigueAttackGate(scored) {
        const st = CombatTuning.stamina;
        if (st?.enabled === false) return;
        if (this.fatigueAwareness <= 0) return;
        const self = this.character;
        if (!self?.combat) return;
        // D5/R1：攻击过滤仅在统一疲劳周期在管时生效——掷骰失败拍 AI「没意识到疲劳」，候选正常竞争
        if (!this._fatigueGateActive) return;

        const agg = Math.max(0, Math.min(1, this.tuning.aiProfile?.baseAggression ?? 1.0));
        const reserveThreshold = 0.7 - 0.5 * agg;
        const filtering = st.attackGate?.enabled === true;

        const wouldBlock = [];
        const released = [];
        for (const entry of scored) {
            if (entry.kind !== "attack") continue;
            const cost = self.getAttackCommitCost(entry.action?.weight);
            const projected = Math.max(0, self.stamina - cost) / self.combat.maxStamina;
            const blocked = projected < reserveThreshold;
            // D4/R4：机会资格 = 机会分量 > 0；punish 无逐候选时序验证（R2），暂不放行
            const opp = entry.fatigueOpportunity ?? null;
            let opportunity = null;
            if (opp?.preemptive > 0) opportunity = "preemptive";
            else if (opp?.clashSeeker > 0) opportunity = "clashSeeker";
            else if (opp?.punish > 0) opportunity = "punish(unqualified)";
            entry.fatigueGate = { cost, projected, reserveThreshold, opportunity, blocked, filtering, filtered: false };
            if (blocked) {
                const releaseable = opportunity === "preemptive" || opportunity === "clashSeeker";
                const label = `${entry.action?.stateName ?? "?"}(cost=${cost.toFixed(0)} proj=${(projected * 100).toFixed(0)}%` +
                    (opportunity ? ` opp=${opportunity}${releaseable ? "→RELEASE" : "→BLOCK"}` : "→BLOCK") + ")";
                if (filtering && releaseable) {
                    released.push(label);
                } else {
                    wouldBlock.push(label);
                    if (filtering && !releaseable) entry.fatigueGate.filtered = true;
                }
            }
        }

        // 实际过滤（attackGate.enabled）：倒序 splice 原地移除，排序 / committedScoreThreshold 仲裁只见候选缺席
        if (filtering) {
            for (let i = scored.length - 1; i >= 0; i--) {
                if (scored[i].fatigueGate?.filtered) scored.splice(i, 1);
            }
        }

        if (this.debugVisible && wouldBlock.length > 0) {
            const now = performance.now();
            if (now >= this._fatigueAttackGateLogUntil) {
                this._fatigueAttackGateLogUntil = now + 2500;
                console.log(
                    `[AI-Diag] fatigueAttackGate: aware=${this.fatigueAwareness} ` +
                    `stamina=${self.stamina.toFixed(0)}/${self.combat.maxStamina} ` +
                    `reserve=${(reserveThreshold * 100).toFixed(0)}% ` +
                    `wouldBlock=[${wouldBlock.join(", ")}]` +
                    (released.length > 0 ? ` released=[${released.join(", ")}]` : "") +
                    (filtering ? "" : " (shadow——实际过滤未启用)")
                );
            }
        }
    }

    /**
     * D8/Step 2.3: fatigueAwareness guard 资格门（每决策 tick 调一次）
     * 风险判定线与规则层 D3/P1 同源（CombatCharacter _commitStaminaCost）：
     * 扣费前 stamina < guard cost × costMultiplier → 弱 guard → 必吃 clash
     * 掷骰通过 → 锁存 2.5s 或直到耐力恢复出风险区（防 200ms tick 抖动）
     */
    /**
     * 26.11.9 攻击耐力计划 Step 5：统一疲劳意识周期（D5/D6/R1）
     * 进入 = 耐力落入攻击管理区（任一候选 commit 后 reserve 不足）或 guard 风险线以下，
     *   且无锁存时掷骰 random < awareness（aware=1 恒常在管，aware=0 永不在管）；
     * 周期内 guard 压制与攻击过滤同时生效（消灭双掷骰）。
     * 退出 = ratio ≥ 攻击区上沿 + 0.1 滞回（D6 固定偏移）；攻击区上沿取 maxAttackCost 口径，
     *   保证退出点在所有候选拦截上沿之上，Step 4 已验证的影子行为不回归。
     */
    #updateFatigueCycle() {
        if (CombatTuning.stamina?.enabled === false) {
            this._fatigueGateActive = false;
            this._fatigueGuardSuppressed = false;
            return;
        }
        const aware = this.fatigueAwareness;
        if (aware <= 0.0) {
            this._fatigueGateActive = false;
            this._fatigueGuardSuppressed = false;
            return;
        }
        const self = this.character;
        const st = CombatTuning.stamina;
        const ratio = (self?.stamina ?? Infinity) / (self?.combat?.maxStamina ?? 100);
        const agg = Math.max(0, Math.min(1, this.tuning.aiProfile?.baseAggression ?? 1.0));
        const reserveThreshold = 0.7 - 0.5 * agg;
        const maxCost = this.kbProfile?.attacks?.length > 0
            ? Math.max(...this.kbProfile.attacks.map(a => self.getAttackCommitCost(a.weight)))
            : 0;
        const exitLine = reserveThreshold + maxCost / (self?.combat?.maxStamina ?? 100) + 0.1;
        if (ratio >= exitLine) {
            if (this._fatigueGateActive && this.debugVisible) {
                console.log(
                    `[AI-Diag] fatigueCycle: ratio=${(ratio * 100).toFixed(0)}% >= exit=${(exitLine * 100).toFixed(0)}% ` +
                    `→ 解除疲劳管理（guard/攻击门恢复资格）`
                );
            }
            this._fatigueCycleLatchUntil = 0;
            this._fatigueGateActive = false;
            this._fatigueGuardSuppressed = false;
            return;
        }
        const wasActive = this._fatigueGateActive;
        if (aware >= 1.0) {
            this._fatigueGateActive = true;
            if (!wasActive && this.debugVisible) {
                console.log(
                    `[AI-Diag] fatigueCycle: aware=1 ratio=${(ratio * 100).toFixed(0)}% ` +
                    `< exit=${(exitLine * 100).toFixed(0)}% → 进入疲劳管理（恒常）`
                );
            }
        } else {
            const now = performance.now();
            if (now < this._fatigueCycleLatchUntil) {
                this._fatigueGateActive = true;
            } else if (Math.random() < aware) {
                this._fatigueCycleLatchUntil = now + 2500;
                this._fatigueGateActive = true;
                if (this.debugVisible) {
                    console.log(
                        `[AI-Diag] fatigueCycle: aware=${aware} ratio=${(ratio * 100).toFixed(0)}% ` +
                        `< line=${(exitLine * 100).toFixed(0)}% → 进入疲劳管理 2.5s（guard 压制 + 攻击过滤）`
                    );
                }
            } else {
                this._fatigueGateActive = false;
            }
        }
        // guard 压制 = 周期在管 且 耐力低于 guard 物理风险线（Step 2.3 语义：guard 后可能归零，dodge 接管）
        const guardLine = (st.costs?.guard ?? 10) * (self?.costMultiplier ?? 1.0);
        this._fatigueGuardSuppressed = this._fatigueGateActive && (self?.stamina ?? Infinity) < guardLine;
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
                    const _eff = this.#getEffectiveTiming(bestSlash.timing, this.character);
                    const activeStart = _eff.startupMs;
                    const activeEnd = _eff.startupMs + _eff.activeMs;
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
     * dodge i-frame 窗口因子（Bug A 修复：i-frame 口径）
     * dodge 的保命机制是 dodgeActive 全程免疫 [0, totalMs]，无位置闪避语义。
     * 存活条件：投掷物在免疫窗结束前到达 → tti ≤ totalMs − 后撤位移延迟。
     * 后撤位移（frameSpeeds，远离弹道）会把实际命中时刻推后 retreatMs，故上限相应下调。
     * 返回 { factor, effectiveTotalMs } 供评分与诊断共用。
     */
    #dodgeWindowFactor(dodge, tti, threat) {
        const tun = this.tuning.projectileDefense;
        const totalMs = dodge.timing.totalMs;

        // 后撤位移延迟：位移 / 弹速（KB 扫描已提供 displacement，此前从未被使用）
        // D9：dodge 动画不减速但位移按耐力缩放，预测必须读缩放后位移，否则疲劳 AI 高估闪避成功率
        const projSpeed = Math.abs(threat.velocity?.x ?? threat.profile?.speed ?? threat.speed ?? 6);
        const retreatMs = Math.abs(dodge.displacement ?? 0)
            * (this.character?.dodgeDisplacementScale ?? 1.0) / projSpeed * 1000;
        const effectiveTotalMs = Math.max(0, totalMs - retreatMs);

        let factor;
        if (tti > effectiveTotalMs) {
            factor = 0;                              // 闪完了才到 → 必死
        } else if (tti >= tun.dodgeLateMarginMs) {
            factor = 1.0;                            // 到达落在免疫窗内 → 存活
        } else {
            factor = tti / tun.dodgeLateMarginMs;    // 极近：commit 执行延迟保险
        }
        return { factor, effectiveTotalMs };
    }

    /**
     * 从 kbProfile.dodges 里选窗口因子最优的 dodge。
     */
    #findBestDodgeForProjectile(tti, threat) {
        const dodges = this.kbProfile?.dodges ?? [];
        if (dodges.length === 0) return null;

        let bestDodge = null;
        let bestF = -Infinity;

        for (const dodge of dodges) {
            const { factor } = this.#dodgeWindowFactor(dodge, tti, threat);
            if (factor > bestF) { bestF = factor; bestDodge = dodge; }
        }
        return bestDodge;
    }

    #scoreDodgeForProjectile(dodge, tti, threat) {
        const tun = this.tuning.projectileDefense;
        const { factor: timeWindowFactor, effectiveTotalMs } =
            this.#dodgeWindowFactor(dodge, tti, threat);

        let score = tun.dodgeBase * timeWindowFactor;
        score *= this.combatPosture.defenseMultiplier;

        // 距离门控：已经飞过了
        if (threat.distanceToSelf < 0.2) score *= tun.nearSelfDecay;

        // === DIAGNOSTIC: dodge 评分明细（Bug A 修复：i-frame 口径）===
        if (this.debugVisible) {
            const band = tti > effectiveTotalMs ? "DEAD_IFRAME_EXPIRED"
                       : tti >= tun.dodgeLateMarginMs ? "SAFE"
                       : "MARGIN";
            console.log(
                `[AI-Diag] projDodge: dodge=${dodge.stateName} ` +
                `tti=${tti.toFixed(0)}ms iframesEnd@${effectiveTotalMs.toFixed(0)} ` +
                `(totalMs=${dodge.timing.totalMs} retreatMs=${(dodge.timing.totalMs - effectiveTotalMs).toFixed(0)}) ` +
                `winFactor=${timeWindowFactor.toFixed(2)} score=${score.toFixed(3)} ` +
                `dist=${threat.distanceToSelf.toFixed(2)} band=${band}`
            );
        }

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
            const activeStart = this.#getEffectiveTiming(slash.timing, this.character).startupMs;
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
        const _eff = this.#getEffectiveTiming(slash.timing, this.character);
        const activeStart = _eff.startupMs;
        const activeEnd = _eff.startupMs + _eff.activeMs;

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
        const slashMinReach = slash.range?.minReach ?? 0;  // 贴脸无效区内缘（近端死区）
        // 窗口两端 projectile 的距离（直线飞行，单调递减）
        // 窗口开始 = projectile 距离最远点，窗口结束 = 最近点
        const distAtStart = Math.max(0,
            threat.distanceToSelf - projectileSpeed * (activeStart / 1000));
        const distAtEnd = Math.max(0,
            threat.distanceToSelf - projectileSpeed * (activeEnd / 1000));

        // === Bug 修复：distanceAlignment 改为带状判据 [minReach, maxReach] ===
        // weaponbox 是 active 帧序列的固定矩形，聚合覆盖带 = [minReach(贴脸死区内缘), maxReach]
        // 有覆盖 ⟺ 穿越带 [distAtEnd, distAtStart] 与覆盖带有交集：
        //   distAtEnd ≤ maxReach（窗口结束前已进入 reach 内）
        //   且 distAtStart ≥ minReach（窗口开始时尚未穿入贴脸死区）
        let distanceAlignment;
        if (distAtStart < slashMinReach) {
            // 全程在贴脸死区内 → 剑在外侧挥，物理不可能命中
            distanceAlignment = 0;
        } else if (distAtEnd > slashReach) {
            // 全程在最大 reach 外 → 够不着，物理不可能命中（Bug B 修复：原线性衰减
            // 会给超距 0.26~0.74 的虚高分，导致 AI 在 6.5m 处挥空挨打）
            distanceAlignment = 0;
        } else {
            distanceAlignment = 1.0;
        }

        let score = tun.cutBase;
        score *= timingAlignment;
        score *= distanceAlignment;
        score *= this.combatPosture.attackMultiplier;
        score *= (1 + tun.cutBoostBonus);

        // === DIAGNOSTIC: cut 评分明细（reactive 路径，preemptive 已在调用点打日志）===
        // 区分 reactive vs preemptive：threat 来自真实 projectile 时有 profile
        const isReactive = !!threat.profile;
        if (this.debugVisible && isReactive) {
            console.log(
                `[AI-Diag] projCut[reactive]: slash=${slash.stateName} ` +
                `tti=${tti.toFixed(0)}ms active=[${activeStart},${activeEnd}]ms ` +
                `projBand=[${distAtEnd.toFixed(2)},${distAtStart.toFixed(2)}] ` +
                `boxBand=[${slashMinReach.toFixed(2)},${slashReach.toFixed(2)}] ` +
                `distAlign=${distanceAlignment.toFixed(2)} score=${score.toFixed(3)}`
            );
        }

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
        // 近战最远有效距离（物理硬门控，与 #scoreThrow 共用口径）
        const maxEffReach = this.#getMeleeMaxEffReach();
        // 理想交战距离（所有攻击有效射程的中位数，用于 positioning 锚点）
        const idealEffReach = this.#getIdealEffReach();
        const distance = sit.distance;

        // distanceHunger: distance 在 idealEffReach*1.5 ~ idealEffReach*3 之间 smoothstep 从 0→1
        const smoothstep = (x, e0, e1) => {
            if (e1 <= e0) return x <= e0 ? 0 : 1;
            const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
            return t * t * (3 - 2 * t);
        };
        const farThreshold = idealEffReach * 3;
        const nearFarZone = idealEffReach * 1.5;
        const distanceHunger = smoothstep(distance, nearFarZone, farThreshold);

        // Posture multiplier（Phase 1 已接线）
        const advMult = this.combatPosture.advanceMultiplier;
        const retMult = this.combatPosture.retreatMultiplier;

        // === Approach ===
        // 远距离才想靠近（distanceHunger smoothstep 加权）
        // 分数低于 attack.baseWeight(0.4)，让 attack 在范围内赢
        let approachScore = 0;
        // v2: approach 门槛改用 idealEffReach × 1.15，而非物理 maxEffReach
        if (distance > idealEffReach * 1.15) {
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
        // v2: hold 门槛上界改用 idealEffReach × 1.15
        // v2: holdScore 也乘 attackMultiplier（封顶 0.15）
        //     - 防御型 attackMult 低 → hold 也低，attack 偶尔能赢打破 opp idle 僵局
        //     - 攻击性 attackMult 高 → hold 封顶 0.15，attack 本来就赢
        let holdScore = 0;
        if (distance > closestMinReach && distance <= idealEffReach * 1.15) {
            // hold 意愿和攻击意愿正相关：不想打时也不想 hold 太死
            holdScore = Math.min(0.15, 0.15 * this.combatPosture.attackMultiplier);

            // 最长 hold 时间超时（26.11.2 Step 3：周期性语义，非一次性禁用）
            // 超时 → 本 tick holdScore 归零（给 attack/approach 重新评价的机会），
            // 同时重置 holdCommitStart 开启新一轮评价周期。
            // holdTimeout 的语义是"这个位置意图该重新评价了"，不是"永远不许再 hold"。
            // 修复原 bug：计时器只在非 hold commit 时重置，baseAggression=1.0 时
            // maxHoldMs=0 → 每 tick 判超时且永不复位 = hold 被永久禁用。
            if (this.#holdCommitStart !== null) {
                const holdDuration = performance.now() - this.#holdCommitStart;
                const maxHoldMs = this.#getMaxHoldMs();
                if (holdDuration > maxHoldMs) {
                    holdScore = 0;
                    this.#holdCommitStart = performance.now();  // 开启新一轮评价周期
                    if (this.debugVisible) {
                        console.log(
                            `[AI-Diag] holdTimeout: holdDuration=${(holdDuration/1000).toFixed(1)}s ` +
                            `> maxHoldMs=${(maxHoldMs/1000).toFixed(1)}s → holdScore=0（计时已重置，下一周期恢复资格）`
                        );
                    }
                }
            }

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
        // v2 fix: 加 holdScore > 0 门控 —— 静态 hold 无资格时（holdScore=0）不应保底 0.05
        if (sit.opp?.phase === "throw_windup" && _hasCuttableThrow && holdScore > 0) {
            holdScore = Math.max(holdScore, 0.05);
        }
        // hold 不乘 Posture multiplier（是基线）

        // === Retreat ===
        // 太近必须退（closestMinReach）
        // oppThreat 高也想拉开
        let retreatScore = 0;
        // === 26.11.2 Step 4B: retreat 中间档 ===
        // 填补贴脸死区上方的欲望真空，与 attack 近距侧衰减（Step 4A）成对生效。
        // 锚定**最短攻击招的 minReach**（closestMinReach，26.11.2 复测调整）：
        // 复测发现锚在 0.7×ideal 时中间档盖住 1.3~1.87m，AI 永远进不了 dash
        // 舒适区（1.11~1.6m）——现在 1.2m 以上归还给 attack/dash 竞争，
        // 后退意图只在"比最短招还近"的带内存在（用户口径：引起后退意图的
        // 距离应和最短攻击距离的招数关联）。
        // distance 从 0.55×closestMinReach 线性爬到 midTierAnchor(1.1)×closestMinReach
        // 处的 0.5，与既有贴脸必退线连续衔接。
        {
            const closestMin = closestMinReach;
            const distFar = closestMin * (this.tuning.retreat?.midTierAnchor ?? 1.1);
            const distNear = closestMin * 0.55;
            if (distance <= distFar && distance > distNear && distFar > distNear) {
                const t = (distFar - distance) / (distFar - distNear);
                retreatScore = Math.max(retreatScore, 0.5 * t);
            }
        }
        // v2: retreat 近距门槛改用 idealEffReach × 0.4，而非 closestMinReach + 0.3
        if (distance <= idealEffReach * 0.4) {
            retreatScore = 0.5; // 底线：距离理想值小于 40% 必须退
        }
        // v2: 物理贴脸绝对底线（closestMinReach 覆盖不到的 gap 场景）
        if (distance <= closestMinReach) {
            retreatScore = Math.max(retreatScore, 0.5);
        }
        const hasBoost = sit.selfMobility?.hasActiveBoost === true;
        let retreatThreatThreshold = hasBoost ? this.tuning.retreat.mobilityBoostThreat : this.tuning.retreat.normalThreat;
        // 被动守卫减免：self 有 shield 且对手当前攻击能被挡 → 不需要急着退
        if (sit.selfGuardType && sit.opp.attackProfile) {
            const canBlock = ContactResolver.evaluateInteraction({
                offenseTrajectory: sit.opp.attackProfile.trajectory,
                offenseWeight: sit.opp.attackProfile.weight,
                defenseGuardType: sit.selfGuardType,
                defenseIsDodging: false,
            }).blocked;
            if (canBlock) retreatThreatThreshold = Math.min(1, retreatThreatThreshold + 0.3);
        }
        if (sit.oppThreat > retreatThreatThreshold && distance <= maxEffReach) {
            retreatScore = Math.max(retreatScore, 0.3);
        }
        retreatScore *= retMult;

        // === 26.11.2 Step 4c: 失败驱动脱离（语义挂现有 posture 参数，无新 tuning 旋钮）===
        // 场景：玩家持续 dodge / 连续挥空后，AI 需要退出攻击范围外重整，
        // 而不是在射程内无限重新起手（日志实证）。
        //
        // 触发（预算制，26.11.2 复测调整）：**每个招都试过且失败够次数**才考虑退——
        // 模仿"人类战斗者会把武器库轮一遍再决定拉开"：
        //   每招要求 consecutiveFail ≥ attemptsPerAttack，
        //   attemptsPerAttack 由现有 attMult 表达进攻欲望：≥1.0（标准/高）→ 2 次，
        //   <1.0（低侵略/已被失败压低信心）→ 1 次。触发时清零预算开始新一轮。
        //
        // 退离目标线（想退多远）由 attMult 插值——同一参数既表达"想打多凶"，
        // 也反向表达"失败后想退多远"：
        //   attMult = MAX(1.4，高侵略) → 0.85 × 自己射程（贴着射程内侧就回头）
        //   attMult = 1.0（标准侵略性） → 刚好退到自己攻击距离外
        //   attMult = MIN(0.6，低侵略)  → max(自己射程, 对手射程)（退到双方射程外）
        // 幅度复用本函数既有"必退"基线 0.5，不设新常量。
        //
        // 防抽搐（26.11.2 复测调整）：boost 用时间锁存（触发后 4s，机制常量）+
        // 外缘线性衰减（line + 0.3 处降为 0）——目标线两侧分数连续，AI 在边界
        // 漂移而不是每 100ms 翻转移动方向（原版 retreat 0.5 vs approach 0.12 硬翻转）。
        // 门控：仅 opp idle/recovery（无威胁窗口）——交换中由 defense 候选负责，
        // 保住"正常交换不机械后退"红线；追加在 retMult 乘区之后，不被防御人格削弱。
        {
            const oppPhase = sit.opp?.phase;
            const now = performance.now();
            const attMult = this.combatPosture.attackMultiplier;
            const pt = this.combatPosture.tuning;
            const attMax = pt?.MAX_ATTACK_MULT ?? 1.4;
            const attMin = pt?.MIN_ATTACK_MULT ?? 0.6;
            const stdLine = maxEffReach;                       // 标准：自己攻击距离外
            const nearLine = maxEffReach * 0.85;               // 高侵略：射程内侧就回头
            const farLine = Math.max(maxEffReach, this.#getOpponentMaxEffReach()); // 低侵略上限
            let line;
            if (attMult >= 1.0) {
                const k = attMax > 1.0 ? Math.min(1, (attMult - 1.0) / (attMax - 1.0)) : 0;
                line = stdLine + (nearLine - stdLine) * k;
            } else {
                const k = attMin < 1.0 ? Math.min(1, (1.0 - attMult) / (1.0 - attMin)) : 0;
                line = stdLine + (farLine - stdLine) * k;
            }

            if (oppPhase === "none" || oppPhase === "recovery") {
                if (this.#disengageUntilTs <= now) {
                    // 未锁存：检查触发条件（预算制——每个招都试过且失败够次数）
                    const attemptsPerAttack = attMult >= 1.0 ? 2 : 1;
                    const meleeAttacks = this.kbProfile?.attacks ?? [];
                    const allTried = meleeAttacks.length > 0 && meleeAttacks.every(a =>
                        (this.#attackFailBudget.get(a.stateName) ?? 0) >= attemptsPerAttack
                    );
                    if (allTried && distance <= maxEffReach) {
                        this.#disengageUntilTs = now + 4000;   // 锁存 4s：覆盖退离目标线所需时间
                        this.#disengageLine = line;
                        this.#attackFailBudget.clear();        // 预算消耗，重新打入后新一轮
                        if (this.debugVisible) {
                            console.log(
                                `[AI-Diag] disengage TRIGGER: attMult=${attMult.toFixed(2)} ` +
                                `attemptsPerAttack=${attemptsPerAttack} line=${line.toFixed(2)} dist=${distance.toFixed(2)}`
                            );
                        }
                    }
                }
                if (this.#disengageUntilTs > now) {
                    const edge = this.#disengageLine + 0.3;
                    if (distance < edge) {
                        // 外缘线性衰减：line 处满额 0.5，line+0.3 处为 0——边界分数连续
                        const boost = 0.5 * Math.max(0, Math.min(1, (edge - distance) / 0.3));
                        retreatScore = Math.max(retreatScore, boost);
                        if (this.debugVisible) {
                            console.log(
                                `[AI-Diag] disengage: attMult=${attMult.toFixed(2)} ` +
                                `line=${this.#disengageLine.toFixed(2)} dist=${distance.toFixed(2)} boost=+${boost.toFixed(2)} ` +
                                `remain=${((this.#disengageUntilTs - now) / 1000).toFixed(1)}s`
                            );
                        }
                    }
                }
            } else if (this.#disengageUntilTs > now && (oppPhase === "startup" || oppPhase === "active")) {
                // 交换窗口到来：锁存保留（脱离意图不因对手出招而清零），
                // 但 boost 本 tick 不生效——defense 候选接管
            }
        }

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
                // v2 fix: 加 holdScore > 0 门控 —— 静态 hold 无资格时（holdScore=0）不应凭空加 0.08
                // 根因：旧代码无条件加，导致 dist>maxEffReach 时 holdScore=0.08 压制 approach 和 attack
                if (holdScore > 0) {
                    holdScore += 0.08;
                    approachScore *= 0.5;
                    _planBonusLog = `plan:hold+0.08 approach×0.5`;
                } else {
                    _planBonusLog = `plan:hold SKIP(holdScore=0,no static qual)`;
                }
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
        const startupMs = this.#getEffectiveTiming(t.timing, this.character)?.startupMs ?? 0;

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
                    const fastestSlashStartup = Math.min(...slashAttacks.map(s => this.#getEffectiveTiming(s.timing, this.opponent)?.startupMs ?? 0));
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
            // 最长 hold 时间追踪：连续 hold 计时，非 hold 重置
            //（26.11.2 Step 3：超时本身也会在评分处重置计时，开启下一评价周期）
            if (kind === "hold") {
                if (this.#holdCommitStart === null) {
                    this.#holdCommitStart = performance.now();
                }
            } else {
                this.#holdCommitStart = null;
            }
            // Phase 0: 记录 COMMIT（positioning 也算一次 commit）
            this.combatMemory.pushCommit(kind, kind);

            // positioning（hold/approach/retreat）完全不碰 consecutiveAttackUsage——
            // 就让它 stale。attack commit 时 line 2095-2098 自然处理：
            //   同一 attack → count++，不同 attack → count 重置为 1。
            // 这样 smash→hold→smash 的 count 链是 1→(不变)→2，repitition 终于触发。
            // Rabble thrust→hold→swing（不同 stateName）自然重置，不受影响。
            // 语义上 hold 是等冷却还没换招，不该衰减 repitition 计数。
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
        // attack/defense/throw commit 都重置 hold 计时（positioning 分支内部自行处理）
        this.#holdCommitStart = null;
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
        // 每个 attack 单独计算 maxReach + 自身前冲位移，再取 max
        // 禁止跨 attack 取 max 再相加（数学上 max(A_i)+max(B_i) ≠ max(A_i+B_i)，
        // 当 maxReach 和 maxFwdBoost 来自不同 attack 时会产生幻影射程）
        const perAttackEffReach = (this.kbProfile?.attacks || []).map(a => {
            const reach = a.range?.maxReach ?? 0;
            const disp = a.activeDisplacement ?? a.displacement ?? 0;
            const fwdBoost = disp < 0 ? -disp : 0;
            return reach + fwdBoost;
        });
        const maxPerAttack = perAttackEffReach.length > 0 ? Math.max(...perAttackEffReach) : 0;
        return maxPerAttack + this.rangeBuffer;
    }

    /**
     * 对手的最远攻击有效距离（26.11.2 Step 4c：失败驱动脱离的 farLine 依据）。
     * 与 #getMeleeMaxEffReach 同口径（maxReach + 自身前冲位移 + rangeBuffer），
     * 数据源换成 opponentKB。对手无攻击数据时返回 0（farLine 退化为 ownLine）。
     */
    #getOpponentMaxEffReach() {
        const perAttackEffReach = (this.opponentKB?.attacks || []).map(a => {
            const reach = a.range?.maxReach ?? 0;
            const disp = a.activeDisplacement ?? a.displacement ?? 0;
            const fwdBoost = disp < 0 ? -disp : 0;
            return reach + fwdBoost;
        });
        const maxPerAttack = perAttackEffReach.length > 0 ? Math.max(...perAttackEffReach) : 0;
        return maxPerAttack + this.rangeBuffer;
    }

    /**
     * 理想交战距离：所有攻击有效射程的中位数。
     *
     * 与 #getMeleeMaxEffReach() 的区别：
     *   - #getMeleeMaxEffReach() 取 max 再加 rangeBuffer —— 物理最远 reach，用于 positioning/attack 的硬门控
     *   - #getIdealEffReach() 取 median —— 多数攻击都舒服的距离，用于 positioning hold 曲线的锚点
     *
     * 中位数优于 max：max 是最远那招的极限，不是"多数攻击都舒服"的距离。
     * 例如 Manatarms v6：smash=2.49, quart=2.73, reverse_quart=3.32 → median=2.73
     */
    #getIdealEffReach() {
        const perAttackEffReach = (this.kbProfile?.attacks || []).map(a => {
            const reach = a.range?.maxReach ?? 0;
            const disp = a.activeDisplacement ?? a.displacement ?? 0;
            const fwdBoost = disp < 0 ? -disp : 0;
            return reach + fwdBoost;
        });
        if (perAttackEffReach.length === 0) return 0;
        perAttackEffReach.sort((a, b) => a - b);
        const mid = Math.floor(perAttackEffReach.length / 2);
        return perAttackEffReach.length % 2 !== 0
            ? perAttackEffReach[mid]
            : (perAttackEffReach[mid - 1] + perAttackEffReach[mid]) / 2;
    }

    /**
     * 最长 hold 时间（ms）— 单个评价周期的时长
     *
     * 设计：
     *   基数 = Σ 所有攻击的 timing.totalMs（startup + active + recovery 总时长）
     *   maxHoldMs = max(totalAttackMs × (1 - aggression), minHoldPeriodMs)
     *
     *   aggression = aiProfile.baseAggression（配置级固定值）
     *
     *   aggression=0（完全防御型）→ maxHoldMs = totalAttackMs（等完所有攻击动画）
     *   aggression=1（完全侵略型）→ 计算值 0，由 minHoldPeriodMs 下限兜底
     *
     * 26.11.2 Step 3 语义修正：
     *   超时不再是"永久禁用"，而是"该重新评价了"——超时 tick holdScore 归零
     *   并重置计时器，hold 进入下一轮评价周期（周期性，见评分处注释）。
     *   minHoldPeriodMs 下限保证 baseAggression=1.0 这个合法边界下，
     *   hold 至少完整保有 400ms 再进入重新评价，而非每 tick 判超时。
     */
    #getMaxHoldMs() {
        const attacks = this.kbProfile?.attacks || [];
        const totalAttackMs = attacks.reduce((sum, a) => sum + (a.timing?.totalMs ?? 0), 0);
        if (totalAttackMs === 0) return Infinity;  // 无攻击数据，不过期（安全兜底）

        const aggression = this.tuning.aiProfile?.baseAggression ?? 1.0;
        const minHoldPeriodMs = this.tuning.hold?.minHoldPeriodMs ?? 400;
        return Math.max(totalAttackMs * (1 - aggression), minHoldPeriodMs);
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
