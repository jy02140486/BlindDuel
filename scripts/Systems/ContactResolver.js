import { CombatTuning } from "../../Data/CombatTuning.js";

export class ContactResolver {
    constructor(options = {}) {
        // 命中去重：同一攻击实例对同一目标只生效一次（跨帧保留，攻击结束后清理）。
        this.hitDedupe = new Set();
        // 拼刀去重：同一对攻击实例只处理一次拼刀结果（跨帧保留，任一攻击结束后清理）。
        this.clashDedupe = new Set();
        // 防守接触去重：同一攻击实例对同一防守方只处理一次拦截结果。
        this.guardDedupe = new Set();
        // defenseSuccess 去重：同一攻击实例对同一防守方只触发一次防守成功事件。
        this.defenseSuccessDedupe = new Set();
        // 攻击失效集合：被盾牌拦截或拼刀失败的攻击，跨帧保留直到攻击结束。
        this.invalidatedAttacks = new Set();
        // 接触异常去重：同一攻击实例对同一目标、同一异常类型只记录一次日志。
        this.contactExceptionDedupe = new Set();
        // 系统级战斗手感参数（嵌套对象，字段分组与 CombatTuning.js 一一对应）
        this.tuning = options.combatTuning ?? CombatTuning;
        this.debugTrace = options.debugTrace ?? false;
    }

