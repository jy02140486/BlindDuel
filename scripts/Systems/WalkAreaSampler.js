export class WalkAreaSampler {
    static sample(x, y, walkArea, blockers, options = {}) {
        const padding = options.padding ?? 0;
        const maxIter = options.maxIter ?? 4;
        const agentX = options.agentX;
        const agentY = options.agentY;

        let tx = x;
        let ty = y;

        if (walkArea) {
            if (tx < walkArea.minX) tx = walkArea.minX;
            else if (tx > walkArea.maxX) tx = walkArea.maxX;
            if (ty < walkArea.minY) ty = walkArea.minY;
            else if (ty > walkArea.maxY) ty = walkArea.maxY;
        }

        let unresolved = false;
        for (let iter = 0; iter < maxIter; iter++) {
            let pushed = false;
            for (const blocker of blockers ?? []) {
                if (typeof blocker.isBlockingNow === "function" && !blocker.isBlockingNow()) continue;
                const b = blocker.getBlockerAabb?.();
                if (!b) continue;

                const minX = b.minX - padding;
                const maxX = b.maxX + padding;
                const minY = b.minY - padding;
                const maxY = b.maxY + padding;
                if (tx <= minX || tx >= maxX || ty <= minY || ty >= maxY) continue;

                const dLeft = tx - minX;
                const dRight = maxX - tx;
                const dBottom = ty - minY;
                const dTop = maxY - ty;

                const candidates = [
                    { axis: 'x', dist: dLeft, val: minX },
                    { axis: 'x', dist: dRight, val: maxX },
                    { axis: 'y', dist: dBottom, val: minY },
                    { axis: 'y', dist: dTop, val: maxY },
                ];
                candidates.sort((a, c) => a.dist - c.dist);

                let resolvedThisBlocker = false;
                for (const cand of candidates) {
                    if (cand.dist <= 0) continue;
                    let nx = tx, ny = ty;
                    if (cand.axis === 'x') nx = cand.val;
                    else ny = cand.val;

                    if (walkArea) {
                        if (nx < walkArea.minX) nx = walkArea.minX;
                        else if (nx > walkArea.maxX) nx = walkArea.maxX;
                        if (ny < walkArea.minY) ny = walkArea.minY;
                        else if (ny > walkArea.maxY) ny = walkArea.maxY;
                    }

                    if (nx > minX && nx < maxX && ny > minY && ny < maxY) {
                        continue;
                    }
                    tx = nx; ty = ny;
                    resolvedThisBlocker = true;
                    pushed = true;
                    break;
                }
                if (!resolvedThisBlocker) {
                    unresolved = true;
                    console.warn(`[WalkAreaSampler] unresolved blocker: raw=(${x.toFixed(2)}, ${y.toFixed(2)}) cur=(${tx.toFixed(2)}, ${ty.toFixed(2)}) blocker=${JSON.stringify(b)}`);
                }
            }
            if (!pushed || unresolved) break;
        }

        if (walkArea) {
            if (tx < walkArea.minX) tx = walkArea.minX;
            else if (tx > walkArea.maxX) tx = walkArea.maxX;
            if (ty < walkArea.minY) ty = walkArea.minY;
            else if (ty > walkArea.maxY) ty = walkArea.maxY;
        }

        return { x: tx, y: ty, changed: (tx !== x || ty !== y) };
    }
}