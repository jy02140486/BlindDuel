// ProjectileManager — lifecycle manager for Projectile entities in BattleMode.
// Designed per plans/26.9.24 投掷物实现计划.MD §4
// Lightweight shell: owns lifecycle, does NOT make combat rules decisions.

import { Projectile } from "../Enties/Projectile.js";

export class ProjectileManager {
    constructor(context) {
        this.context = context;         // { scene, entityPool, ... }
        this._projectiles = [];         // active projectiles (may include ones marked for destroy)
        this._destroyIds = new Set();    // projectile IDs to flush at end of tick
    }

    spawn(config) {
        const scene = this.context.scene;
        if (!scene) {
            console.error("[ProjectileManager] spawn failed: scene missing in context");
            return null;
        }

        const proj = new Projectile(scene, config);
        this._projectiles.push(proj);

        // Register with Scene.entityPool — Scene will automatically handle snapshot/restore/interpolate
        if (this.context.entityPool) {
            this.context.entityPool.push(proj);
        }

        return proj;
    }

    fixedUpdate(dtMs, tickCount) {
        // Integrate all active projectiles. Destroyed ones skip.
        for (const proj of this._projectiles) {
            if (proj.isDestroyed) continue;
            proj.fixedUpdate(dtMs, tickCount);
        }
    }

    getActiveProjectiles() {
        // Filter to only live projectiles for ProjectileContactResolver.
        return this._projectiles.filter(p => !p.isDestroyed);
    }

    requestDestroy(projectileId) {
        // Called by CombatSystem when projectile_destroy effect fires.
        // Marked for flushing at end of current tick.
        const proj = this._projectiles.find(p => p.id === projectileId);
        if (proj) proj.isDestroyed = true;
        this._destroyIds.add(projectileId);
    }

    flushDestroyed() {
        // Remove destroyed projectiles from entityPool and dispose Babylon resources.
        const pool = this.context.entityPool;
        if (pool) {
            for (const proj of this._projectiles) {
                if (proj.isDestroyed && proj._renderTransformSynced !== false) {
                    // Remove from Scene's entity pool (snapshot/interpolate chain)
                    const idx = pool.indexOf(proj);
                    if (idx >= 0) pool.splice(idx, 1);
                }
            }
        }

        // Dispose + cleanup array
        for (const proj of this._projectiles) {
            if (proj.isDestroyed) {
                proj.dispose();
            }
        }

        this._projectiles = this._projectiles.filter(p => !p.isDestroyed);
        this._destroyIds.clear();
    }

    clearAll() {
        // Called on BattleMode.exit() to clean up everything.
        for (const proj of this._projectiles) {
            proj.isDestroyed = true;
        }
        this.flushDestroyed();
    }

    get count() {
        return this._projectiles.filter(p => !p.isDestroyed).length;
    }
}