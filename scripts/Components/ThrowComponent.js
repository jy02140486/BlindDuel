/**
 * ThrowComponent — 管理 CombatCharacter 的投掷弹药 + 负责实际 spawn Projectile。
 *
 * 归属：ThrowComponent 挂载在 CombatCharacter 上（character.throwComponent），
 * 生命周期由 BattleMode 负责（enter 时装配，exit 时置 null）。
 * 不是所有角色都有 — 没投掷能力的 character.throwComponent 为 null。
 *
 * 职责边界（见计划 §5 架构约定）：
 *   ✅ 维护 ammo 计数
 *   ✅ canThrow() / consumeAmmo()
 *   ✅ release(context) 内部 spawn Projectile + 原子性保证
 *   ❌ 不感知 InventoryManager（Inventory 同步由 BattleMode 负责）
 *   ❌ 不做 gate 拦截（gate 在 CombatCharacter._matchesTransitionCondition）
 */
export class ThrowComponent {
    static MAX_AMMO = 99;

    /**
     * @param {object} config
     * @param {number} [config.ammo=0]  初始弹药数
     */
    constructor({ ammo = 0 } = {}) {
        this.ammo = Math.max(0, Math.min(ThrowComponent.MAX_AMMO, ammo));
    }

    /** Gate 查询 — CombatCharacter._matchesTransitionCondition 调用。 */
    canThrow() {
        return this.ammo > 0;
    }

    /** 直接消耗 1 发 — release() 内部调用，外部一般不用。 */
    consumeAmmo() {
        this.ammo = Math.max(0, this.ammo - 1);
    }

    /**
     * 尝试 spawn 一次投掷物。原子性保证：spawn 失败 → ammo 不减、返回 false。
     *
     * 由 BattleMode.#onThrowRelease 调用（release 动画帧）。
     *
     * @param {object} context
     * @param {import("../Systems/Modes/BattleMode.js").ProjectileManager} context.projectileManager
     * @param {number}  context.dirX         投掷方向（-1 左 / 1 右），由 BattleMode 基于 opponent 算出
     * @param {object}  context.thrower      CombatCharacter 实例（读 hand anchor、team、pxToWorld）
     * @returns {boolean} true = spawn 成功 + ammo 已扣，false = 失败（ammo 不动）
     */
    release({ projectileManager, dirX, thrower }) {
        if (!this.canThrow()) return false;
        if (!projectileManager || !thrower) return false;

        const handWorld = thrower.getHandAnchorWorld();
        if (!handWorld) {
            console.warn("[ThrowComponent] release but no hand anchor on thrower", thrower.id);
            return false;
        }

        // v1: hardcoded dagger config — 从 BattleMode.#onThrowRelease 原封不动搬过来
        const result = projectileManager.spawn({
            ownerId: thrower.id,
            teamId: thrower.kind === "player" ? "hero" : "enemy",
            startPos: { x: handWorld.x, y: handWorld.y },
            groundY: thrower.root.position.y,
            velocity: { x: dirX * 6, y: 1 },
            pxToWorld: thrower.pxToWorld,
            frame: { w: 32, h: 6 },
            sourceSize: { w: 32, h: 6 },
            spriteUrl: "./Art/Sprite/projectiles/proj_dagger.png",
            cuttable: true,
            damage: 1,
            lifetimeMs: 4000,
            arcHeight: 1.5,
            gravity: 4
        });

        // 原子性：spawn 失败 → ammo 不扣
        if (!result) return false;

        this.consumeAmmo();
        return true;
    }
}
