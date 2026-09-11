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
                    if (!(trajectory === "slash" && weight === "heavy")) blocked = true;
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
                        this.#pushDefenseSuccess(defenseCharId, offenseAttackId, "parry", effects);
                        effects.push({ type: "clash", targetId: defenseCharId });
                        effects.push({ type: "clash", targetId: offenseCharId, context: { hitState: "hit", knockbackX: this.#signedKnockback(offensePos, defensePos, this.tuning.block.knockbackX) } });
                        effects.push({ type: "hitstop", targetId: offenseCharId, durationFrames: this.tuning.parry.hitstopFrames });
                        effects.push({ type: "hitstop", targetId: defenseCharId, durationFrames: this.tuning.parry.hitstopFrames });
                    } else {
                        this.#pushDefenseSuccess(defenseCharId, offenseAttackId, "guard_block", effects);
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
                    this.#pushDefenseSuccess(contact.targetId, attackId, "dodge", effects);
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
            const knockback = this.#signedKnockback(targetPos, attackerPos, this.tuning.hit.victimKnockbackX);


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
                    knockbackX: knockback
                }
            });
        }

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
    #pushDefenseSuccess(defenseCharId, attackId, source, effects) {
        const key = `${attackId}|${defenseCharId}`;
        if (this.defenseSuccessDedupe.has(key)) return;
        this.defenseSuccessDedupe.add(key);
        effects.push({ type: "defenseSuccess", targetId: defenseCharId, context: { source } });
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
        if (defenseGuardType === "guard") {
            // guard: 防 slash（light + heavy），不防 thrust
            if (offenseTrajectory !== "thrust") blocked = true;
        } else if (defenseGuardType === "shield") {
            // shield: 防 thrust + light slash，不防 heavy slash
            if (!(offenseTrajectory === "slash" && offenseWeight === "heavy")) blocked = true;
        }
        // defenseGuardType 为 null 或其他 → 不拦截

        const parryable = blocked && defenseCanParry;

        return {
            blocked,
            dodged: false,
            parryable,
            willMiss: blocked // 对 AI 来说 blocked = 攻击打不中
        };
    }
}
