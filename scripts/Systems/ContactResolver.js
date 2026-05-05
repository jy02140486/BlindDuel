export class ContactResolver {
    constructor(options = {}) {
        // 命中去重：同一攻击实例对同一目标只生效一次（跨帧保留，攻击结束后清理）。
        this.hitDedupe = new Set();
        // 拼刀去重：同一对攻击实例只处理一次拼刀结果（跨帧保留，任一攻击结束后清理）。
        this.clashDedupe = new Set();
        // 防守接触去重：同一攻击实例对同一防守方只处理一次拦截结果。
        this.guardDedupe = new Set();
        this.hitKnockback = options.hitKnockback ?? 0.12;
        this.clashKnockback = options.clashKnockback ?? 0.2;
    }

    resolve(characters = []) {
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

        // 同帧快照接触：先收集，不立即生效，避免“调用先后”影响结果。
        const frameContacts = this.#collectFrameContacts(snapshots);
        const invalidatedAttacks = new Set();
        const effects = [];

        // Phase 1: 先结算 weapon vs weapon（拼刀优先于打到身体）。
        for (const contact of frameContacts.weaponVsWeapon) {
            const attackA = contact.boxA.attackInstanceId;
            const attackB = contact.boxB.attackInstanceId;
            const aOffense = Boolean(attackA);
            const bOffense = Boolean(attackB);

            if (!aOffense && !bOffense) {
                continue;
            }

            if (aOffense !== bOffense) {
                const offenseAttackId = aOffense ? attackA : attackB;
                const offenseCharacterId = aOffense ? contact.characterA : contact.characterB;
                const guardCharacterId = aOffense ? contact.characterB : contact.characterA;
                const offenseBox = aOffense ? contact.boxA : contact.boxB;
                const guardBox = aOffense ? contact.boxB : contact.boxA;
                const guardKey = `${offenseAttackId}|${guardCharacterId}`;
                if (this.guardDedupe.has(guardKey)) {
                    continue;
                }
                this.guardDedupe.add(guardKey);

                const offenseLevel = this.#toWeaponLevel(offenseBox.subtype);
                const guardLevel = this.#toWeaponLevel(guardBox.subtype);
                if (this.#weaponLevelRank(guardLevel) >= this.#weaponLevelRank(offenseLevel)) {
                    invalidatedAttacks.add(offenseAttackId);
                    const offensePos = snapshotById.get(offenseCharacterId)?.rootPositionX ?? 0;
                    const guardPos = snapshotById.get(guardCharacterId)?.rootPositionX ?? 0;

                    // Just Guard 时机判定
                    const offenseSnapshot = snapshotById.get(offenseCharacterId);
                    const guardSnapshot = snapshotById.get(guardCharacterId);
                    const offenseEnterTick = offenseSnapshot?.stateEnterTick ?? 0;
                    const guardEnterTick = guardSnapshot?.stateEnterTick ?? 0;
                    const tickDiff = guardEnterTick - offenseEnterTick;
                    // 预判 guard：guard 第一帧或比攻击早进入
                    const isPreemptiveGuard = guardSnapshot?.frameIndex === 0 || tickDiff <= 7;
                    const canParry = guardBox.canParry && isPreemptiveGuard;

                    console.log(`[GUARD] ${guardCharacterId} guardBox.canParry=${guardBox.canParry}, tickDiff=${tickDiff}, guardFrame=${guardSnapshot?.frameIndex}, isPreemptive=${isPreemptiveGuard}, canParry=${canParry}, guardState=${guardSnapshot?.stateName}, offenseState=${offenseSnapshot?.stateName}`);
                    if (canParry) {
                        console.log(`[PARRY] Adding parryBonus to ${guardCharacterId}`);
                        effects.push({
                            type: "parryBonus",
                            targetId: guardCharacterId
                        });
                        effects.push({ type: "clash", targetId: guardCharacterId });
                        // 攻击方也被弹开，进入硬直
                        effects.push({
                            type: "clash",
                            targetId: offenseCharacterId,
                            context: {
                                hitState: "hit",
                                knockbackX: this.#signedKnockback(offensePos, guardPos, this.clashKnockback)
                            }
                        });
                        effects.push({ type: "hitstop", targetId: offenseCharacterId, durationFrames: 8 });
                        effects.push({ type: "hitstop", targetId: guardCharacterId, durationFrames: 8 });
                    } else {
                        effects.push({ type: "blockstun", targetId: guardCharacterId, durationFrames: 10 });
                        effects.push({ type: "hitstop", targetId: offenseCharacterId, durationFrames: 4 });
                        effects.push({ type: "hitstop", targetId: guardCharacterId, durationFrames: 4 });
                    }
                }
                continue;
            }

            const clashKey = this.#buildClashKey(attackA, attackB);
            if (this.clashDedupe.has(clashKey)) {
                continue;
            }

            this.clashDedupe.add(clashKey);
            const levelA = this.#toWeaponLevel(contact.boxA.subtype);
            const levelB = this.#toWeaponLevel(contact.boxB.subtype);
            const posA = snapshotById.get(contact.characterA)?.rootPositionX ?? 0;
            const posB = snapshotById.get(contact.characterB)?.rootPositionX ?? 0;

            if (levelA === levelB) {
                // 同级拼刀：双方攻击都失效，双方都进入弹刀/受击反馈。
                invalidatedAttacks.add(attackA);
                invalidatedAttacks.add(attackB);

                effects.push(
                    this.#buildClashEffect(contact.characterA, contact.characterB, "clash_tie", posA, posB),
                    this.#buildClashEffect(contact.characterB, contact.characterA, "clash_tie", posB, posA)
                );
                effects.push({ type: "hitstop", targetId: contact.characterA, durationFrames: 8 });
                effects.push({ type: "hitstop", targetId: contact.characterB, durationFrames: 8 });
                continue;
            }

            const strongIsA = levelA === "strong_blade";
            const loserId = strongIsA ? contact.characterB : contact.characterA;
            const winnerId = strongIsA ? contact.characterA : contact.characterB;
            const loserAttack = strongIsA ? attackB : attackA;
            const loserPos = strongIsA ? posB : posA;
            const winnerPos = strongIsA ? posA : posB;

            // 强压弱：仅弱方攻击失效并触发弹刀/受击反馈。
            invalidatedAttacks.add(loserAttack);
            effects.push(this.#buildClashEffect(loserId, winnerId, "clash_lose", loserPos, winnerPos));
            effects.push({ type: "hitstop", targetId: loserId, durationFrames: 6 });
            effects.push({ type: "hitstop", targetId: winnerId, durationFrames: 4 });
        }

        // Phase 2: 再结算 weapon vs hitbox（若攻击在拼刀阶段失效或非激活攻击帧则跳过）。
        for (const contact of frameContacts.weaponVsHitbox) {
            const attackId = contact.weapon.attackInstanceId;
            const attackerSnap = snapshotById.get(contact.attackerId);
            const targetSnap = snapshotById.get(contact.targetId);
            console.log(
                `[Phase2] ${contact.attackerId} -> ${contact.targetId} | ` +
                `weaponRole=${contact.weapon.weaponRole} attackId=${attackId ?? 'null'} | ` +
                `attackerState=${attackerSnap?.stateName} frame=${attackerSnap?.frameIndex} | ` +
                `targetState=${targetSnap?.stateName} frame=${targetSnap?.frameIndex}`
            );
            if (!attackId || contact.weapon.weaponRole !== "offense" || invalidatedAttacks.has(attackId)) {
                continue;
            }

            const hitKey = `${attackId}|${contact.targetId}`;
            if (this.hitDedupe.has(hitKey)) {
                continue;
            }

            this.hitDedupe.add(hitKey);
            const attackerPos = snapshotById.get(contact.attackerId)?.rootPositionX ?? 0;
            const targetPos = snapshotById.get(contact.targetId)?.rootPositionX ?? 0;
            const knockback = this.#signedKnockback(targetPos, attackerPos, this.hitKnockback);
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
                targetId: contact.targetId,
                context: {
                    attackInstanceId: attackId,
                    attackerId: contact.attackerId,
                    targetId: contact.targetId,
                    attackLevel: this.#toWeaponLevel(contact.weapon.subtype),
                    contactType: "weapon_vs_hitbox",
                    damage: 1,
                    hitState: "hit",
                    knockbackX: knockback
                }
            });
        }

        return { frameContacts, effects };
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

    #toWeaponLevel(subtype) {
        return subtype === "strong_blade" ? "strong_blade" : "weak_blade";
    }

    #weaponLevelRank(level) {
        return level === "strong_blade" ? 2 : 1;
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
                knockbackX: this.#signedKnockback(targetPos, otherPos, this.clashKnockback)
            }
        };
    }
}
