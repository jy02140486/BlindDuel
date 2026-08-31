/**
 * SceneDefs — 工厂函数与 BattleDef（SceneDef 已外部化到 Data/SceneDefs/*.json）
 *
 * 职责：
 * - ARCHETYPE_FACTORY / createEntityFromDef：根据 archetype 调用对应工厂函数创建实体（代码逻辑，非数据）
 * - BATTLE_DEFS：战斗定义（因 enterSequence/exitSequence 含函数，暂无法 JSON 化）
 *
 * SceneDef 加载走 SceneDefRegistry.resolveSceneDef(id) → Data/SceneDefs/{id}.json
 */

import {
    createHeroCharacter,
    createRabbleStickCharacter,
    createManatarmsCharacter,
    createNpcCharacter,
    createMerchantNpc,
    createCustomerNpc,
    createCustomer2Npc,
    createBardNpc,
    createCompanionNpc,
    createPropEntity,
    createPickable,
} from "./CharacterFactory.js";
import { SCENARIO } from "../Data/ScenarioMilestones.js";

// ---------------------------------------------------------------------------
// 工厂映射：archetype → factory(assets) → entity
// ---------------------------------------------------------------------------

const ARCHETYPE_FACTORY = {
    hero_longsword: (scene, assets) => createHeroCharacter(scene, assets),
    rabble_stick: (scene, assets) => createRabbleStickCharacter(scene, assets),
    manatarms_sword: (scene, assets) => createManatarmsCharacter(scene, assets),
    npc_traveller: (scene, assets) => createNpcCharacter(scene, assets),
    npc_merchant: (scene, assets) => createMerchantNpc(scene, assets),
    npc_customer: (scene, assets) => createCustomerNpc(scene, assets),
    npc_customer2: (scene, assets) => createCustomer2Npc(scene, assets),
    npc_bard: (scene, assets) => createBardNpc(scene, assets),
    npc_companion: (scene, assets) => createCompanionNpc(scene, assets),
    prop: (scene, assets, entityDef) => createPropEntity(scene, assets, entityDef),
    pickable: createPickable,
};

/**
 * 根据 entityDef 创建实体实例
 * @param {BABYLON.Scene} scene
 * @param {Object} assets - 已加载的资源
 * @param {Object} entityDef - { archetype, id, pos: [x, y], controller, kind, ... }
 * @returns {CharacterBase}
 */
export function createEntityFromDef(scene, assets, entityDef) {
    const factory = ARCHETYPE_FACTORY[entityDef.archetype];
    if (!factory) {
        throw new Error(`[SceneDefs] Unknown archetype: ${entityDef.archetype}`);
    }
    const entity = factory(scene, assets, entityDef);

    // 覆盖 id / name（工厂函数内部设了 name，这里按 def 覆盖）
    entity.id = entityDef.id ?? entityDef.name ?? entity.id;
    if (entityDef.name) {
        entity.name = entityDef.name;
    }
    if (entityDef.kind) {
        entity.kind = entityDef.kind;
    }

    // 设置位置
    if (entityDef.pos) {
        entity.root.position.x = entityDef.pos[0];
        entity.root.position.y = entityDef.pos[1] ?? 0;
        entity.root.position.z = 0;
    }

    entity.debugTrace = false;

    return entity;
}

// ---------------------------------------------------------------------------
// BattleDef：战斗定义
// ---------------------------------------------------------------------------

export const BATTLE_FIELD_1 = {
    id: "battle_field_1",
    combatants: ["hero", "enemy_1"],
    stageBounds: { minX: -8, maxX: 8, minY: -0.05, maxY: 0.05 },
    battleYBaseline: 0,
    onVictory: {
        flags: ["battle_field_1"],
    },
    duelCamera: {
        zoomMinDistance: 3.2,
        zoomMaxDistance: 6.4,
        orthoMinWidth: 16,
        orthoMaxWidth: 32,
        perspMinDistance: 15,
        perspMaxDistance: 35,
        minCameraHeight: 3.2,
        maxCameraHeight: 5.2,
        targetAspect: 16 / 9,
    },
    enterSequence: (battleDef) => ({
        id: "enter_battle",
        durationMs: 3000,
        tracks: [
            {
                id: "hero.command",
                kind: "actor",
                binding: { actorId: "hero" },
                channel: "command",
                clips: [
                    { type: "inputLock", atMs: 0, locked: true },
                    { type: "command", atMs: 0, command: "draw" },
                    { type: "inputLock", atMs: 3000, locked: false }
                ]
            },
            {
                id: "camera",
                kind: "camera",
                binding: { cameraId: "duel" },
                channel: "blend",
                clips: [
                    { type: "setCameraFollow", atMs: 0, actorId: "hero", offsetX: 0, offsetY: 0, offsetZ: 0, lerp: 0.12, height: 2, orthoWidth: 20 },
                   { type: "cameraBlend", startMs: 0, durationMs: 500, to: "scripted" },
                   
                   { type: "cameraBlend", startMs: 500, durationMs: 1800, to: "duel" }
                ]
            },
            {
                id: "mode",
                kind: "mode",
                clips: [
                    { type: "switchMode", atMs: 3000, modeId: "battle", payload: { battleDef } }
                ]
            }
        ]
    }),
    exitSequence: {
        id: "exit_battle",
        durationMs: 6000,
        tracks: [
            {
                id: "hero.command",
                kind: "actor",
                binding: { actorId: "hero" },
                channel: "command",
                clips: [
                    { type: "inputLock", atMs: 0, locked: true },
                    { type: "command", atMs: 2500, command: "sheath" },
                    { type: "inputLock", atMs: 6000, locked: false }
                ]
            },
            {
                id: "camera",
                kind: "camera",
                binding: { cameraId: "explore" },
                channel: "blend",
                clips: [
                    { type: "setCameraFollow", atMs: 0, actorId: "hero", offsetX: 0, offsetY: 0, offset : 0, lerp: 0.12, height: 2, orthoWidth: 20 },
                   { type: "cameraBlend", startMs: 0, durationMs: 500, to: "scripted" },
                   
                   { type: "cameraBlend", startMs: 500, durationMs: 5500, to: "explore" }
                ]
            },
            {
                id: "mode",
                kind: "mode",
                clips: [
                    { type: "switchMode", atMs: 6000, modeId: "explore" }
                ]
            }
        ]
    },
};

