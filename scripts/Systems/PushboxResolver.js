export class PushboxResolver {
    constructor(options = {}) {
        this.iterations = options.iterations ?? 1;
    }

    resolve(characters = []) {
        for (let iter = 0; iter < this.iterations; iter++) {
            const snapshots = [];
            for (const character of characters) {
                if (!character || typeof character.getCombatSnapshot !== "function") {
                    continue;
                }
                const snapshot = character.getCombatSnapshot();
                const pushboxes = snapshot.boxes.filter((box) => box.type === "pushbox");
                if (pushboxes.length > 0) {
                    snapshots.push({
                        characterId: snapshot.characterId,
                        rootPositionX: snapshot.rootPositionX,
                        pushboxes
                    });
                }
            }

            for (let i = 0; i < snapshots.length; i++) {
                for (let j = i + 1; j < snapshots.length; j++) {
                    this.#resolvePair(snapshots[i], snapshots[j], characters);
                }
            }
        }
    }

    #resolvePair(a, b, characters) {
        let maxOverlap = 0;

        for (const pbA of a.pushboxes) {
            for (const pbB of b.pushboxes) {
                const overlap = this.#computeXOverlap(pbA, pbB);
                if (overlap > maxOverlap) {
                    maxOverlap = overlap;
                }
            }
        }

        if (maxOverlap <= 0) return;

        const charA = characters.find((c) => c?.id === a.characterId);
        const charB = characters.find((c) => c?.id === b.characterId);
        if (!charA || !charB) return;

        const movingA = Math.abs(charA.moveIntent?.x ?? 0) > (charA.moveDeadzone ?? 0.2);
        const movingB = Math.abs(charB.moveIntent?.x ?? 0) > (charB.moveDeadzone ?? 0.2);

        let shiftA = 0;
        let shiftB = 0;

        if (movingA && !movingB) {
            shiftA = a.rootPositionX < b.rootPositionX ? -maxOverlap : maxOverlap;
        } else if (!movingA && movingB) {
            shiftB = a.rootPositionX < b.rootPositionX ? maxOverlap : -maxOverlap;
        } else {
            shiftA = a.rootPositionX < b.rootPositionX ? -maxOverlap * 0.5 : maxOverlap * 0.5;
            shiftB = a.rootPositionX < b.rootPositionX ? maxOverlap * 0.5 : -maxOverlap * 0.5;
        }

        if (shiftA !== 0) {
            charA.root.position.x += shiftA;
        }
        if (shiftB !== 0) {
            charB.root.position.x += shiftB;
        }
    }

    #computeXOverlap(pbA, pbB) {
        const halfA = pbA.half.x;
        const halfB = pbB.half.x;
        const centerA = pbA.center.x;
        const centerB = pbB.center.x;
        const dist = Math.abs(centerA - centerB);
        const minDist = halfA + halfB;
        if (dist >= minDist) return 0;
        return minDist - dist;
    }
}