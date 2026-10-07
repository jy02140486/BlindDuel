/**
 * ProjectileDefs — 投掷物类型静态定义。
 *
 * 单一真相源：ProjectileDefs 是 projectile gameplay 属性（cuttable/speed/damage/gravity/arcHeight...）
 * 的唯一来源。StateGraph throw state 只引用 projectileType 字符串 + 时序元数据（throwReleaseFrame），
 * 不定义任何 gameplay 参数。ThrowComponent.release() 和 AIKnowledgeRegistry 都从此读。
 *
 * 与 ThrowComponent 的关系：
 *   ThrowComponent 读 ProjectileDefs → 组运行时参数（ownerId/dirX/startPos/pxToWorld...）→ spawn Projectile
 *   ProjectileDefs 只存静态属性，不存任何运行时字段
 */
export const ProjectileDefs = {
    dagger: {
        typeId: "dagger",
        // === 动力学参数（从 ThrowComponent.release 硬编码值原封不动搬过来）===
        speed: 6,                // 水平初始速度 magnitude；方向由 ThrowComponent 的 dirX 控制
        launchVy: 1,             // 初始垂直速度（向上为正，配合 gravity 形成抛物线）
        gravity: 4,
        arcHeight: 1.5,
        // === 碰撞/伤害 ===
        damage: 1,
        cuttable: true,          // 可被 slash 斩落
        lifetimeMs: 4000,
        // === 渲染 ===
        spriteUrl: "./Art/Sprite/projectiles/proj_dagger.png",
        frame: { w: 32, h: 6 },
        sourceSize: { w: 32, h: 6 },
    },

    // --- 未来投掷物预留（本次不动，AI 后续也不引用）---
    rock: {
        typeId: "rock",
        speed: 5,
        launchVy: 1.2,
        gravity: 4,
        arcHeight: 2.0,
        damage: 1,
        cuttable: false,          // 石头只能闪避
        lifetimeMs: 4000,
        spriteUrl: "./Art/Sprite/projectiles/proj_rock.png",
        frame: { w: 20, h: 20 },
        sourceSize: { w: 20, h: 20 },
    },

    spear: {
        typeId: "spear",
        speed: 8,
        launchVy: 0.8,
        gravity: 4,
        arcHeight: 0.8,
        damage: 2,
        cuttable: true,
        lifetimeMs: 4000,
        spriteUrl: "./Art/Sprite/projectiles/proj_spear.png",
        frame: { w: 48, h: 10 },
        sourceSize: { w: 48, h: 10 },
    },
};

/**
 * 查询工具：按 typeId 拿定义，带 undefined 检查。
 * 供 ThrowComponent 和 AIKnowledgeRegistry 通用。
 */
export function getProjectileDef(typeId) {
    return ProjectileDefs[typeId] ?? null;
}