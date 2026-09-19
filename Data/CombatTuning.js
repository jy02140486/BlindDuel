/**
 * CombatTuning — 系统级战斗手感参数
 *
 * 回答：这个战斗系统默认表现得怎样？
 * 设计者调这些来改变 hitstop 时长、击退距离、判定阈值等手感。
 *
 * 边界：
 *   这里放的是「战斗结果/表现」的参数 — 改了它们改变的是手感
 *   战斗规则（evaluateInteraction 里的克制关系）属于 Combat Rules，不在这里
 */
export const CombatTuning = {
    hit: {
        /** 受击方的击退位移（Phase 2 weapon vs hitbox） */
        victimKnockbackX: 0.12,
        /** 普通 hit 双方 hitstop 帧（双方各停这么多帧） */
        hitstopFrames: 8,
        /** hit / clash 的 freezeImpact 默认帧数（CombatSystem.js effect 处理） */
        freezeImpactFrames: 24,
        /** 边界 pushback：attacker 反推距离 = victimKnockback × 此系数 */
        pushbackKnockbackScale: 2,
        /** 边界 pushback：victim 到边界距离小于此阈值时才触发（米） */
        pushbackTriggerThreshold: 1.0,
    },
    block: {
        /** guard / clash 击退（双方互相推开的位移） */
        knockbackX: 0.2,
        /** guard_block 双方 hitstop 帧 */
        hitstopFrames: 4,
        /** guard_block blockstun 帧 */
        blockstunFrames: 10,
    },
    parry: {
        /** parry 双方 hitstop 帧 */
        hitstopFrames: 8,
        /** Just Guard 判定阈值：preemptive tickDiff <= 此值 */
        preemptiveTickDiffMax: 32,
    },
    clash: {
        /** clash_tie 双方 hitstop 帧 */
        tieHitstopFrames: 8,
        /** clash_lose 弱方 hitstop 帧 */
        loseLoserHitstopFrames: 6,
        /** clash_lose 强方 hitstop 帧 */
        loseWinnerHitstopFrames: 4,
    },
    action: {
        /** committed state 退出回 idle 后的公共动作冷却（ms）— 硬拦截层 */
        globalCooldownMs: 400,
    },
};