    resolve(characters = [], context = {}) {
        const tickCount = context.tickCount ?? "?";
        const snapshots = [];
        const snapshotById = new Map();
        for (const character of characters) {
            if (!character || typeof character.getCombatSnapshot !== "function") {
                continue;
            }
            const snapshot = character.getCombatSnapshot();
            snapshots.push(snapshot);
            snapshotById.set(snapshot.characterId, snapshot);
        }

        const activeAttackIds = this.#collectActiveAttackIds(snapshots);
        this.#cleanupDedupe(activeAttackIds);

        // 同帧快照接触：先收集，不立即生效，避免"调用先后"影响结果。
        const frameContacts = this.#collectFrameContacts(snapshots);
        const invalidatedAttacks = this.invalidatedAttacks;
        const effects = [];

        // --- debug: 打印所有收集到的相交对 ---
        // if (frameContacts.weaponVsWeapon.length > 0 || frameContacts.weaponVsHitbox.length > 0) {
        //     this.#dumpContacts(snapshots, frameContacts, tickCount);
        // }

        // Phase 1: 先结算 weapon vs weapon（拼刀优先于打到身体）。
        for (const contact of frameContacts.weaponVsWeapon) {
            const snapA = snapshotById.get(contact.characterA);
            const snapB = snapshotById.get(contact.characterB);

            if (snapA?.dodgeActive || snapB?.dodgeActive) continue;

            const boxA = contact.boxA;
            const boxB = contact.boxB;
            const isAAttack = boxA.boxRole === "attack";
            const isBAttack = boxB.boxRole === "attack";
            const isAShield = boxA.boxRole === "shield";
            const isBShield = boxB.boxRole === "shield";

            if ((isAAttack && isBShield) || (isAShield && isBAttack)) {
                const offenseBox = isAAttack ? boxA : boxB;
                const defenseBox = isAAttack ? boxB : boxA;
                const offenseCharId = isAAttack ? contact.characterA : contact.characterB;
                const defenseCharId = isAAttack ? contact.characterB : contact.characterA;
                const offenseAttackId = offenseBox.attackInstanceId;

                // console.log(
                //     `[Resolver-P1] tick=${tickCount} attack-vs-shield | ` +
                //     `offense=${offenseCharId}(${offenseBox.id}) defense=${defenseCharId}(${defenseBox.id}) | ` +
                //     `trajectory=${offenseBox.attackTrajectory} weight=${offenseBox.attackWeight} guardType=${defenseBox.guardType} | ` +
                //     `attackId=${offenseAttackId} hasAttackId=${!!offenseAttackId}`
                // );

                if (!offenseAttackId) continue;

                const guardKey = `${offenseAttackId}|${defenseCharId}`;
                if (this.guardDedupe.has(guardKey)) {
                    continue;
                }
                this.guardDedupe.add(guardKey);

                const trajectory = offenseBox.attackTrajectory;
                const guardType = defenseBox.guardType;
                const weight = offenseBox.attackWeight;
                const offensePos = snapshotById.get(offenseCharId)?.rootPositionX ?? 0;
                const defensePos = snapshotById.get(defenseCharId)?.rootPositionX ?? 0;

                let blocked = false;
                if (guardType === "guard") {
                    if (trajectory !== "thrust") blocked = true;
                } else if (guardType === "shield") {
                    if (!(trajectory === "slash" && weight === "heavy")) {
                        blocked = true;  // 正常挡下（thrust / light slash）
                    } else {
                        // 破盾！heavy slash 击穿 shield
                        // shield 吸收本次伤害 → invalidatedAttacks 跳过 Phase 2 命中（不扣血）
                        invalidatedAttacks.add(offenseAttackId);
                        effects.push({
                            type: "shield_broken",
                            targetId: defenseCharId,
                            context: {
                                attackerId: offenseCharId,
                                attackInstanceId: offenseAttackId,
                                knockbackX: this.#signedKnockback(offensePos, defensePos, this.tuning.block.knockbackX)
                            }
                        });
                    }
                } else {
                    blocked = true;
                }

                // console.log(
                //     `[Resolver-P1] tick=${tickCount} block-result | blocked=${blocked} ` +
                //     `trajectory=${trajectory} weight=${weight} guardType=${guardType}`
                // );

                if (blocked) {
                    invalidatedAttacks.add(offenseAttackId);
                    const offenseSnapshot = snapshotById.get(offenseCharId);
                    const guardSnapshot = snapshotById.get(defenseCharId);
                    const guardFrameIdx = guardSnapshot?.frameIndex ?? -1;
                    const offenseEnterTick = offenseSnapshot?.stateEnterTick ?? 0;
                    const guardEnterTick = guardSnapshot?.stateEnterTick ?? 0;
                    const tickDiff = guardEnterTick - offenseEnterTick;
                    // Just Guard 判定：只看双方状态 enter 时间差的绝对值
                    // tickDiff ≈ 0 → 几乎同时进入 → Just Guard → preemptive → can parry
                    // tickDiff 负值且绝对值大（提前很久 enter guard）→ 不算 preemptive → 普通 guard_block
                    // tickDiff 正值（攻击已经出去了才 enter guard）→ 不算 preemptive → guard_block
                    // 注：不能用 guardFrameIdx === 0 做兜底——enter guard 第一帧 animation.play restart 后 frameIndex 一定是 0，
                    //      不管 Math.abs(tickDiff) 多大都会被放行，导致 hold guard 100% 触发 parry
                    const isPreemptiveGuard = Math.abs(tickDiff) <= this.tuning.parry.preemptiveTickDiffMax;
                    const canParry = defenseBox.canParry && isPreemptiveGuard;

                    this.#trace(
                        `[ResolverPhase1] block offense=${offenseCharId} defense=${defenseCharId}` +
                        ` trajectory=${trajectory} guardType=${guardType} canParry=${canParry}`
                    );

                    if (canParry) {
                        this.#pushDefenseSuccess(defenseCharId, offenseCharId, offenseAttackId, "parry", effects);
                        // 防守方：不进 clash，guard 动画继续播；加 blockstun 防止 guard→idle 过早（与 guard_block 对齐）
                        effects.push({ type: "blockstun", targetId: defenseCharId, durationFrames: this.tuning.block.blockstunFrames });
                        // 攻击方：freezeImpact 后走 clash（与拼刀统一），knockback 照给
                        // 注意：此处 attackerId 指向防守方（parry 来源），与普通 clash_lose 一致，
                        // 但缺少 contactType 字段，CombatSystem 用此区分 parried vs clash
                        effects.push({ type: "clash", targetId: offenseCharId, context: { attackerId: defenseCharId, knockbackX: this.#signedKnockback(offensePos, defensePos, this.tuning.block.knockbackX) } });
                        effects.push({ type: "hitstop", targetId: offenseCharId, durationFrames: this.tuning.parry.hitstopFrames });
                        effects.push({ type: "hitstop", targetId: defenseCharId, durationFrames: this.tuning.parry.hitstopFrames });
                    } else {
                        this.#pushDefenseSuccess(defenseCharId, offenseCharId, offenseAttackId, "guard_block", effects);
                        effects.push({ type: "blockstun", targetId: defenseCharId, durationFrames: this.tuning.block.blockstunFrames });
                        effects.push({ type: "hitstop", targetId: offenseCharId, durationFrames: this.tuning.block.hitstopFrames });
                        effects.push({ type: "hitstop", targetId: defenseCharId, durationFrames: this.tuning.block.hitstopFrames });
                    }
                }
                continue;
            }

            if (!isAAttack || !isBAttack) continue;

            const attackA = boxA.attackInstanceId;
            const attackB = boxB.attackInstanceId;
            if (!attackA || !attackB) continue;

            const clashKey = this.#buildClashKey(attackA, attackB);
            if (this.clashDedupe.has(clashKey)) continue;
            this.clashDedupe.add(clashKey);

            const weightA = boxA.attackWeight;
            const weightB = boxB.attackWeight;
            const posA = snapA?.rootPositionX ?? 0;
            const posB = snapB?.rootPositionX ?? 0;

            this.#trace(
                `[ResolverPhase1] clash-check A=${contact.characterA} B=${contact.characterB}` +
                ` attackA=${attackA} attackB=${attackB} weightA=${weightA} weightB=${weightB}`
            );

            if (weightA === weightB) {
                this.#trace(`[ResolverPhase1] clash-tie A=${contact.characterA} B=${contact.characterB}`);
                invalidatedAttacks.add(attackA);
                invalidatedAttacks.add(attackB);
                effects.push(
                    this.#buildClashEffect(contact.characterA, contact.characterB, "clash_tie", posA, posB),
                    this.#buildClashEffect(contact.characterB, contact.characterA, "clash_tie", posB, posA)
                );
                effects.push({ type: "hitstop", targetId: contact.characterA, durationFrames: this.tuning.clash.tieHitstopFrames });
                effects.push({ type: "hitstop", targetId: contact.characterB, durationFrames: this.tuning.clash.tieHitstopFrames });
                continue;
            }

            const heavyIsA = weightA === "heavy";
            const loserId = heavyIsA ? contact.characterB : contact.characterA;
            const winnerId = heavyIsA ? contact.characterA : contact.characterB;
            const loserAttack = heavyIsA ? attackB : attackA;
            const loserPos = heavyIsA ? posB : posA;
            const winnerPos = heavyIsA ? posA : posB;

            invalidatedAttacks.add(loserAttack);
            this.#trace(
                `[ResolverPhase1] clash-lose winner=${winnerId} loser=${loserId}` +
                ` winnerWeight=${heavyIsA ? weightA : weightB} loserWeight=${heavyIsA ? weightB : weightA}`
            );
            effects.push(this.#buildClashEffect(loserId, winnerId, "clash_lose", loserPos, winnerPos));
            effects.push({ type: "hitstop", targetId: loserId, durationFrames: this.tuning.clash.loseLoserHitstopFrames });
            effects.push({ type: "hitstop", targetId: winnerId, durationFrames: this.tuning.clash.loseWinnerHitstopFrames });
        }

        // Phase 2: 再结算 weapon vs hitbox（若攻击在拼刀阶段失效或非激活攻击帧则跳过）。
        for (const contact of frameContacts.weaponVsHitbox) {
            const attackId = contact.weapon.attackInstanceId;
            const attackerSnap = snapshotById.get(contact.attackerId);
            const targetSnap = snapshotById.get(contact.targetId);

            const skipReason = targetSnap?.dodgeActive ? "dodgeActive"
                : !attackId ? "noAttackId"
                : contact.weapon.boxRole !== "attack" ? `boxRole=${contact.weapon.boxRole}`
                : invalidatedAttacks.has(attackId) ? "attackInvalidated"
                : null;

            if (skipReason) {
                if (skipReason === "dodgeActive" && attackId) {
                    this.#pushDefenseSuccess(contact.targetId, contact.attackerId, attackId, "dodge", effects);
                }
                continue;
            }

            const hitKey = `${attackId}|${contact.targetId}`;
            if (this.hitDedupe.has(hitKey)) {
                continue;
            }

            this.hitDedupe.add(hitKey);
            const attackerPos = snapshotById.get(contact.attackerId)?.rootPositionX ?? 0;
            const targetPos = snapshotById.get(contact.targetId)?.rootPositionX ?? 0;
            const attackerImpact = snapshotById.get(contact.attackerId)?.impact ?? {};
            const requestedKnockback = attackerImpact.attackKnockback ?? this.tuning.hit.victimKnockbackX;
            const knockback = this.#signedKnockback(targetPos, attackerPos, requestedKnockback);


/*
            const attackerSnap = snapshotById.get(contact.attackerId);
            const targetSnap = snapshotById.get(contact.targetId);
            const w = contact.weapon;
            const h = contact.hitbox;
            console.log(
                `[HIT] ${contact.attackerId} -> ${contact.targetId} | ` +
                `attackerState=${attackerSnap?.stateName} frame=${attackerSnap?.frameIndex} ` +
                `targetState=${targetSnap?.stateName} frame=${targetSnap?.frameIndex} | ` +
                `weaponBox=${w.id} center=(${w.center.x.toFixed(3)},${w.center.y.toFixed(3)}) half=(${w.half.x.toFixed(3)},${w.half.y.toFixed(3)}) | ` +
                `hitbox=${h.id} center=(${h.center.x.toFixed(3)},${h.center.y.toFixed(3)}) half=(${h.half.x.toFixed(3)},${h.half.y.toFixed(3)}) | ` +
                `distX=${Math.abs(w.center.x - h.center.x).toFixed(3)} sumHalfX=${(w.half.x + h.half.x).toFixed(3)} | ` +
                `distY=${Math.abs(w.center.y - h.center.y).toFixed(3)} sumHalfY=${(w.half.y + h.half.y).toFixed(3)}`
            );*/

            effects.push({
                type: "hit",
                targetId: contact.targetId,
                context: {
                    attackInstanceId: attackId,
                    attackerId: contact.attackerId,
                    targetId: contact.targetId,
                    attackLevel: null,
                    contactType: "weapon_vs_hitbox",
                    damage: 1,
                    hitState: "hit",
                    knockbackX: knockback,
                    attackHitstopFrames: attackerImpact.attackHitstopFrames ?? this.tuning.hit.hitstopFrames,
                    pushbackMultiplier: attackerImpact.pushbackMultiplier ?? 0.05,
                }
            });
        }

        this.#detectContactExceptions(snapshots, frameContacts, effects, tickCount);

        return { frameContacts, effects };
    }

    #trace(message) {
        if (this.debugTrace) {
            console.log(message);
        }
    }

