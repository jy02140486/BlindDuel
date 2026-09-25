// Projectile — gameplay entity for thrown/shot projectiles (knives, daggers, etc.)
// Designed per plans/26.9.24 投掷物实现计划.MD §3
// NOT a Character subclass — independent simulation entity with fixed-size collider.

export class Projectile {
    constructor(scene, config) {
        this.scene = scene;
        this.id = config.id ?? `proj_${config.ownerId ?? "unknown"}_${Date.now()}`;
        this.ownerId = config.ownerId ?? null;
        this.teamId = config.teamId ?? null;
        this.cuttable = config.cuttable !== false;  // default true
        this.damage = config.damage ?? 1;
        this.lifetimeMs = config.lifetimeMs ?? 4000;
        this.isDestroyed = false;

        // --- Babylon transform hierarchy ---
        this.root = new BABYLON.TransformNode(this.id, scene);
        const startX = config.startPos?.x ?? 0;
        const startY = config.startPos?.y ?? 0;
        this.root.position.set(startX, startY, config.baseZ ?? 0);

        // --- Sprite plane (visual only, does not affect collision) ---
        const pxToWorld = config.pxToWorld ?? 0.03;
        const frameW = config.frame?.w ?? config.sourceSize?.w ?? 32;
        const frameH = config.frame?.h ?? config.sourceSize?.h ?? 32;
        const planeW = frameW * pxToWorld;
        const planeH = frameH * pxToWorld;

        this._buildSpritePlane(config, planeW, planeH);

        // --- Simulation state ---
        // Real gravity physics:
        //   X: constant horizontal velocity (specified directly)
        //   Y: gravity integration — initial up-velocity from arcHeight, lands at groundY
        //   No durationMs needed — flight time emerges naturally from arcHeight + gravity + drop
        this.simPos = { x: startX, y: startY };
        this.baseZ = config.baseZ ?? 0;
        this.prevSimPos = { ...this.simPos };
        this.spawnTick = config.spawnTick ?? 0;
        this._elapsedMs = 0;

        const groundY = config.groundY ?? 0;
        const arcHeight = config.arcHeight ?? 0; // peak height ABOVE startY (hand)
        const gravity = config.gravity ?? 20;    // world units/s²

        // Derive initial up-velocity from arcHeight: v0 = sqrt(2 * g * h)
        // arcHeight=0 → straight line (no arc), arcHeight>0 → real parabola
        const v0 = arcHeight > 0 ? Math.sqrt(2 * gravity * arcHeight) : 0;

        this.groundY = groundY;
        this.gravity = gravity;
        this.velocity = {
            x: config.velocity?.x ?? 6,       // constant horizontal speed
            y: config.velocity?.y ?? v0       // initial up-velocity (physics-derived default)
        };

        // --- Collider: fixed size, auto-computed from frameRect + optional override ---
        const halfPx = config.colliderHalfPx ?? {
            x: Math.round(frameW / 2),
            y: Math.round(frameH / 2)
        };
        const depthPx = config.colliderDepthPx ?? 4;
        this.colliderHalfWorld = {
            x: halfPx.x * pxToWorld,
            y: halfPx.y * pxToWorld,
            z: depthPx * pxToWorld / 2
        };

        // --- Render interpolation duck type (Scene.entityPool integration) ---
        this.renderTransform = {
            previous: new BABYLON.Vector3(startX, startY, this.root.position.z),
            current: new BABYLON.Vector3(startX, startY, this.root.position.z)
        };
        this.supportsRenderSampling = false;  // we use Scene's lerp, not custom
        this._renderTransformSynced = true;   // Scene interpolation guard
    }