// SceneDefs 已外部化到 Data/SceneDefs/*.json，通过 SceneDefRegistry 加载

// ---------------------------------------------------------------------------
// 第二场战斗定义
// ---------------------------------------------------------------------------

export const BATTLE_FIELD_2 = {
    id: "battle_field_2",
    combatants: ["hero", "enemy_1"],
    stageBounds: { minX: -0.5, maxX: 12, minY: -4.85, maxY: -4.75 },
    battleYBaseline: -4.8,
    onVictory: {
        scenario: SCENARIO.BATTLE_1_COMPLETED,
        flags: ["battle_field_2"],
        questStages: [{ id: "dagger", stage: 2 }],
    },
    duelCamera: {
        zoomMinDistance: 2.4,
        zoomMaxDistance: 5.0,
        orthoMinWidth: 12,
        orthoMaxWidth: 24,
        perspMinDistance: 12,
        perspMaxDistance: 28,
        minCameraHeight: 2.8,
        maxCameraHeight: 4.5,
        targetAspect: 16 / 9,
    },
    enterSequence: (battleDef) => ({
        id: "enter_battle",
        durationMs: 2000,
        tracks: [
            {
                id: "hero.command",
                kind: "actor",
                binding: { actorId: "hero" },
                channel: "command",
                clips: [
                    { type: "command", atMs: 0, command: "draw" }
                ]
            },
            {
                id: "camera",
                kind: "camera",
                binding: { cameraId: "duel" },
                channel: "blend",
                clips: [
                    { type: "cameraBlend", startMs: 0, durationMs: 1800, to: "duel" }
                ]
            },
            {
                id: "mode",
                kind: "mode",
                clips: [
                    { type: "switchMode", atMs: 1800, modeId: "battle", payload: { battleDef } }
                ]
            }
        ]
    }),
    exitSequence: {
        id: "exit_battle",
        durationMs: 8000,
        tracks: [
            {
                id: "hero.command",
                kind: "actor",
                binding: { actorId: "hero" },
                channel: "command",
                clips: [
                    { type: "command", atMs: 2500, command: "sheath" }
                ]
            },
            {
                id: "camera",
                kind: "camera",
                binding: { cameraId: "explore" },
                channel: "blend",
                clips: [
                    { type: "cameraBlend", startMs: 1000, durationMs: 5400, to: "explore" }
                ]
            },
            {
                id: "mode",
                kind: "mode",
                clips: [
                    { type: "switchMode", atMs: 6500, modeId: "explore" }
                ]
            }
        ]
    },
};

// ---------------------------------------------------------------------------
// Prologue 专用 BattleDef（序章战斗）
// ---------------------------------------------------------------------------

export const PROLOGUE_BATTLE = {
    id: "prologue_battle",
    combatants: ["hero", "enemy_1"],
    stageBounds: { minX: -8, maxX: 4, minY: -0.05, maxY: 0.05 },
    battleYBaseline: 0,
    onVictory: {
        scenario: SCENARIO.BATTLE_1_COMPLETED,
        flags: ["prologue_battle"],
    },
    duelCamera: BATTLE_FIELD_1.duelCamera,
    enterSequence: BATTLE_FIELD_1.enterSequence,
    exitSequence: BATTLE_FIELD_1.exitSequence,
};

// ---------------------------------------------------------------------------
// BattleDef 索引（按 id 快速查找）
// ---------------------------------------------------------------------------

export const BATTLE_DEFS = {
    [BATTLE_FIELD_1.id]: BATTLE_FIELD_1,
    [BATTLE_FIELD_2.id]: BATTLE_FIELD_2,
    [PROLOGUE_BATTLE.id]: PROLOGUE_BATTLE,
};