    #collectActiveAttackIds(snapshots) {
        const ids = new Set();
        for (const snapshot of snapshots) {
            for (const box of snapshot.boxes) {
                if (box.type === "weaponbox" && box.attackInstanceId) {
                    ids.add(box.attackInstanceId);
                }
            }
        }
        return ids;
    }

    #cleanupDedupe(activeAttackIds) {
        // 攻击实例不再活跃时，释放相关命中去重记录。
        for (const key of this.hitDedupe) {
            const [attackId] = key.split("|");
            if (!activeAttackIds.has(attackId)) {
                this.hitDedupe.delete(key);
            }
        }

        // 任一攻击实例结束时，释放对应拼刀去重记录。
        for (const key of this.clashDedupe) {
            const [attackA, attackB] = key.split("::");
            if (!activeAttackIds.has(attackA) || !activeAttackIds.has(attackB)) {
                this.clashDedupe.delete(key);
            }
        }

        for (const key of this.guardDedupe) {
            const [attackId] = key.split("|");
            if (!activeAttackIds.has(attackId)) {
                this.guardDedupe.delete(key);
            }
        }

        for (const key of this.defenseSuccessDedupe) {
            const [attackId] = key.split("|");
            if (!activeAttackIds.has(attackId)) {
                this.defenseSuccessDedupe.delete(key);
            }
        }

        for (const attackId of this.invalidatedAttacks) {
            if (!activeAttackIds.has(attackId)) {
                this.invalidatedAttacks.delete(attackId);
            }
        }

        for (const key of this.contactExceptionDedupe) {
            const [attackId] = key.split("|");
            if (!activeAttackIds.has(attackId)) {
                this.contactExceptionDedupe.delete(key);
            }
        }
    }

    #collectFrameContacts(snapshots) {
        const weaponVsWeapon = [];
        const weaponVsHitbox = [];

        for (let i = 0; i < snapshots.length; i += 1) {
            for (let j = i + 1; j < snapshots.length; j += 1) {
                const a = snapshots[i];
                const b = snapshots[j];
                const aWeapons = a.boxes.filter((box) => box.type === "weaponbox");
                const bWeapons = b.boxes.filter((box) => box.type === "weaponbox");
                const aHitboxes = a.boxes.filter((box) => box.type === "hitbox");
                const bHitboxes = b.boxes.filter((box) => box.type === "hitbox");

                for (const boxA of aWeapons) {
                    for (const boxB of bWeapons) {
                        if (!this.#intersects(boxA, boxB)) {
                            continue;
                        }
                        weaponVsWeapon.push({
                            characterA: a.characterId,
                            characterB: b.characterId,
                            boxA,
                            boxB
                        });
                    }
                }

                for (const weapon of aWeapons) {
                    for (const hitbox of bHitboxes) {
                        if (!this.#intersects(weapon, hitbox)) {
                            continue;
                        }
                        weaponVsHitbox.push({
                            attackerId: a.characterId,
                            targetId: b.characterId,
                            weapon,
                            hitbox
                        });
                    }
                }

                for (const weapon of bWeapons) {
                    for (const hitbox of aHitboxes) {
                        if (!this.#intersects(weapon, hitbox)) {
                            continue;
                        }
                        weaponVsHitbox.push({
                            attackerId: b.characterId,
                            targetId: a.characterId,
                            weapon,
                            hitbox
                        });
                    }
                }
            }
        }

        return { weaponVsWeapon, weaponVsHitbox };
    }

    #dumpContacts(snapshots, frameContacts, tickCount) {
        /*
        const { weaponVsWeapon, weaponVsHitbox } = frameContacts;
        const snapshotById = new Map();
        for (const s of snapshots) snapshotById.set(s.characterId, s);

        console.log(
            `[Resolver-DUMP] tick=${tickCount} === FRAME CONTACTS === ` +
            `weaponVsWeapon=${weaponVsWeapon.length} weaponVsHitbox=${weaponVsHitbox.length}`
        );

        for (const c of weaponVsWeapon) {
            const snapA = snapshotById.get(c.characterA);
            const snapB = snapshotById.get(c.characterB);
            console.log(
                `[Resolver-DUMP] tick=${tickCount} WvW | ` +
                `A=${c.characterA}(${snapA?.stateName}@${snapA?.frameIndex}) boxA=${c.boxA.id}(role=${c.boxA.boxRole},subtype=${c.boxA.subtype}) ` +
                `centerA=(${c.boxA.center.x.toFixed(3)},${c.boxA.center.y.toFixed(3)}) halfA=(${c.boxA.half.x.toFixed(3)},${c.boxA.half.y.toFixed(3)}) angleA=${c.boxA.angle} | ` +
                `B=${c.characterB}(${snapB?.stateName}@${snapB?.frameIndex}) boxB=${c.boxB.id}(role=${c.boxB.boxRole},subtype=${c.boxB.subtype}) ` +
                `centerB=(${c.boxB.center.x.toFixed(3)},${c.boxB.center.y.toFixed(3)}) halfB=(${c.boxB.half.x.toFixed(3)},${c.boxB.half.y.toFixed(3)}) angleB=${c.boxB.angle}`
            );
        }

        for (const c of weaponVsHitbox) {
            const atkSnap = snapshotById.get(c.attackerId);
            const tgtSnap = snapshotById.get(c.targetId);
            console.log(
                `[Resolver-DUMP] tick=${tickCount} WvH | ` +
                `attacker=${c.attackerId}(${atkSnap?.stateName}@${atkSnap?.frameIndex}) weapon=${c.weapon.id}(role=${c.weapon.boxRole}) ` +
                `wpnCenter=(${c.weapon.center.x.toFixed(3)},${c.weapon.center.y.toFixed(3)}) | ` +
                `target=${c.targetId}(${tgtSnap?.stateName}@${tgtSnap?.frameIndex}) hitbox=${c.hitbox.id} ` +
                `hitCenter=(${c.hitbox.center.x.toFixed(3)},${c.hitbox.center.y.toFixed(3)})`
            );
        }

        console.log(`[Resolver-DUMP] tick=${tickCount} === END CONTACTS ===`);
        */
    }

    #intersects(a, b) {
        return this.#obbIntersect2D(a, b);
    }

    #obbIntersect2D(a, b) {
        const aAngle = (a.angle ?? 0) * Math.PI / 180;
        const bAngle = (b.angle ?? 0) * Math.PI / 180;

        const aCos = Math.cos(aAngle);
        const aSin = Math.sin(aAngle);
        const bCos = Math.cos(bAngle);
        const bSin = Math.sin(bAngle);

        const axes = [
            { x: aCos, y: aSin },
            { x: -aSin, y: aCos },
            { x: bCos, y: bSin },
            { x: -bSin, y: bCos }
        ];

        for (const axis of axes) {
            if (this.#separatedOnAxis(a, b, axis)) {
                return false;
            }
        }

        return true;
    }

    #separatedOnAxis(a, b, axis) {
        const aAngle = (a.angle ?? 0) * Math.PI / 180;
        const bAngle = (b.angle ?? 0) * Math.PI / 180;

        const aCos = Math.cos(aAngle);
        const aSin = Math.sin(aAngle);
        const bCos = Math.cos(bAngle);
        const bSin = Math.sin(bAngle);

        const aRx = Math.abs(axis.x * aCos + axis.y * aSin);
        const aRy = Math.abs(axis.x * -aSin + axis.y * aCos);
        const aProj = a.half.x * aRx + a.half.y * aRy;

        const bRx = Math.abs(axis.x * bCos + axis.y * bSin);
        const bRy = Math.abs(axis.x * -bSin + axis.y * bCos);
        const bProj = b.half.x * bRx + b.half.y * bRy;

        const dx = b.center.x - a.center.x;
        const dy = b.center.y - a.center.y;
        const dist = Math.abs(dx * axis.x + dy * axis.y);

        return dist > (aProj + bProj);
    }

    #buildClashKey(attackA, attackB) {
        return [attackA, attackB].sort().join("::");
    }

    #signedKnockback(targetPos, sourcePos, amount) {
        return targetPos >= sourcePos ? Math.abs(amount) : -Math.abs(amount);
    }

    #buildClashEffect(targetId, otherId, contactType, targetPos, otherPos) {
        return {
            type: "clash",
            targetId,
            context: {
                attackInstanceId: null,
                attackerId: otherId,
                targetId,
                attackLevel: null,
                contactType,
                damage: 0,
                hitState: "clash",
                knockbackX: this.#signedKnockback(targetPos, otherPos, this.tuning.block.knockbackX)
            }
        };
    }

    /**
     * 辅助方法：push defenseSuccess event（带 dedupe，同一攻击对同一防守方只 push 一次）
     * @param {string} defenseCharId - 防守方角色 id
     * @param {string} attackId - 被防住的攻击实例 id
     * @param {string} source - 防守来源："parry" | "guard_block" | "dodge"
     * @param {Array} effects - effects 数组（resolve 内的局部变量）
     */
    #pushDefenseSuccess(defenseCharId, offenseCharId, attackId, source, effects) {
        const key = `${attackId}|${defenseCharId}`;
        if (this.defenseSuccessDedupe.has(key)) return;
        this.defenseSuccessDedupe.add(key);
        effects.push({
            type: "defenseSuccess",
            targetId: defenseCharId,
            context: { source, attackerId: offenseCharId, attackInstanceId: attackId }
        });
    }

    // ==================== Phase 2: AI 查询接口 ====================

    /**
     * 纯规则查询：评估一次攻击对某种防御的结果。
     * 不依赖实例状态（hitDedupe / clashDedupe 等跨帧数据），AI 决策阶段用。
     *
     * @param {Object} params
     * @param {string}  params.offenseTrajectory  - "thrust" | "slash" | null
     * @param {string}  params.offenseWeight      - "light" | "heavy" | null
     * @param {string}  params.defenseGuardType   - "guard" | "shield" | null (null = 非 guard 状态)
     * @param {boolean} params.defenseIsDodging   - 是否处于 dodgeActive 状态
     * @param {boolean} [params.defenseCanParry]  - guard 状态是否支持 parry
     * @returns {{ blocked: boolean, dodged: boolean, parryable: boolean, willMiss: boolean }}
     */
    static evaluateInteraction({
        offenseTrajectory,
        offenseWeight,
        defenseGuardType,
        defenseIsDodging,
        defenseCanParry = false
    } = {}) {
        // Dodge 全免疫（Phase 1 规则：dodgeActive=true 跳过所有攻击命中）
        if (defenseIsDodging) {
            return { blocked: false, dodged: true, parryable: false, willMiss: true };
        }

        // Guard 拦截判定（ContactResolver.resolve Phase 1 的同一规则）
        let blocked = false;
        let shieldBroken = false;
        if (defenseGuardType === "guard") {
            // guard: 防 slash（light + heavy），不防 thrust
            if (offenseTrajectory !== "thrust") blocked = true;
        } else if (defenseGuardType === "shield") {
            // shield: 防 thrust + light slash，唯独 heavy slash 破盾
            if (!(offenseTrajectory === "slash" && offenseWeight === "heavy")) {
                blocked = true;
            } else {
                shieldBroken = true;  // heavy slash 击穿 → 破盾硬直
            }
        }
        // defenseGuardType 为 null 或其他 → 不拦截

        const parryable = blocked && defenseCanParry;

        return {
            blocked,
            shieldBroken,
            dodged: false,
            parryable,
            willMiss: blocked  // 对 AI 来说 blocked = 攻击打不中；shieldBroken = 穿透但触发对手破盾（对 AI 算命中）
        };
    }

    /**
     * 检测接触异常并记录日志（纯观察，不产生任何游戏效果）。
     * 两类异常：
     *   Case 1 (Overshoot): active attack 的 weaponbox 越过了 target 的 hitbox，
     *                      本帧无命中，也无 weapon-vs-hitbox 相交对——即空挥。
     *   Case 2 (ShieldBypass): Phase 2 产生了 hit，target 有 active shield box，
     *                         且攻击不是 heavy slash 但 guardDedupe 中没有
     *                         对应 attackId|targetId——即 Phase 1 根本没发生
     *                         shield-weaponbox 相交，本应被挡的攻击穿过了。
     */
    #detectContactExceptions(snapshots, frameContacts, effects, tickCount) {
        if (snapshots.length < 2) return;
        const snapshotById = new Map(snapshots.map((s) => [s.characterId, s]));

        // Phase 2 命中记录：本帧哪些 attackInstanceId 实际命中了谁
        const hitEffectMap = new Map(); // attackId -> Set<targetId>
        for (const fx of effects) {
            if (fx.type === "hit") {
                const { attackInstanceId, attackerId, targetId } = fx.context;
                if (attackInstanceId) {
                    if (!hitEffectMap.has(attackInstanceId)) hitEffectMap.set(attackInstanceId, new Set());
                    hitEffectMap.get(attackInstanceId).add(targetId);
                }
            }
        }

        // 构建 weapon-vs-hitbox 相交对的快速查找集，key: attackerId|weaponBoxId|targetId|hitboxId
        const wvhKeySet = new Set();
        for (const c of frameContacts.weaponVsHitbox) {
            wvhKeySet.add(`${c.attackerId}|${c.weapon.id}|${c.targetId}|${c.hitbox.id}`);
        }

        // ---- 遍历所有 snapshot 对 ----
        for (let i = 0; i < snapshots.length; i += 1) {
            for (let j = 0; j < snapshots.length; j += 1) {
                if (i === j) continue;
                const attacker = snapshots[i];
                const target = snapshots[j];

                // 防御方在 dodgeActive 时 hitbox 无敌，异常判定无意义
                if (target.dodgeActive) continue;

                const attackBoxes = attacker.boxes.filter((b) => b.type === "weaponbox" && b.boxRole === "attack");
                const hitboxes = target.boxes.filter((b) => b.type === "hitbox");
                if (attackBoxes.length === 0 || hitboxes.length === 0) continue;

                for (const weapon of attackBoxes) {
                    const attackId = weapon.attackInstanceId;
                    if (!attackId) continue;

                    for (const hitbox of hitboxes) {
                        // ---- Case 1: Overshoot ----
                        const keyC1 = `${attackId}|${target.characterId}|Case1`;
                        if (!this.contactExceptionDedupe.has(keyC1)) {
                            const overshot = this.#isOvershoot(attacker, weapon, target, hitbox);
                            if (overshot) {
                                const noContact = !wvhKeySet.has(
                                    `${attacker.characterId}|${weapon.id}|${target.characterId}|${hitbox.id}`
                                );
                                const noHit = !hitEffectMap.get(attackId)?.has(target.characterId);
                                if (noContact && noHit) {
                                    this.contactExceptionDedupe.add(keyC1);
                                    this.#logContactException(
                                        "Case1-Overshoot", tickCount,
                                        attacker, target,
                                        weapon, hitbox, null
                                    );
                                }
                            }
                        }

                        // ---- Case 2: ShieldBypass ----
                        const keyC2 = `${attackId}|${target.characterId}|Case2`;
                        if (!this.contactExceptionDedupe.has(keyC2)) {
                            const actuallyHit = hitEffectMap.get(attackId)?.has(target.characterId);
                            if (actuallyHit) {
                                const shieldBoxes = target.boxes.filter((b) => b.boxRole === "shield");
                                for (const shield of shieldBoxes) {
                                    const isHeavySlash = weapon.attackTrajectory === "slash" && weapon.attackWeight === "heavy";
                                    const phase1Intercepted = this.guardDedupe.has(`${attackId}|${target.characterId}`);
                                    // shield 应挡 light/thrust；heavy slash 破盾是正常设计，不算异常
                                    if (!isHeavySlash && !phase1Intercepted) {
                                        this.contactExceptionDedupe.add(keyC2);
                                        this.#logContactException(
                                            "Case2-ShieldBypass", tickCount,
                                            attacker, target,
                                            weapon, hitbox, shield
                                        );
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    /**
     * 判断 weaponbox 是否按 facing 方向越过了 hitbox 的最远 X 边界。
     * attacker.facing > 0 → 向右攻 → weapon.center.x > hitbox.center.x + hitbox.half.x
     * attacker.facing < 0 → 向左攻 → weapon.center.x < hitbox.center.x - hitbox.half.x
     */
    #isOvershoot(attacker, weapon, target, hitbox) {
        const dir = attacker.facing ?? 0;
        if (dir === 0) {
            // facing 不可用：用 rootPositionX 差值推断
            const atkOnLeft = attacker.rootPositionX < target.rootPositionX;
            return atkOnLeft
                ? weapon.center.x > hitbox.center.x + hitbox.half.x
                : weapon.center.x < hitbox.center.x - hitbox.half.x;
        }
        if (dir > 0) return weapon.center.x > hitbox.center.x + hitbox.half.x;
        return weapon.center.x < hitbox.center.x - hitbox.half.x;
    }

    /**
     * 输出 Contact Exception 日志。shieldBox 传 null 表示 Case 1。
     */
    #logContactException(caseType, tickCount, attacker, target, weapon, hitbox, shieldBox) {
        const aState = `${attacker.stateName}@${attacker.frameIndex}`;
        const tState = `${target.stateName}@${target.frameIndex}`;
        const aFacing = attacker.facing >= 0 ? "+1" : "-1";
        const wcx = weapon.center.x.toFixed(2);
        const wcy = weapon.center.y.toFixed(2);
        const hcx = hitbox.center.x.toFixed(2);
        const hcy = hitbox.center.y.toFixed(2);
        let parts = [
            `Contact Exception [${caseType}] tick=${tickCount}`,
            `| attacker=${attacker.characterId}(${aState}) facing=${aFacing}`,
            `target=${target.characterId}(${tState})`,
            `| weapon=${weapon.id} center=(${wcx},${wcy})`,
            `hitbox=${hitbox.id} center=(${hcx},${hcy})`,
        ];
        if (shieldBox) {
            const scx = shieldBox.center.x.toFixed(2);
            const scy = shieldBox.center.y.toFixed(2);
            parts.push(`shield=${shieldBox.id} center=(${scx},${scy})`);
            parts.push(
                `| weight=${weapon.attackWeight} trajectory=${weapon.attackTrajectory}`,
                `guardType=${shieldBox.guardType}`
            );
        } else {
            parts.push(
                `| attackerRootX=${attacker.rootPositionX.toFixed(2)}`,
                `targetRootX=${target.rootPositionX.toFixed(2)}`
            );
        }
        console.log(parts.join(" "));
    }
}
