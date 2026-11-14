import { CharacterBase } from "./CharacterBase.js";
import { FrameAnimationComponent } from "../Components/FrameAnimationComponent.js";
import { CollisionComponent } from "../Components/CollisionComponent.js";
import { TimeControlComponent } from "../Components/TimeControlComponent.js";
import { TimeControlSystem } from "../Systems/TimeControlSystem.js";
import { TrailRenderer } from "../Components/TrailRenderer.js";
import { CombatTuning } from "../../Data/CombatTuning.js";

export class CombatCharacter extends CharacterBase {
    constructor(scene, config) {
        const animation = new FrameAnimationComponent(config.clips);

        const colliderClips = {};
        for (const [clipName, clipDef] of Object.entries(config.clips)) {
            colliderClips[clipName] = clipDef.colliderData;
        }
        const collision = new CollisionComponent(
            scene,
            null,
            colliderClips,
            {
                pxToWorld: config.pxToWorld ?? 0.02,
                thicknessPx: config.collisionThicknessPx ?? 40,
                visible: config.showCollision ?? true
            }
        );

        config._animation = animation;
        config._collision = collision;

        super(scene, config);

        this.collision.rootNode = this.root;
        for (const mesh of this.collision.debugMeshesById.values()) {
            mesh.parent = this.root;
        }

        // D10 combatProfile：个体体能（StateGraphDef 顶层，与 aiProfile 并列，属战斗属性非 AI 性格）
        const profileStamina = this.stateGraph?.combatProfile?.stamina ?? {};
        const maxStamina = profileStamina.maxStamina ?? config.maxStamina ?? CombatTuning.stamina.maxStamina;

        this.combat = {
            globalCooldownMs: config.globalCooldownMs ?? CombatTuning.action.globalCooldownMs,
            lastActionTime: -Infinity,
            timeControl: new TimeControlComponent(),
            timeControlSystem: new TimeControlSystem(),
            hp: config.maxHp ?? 3,
            maxHp: config.maxHp ?? 3,
            stamina: maxStamina,
            maxStamina: maxStamina,
            recoveryMultiplier: profileStamina.recoveryMultiplier ?? 1.0,
            costMultiplier: profileStamina.costMultiplier ?? 1.0,
            isDead: false,
            deathState: config.deathState ?? "defeated"
        };

        this._battleYMin = null;
        this._battleYMax = null;
        this._battleYCorrectionSpeed = 0.4;

        // ThrowComponent — BattleMode 负责装配/销毁，没投掷能力的角色保持 null
        this.throwComponent = null;

        // TrailRenderer — 刀光组件，每角色一个可复用实例（D5）
        this.trailRenderer = new TrailRenderer(scene, this);

        // Feedback Memory: 跟踪攻击命中结果，用于判定 miss
        this._lastAttackHadHit = false;
        this._currentAttackInstanceId = null;
        this._resolvedAttackIds = new Set();
    }

    /** Feedback Memory: CombatSystem 回传结果时调用，标记该攻击实例已有 outcome */
    markAttackResolved(attackInstanceId) {
        if (attackInstanceId) this._resolvedAttackIds.add(attackInstanceId);
    }

    /** Feedback Memory: 攻击命中对手时调用 */
    markAttackHit() {
        this._lastAttackHadHit = true;
    }

    /** Feedback Memory: 当前攻击是否已有 resolved outcome（hit 或 CombatSystem 已回传） */
    isCurrentAttackResolved() {
        const id = this._currentAttackInstanceId;
        return !!(this._lastAttackHadHit || (id && this._resolvedAttackIds.has(id)));
    }

    /**
     * Get hand anchor position in world coordinates for the current animation frame.
     * Used by ThrowComponent/Phase 3c to spawn Projectile at the hand's release point.
     * @returns {{ x: number, y: number, z: number } | null} null if no hand anchor on this frame
     */
    getHandAnchorWorld() {
        const clipName = this.animation.currentClipName;
        const clipDef = this.config?.clips?.[clipName];
        const colliderClip = clipDef?.colliderData;
        const frameIndex = this.animation.currentFrameIndex;
        const colliderFrame = colliderClip?.frames?.[frameIndex];
        const hand = colliderFrame?.anchors?.hand;
        const rootAnchor = colliderFrame?.anchors?.root;

        if (!hand || !rootAnchor) return null;

        // Same conversion formula as getCombatSnapshot box centers:
        // world = root.position + (pixel_offset_from_root) * pxToWorld
        return {
            x: this.root.position.x + (hand.cx - rootAnchor.cx) * this.pxToWorld,
            y: this.root.position.y + (rootAnchor.cy - hand.cy) * this.pxToWorld,
            z: this.root.position.z
        };
    }

