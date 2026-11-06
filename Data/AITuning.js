/**
 * AITuning — AI 行为偏好参数（系统默认值）
 *
 * 回答：AI 如何评价已存在的行为？
 * 这些不是战斗规则本身，是 Utility 评分的权重 / 阈值 / 节奏参数。
 *
 * 判断标准：
 *   改这个值会改变「AI 是什么样的人」→ 放这里
 *   改这个值会改变算法是否正确运行 → 留在代码
 *
 * 未来扩展：角色级 override
 *   同一套 AI 算法，不同敌人（Rabble / LongSwordMan / Shield）需要不同性格。
 *   本次暂不实现 override 机制，但字段命名已按「可 override」的扁平语义设计好
 *   （attack.baseWeight、defense.activeBase 这种，不是 attackAggression 单值名）。
 *   方向：StateGraph JSON 加 aiOverrides 字段，AIController 构造时合并。
 */
export const AITuning = {
    // === 节奏参数 ===
    decisionIntervalMs: 100,           // 决策间隔
    attackCooldownMs: 500,             // 攻击冷却

    // === 距离模型 ===
    rangeBuffer: 0.2,                  // 统一安全/操作 margin
    // 注释：当前 attack effective range 与 positioning hold 边界共享此值，
    // 是为了保证战斗距离模型的一致性；
    // 若未来出现不同语义需求（如 attackRangeBuffer / positioningBuffer / dodgePredictionBuffer），
    // 再拆分。不要为了「灵活」现在就拆三个相同值。

    // === 性格门控 ===
    // 26.11.2 Step 2 已接线：committed action（attack/dodge/guard/throw）评分 ≥ 此值
    // 才留在候选池（positioning 不受约束，有自己的距离门控）。注意 0.15 数值未经证明，
    // 是回归验证项——可能过滤掉低分但有价值的反应（观察 commitArbitration 日志）。
    // 26.11.2 Step 4 复测修正：运行时按角色 attack.baseWeight / 系统默认值归一化
    // （钳制 [0.25, 1.5]）——防御偏好型人格（manatarms baseWeight=0.10）攻击分天花板
    // ≈0.09，绝对阈值使其永远无法攻击 → 无限 hold。此字段只保留"系统默认量纲"下的值。
    committedScoreThreshold: 0.15,
    reactionVariance: 0.05,            // 随机扰动幅度（降级为 tie-break，Step 5）

    // === oppThreat 感知 ===
    threatPerPhase: {
        active: 1.0,   // 对手 active 阶段的威胁感知
        startup: 0.6,  // 对手 startup 阶段的威胁感知
        recovery: 0.4, // Bug 1 fix: recovery 也乘 rangeFactor，基值调到大范围（对手即将恢复出下一招）
        throw_windup: 0.5,  // Phase 3 Step 6: 对手在投掷准备阶段的基础威胁（preemptive 窗口）
    },
    selfBusyThreatBonus: 0.2,          // self 正在攻击时额外放大威胁的量

    // === oppVulnerable 感知 ===
    vulnerabilityPerPhase: {
        recovery: 0.8, // 对手 recovery 阶段的 punish 机会
        startup: 0.3,  // 对手 startup 阶段的抢先窗口
    },

    // === 攻击偏好 ===
    attack: {
        baseWeight: 0.4,          // 攻击的基础分（越高越 aggressive）
        cooldownPenalty: 0.5,     // 冷却中扣分
        parryRiskPenalty: 0.9,    // 被 parry 风险扣分（比普通 miss 更危险）
        missPenalty: 0.6,         // 普通 miss 扣分
        guardLeakBonus: 0.25,     // 抓住 guard 漏洞加分
        vulnReward: 0.4,          // opponent vulnerability 乘数
        threatPenalty: 0.3,       // opponent active + in range 扣分
        preemptiveBonus: 0.2,     // startup 抢先攻击加分
        rangeEdgeBonus: 0.05,     // 边缘命中微加分

        // === Feedback Memory 调节器 ===
        feedbackFailPenalty: 0.15,   // 每次失败扣多少分（连续 2 次 → -0.30；第 1 次 × 0.5）
        feedbackSuccessBonus: 0.05,  // 每次成功加多少分（短期记忆，封顶 successMaxCount 次）
        successMaxCount: 3,          // feedbackSuccessBonus 封顶次数（Step 3）
        continuityBonus: 0.02,       // 上一招成功过的惯性加分（降级为弱 tie-break，Step 4）

        // === Repetition Cost（Step 2）===
        repetitionCostRate: 0.06,    // 每次连续使用的成本增长（× (count-1)）
        repetitionCostMax: 0.18,     // 累计成本上限（防止盖过一切）

        // === Startup Utility（Phase 3）===
        recoveryStartupBonus: 0.12,  // opp recovery 时快招的最大加分（ratio=1.0 最快招拿满额）
        activeStartupPenalty: 0.10,  // opp active + in-range 时长招的最大扣分（ratio→0 最慢招扣满，ratio=1.0 不扣）
        distanceStartupSmooth: 0.3,  // startup factor 开始衰减的距离窗口

        // === 近距侧衰减（26.11.2 Step 4A）===
        // 锚定单招自己的射程带 [minReach, effectiveRange]：distance 从 effectiveRange
        // 收缩到 minReach 时 rangeFactor 衰减到 nearFloor——长招先于短招感受贴脸劣势，
        // 短招在自己的舒适带不受罚。与 retreat 中间档（Step 4B）成对生效。
        // 0.5 是验证起点，不是结论，随验收调整。
        nearDecayFloor: 0.5,

        // === Clash Seeker：主动寻求武器碰撞（防御缺口补完）===
        // 不是新 kind，是同一 attack 候选的额外 bonus 分项
        // 当 opp 正在 startup、双方 weaponbox active 窗口有 overlap、reachSum 够覆盖间距时触发
        clashSeeker: {
            baseBonus: 0.25,  // 基础 bonus，后续乘 timingAlign + urgencyMult
        },
    },

    // === 投掷偏好（AI 进攻性投掷，计划 §7）===
    throw: {
        baseWeight: 0.35,            // 低于 attack.baseWeight(0.4)，但量级同档可竞争
        rangeConservatism: 0.85,     // R_effective = R_physical × 0.85（扫描期注入）
        meleeZoneFactor: 0.35,       // 近战区间 throw 距离系数（非零，留弹性不硬禁）
        interruptRiskPenalty: 0.25,  // 风险 A（release 前被近战打断）满额扣分
        startupInterruptMarginMs: 50,
        cutRiskPenalty: 0.20,        // 风险 B（出手后被 slash 斩落，仅 cuttable）满额扣分
        idleOpportunityBonus: 0.05,  // opp idle 时弱主动机会
        recoveryPunishBonus: 0.15,   // opp recovery 窗口（需预测事件证明，无数据不加分）
        cooldownMs: 3000,            // 投掷节奏间隔（实测修正：throw 动画 ~1050ms，共享 500ms 冷却被动画吞掉导致连扔）；共享 lastAttackTime 时间戳
        repetitionCostRate: 0.06,    // 与 attack 持平（弹药本身限流，不加重）
        repetitionCostMax: 0.18,
        // distanceStartupSmooth / cooldownPenalty 显式复用 attack 字段；reflexMaxMs 复用 defense
    },

    // === 防御偏好 ===
    // 注：activationThreshold / startupTooLateBase 已删除（2026-11-02 口径核对）——
    // 两者在 AIController 中从未被读取（死配置）。防御资格由可达性门 + startup timing 门控制。
    defense: {
        parryReward: 0.2,          // parry 成功额外加分
        badDefensePenalty: 0.5,    // guard 防不住 thrust 这类情况扣分
        activeBase: 0.85,          // opponent active 时的防御基础分
        startupCanActBase: 0.65,   // startup 且自己来得及反应
        // 可达性门的受击体延伸（26.11.2 Step 1b）：AI 距离是 root-to-root，命中判定是
        // weaponbox × hitbox 重叠——受击方身体朝攻击者一侧有 hitbox 延伸，"尖端擦身"
        // 就发生在这段延伸里。初版 0.45 由旧观察（命中于 4.6-4.7m）反推，26.11.2 Step 1c
        // 复测被 COMBAT 命中日志推翻：AI approach 中被 thrust 尖端稳定命中于 4.90-5.10m
        // （defenseGate REJECT 证实门差 0.01-0.02m 拒掉后即被命中），重校准为 0.7
        // （(4.15+0.7)×1.05=5.10 覆盖全部实测命中；实测 5.33m 处未命中，仍被门拒）。
        bodyReachAllowance: 0.7,
        // === Reaction Profile ===
        // 每个决策 tick 抽取 0 ~ reflexMaxMs 的随机偏移，加到 decisionBuffer 上。
        // 效果：reflexMaxMs=0 → 和现在一样（默认）；reflexMaxMs=200 → AI 的
        // 反应窗口变成 [100ms, 300ms] 随机分布，表示「初级 AI 反应慢/不稳定」。
        // 未来可通过 aiProfile 角色级 override（如 tutorial=400, elite=0, boss=0）。
        reflexMaxMs: 0,
    },

    // === 距离后果（防御动作后的距离代价）===
    distanceConsequence: {
        multiplier: 0.3,   // consequenceDelta × multiplier
        clamp: 0.25,       // ±clamp 限幅上限
    },

    // === 投掷物防御偏好（Phase 3 Step 7）===
    projectileDefense: {
        dodgeBase: 0.45,   // dodge 基础分
        cutBase: 0.65,    // cut 基础分（略高于 dodge 体现奖励）
        // Bug A 修复（i-frame 口径）：dodge 的保命机制是 dodgeActive 免疫窗 [0, totalMs]，
        // 存活条件 = 投掷物在窗口内到达（tti ≤ totalMs − 后撤位移延迟）。
        // 旧 dodgeTimeWindowPeak/dodgeTooLateRatio/dodgeTooEarlySpan 是位置闪避语义，已删除。
        dodgeLateMarginMs: 150,    // tti < 此值 → 来不及反应（执行延迟保险），线性衰减到 0
        cutTooSlowSpan: 500,       // tti > slashActiveEnd 时的衰减跨度
        nearSelfDecay: 0.2,        // distanceToSelf < 0.2 时 dodge 打这个折扣
        cutBoostBonus: 0.1,        // cut 比 dodge 多一份奖励感
    },

    // === Positioning ===
    hold: {
        // 26.11.2 Step 3：hold 最低保有期下限（ms）。
        // maxHoldMs 计算值（totalAttackMs × (1 - baseAggression)）低于此值时取此值——
        // baseAggression=1.0 是合法边界，hold 至少完整保有该周期再进入重新评价，
        // 而非每 tick 判超时。400ms 是防抖起点，不是已证明的设计值，随验收调整。
        minHoldPeriodMs: 400,
    },
    retreat: {
        normalThreat: 0.6,           // 普通状态下 retreat 的威胁阈值
        mobilityBoostThreat: 0.8,    // Mobility Boost 时 retreat 的威胁阈值
        // 26.11.2 Step 4B：retreat 中间档锚点。
        // distance ≤ closestMinReach（最短攻击招的 minReach）× 此值时进入中间档，
        // 分数从 0（0.55×closestMinReach 处）线性爬升到 0.5（锚点处），
        // 与贴脸必退线连续衔接。锚最短招而非 idealEffReach（复测调整）：
        // 锚 ideal 时中间档盖住 1.3~1.87m，AI 永远进不了 dash 舒适区。
        // 与 attack 近距侧衰减（Step 4A）成对生效，单加任一侧都赢不了。
        midTierAnchor: 1.1,
        // 失败驱动脱离（26.11.2 Step 4c）刻意无新参数：退离目标线由现有
        // posture.attackMultiplier 插值（标准侵略性=退到自己攻击距离外，高侵略退短
        // 至 0.85×射程，低侵略退长至 max(自己射程, 对手射程)），幅度复用必退基线 0.5。
        // 触发为预算制（每个招都失败过 attemptsPerAttack 次，attMult≥1.0 → 2 次 /
        // <1.0 → 1 次），锁存 4s + 外缘衰减，机制语义见 AIController #scorePositioning。
    },
};