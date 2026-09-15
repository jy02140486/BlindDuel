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
    attackCooldownMs: 800,             // 攻击冷却

    // === 距离模型 ===
    rangeBuffer: 0.2,                  // 统一安全/操作 margin
    // 注释：当前 attack effective range 与 positioning hold 边界共享此值，
    // 是为了保证战斗距离模型的一致性；
    // 若未来出现不同语义需求（如 attackRangeBuffer / positioningBuffer / dodgePredictionBuffer），
    // 再拆分。不要为了「灵活」现在就拆三个相同值。

    // === 性格门控 ===
    committedScoreThreshold: 0.15,     // 评分超过此阈值才执行 committed action
    reactionVariance: 0.15,            // 随机扰动幅度

    // === oppThreat 感知 ===
    threatPerPhase: {
        active: 1.0,   // 对手 active 阶段的威胁感知
        startup: 0.6,  // 对手 startup 阶段的威胁感知
        recovery: 0.1, // 对手 recovery 阶段的威胁感知
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
        feedbackSuccessBonus: 0.05,  // 每次成功加多少分（连续累积）
        continuityBonus: 0.05,       // 上一招成功过的惯性加分（连续失败 ≥2 则不给）
    },

    // === 防御偏好 ===
    defense: {
        activationThreshold: 0.3,  // oppThreat < 此值时防御评分归零
        parryReward: 0.2,          // parry 成功额外加分
        badDefensePenalty: 0.5,    // guard 防不住 thrust 这类情况扣分
        activeBase: 0.85,          // opponent active 时的防御基础分
        startupCanActBase: 0.65,   // startup 且自己来得及反应
        startupTooLateBase: 0.3,   // startup 但自己来不及
    },

    // === 距离后果（防御动作后的距离代价）===
    distanceConsequence: {
        multiplier: 0.3,   // consequenceDelta × multiplier
        clamp: 0.25,       // ±clamp 限幅上限
    },

    // === Positioning ===
    retreat: {
        normalThreat: 0.6,           // 普通状态下 retreat 的威胁阈值
        mobilityBoostThreat: 0.8,    // Mobility Boost 时 retreat 的威胁阈值
    },
};