    getBlockerAabb() {
        const halfW = 20 * this.pxToWorld;
        const halfH = 12 * this.pxToWorld;
        return {
            minX: this.root.position.x - halfW,
            maxX: this.root.position.x + halfW,
            minY: this.root.position.y - halfH,
            maxY: this.root.position.y + halfH,
        };
    }

    /**
     * Delegate gate — 供 StateGraph transition 评估调用。
     * throwComponent 为 null（没投掷能力）→ 永远 false。
     */
    canThrow() {
        return this.throwComponent?.canThrow?.() ?? false;
    }

    _getCurrentRootAnchor(frameIndex) {
        const colliderClip = this.config.clips?.[this.animation.currentClipName]?.colliderData;
        const rootFromCollider = colliderClip?.frames?.[frameIndex]?.anchors?.root ?? null;
        if (rootFromCollider) return rootFromCollider;

        // 回退到 rootMotionData（pickup/eat/drink/topack 等无 collider 的动画）
        return this.getRootAnchor(frameIndex) ?? null;
    }

    /** 获取当前帧的动作锚点（物品放置位置），{ cx, cy } 在帧像素坐标 */
    getActionAnchor(frameIndex) {
        const clipName = this.animation.currentClipName;
        const occupancy = this.config.rootMotionData?.[clipName];
        if (!occupancy?.frames) return null;
        return occupancy.frames[frameIndex]?.anchors?.action ?? null;
    }

    /** 获取当前帧的 root 锚点，{ cx, cy } 在帧像素坐标 */
    getRootAnchor(frameIndex) {
        const clipName = this.animation.currentClipName;
        const occupancy = this.config.rootMotionData?.[clipName];
        if (!occupancy?.frames) return null;
        return occupancy.frames[frameIndex]?.anchors?.root ?? null;
    }

    _getStateTimeScale(stateDef) {
        const hasBonus = this.hasTag("chainBonus")
                      || this.hasTag("postDefenseCounterActive");
        const base = hasBonus
            ? (stateDef.bonusTimeScale ?? stateDef.timeScale ?? 1.0)
            : (stateDef.timeScale ?? 1.0);

        // D1/D4/D5：疲劳减速只作用于 attack 类 + throw + clash（super.enterState 内调用时
        // currentStateName/currentStateDef 已指向新状态）；guard/dodge 豁免（D1/D9）
        const st = CombatTuning.stamina;
        if (st.enabled === false) return base;
        const name = this.currentStateName;
        const fatigable = stateDef?.attackActive === true
            || name === "throw"
            || name === "clash";
        if (!fatigable) return base;

        const slowdown = this.staminaSlowdown;
        return base / slowdown;
    }

    /** 当前疲劳减速因子（≥1.0，disabled=1.0）；动画减速与 AI 时序预测共用单一来源（疲劳计划 Step 2.1） */
    get staminaSlowdown() {
        const st = CombatTuning.stamina;
        if (st.enabled === false) return 1.0;
        return 1 + st.slowdownMax * (1 - this.staminaRatio);
    }

    get dodgeDisplacementScale() {
        return this._dodgeFrameSpeedScale ?? 1.0;
    }

    _matchesTransitionCondition(condition) {
        if (condition.command) {
            const canAct = this.canAct();
            const hasCmd = this.pendingCommands.includes(condition.command);
            if (!canAct) {
                return false;
            }
            // throw 专属 gate：弹药耗尽 → 连 throw 状态都不进
            if (condition.command === "throw" && !this.canThrow()) {
                return false;
            }
            return hasCmd;
        }

        return super._matchesTransitionCondition(condition);
    }

