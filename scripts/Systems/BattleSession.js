/**
 * BattleSession — battle trigger 命中后生成的运行时战斗会话（严格 1v1）
 *
 * 与 BattleDef 的区别：
 * - BattleDef 是静态配置（combatants id 列表、stageBounds、duelCamera、onVictory ...）
 * - BattleSession 是某次 trigger 命中后的运行时上下文：声明 id 解析为 live entity，
 *   并携带本场 trigger、失败重试点、已解析的入场/退场序列。
 *
 * Session 契约（见 plans/26.10.16 单场景多战斗重构计划.MD §3.1）：
 * {
 *   triggerId,                // 命中的 battle trigger id（无 trigger 直入时为 null）
 *   battleId,
 *   battleDef,                // 静态配置引用
 *   playerId, opponentId,     // BattleDef.combatants 中声明的 id
 *   player, opponent,         // actorRegistry 解析出的 live entity（不复制位置，实时读 root.position）
 *   retryCheckpointSpawnId,   // 本场战败恢复 spawn（trigger.checkpointSpawn）
 *   enterSequence, exitSequence
 * }
 *
 * 生命周期（pending/active 各至多一个 session，任一时刻只进行一场战斗）：
 *   ExploreMode trigger 命中
 *     -> createBattleSession() 校验通过
 *     -> sharedContext.pendingBattleSession = session（pending；入场序列与入场镜头读它）
 *     -> switchMode("battle", { session })
 *     -> BattleMode.enter 保存为 this._activeSession（active）
 *     -> BattleMode.exit 清理 active 与 pending 引用
 */

export class BattleSessionError extends Error {
    constructor(message) {
        super(`[BattleSession] ${message}`);
        this.name = "BattleSessionError";
    }
}

function getUnavailableReason(entity) {
    if (entity.isDisposed === true) return "disposed";
    if (entity.root?._isDisposed === true) return "disposed";
    if (entity.isDead === true) return "dead";
    return null;
}

function isCombatCapable(entity) {
    // CombatSystem 对战斗角色的最低接口要求；NpcCharacter 等非战斗实体无 takeDamage
    return typeof entity.enterState === "function"
        && typeof entity.takeDamage === "function"
        && typeof entity.fixedUpdate === "function";
}

/**
 * 解析 BattleDef.combatants 并做严格 1v1 校验，产出 BattleSession。
 * 任何配置/实体错误都在进入入场序列之前以 BattleSessionError 抛出，
 * 不允许进入序列后才出现相机或 AI 异常（计划 §3.3）。
 *
 * @param {Object} spec
 * @param {string|null} spec.triggerId
 * @param {Object} spec.battleDef
 * @param {Map<string,Object>} spec.actorRegistry
 * @param {string|null} [spec.retryCheckpointSpawnId]
 * @param {Object|null} [spec.enterSequence]
 * @param {Object|null} [spec.exitSequence]
 * @returns {Object} BattleSession
 */
export function createBattleSession(spec = {}) {
    const {
        triggerId = null,
        battleDef,
        actorRegistry,
        retryCheckpointSpawnId = null,
        enterSequence = null,
        exitSequence = null,
    } = spec;

    const where = triggerId ? `trigger="${triggerId}"` : "direct battle entry";

    if (!battleDef || typeof battleDef !== "object" || !battleDef.id) {
        throw new BattleSessionError(`${where}: battleDef missing or has no id`);
    }

    const battleId = battleDef.id;
    const ids = battleDef.combatants;
    if (!Array.isArray(ids) || ids.length !== 2) {
        throw new BattleSessionError(
            `${where} battle="${battleId}": combatants must be exactly 2 ids [player, enemy], got ${JSON.stringify(ids)}`
        );
    }
    if (new Set(ids).size !== 2) {
        throw new BattleSessionError(
            `${where} battle="${battleId}": duplicate combatant ids ${JSON.stringify(ids)}`
        );
    }
    if (!(actorRegistry instanceof Map)) {
        throw new BattleSessionError(`${where} battle="${battleId}": actorRegistry (Map) is required`);
    }

    const resolved = ids.map(id => {
        const entity = actorRegistry.get(id) ?? null;
        if (!entity) {
            throw new BattleSessionError(
                `${where} battle="${battleId}": combatant id "${id}" not found in actorRegistry`
            );
        }
        return { id, entity };
    });

    // 身份校验：严格 1v1 —— 恰好一个 player、恰好一个 enemy，不允许用数组位置猜身份
    const players = resolved.filter(r => r.entity.kind === "player");
    const enemies = resolved.filter(r => r.entity.kind === "enemy");
    if (players.length !== 1 || enemies.length !== 1) {
        const kinds = resolved
            .map(r => `"${r.id}" kind=${r.entity.kind ?? "undefined"}`)
            .join(", ");
        throw new BattleSessionError(
            `${where} battle="${battleId}": expected exactly 1 player + 1 enemy; got ${kinds}`
        );
    }

    // 存活/战斗能力校验：错误必须在入场序列播放前暴露，不能拖到相机/AI 运行时
    for (const { id, entity } of resolved) {
        const unavailable = getUnavailableReason(entity);
        if (unavailable) {
            throw new BattleSessionError(
                `${where} battle="${battleId}": combatant "${id}" is ${unavailable}`
            );
        }
        if (!isCombatCapable(entity)) {
            throw new BattleSessionError(
                `${where} battle="${battleId}": combatant "${id}" is not combat-capable (needs enterState/takeDamage/fixedUpdate)`
            );
        }
    }

    return {
        triggerId,
        battleId,
        battleDef,
        playerId: players[0].id,
        opponentId: enemies[0].id,
        player: players[0].entity,
        opponent: enemies[0].entity,
        retryCheckpointSpawnId,
        enterSequence,
        exitSequence,
    };
}
