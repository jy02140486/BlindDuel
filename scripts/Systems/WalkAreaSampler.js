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
                const minD = Math.min(dLeft, dRight, dBottom, dTop);

                if (minD === dLeft || minD === dRight) {
                    if (Math.abs(dLeft - dRight) < 1e-6) {
                        tx = (agentX !== undefined && agentX >= tx) ? maxX : minX;
                    } else {
                        tx = (minD === dLeft) ? minX : maxX;
                    }
                } else if (minD === dBottom || minD === dTop) {
                    if (Math.abs(dBottom - dTop) < 1e-6) {
                        ty = (agentY !== undefined && agentY >= ty) ? maxY : minY;
                    } else {
                        ty = (minD === dBottom) ? minY : maxY;
                    }
                }
                pushed = true;
            }
            if (!pushed) break;
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