    _updateDebugPanel() {
        if (!this.debugPanel) return;
        if (!this.rootDebugVisible) {
            this.debugPanel.style.display = "none";
            return;
        }

        const canvas = this.scene.getEngine().getRenderingCanvas();
        if (!canvas) return;

        const worldPos = this.root.position.clone();
        worldPos.y -= 0.3;

        const projected = BABYLON.Vector3.Project(
            worldPos,
            BABYLON.Matrix.Identity(),
            this.scene.getTransformMatrix(),
            this.scene.activeCamera.viewport.toGlobal(canvas.width, canvas.height)
        );

        if (projected.z > 0 && projected.z < 1) {
            this.debugPanel.style.display = "block";
            this.debugPanel.style.left = `${projected.x - this.debugPanel.offsetWidth / 2}px`;
            this.debugPanel.style.top = `${projected.y}px`;
        } else {
            this.debugPanel.style.display = "none";
        }

        const moveSpeed = this.currentSpd;
        const cdRemaining = this.getCooldownRemaining().toFixed(0);

        const staminaEnabled = CombatTuning.stamina.enabled !== false;
        const staminaText = staminaEnabled
            ? ` | ST: ${this.combat.stamina.toFixed(1)}/${this.combat.maxStamina} (${(this.staminaRatio * 100).toFixed(0)}%)`
            : "";

        this.debugPanel.textContent = `y:${this.root.position.y.toFixed(2)} z:${this.root.position.z.toFixed(2)} alpha:${this.spritePlane.alphaIndex.toFixed(1)} | Speed: ${moveSpeed.toFixed(2)} | CD: ${cdRemaining}ms | HP: ${this.combat.hp}/${this.combat.maxHp}${staminaText}`;
    }

    get globalCooldownMs() { return this.combat.globalCooldownMs; }
    set globalCooldownMs(v) { this.combat.globalCooldownMs = v; }
    get lastActionTime() { return this.combat.lastActionTime; }
    set lastActionTime(v) { this.combat.lastActionTime = v; }
    get timeControl() { return this.combat.timeControl; }
    set timeControl(v) { this.combat.timeControl = v; }
    get timeControlSystem() { return this.combat.timeControlSystem; }
    set timeControlSystem(v) { this.combat.timeControlSystem = v; }
    get hp() { return this.combat.hp; }
    get maxHp() { return this.combat.maxHp; }
    get stamina() { return this.combat.stamina; }
    get maxStamina() { return this.combat.maxStamina; }
    get recoveryMultiplier() { return this.combat.recoveryMultiplier; }
    get costMultiplier() { return this.combat.costMultiplier; }
    get staminaRatio() {
        return this.combat.maxStamina > 0
            ? this.combat.stamina / this.combat.maxStamina
            : 0;
    }
    get isDead() { return this.combat.isDead; }

    getEffectiveCooldownMs() {
        if (!this.buffsProvider || typeof this.buffsProvider.getCdMultiplier !== "function") {
            return this.globalCooldownMs;
        }
        return this.globalCooldownMs * this.buffsProvider.getCdMultiplier();
    }

    canAct() {
        if (this.combat.isDead) return false;
        const now = performance.now();
        return now - this.lastActionTime >= this.getEffectiveCooldownMs();
    }

    getCooldownRemaining() {
        const now = performance.now();
        const remaining = this.getEffectiveCooldownMs() - (now - this.lastActionTime);
        return Math.max(0, remaining);
    }

    triggerCooldown() {
        this.lastActionTime = performance.now();
    }

    heal(amount = 1) {
        if (this.combat.isDead) return;
        const before = this.combat.hp;
        this.combat.hp = Math.min(this.combat.maxHp, this.combat.hp + amount);
        console.log(`[Heal] +${this.combat.hp - before} HP (${this.combat.hp}/${this.combat.maxHp})`);
    }

    takeDamage(ctx = {}) {
        if (this.currentStateDef?.invincible || this.combat.isDead) {
            return false;
        }

        const damage = Number(ctx.damage ?? 1);
        this.combat.hp = Math.max(0, this.combat.hp - damage);

        if (this.combat.hp <= 0) {
            this.combat.isDead = true;
            const deathState = ctx.deathState || this.combat.deathState;
            if (this.hasState(deathState)) {
                this.enterState(deathState);
            }
            return true;
        }

        const knockbackX = Number(ctx.knockbackX ?? 0);
        if (knockbackX !== 0) {
            this.root.position.x += knockbackX;
        }

        const hitState = ctx.hitState || "hit";
        if (!this.hasState(hitState)) {
            return false;
        }

        if (this.currentStateName !== hitState) {
            this.enterState(hitState);
        } else {
            // 已经在 hit 状态，仍重播 hit 动画表示新的伤害
            this.animation.play(this.currentStateDef.clip, { restart: true });
        }

        return true;
    }

    /** 刀光采样（§6.1）：动画帧推进之后调用，读当前 clip 的 trailMarkers 做世界空间采样 */
    _updateTrailRenderer() {
        if (!this.trailRenderer) return;
        const clipDef = this.config.clips?.[this.animation.currentClipName];
        this.trailRenderer.update({
            colliderClip: clipDef?.colliderData ?? null,
            frameIndex: this.animation.currentFrameIndex,
            rootPosition: this.root.position,
            facing: this.facing,
            trajectory: this.currentStateDef?.attackTrajectory ?? null,
        });
    }

