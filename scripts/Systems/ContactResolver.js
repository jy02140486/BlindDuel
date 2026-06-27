export class ContactResolver {
    constructor(options = {}) {
        // 命中去重：同一攻击实例对同一目标只生效一次（跨帧保留，攻击结束后清理）。
        this.hitDedupe = new Set();
        // 拼刀去重：同一对攻击实例只处理一次拼刀结果（跨帧保留，任一攻击结束后清理）。
        this.clashDedupe = new Set();
        // 防守接触去重：同一攻击实例对同一防守方只处理一次拦截结果。
        this.guardDedupe = new Set();
        // 攻击失效集合：被盾牌拦截或拼刀失败的攻击，跨帧保留直到攻击结束。
        this.invalidatedAttacks = new Set();
        this.hitKnockback = options.hitKnockback ?? 0.12;
        this.clashKnockback = options.clashKnockback ?? 0.2;
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
        // this.#dumpContacts(snapshots, frameContacts, tickCount);

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
                    // console.log(`[Resolver-P1] tick=${tickCount} SKIP: guard dedupe hit for ${guardKey}`);
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
                    const isPreemptiveGuard = guardFrameIdx === 0 || tickDiff <= 16;
                    const canParry = defenseBox.canParry && isPreemptiveGuard;

                    this.#trace(
                        `[ResolverPhase1] block offense=${offenseCharId} defense=${defenseCharId}` +
                        ` trajectory=${trajectory} guardType=${guardType} canParry=${canParry}`
                    );

                    if (canParry) {
                        effects.push({ type: "parryBonus", targetId: defenseCharId, context: { durationFrames: 40 } });
                        effects.push({ type: "clash", targetId: defenseCharId });
                        effects.push({ type: "clash", targetId: offenseCharId, context: { hitState: "hit", knockbackX: this.#signedKnockback(offensePos, defensePos, this.clashKnockback) } });
                        effects.push({ type: "hitstop", targetId: offenseCharId, durationFrames: 8 });
                        effects.push({ type: "hitstop", targetId: defenseCharId, durationFrames: 8 });
                    } else {
                        effects.push({ type: "blockstun", targetId: defenseCharId, durationFrames: 10 });
                        effects.push({ type: "hitstop", targetId: offenseCharId, durationFrames: 4 });
                        effects.push({ type: "hitstop", targetId: defenseCharId, durationFrames: 4 });
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
                effects.push({ type: "hitstop", targetId: contact.characterA, durationFrames: 8 });
                effects.push({ type: "hitstop", targetId: contact.characterB, durationFrames: 8 });
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
            effects.push({ type: "hitstop", targetId: loserId, durationFrames: 6 });
            effects.push({ type: "hitstop", targetId: winnerId, durationFrames: 4 });
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
                // console.log(
                //     `[Resolver-P2] tick=${tickCount} SKIP | attacker=${contact.attackerId}(${contact.weapon.id}) target=${contact.targetId}(${contact.hitbox.id}) | ` +
                //     `reason=${skipReason} attackId=${attackId}`
                // );
                continue;
            }

            const hitKey = `${attackId}|${contact.targetId}`;
            if (this.hitDedupe.has(hitKey)) {
                // console.log(`[Resolver-P2] tick=${tickCount} SKIP: hit dedupe for ${hitKey}`);
                continue;
            }

            this.hitDedupe.add(hitKey);
            // console.log(
            //     `[Resolver-P2] tick=${tickCount} >>> HIT <<< attacker=${contact.attackerId}(${contact.weapon.id}) target=${contact.targetId}(${contact.hitbox.id}) | ` +
            //     `attackId=${attackId} attackerState=${attackerSnap?.stateName}@${attackerSnap?.frameIndex} targetState=${targetSnap?.stateName}@${targetSnap?.frameIndex} | ` +
            //     `wpnCenter=(${contact.weapon.center.x.toFixed(3)},${contact.weapon.center.y.toFixed(3)}) hitCenter=(${contact.hitbox.center.x.toFixed(3)},${contact.hitbox.center.y.toFixed(3)})`
            // );
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

    // #dumpContacts(snapshots, frameContacts, tickCount) {
    //     const { weaponVsWeapon, weaponVsHitbox } = frameContacts;
    //     const snapshotById = new Map();
    //     for (const s of snapshots) snapshotById.set(s.characterId, s);
    //
    //     console.log(
    //         `[Resolver-DUMP] tick=${tickCount} === FRAME CONTACTS === ` +
    //         `weaponVsWeapon=${weaponVsWeapon.length} weaponVsHitbox=${weaponVsHitbox.length}`
    //     );
    //
    //     for (const c of weaponVsWeapon) {
    //         const snapA = snapshotById.get(c.characterA);
    //         const snapB = snapshotById.get(c.characterB);
    //         console.log(
    //             `[Resolver-DUMP] tick=${tickCount} WvW | ` +
    //             `A=${c.characterA}(${snapA?.stateName}@${snapA?.frameIndex}) boxA=${c.boxA.id}(role=${c.boxA.boxRole},subtype=${c.boxA.subtype}) ` +
    //             `centerA=(${c.boxA.center.x.toFixed(3)},${c.boxA.center.y.toFixed(3)}) halfA=(${c.boxA.half.x.toFixed(3)},${c.boxA.half.y.toFixed(3)}) angleA=${c.boxA.angle} | ` +
    //             `B=${c.characterB}(${snapB?.stateName}@${snapB?.frameIndex}) boxB=${c.boxB.id}(role=${c.boxB.boxRole},subtype=${c.boxB.subtype}) ` +
    //             `centerB=(${c.boxB.center.x.toFixed(3)},${c.boxB.center.y.toFixed(3)}) halfB=(${c.boxB.half.x.toFixed(3)},${c.boxB.half.y.toFixed(3)}) angleB=${c.boxB.angle}`
    //         );
    //     }
    //
    //     for (const c of weaponVsHitbox) {
    //         const atkSnap = snapshotById.get(c.attackerId);
    //         const tgtSnap = snapshotById.get(c.targetId);
    //         console.log(
    //             `[Resolver-DUMP] tick=${tickCount} WvH | ` +
    //             `attacker=${c.attackerId}(${atkSnap?.stateName}@${atkSnap?.frameIndex}) weapon=${c.weapon.id}(role=${c.weapon.boxRole}) ` +
    //             `wpnCenter=(${c.weapon.center.x.toFixed(3)},${c.weapon.center.y.toFixed(3)}) | ` +
    //             `target=${c.targetId}(${tgtSnap?.stateName}@${tgtSnap?.frameIndex}) hitbox=${c.hitbox.id} ` +
    //             `hitCenter=(${c.hitbox.center.x.toFixed(3)},${c.hitbox.center.y.toFixed(3)})`
    //         );
    //     }
    //
    //     console.log(`[Resolver-DUMP] tick=${tickCount} === END CONTACTS ===`);
    // }

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
                knockbackX: this.#signedKnockback(targetPos, otherPos, this.clashKnockback)
            }
        };
    }
}
