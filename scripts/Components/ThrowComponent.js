import { getProjectileDef } from "../../Data/ProjectileDefs.js";

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
    // DEBUG: 设成 true 就无限弹药（测试 AI 投掷物应对用）
    static DEBUG_INFINITE_AMMO = true;

    /**
     * @param {object} config
     * @param {number} [config.ammo=0]  初始弹药数
     */
    constructor({ ammo = 0 } = {}) {
        this.ammo = Math.max(0, Math.min(ThrowComponent.MAX_AMMO, ammo));
    }

    /** Gate 查询 — CombatCharacter._matchesTransitionCondition 调用。 */
    canThrow() {
        if (ThrowComponent.DEBUG_INFINITE_AMMO) return true;
        return this.ammo > 0;
    }

    /**
     * 指定投掷物类型 ID。默认 "dagger"。
     * 将来 BattleMode 装配 ThrowComponent 时可按场景配置覆盖（如 RabbleStick="rock"）。
     */
    setProjectileType(typeId) {
        this.projectileTypeId = typeId;
    }

    /** 直接消耗 1 发 — release() 内部调用，外部一般不用。 */
    consumeAmmo() {
        if (ThrowComponent.DEBUG_INFINITE_AMMO) return;  // 无限弹药：不扣
        this.ammo = Math.max(0, this.ammo - 1);
    }

    /**
     * 尝试 spawn 一次投掷物。原子性保证：spawn 失败 → ammo 不减、返回 false。
     *
     * 由 BattleMode.#onThrowRelease 调用（release 动画帧）。
     *
     * 数据源：静态属性从 ProjectileDefs 读（单一真相源），运行时字段（方向/位置/owner）
     * 在本方法内组装。projectileTypeId 默认 "dagger"，将来扩展时可通过构造参数或场景配置注入。
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

        // 从 ProjectileDefs 读静态属性
        const typeId = this.projectileTypeId ?? "dagger";
        const def = getProjectileDef(typeId);
        if (!def) {
            console.error(`[ThrowComponent] Unknown projectileType "${typeId}" — no spawn attempted`);
            return false;
        }

        // 组装 spawn config：静态属性来自 def，运行时字段来自 context
        const result = projectileManager.spawn({
            ownerId: thrower.id,
            teamId: thrower.kind === "player" ? "hero" : "enemy",
            startPos: { x: handWorld.x, y: handWorld.y },
            groundY: thrower.root.position.y,
            velocity: { x: dirX * def.speed, y: def.launchVy },
            pxToWorld: thrower.pxToWorld,
            frame: def.frame,
            sourceSize: def.sourceSize,
            spriteUrl: def.spriteUrl,
            cuttable: def.cuttable,
            damage: def.damage,
            lifetimeMs: def.lifetimeMs,
            arcHeight: def.arcHeight,
            gravity: def.gravity,
            projectileType: def.typeId,  // 额外字段：AI 侧 cross-reference 用
        });

        // 原子性：spawn 失败 → ammo 不扣
        if (!result) return false;

        this.consumeAmmo();
        return true;
    }
}