    /**
     * 刀光生命周期兜底（§6.2）：离开攻击状态时强制隐藏。
     * 常规消失时机是取样帧结束（TrailRenderer.update 内"无 marker 帧 + ribbon 在显示"→ hide），
     * 此处兜住 clip 每帧都有 marker 等边界情况。
     * 构造期间基类会先调 enterState(initialState)，此时 trailRenderer 尚未赋值，optional chaining 兜住。
     */
    enterState(stateName, tickCount = null, overrides = {}) {
        const prevStateDef = this.currentStateDef;
        const prevStateName = this.currentStateName;
        super.enterState(stateName, tickCount, overrides);
        if (prevStateDef?.attackActive === true && stateName !== prevStateName) {
            this.trailRenderer?.hide();
            this.animationEventBus?.dispatch({ type: "stop_sfx", source: this });
        }
        // 构造期间基类会先调 enterState(initialState)，此时 combat 尚未赋值，跳过
        if (this.combat) {
            this._commitStaminaCost();
            // D9 dodge 位移缩放：commit 时刻锁存本次 dodge 的位移系数，动画帧率不变仅位移变短
            if (this.currentStateDef?.dodgeActive === true) {
                const floor = CombatTuning.stamina.dodgeScaleFloor;
                this._dodgeFrameSpeedScale = floor + (1 - floor) * this.staminaRatio;
            } else {
                this._dodgeFrameSpeedScale = 1.0;
            }
        }
    }

