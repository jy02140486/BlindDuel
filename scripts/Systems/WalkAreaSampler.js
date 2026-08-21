/**
 * WalkAreaSampler — constraint projection sampler (NOT a Unity-style nearest-point query).
 *
 * Projects rawTarget onto a point that simultaneously satisfies:
 *   - within walkArea rectangle
 *   - outside every staticBlocker AABB (expanded by padding)
 *   - outside every dynamicConstraint AABB (e.g. player as dynamic follow constraint)
 *
 * Algorithm: walkArea clamp → blocker MTV push (per-direction clamp preview, fallback to
 * next-smallest direction) → walkArea clamp. Per-direction clamp preview prevents the
 * "push → clamp reverts → push → reverts" dead loop that maxIter alone cannot break.
 *
 * Returns { x, y, changed, failed }.
 *   - changed: true if (x,y) differs from input
 *   - failed:  true if at least one blocker couldn't be resolved (e.g. player wedged
 *             against wall + large padding); caller should hold previous target
 *
 * Backward compat: if the 5th arg is an options object (old callers, e.g. ExploreMode),
 * it is treated as options and dynamicConstraints defaults to [].
 */
export class WalkAreaSampler {
    static _lastWarnMs = 0;

    static sample(x, y, walkArea, staticBlockers, dynamicConstraints, options = {}) {
        if (dynamicConstraints && !Array.isArray(dynamicConstraints) && typeof dynamicConstraints === "object") {
            options = dynamicConstraints;
            dynamicConstraints = [];
        }
        const padding = options.padding ?? 0;
        const maxIter = options.maxIter ?? 4;
        const agentX = options.agentX;
        const agentY = options.agentY;

        const allBlockers = [...(staticBlockers ?? []), ...(dynamicConstraints ?? [])];

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
            let iterUnresolved = false;
            for (const blocker of allBlockers) {
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
                    iterUnresolved = true;
                }
            }
            unresolved = iterUnresolved;
            if (!pushed) break;
        }

        if (walkArea) {
            if (tx < walkArea.minX) tx = walkArea.minX;
            else if (tx > walkArea.maxX) tx = walkArea.maxX;
            if (ty < walkArea.minY) ty = walkArea.minY;
            else if (ty > walkArea.maxY) ty = walkArea.maxY;
        }

        if (unresolved) {
            const now = (typeof performance !== "undefined" ? performance.now() : Date.now());
            if (now - WalkAreaSampler._lastWarnMs > 500) {
                WalkAreaSampler._lastWarnMs = now;
                console.warn(`[WalkAreaSampler] sample failed (unresolved blocker): raw=(${x.toFixed(2)}, ${y.toFixed(2)}) cur=(${tx.toFixed(2)}, ${ty.toFixed(2)})`);
            }
        }

        return { x: tx, y: ty, changed: (tx !== x || ty !== y), failed: unresolved };
    }
}