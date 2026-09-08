import { BaseController } from "./BaseController.js";
import { AIKnowledgeRegistry } from "./AIKnowledgeRegistry.js";
import { ContactResolver } from "./ContactResolver.js";

/**
 * AIController - AI 控制器（Phase 1：局面感知 + Utility 选招 + Action Commitment）
 * 核心流程：
 *   fixedUpdate
 *     → committed? → skip
 *     → 100ms 到 → buildSituation → score actions → pick best → execute
 * 场景设定：AI 永远在右，玩家永远在左，AI 始终面向左
 */
export class AIController extends BaseController {
    constructor(character = null, options = {}) {
        super(character);

        // 目标对手（玩家角色）
        this.opponent = options.opponent || null;

        // 双方知识档案（self KB 构造时加载；opponent KB 在 setOpponent 时加载）
        this.kbProfile = AIKnowledgeRegistry.getProfile(this.character);
        this.opponentKB = null;

        // 决策冷却
        this.attackCooldownMs = options.attackCooldownMs ?? 800;
        this.lastAttackTime = -Infinity;

        // 决策间隔（避免每帧都重新决策）
        this.decisionIntervalMs = options.decisionIntervalMs ?? 100;
        this.decisionAccumulatedMs = 0;

        // 统一范围模型：攻击有效阈值 & positioning hold 边界共用同一个 buffer
        // 原来 attack 用 +0.3、positioning 用 +0.5/+1.0，导致 gap 和 mobility boost 反效果
        this.rangeBuffer = options.rangeBuffer ?? 0.2;

        // 随机扰动
        this.reactionVariance = options.reactionVariance ?? 0.15;

        // 当前行为状态（debug 用）
        this.currentBehavior = "idle";

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
        return def.attackActive === true
            || def.dodgeActive === true
            || def.guardActive === true;
    }

    /**
     * Phase 1 核心决策：构建 Combat Situation → Utility 评分 → 选最高分 → 执行
     */
    #makeDecision() {
        const sit = this.#buildSituation();

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

        // 轻微随机扰动 + 排序
        for (const entry of scored) {
            entry.score *= (1 + (Math.random() - 0.5) * this.reactionVariance);
        }
        scored.sort((a, b) => b.score - a.score);

        const best = scored[0];

        // 有足够好的 committed action 就执行
        if (best && best.score > 0.15) {
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
        let oppThreat = 0; // 0~1
        if (oppAttackProfile) {
            const oppReach = oppAttackProfile.range?.maxReach ?? 0;
            const inRange = distance <= oppReach + this.rangeBuffer;
            const selfIsBusy = selfDef?.attackActive === true;

            if (oppPhase === "active") {
                oppThreat = inRange ? 1.0 : 0.3;
            } else if (oppPhase === "startup") {
                oppThreat = inRange ? 0.6 : 0.2;
            } else if (oppPhase === "recovery") {
                oppThreat = 0.1; // 威胁窗口已过
            }
            // self 正在攻击中（不可响应窗口）→ 放大威胁
            if (selfIsBusy && oppPhase !== "recovery") oppThreat = Math.min(1, oppThreat + 0.2);
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
            oppVulnerable = 0.8;
        } else if (oppPhase === "startup") {
            oppVulnerable = 0.3; // 反制窗口
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
        const oppDef = this.opponent?.currentStateDef;
        if (!oppDef?.transitions) return false;
        return oppDef.transitions.some(t => t.when?.some(w => w.hasTag === "parryBonus"));
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
     * 攻击动作 Utility 评分（Phase 2 扩展：加 queryInteraction 克制关系）
     */
    #scoreAttack(attack, sit) {
        const range = attack.range?.maxReach ?? 0;
        const timing = attack.timing;

        // 统一有效阈值（Step 1：改为引用 rangeBuffer，与 positioning 边界对齐）
        const effectiveRange = range + this.rangeBuffer;
        if (sit.distance > effectiveRange) return 0;

        let score = 0.4; // base: 距离可达就有基础分

        const canAttack = sit.now - this.lastAttackTime >= this.attackCooldownMs;
        if (!canAttack) score -= 0.5; // 冷却中 → 大幅扣分

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
            const penalty = interaction.parryable ? 0.9 : 0.6; // parry 更危险（有反击）
            score -= penalty;
        } else if (sit.opp.guardType && !interaction.blocked) {
            // opponent 在 guard 但防不住我的攻击 → 加分（抓漏洞）
            score += 0.25;
        }
        // --------------------------------

        // opponent vulnerability 高 → 加分（punish 窗口）
        score += sit.oppVulnerable * 0.4;

        // opponent 正在 active 且在我 range 内 → 攻击风险高 → 扣分
        if (sit.opp.phase === "active" && sit.distance <= (sit.opp.attackProfile?.range?.maxReach ?? 99)) {
            score -= sit.oppThreat * 0.3;
        }

        // opponent 在 startup 且我能在他 active 前出手 → 加分（抢先）
        if (sit.opp.phase === "startup" && timing) {
            const myStartupMs = timing.startupMs ?? 0;
            if (myStartupMs <= sit.opp.remainingMs) score += 0.2;
        }

        // 距离接近 range 上限 → 微加分（稳定命中点，Step 1：与 effectiveRange 对齐）
        if (sit.distance >= range && sit.distance <= effectiveRange) score += 0.05;

        return Math.max(0, Math.min(1, score));
    }

    /**
     * 防御动作 Utility 评分（Phase 2 扩展：evaluateInteraction 区分 dodge/guard 对不同攻击的有效性）
     */
    #scoreDefense(defenseAction, sit, kind) {
        // opponent 没有攻击 → 防御无意义
        if (sit.opp.phase === "none" || sit.oppThreat < 0.3) return 0;

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
                    score += 0.2;
                }
            } else if (oppAtk.trajectory && !interaction.blocked && !interaction.dodged) {
                // 我的防御对对手这个攻击完全没用（比如 guard 遇到 thrust）→ 大幅扣分
                score -= 0.5;
            }
        }
        // -----------------------------------------------------------

        if (sit.opp.phase === "active") {
            // 对手刀正在挥 → 必须防御
            // Step 3 改动：拉平 dodge 和 guard 基数（原 dodge 0.9 / guard 0.8）
            score += 0.85;
        } else if (sit.opp.phase === "startup") {
            // 对手还在起手 → 预判防御有价值
            const myStartupMs = defenseAction.timing?.totalMs ?? 200;
            if (myStartupMs <= sit.opp.remainingMs) {
                // Step 3 改动：拉平 dodge 和 guard 基数（原 dodge 0.7 / guard 0.6）
                score += 0.65;
            } else {
                score += 0.3; // 可能来不及
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

        // 转换成评分调整量，系数 0.3 控制敏感度，±0.25 限幅避免盖过威胁评分
        const consequenceAdjustment = Math.max(-0.25, Math.min(0.25, -consequenceDelta * 0.3));
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
        const retreatThreatThreshold = hasBoost ? 0.8 : 0.6;

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