    /**
     * 26.11.9 攻击耐力计划 Step 1：攻击基础消耗表唯一读取口（防止 AI 预测与实际扣费两处漂移）
     * @param {string} attackWeight "heavy" | "light"
     * @returns {number} 基础成本（未乘 costMultiplier）
     */
    #attackBaseCost(attackWeight) {
        const costs = CombatTuning.stamina.costs;
        return attackWeight === "heavy" ? costs.attackHeavy : costs.attackLight;
    }

    /**
     * 26.11.9 攻击耐力计划 Step 1：攻击 commit 成本查询口（供 AI Gate 预测用，与实际扣费同源）
     * @param {string} attackWeight "heavy" | "light"（缺省按 light 口径）
     * @returns {number} 本次攻击 commit 实付成本（已乘 costMultiplier）；系统关闭时返回 0
     */
    getAttackCommitCost(attackWeight) {
        if (CombatTuning.stamina.enabled === false) return 0;
        return this.#attackBaseCost(attackWeight) * this.combat.costMultiplier;
    }

    /**
     * Step 1.2 基础消耗：commit 时刻扣费 —— 被打断也自动已扣；玩家与 AI 走同一入口，规则对称
     * 分类依据 D1~D6：attack 按 attackWeight 扣 / guard / dodge 扣；throw 不扣；hit 等其他状态不扣
     */
    _commitStaminaCost() {
        const st = CombatTuning.stamina;
        if (st.enabled === false) return;

        const stateDef = this.currentStateDef;
        let cost = 0;
        let insufficientGuard = false;

        if (stateDef?.attackActive === true) {
            cost = this.#attackBaseCost(stateDef.attackWeight);
        } else if (stateDef?.guardActive === true) {
            cost = st.costs.guard;
            // D3/P1：判定线 = commit 时刻扣费前的耐力，本次 guard 全程共用这个结果
            insufficientGuard = this.combat.stamina < cost * this.combat.costMultiplier;
        } else if (stateDef?.dodgeActive === true) {
            cost = st.costs.dodge;
        }

        this.combat.staminaInsufficientGuard = insufficientGuard;

        if (cost <= 0) return;
        const paid = cost * this.combat.costMultiplier;
        this.combat.stamina = Math.max(0, this.combat.stamina - paid);
    }

    /**
     * Step 1.3 结果追加消耗：按 outcome 查表扣费（miss 挥空重罚 / parried / guard_blocked / clash 轻罚 / hit 0）
     * 回传路径有两条：miss 由本类退出攻击状态时直接触发，其余经 CombatSystem dispatch —— 两处都调本方法
     */
    applyOutcomeStaminaCost(outcome) {
        const st = CombatTuning.stamina;
        if (st.enabled === false) return;
        const cost = st.outcomeCosts?.[outcome] ?? 0;
        if (cost <= 0) return;
        const paid = cost * this.combat.costMultiplier;
        this.combat.stamina = Math.max(0, this.combat.stamina - paid);
    }

    /**
     * 防御成功耐力回补（guard:success 含 parry / dodge:success）—— 成功打折、失败全额的净成本分层。
     * 回补乘 recoveryMultiplier（体能好的角色防守更经济），cap 到满值。
     */
    applyDefenseSuccessRefund(outcome) {
        const st = CombatTuning.stamina;
        if (st.enabled === false) return;
        const refund = st.successRefunds?.[outcome] ?? 0;
        if (refund <= 0) return;
        const gain = refund * this.combat.recoveryMultiplier;
        this.combat.stamina = Math.min(
            this.combat.maxStamina,
            this.combat.stamina + gain
        );
    }

    /**
     * Step 1.4 恢复：非战斗状态按速率回充，高强度状态（P3：含 guard）暂停恢复。
     * dt 用 effectiveDeltaMs —— hitstop 冻结时 delta=0，天然暂停；不建恢复阶段状态机。
     */
    _regenStamina(dtMs) {
        const st = CombatTuning.stamina;
        if (st.enabled === false) return;
        if (dtMs <= 0) return;
        if (this.combat.stamina >= this.combat.maxStamina) return;

        const name = this.currentStateName;
        const stateDef = this.currentStateDef;
        const busy = stateDef?.attackActive === true
            || stateDef?.guardActive === true
            || stateDef?.dodgeActive === true
            || name === "throw"
            || name === "clash"
            || name === "hit"
            || name === "stunned";
        if (busy) return;

        this.combat.stamina = Math.min(
            this.combat.maxStamina,
            this.combat.stamina + st.regenPerSecond * (dtMs / 1000) * this.combat.recoveryMultiplier
        );
    }

    getCombatSnapshot() {
        const clipName = this.animation.currentClipName;
        const clipDef = this.config?.clips?.[clipName];
        const colliderClip = clipDef?.colliderData;
        const frameIndex = this.animation.currentFrameIndex;
        const animationFrame = this.animation.currentFrame;
        const colliderFrame = colliderClip?.frames?.[frameIndex];
        const boxes = colliderFrame?.boxes ?? [];
        const frameWidth = animationFrame?.w ?? colliderFrame?.frameRect?.w ?? 0;
        const frameHeight = animationFrame?.h ?? colliderFrame?.frameRect?.h ?? 0;
        const anchor = colliderFrame?.anchors?.root ?? null;
        const anchorOffsetX = anchor ? (anchor.cx - frameWidth / 2) * this.pxToWorld : 0;
        const anchorOffsetY = anchor ? (frameHeight / 2 - anchor.cy) * this.pxToWorld : 0;
        const hasWeapon = boxes.some((box) => box.type === "weaponbox");
        const isAttackState = this.currentStateDef?.attackActive === true;
        const attackInstanceId = (isAttackState && hasWeapon)
            ? `${this.id}:${this.currentStateName}:${this.stateEntrySerial}`
            : null;

        let isActiveAttackFrame = false;
        if (isAttackState && hasWeapon) {
            const startMs = this.currentStateDef?.attackActiveStartMs;
            const durationMs = this.currentStateDef?.attackActiveDurationMs;
            if (startMs != null) {
                const elapsedMs = this.animation.elapsedInClipMs;
                const endMs = startMs + (durationMs ?? 1000);
                isActiveAttackFrame = elapsedMs >= startMs && elapsedMs < endMs;
            } else {
                // fallback: 旧的 frame-based 逻辑
                const attackActiveFrames = this.currentStateDef?.attackActiveFrames;
                isActiveAttackFrame = attackActiveFrames === undefined || attackActiveFrames.includes(frameIndex);
            }
        }

        const isInvincible = this.currentStateDef?.invincible === true || this.currentStateDef?.dodgeActive === true;
        const worldBoxes = boxes
            // 不再 filter 掉 invincible 的 hitbox，而是标记 invincible 标志
            // ContactResolver Phase 2 会检查这个标志来 skip
            .map((box) => ({
                ...box,
                invincible: isInvincible && box.type === "hitbox"
            }))
            .map((box) => {
                const localX = (box.cx - frameWidth / 2) * this.pxToWorld - anchorOffsetX;
                const localY = (frameHeight / 2 - box.cy) * this.pxToWorld - anchorOffsetY;
                const widthWorld = box.w * this.pxToWorld;
                const heightWorld = box.h * this.pxToWorld;
                const depthWorld = this.thicknessPx * this.pxToWorld;

                const passiveShieldDisabled = this.currentStateDef?.passiveShieldDisabled === true;
                const effectiveGuardType = this.currentStateDef?.guardType
                    || (this.config?.guardType && !passiveShieldDisabled ? this.config.guardType : null);
                const boxRole = box.type === "weaponbox"
                    ? (box.subtype === "strong_blade"
                        ? (effectiveGuardType ? "shield" : null)
                        : (isActiveAttackFrame ? "attack" : null))
                    : null;

                return {
                    id: box.id,
                    type: box.type,
                    subtype: box.subtype ?? null,
                    boxRole,
                    attackInstanceId: box.type === "weaponbox" ? attackInstanceId : null,
                    weaponRole: box.type === "weaponbox"
                        ? (isActiveAttackFrame ? "offense" : "guard")
                        : null,
                    attackWeight: boxRole === "attack" ? (this.currentStateDef?.attackWeight ?? null) : null,
                    attackTrajectory: boxRole === "attack" ? (this.currentStateDef?.attackTrajectory ?? null) : null,
                    // 音频材质细分：攻击 box 带招式撞击材质；所有 box 带该角色当前呈现的接触面材质
                    // （guard/shield 态 override → 状态图 bodySurface 兜底，供 ContactResolver 组装 combat_impact context）
                    impactMaterial: boxRole === "attack" ? (this.currentStateDef?.impactMaterial ?? null) : null,
                    contactSurface: this.currentStateDef?.contactSurface ?? this.stateGraph?.bodySurface ?? null,
                    guardType: boxRole === "shield" ? effectiveGuardType : null,
                    canParry: box.type === "weaponbox" && this.currentStateDef?.guardType === "guard",
                    center: {
                        x: this.root.position.x + localX,
                        y: this.root.position.y + localY,
                        z: this.root.position.z
                    },
                    half: {
                        x: widthWorld / 2,
                        y: heightWorld / 2,
                        z: depthWorld / 2
                    },
                    angle: box.angle ?? 0
                };
            });
        const stateImpact = this.currentStateDef?.impact ?? {};
        const impact = {
            attackKnockback: stateImpact.knockback ?? CombatTuning.hit.victimKnockbackX,
            attackHitstopFrames: stateImpact.hitstopFrames ?? CombatTuning.hit.hitstopFrames,
            pushbackMultiplier: stateImpact.pushbackMultiplier ?? 0.05,
        };
        return {
            characterId: this.id,
            stateName: this.currentStateName,
            frameIndex: this.animation.currentFrameIndex,
            rootPositionX: this.root.position.x,
            facing: this.facing,
            attackInstanceId,
            stateEnterTick: this.stateEnterTick,
            dodgeActive: this.currentStateDef?.dodgeActive === true,
            staminaInsufficientGuard: this.combat?.staminaInsufficientGuard === true,
            boxes: worldBoxes,
            impact
        };
    }

    /**
     * pushback 消费（hitstop 结束后，与 sprite 更新同帧执行）
     * - pending 模式：等帧索引变化（即 sprite 切到下一帧）才开始消费
     * - 非 pending 模式：hitstop 解冻后直接开始消费（最后一帧命中时）
     */
    _consumePushbackIfReady() {
        const tc = this.combat?.timeControl;
        if (!tc || tc.hitstopFrames > 0 || tc.impactContext) return;
        if (tc.hitstopPushbackFrames <= 0) return;

        // 解除 pending：hitstop 解冻后帧索引已经变了
        if (tc.hitstopPushbackPending) {
            if (this.animation.currentFrameIndex !== tc.hitstopPushbackStartFrameIndex) {
                tc.hitstopPushbackPending = false;
            } else {
                return; // 帧还没变，等下一帧
            }
        }

        this.root.position.x += tc.hitstopPushbackPerFrame;
        tc.hitstopPushbackFrames--;
        if (tc.hitstopPushbackFrames <= 0) {
            this._suppressFrameSpeeds = false;
        }
    }

    setMoveIntent(intent) {
        super.setMoveIntent(intent);
    }

    applyHitstop(frames) {
        this.timeControlSystem.applyHitstop(this, frames);
    }

    applyBlockstun(frames) {
        this.timeControlSystem.applyBlockstun(this, frames);
    }

    freezeImpact(durationFrames, options = {}) {
        this.timeControlSystem.freezeImpact(this, durationFrames, {
            ...options,
            startTick: this.tickCount
        });
    }

    get impactContext() {
        return this.timeControl.impactContext;
    }

    get hitstopFrames() {
        return this.timeControl.hitstopFrames;
    }

    get blockstunFrames() {
        return this.timeControl.blockstunFrames;
    }

    get hitstunFrames() {
        return this.timeControl.hitstunFrames;
    }

    fixedUpdate(dtMs, tickCount) {
        // [JITTER_DEBUG] 记录位置突变（CombatCharacter 覆盖了父类 fixedUpdate，需单独调用）
        this._checkJitter(tickCount);

        this.tickCount = tickCount;

        this.trailRenderer?.tick(dtMs);   // 刀光消散进度推进（E3）；非消散状态内部直接 return

        if (this.combat.isDead) {
            this.animation.fixedUpdate(dtMs);
            const newFrame = this.animation.currentFrameIndex;
            this._applyFrame(newFrame);
            const current = this.animation.currentFrame;
            const anchor = this._getCurrentRootAnchor(newFrame);
            this._applyRootAlignment(current.w, current.h, anchor);
            this._syncRootDebug(anchor);
            this.collision.syncToFrame(newFrame, current.w, current.h, anchor);
            this._updateDebugPanel();
            return;
        }

        const timeControlFrame = this.timeControlSystem.tick(this, dtMs, tickCount);
        const effectiveDeltaMs = timeControlFrame.effectiveDeltaMs;
        this._regenStamina(effectiveDeltaMs);
        if (this.debugTrace) {
            const impact = this.timeControl.impactContext;
            const impactNextState = impact?.nextState ?? null;
            const impactFrames = impact?.frames ?? 0;
            console.log(
                `[CharTrace] tick=${tickCount} id=${this.id} state=${this.currentStateName} entry=${this.stateEntrySerial} mode=${timeControlFrame.mode}` +
                ` hs=${this.timeControl.hitstopFrames} bs=${this.timeControl.blockstunFrames} hts=${this.timeControl.hitstunFrames}` +
                ` impactFrames=${impactFrames} impactNext=${impactNextState} effectiveDt=${effectiveDeltaMs}`
            );
        }

        if (timeControlFrame.shouldAdvanceTimedTags) {
            for (const [tag, expireTick] of this.timedTags) {
                if (tickCount >= expireTick) {
                    this.stateTags.delete(tag);
                    this.timedTags.delete(tag);
                }
            }
        }

        if (timeControlFrame.shouldAdvanceAnimation && !timeControlFrame.shouldRunStateLogic) {
            const oldFrameWhenFrozen = this.animation.currentFrameIndex;
            this.animation.fixedUpdate(effectiveDeltaMs);
            const newFrameWhenFrozen = this.animation.currentFrameIndex;
            if (newFrameWhenFrozen !== oldFrameWhenFrozen) {
                this._applyFrame(newFrameWhenFrozen);
            }
            const currentWhenFrozen = this.animation.currentFrame;
            const anchorWhenFrozen = this._getCurrentRootAnchor(newFrameWhenFrozen);
            this._applyRootAlignment(currentWhenFrozen.w, currentWhenFrozen.h, anchorWhenFrozen);
            this._syncRootDebug(anchorWhenFrozen);
            this.collision.syncToFrame(newFrameWhenFrozen, currentWhenFrozen.w, currentWhenFrozen.h, anchorWhenFrozen);
            this._updateDebugPanel();
            this._consumePushbackIfReady();
            this._updateTrailRenderer();   // blockstun/hitstun 期间动画仍推进，采样继续；hitstop 冻结不进此路径（D6）
            return;
        }

        if (!timeControlFrame.shouldRunStateLogic) {
            return;
        }

        // postDefenseCounter pending：改后防守方 parry 不进 clash（只有 blockstun），
        // 解冻后仍在 guard 状态——如果只在 enterState 里激活 pending 就永远不会触发。
        // 这里在固定更新路径上补一次：只要已经解冻，就激活 pending，
        // 让 guard 状态下也能满足 guard→nachschlag/quart 的 hasTag 条件。
        if (this._pendingPostDefenseCounter !== null) {
            const durationFrames = this._pendingPostDefenseCounter;
            this._pendingPostDefenseCounter = null;
            this.addTimedTag("postDefenseCounterActive", durationFrames);
        }

        const oldState = this.currentStateName;
        const oldStateDef = oldState ? this.stateGraph?.states?.[oldState] : null;
        const oldAttackActive = oldStateDef?.attackActive === true;

        const nextStateBeforeUpdate = this._consumeTransition();
        if (nextStateBeforeUpdate) {
            this.enterState(nextStateBeforeUpdate, tickCount);
        }

        // Feedback Memory: 进入攻击状态 → 重置命中标志 + 保存 attackInstanceId
        const newStateDefBeforeAnim = this.currentStateDef;
        const newAttackActiveBeforeAnim = newStateDefBeforeAnim?.attackActive === true;
        if (!oldAttackActive && newAttackActiveBeforeAnim) {
            this._lastAttackHadHit = false;
            // 保存当前 attackInstanceId（退出时需要它来检查 resolved）
            this._currentAttackInstanceId = this.getCombatSnapshot().attackInstanceId;
            // 容量控制：定期清理已 resolved 的旧攻击记录
            if (this._resolvedAttackIds.size > 20) {
                const arr = [...this._resolvedAttackIds];
                this._resolvedAttackIds = new Set(arr.slice(-10));
            }
        }

        const oldFrame = this.animation.currentFrameIndex;
        this.animation.fixedUpdate(effectiveDeltaMs);
        const newFrame = this.animation.currentFrameIndex;

        if (newFrame !== oldFrame) {
            this._applyFrame(newFrame);
        }

        const current = this.animation.currentFrame;
        const anchor = this._getCurrentRootAnchor(newFrame);
        this._applyRootAlignment(current.w, current.h, anchor);
        this._syncRootDebug(anchor);
        this.collision.syncToFrame(newFrame, current.w, current.h, anchor);

        this._consumePushbackIfReady(); // pushback 和 sprite 更新同帧

        this._applyMovement(effectiveDeltaMs);
        this._updateTrailRenderer();   // 动画帧推进 + root 位移之后采样（D4 世界空间）

        const newState = this.currentStateName;
        const newStateDef = this.currentStateDef;
        const newAttackActive = newStateDef?.attackActive === true;

        // committed 状态 = 进入后有代价的状态，退出到 idle 应触发 cooldown
        // 注意：全部基于 oldState（退出的那个状态），不能用 newState
        // hitstunFrames 在 StateGraph JSON 里不存在（运行时只存在于 TimeControlComponent），所以用 oldState==="hit" 替代
        const wasCommittedState = oldAttackActive
            || oldStateDef?.guardActive === true
            || oldState === "hit";
        if (oldState !== newState && newState === "idle" && wasCommittedState) {
            this.triggerCooldown();
        }

        // Feedback Memory: 攻击状态退出 → 判定 miss
        // 条件：old 是 attackActive，new 不是，且 CombatSystem 也没回过传任何结果给这次攻击
        if (oldAttackActive && !newAttackActive && oldState !== newState) {
            const attackInstanceId = this._currentAttackInstanceId;
            const alreadyResolved = attackInstanceId ? this._resolvedAttackIds.has(attackInstanceId) : false;
            if (!this._lastAttackHadHit && !alreadyResolved) {
                this.applyOutcomeStaminaCost("miss");
                if (this.controller?.onCombatResult) {
                    this.controller.onCombatResult({ outcome: "miss", targetState: oldState });
                }
            }
            // 重置 currentInstanceId
            this._currentAttackInstanceId = null;
        }

        this._updateDebugPanel();

        // [JITTER_DEBUG] 保存当前位置用于下一帧对比
        this._prevRootPos.copyFrom(this.root.position);
    }

    _consumeTransition() {
        if (this.controlledBySequence) return null;
        const outsideY = this._battleYMin != null && this._battleYMax != null
            && (this.root.position.y < this._battleYMin || this.root.position.y > this._battleYMax);
        const savedY = this.moveIntent.y;
        if (outsideY) {
            this.moveIntent.y = 0;
        }
        const result = super._consumeTransition();
        this.moveIntent.y = savedY;
        return result;
    }

    _applyMovement(dtMs) {
        const xBefore = this.root.position.x;
        const yBefore = this.root.position.y;

        const outsideY = this._battleYMin != null && this._battleYMax != null
            && (this.root.position.y < this._battleYMin || this.root.position.y > this._battleYMax);
        const savedMoveIntentY = this.moveIntent.y;
        if (outsideY) {
            this.moveIntent.y = 0;
        }

        super._applyMovement(dtMs);

        this.moveIntent.y = savedMoveIntentY;

        if (this._battleYMin == null || this._battleYMax == null) return;

        if (this.root.position.x === xBefore && this.root.position.y === yBefore) return;

        const pos = this.root.position;
        if (pos.y >= this._battleYMin && pos.y <= this._battleYMax) return;

        const dtSec = (dtMs ?? 16) / 1000;
        const blend = 1 - Math.exp(-this._battleYCorrectionSpeed * dtSec);

        if (pos.y < this._battleYMin) {
            pos.y += (this._battleYMin - pos.y) * blend;
        } else {
            pos.y += (this._battleYMax - pos.y) * blend;
        }
    }
}