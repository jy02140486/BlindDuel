/**
 * AIProfiles — 实例级 AI 性格模板
 *
 * 四个档位（计划 §4.1）：
 *   tutorial — 教学型：无预测/弱防御，偏好慢招，给玩家学习 guard 节奏空间
 *   normal   — 标准型：三条攻击路径全开，弱预测能力
 *   elite    — 精英型：强防御、低 reflexMaxMs、高 preemptiveBonus
 *   boss     — Boss 型：未使用，预留
 *
 *   7 个 knob 中，前 5 个是 Posture 层（慢变量），后 2 个是 Utility 层（评分处直读）：
 *     姿态类（CombatPosture 消费）
 *       baseAggression     0.0~1.0  进攻基线
 *       baseDefense        0.0~1.0  防御基线
 *       decayAlpha         0.0~1.0  姿态记忆衰减（越大跳变越快）
 *       distanceAppetite   0.0~1.0  接近对手的欲望
 *       retreatDesire      0.0~1.0  拉开距离的欲望
 *     Utility 层（AIController 评分处消费）
 *       attackPreferences  { [stateName]: number } 各攻击 state 的偏好权重
 *       throwPreference    number | null  投掷偏好（null = 走 stateGraph 兜底）
 */

// Tutorial — 教学敌人（pre-prologue 左侧 rabble_tutor）
// 目标：让玩家学会 guard/parry 节奏。
//   - 无预测：decayAlpha 小 → 姿态变化慢，给玩家时间观察；反应窗口大（reflexMaxMs 高）
//   - 偏好 swing（慢招、大窗口）：swing weight 拉满，其他攻击低
//   - 防御弱：baseDefense 低，preemptiveBonus 低（很少抢先）
export const AI_PROFILE_TUTOR = {
    // Posture 层
    baseAggression: 0.55,
    baseDefense: 0.25,       // 防御意愿低 — 容易被 punishment 命中
    decayAlpha: 0.2,          // 姿态记忆衰减慢 — 反应保守
    distanceAppetite: 0.6,    // 倾向靠近（给玩家保持射程）
    retreatDesire: 0.3,

    // Utility 层
    attackPreferences: {
        swing: 1.5,             // 偏好 swing（大窗口、慢节奏）
        thrust: 0.5,            // 降低 thrust 偏好
        slash: 0.5,             // 降低 slash 偏好
    },
    throwPreference: null,    // tutorial 不开投掷（BattleDef.combatantConfig.throwAmmo=0）

    // Tuning 深合并（通过 Scene._buildInstanceAiTuning 注入）
    tuningOverrides: {
        defense: {
            reflexMaxMs: 400,   // 反应窗口 0~400ms 随机
            preemptiveBonus: 0.05, // 抢先攻击加分极低
        },
        attack: {
            preemptiveBonus: 0.05, // 同 Tuning 层 preemptiveBonus 极低
        },
    },
};

// Normal — 标准型（主线 prologue_battle rabble_react）
// 目标：弱预测、节奏标准。
export const AI_PROFILE_NORMAL = {
    baseAggression: 0.6,
    baseDefense: 0.5,
    decayAlpha: 0.35,
    distanceAppetite: 0.55,
    retreatDesire: 0.4,
    // 无 attackPreferences — 走 StateGraph 默认（各 attack state 权重全 1.0）
    throwPreference: null,
    tuningOverrides: {},
};

// Elite — 精英型（未出场，预留）
export const AI_PROFILE_ELITE = {
    baseAggression: 0.7,
    baseDefense: 0.75,
    decayAlpha: 0.55,
    distanceAppetite: 0.65,
    retreatDesire: 0.35,
    throwPreference: null,
    tuningOverrides: {
        defense: {
            reflexMaxMs: 0,
            preemptiveBonus: 0.35,
        },
    },
};