    // ---------------------------------------------------------------
    // Sprite plane setup (PropEntity pattern)
    // ---------------------------------------------------------------
    _buildSpritePlane(config, planeW, planeH) {
        this.spritePlane = BABYLON.MeshBuilder.CreatePlane(`${this.id}_plane`, {
            width: planeW,
            height: planeH
        }, this.scene);
        this.spritePlane.parent = this.root;
        this.spritePlane.position.z = -0.02;       // slight forward push (no collision impact)
        this.spritePlane.position.y = planeH / 2;  // anchor at bottom of plane

        this.material = new BABYLON.StandardMaterial(`${this.id}_mat`, this.scene);
        this.material.emissiveColor = new BABYLON.Color3(1, 1, 1);
        this.material.backFaceCulling = false;
        this.material.useAlphaFromDiffuseTexture = true;
        this.material.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
        this.material.disableLighting = true;
        this.material.disableDepthWrite = true;
        this.spritePlane.material = this.material;
        this.spritePlane.renderingGroupId = config.renderingGroupId ?? 1;
        // alphaIndex = 9000: renders AFTER all chars/NPCs/props (alphaIndex=0)
        // but BEFORE depthMask (alphaIndex=10000) so stencil wall occlusion still works.
        // Same strategy as carried sprite — projectiles should always be visible.
        this.spritePlane.alphaIndex = 9000;

        if (config.spriteUrl) {
            const tex = new BABYLON.Texture(
                config.spriteUrl,
                this.scene,
                false,
                false,
                BABYLON.Texture.NEAREST_SAMPLINGMODE
            );
            tex.hasAlpha = true;
            tex.wrapU = BABYLON.Texture.CLAMP_ADDRESSMODE;
            tex.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
            this.material.diffuseTexture = tex;
            this._spriteTexture = tex;
        }
    }

    // ---------------------------------------------------------------
    // Render interpolation duck type (Scene.entityPool calls these)
    // ---------------------------------------------------------------
    snapshotRenderTransform() {
        // Scene calls this AFTER simulation.
        // previous = last frame's current, current = root.position (post-simulation)
        const rt = this.renderTransform;
        rt.previous.x = rt.current.x;
        rt.previous.y = rt.current.y;
        rt.previous.z = rt.current.z;
        rt.current.x = this.root.position.x;
        rt.current.y = this.root.position.y;
        rt.current.z = this.root.position.z;
    }

    restoreRenderTransform() {
        // Scene calls this BEFORE simulation (at start of fixedUpdate).
        // Reset root to tick N-1 position so simulation doesn't accumulate render interpolation.
        const prev = this.renderTransform.previous;
        this.root.position.x = prev.x;
        this.root.position.y = prev.y;
        this.root.position.z = prev.z;
    }

    // ---------------------------------------------------------------
    // Simulation
    // ---------------------------------------------------------------
    fixedUpdate(dtMs, tickCount) {
        if (this.isDestroyed) return;

        const dtSec = dtMs / 1000;
        this.prevSimPos.x = this.simPos.x;
        this.prevSimPos.y = this.simPos.y;

        // X: constant horizontal velocity
        this.simPos.x += this.velocity.x * dtSec;

        // Y: real gravity — vy decreases each frame (downward)
        this.velocity.y -= this.gravity * dtSec;
        this.simPos.y += this.velocity.y * dtSec;

        // Write Babylon root
        this.root.position.x = this.simPos.x;
        this.root.position.y = this.simPos.y;
        this.root.position.z = this.baseZ;

        // Landed — projectile touches floor, destroy
        if (this.simPos.y <= this.groundY) {
            this.simPos.y = this.groundY;  // snap to floor for collision accuracy
            this.isDestroyed = true;
            return;
        }

        // Lifetime safety net (fallback if floor never reached, e.g., arcHeight=0 straight shot)
        this._elapsedMs += dtMs;
        if (this._elapsedMs >= this.lifetimeMs) {
            this.isDestroyed = true;
        }
    }

    // ---------------------------------------------------------------
    // Collision contract (ProjectileContactResolver reads this)
    // ---------------------------------------------------------------
    getCombatBox() {
        return {
            type: "projectilebox",
            id: this.id,
            ownerId: this.ownerId,
            teamId: this.teamId,
            cuttable: this.cuttable,
            center: {
                x: this.simPos.x,
                y: this.simPos.y,
                z: this.baseZ
            },
            half: this.colliderHalfWorld,
            angle: 0  // v1 collider does not rotate; visual mesh may spin later
        };
    }

    // ---------------------------------------------------------------
    // Cleanup
    // ---------------------------------------------------------------
    dispose() {
        if (this._spriteTexture) this._spriteTexture.dispose();
        if (this.material) this.material.dispose();
        if (this.spritePlane) this.spritePlane.dispose();
        if (this.root) this.root.dispose();
        this.isDestroyed = true;
    }
}