/**
 * SceneDefs — 场景定义与战斗定义（硬编码 JS 对象，后续再外部化为 JSON）
 *
 * 职责：
 * - SceneDef：描述一张地图的实体、触发器、环境、行走区域
 * - BattleDef：描述一场战斗的参与者、边界、相机参数、进出序列
 * - createEntityFromDef()：根据 archetype 调用对应工厂函数创建实体
 */

import {
    createHeroCharacter,
    createRabbleStickCharacter,
    createNpcCharacter,
    createMerchantNpc,
    createCustomerNpc,
    createCustomer2Npc,
    createBardNpc
} from "./CharacterFactory.js";

// ---------------------------------------------------------------------------
// 工厂映射：archetype → factory(assets) → entity
// ---------------------------------------------------------------------------

const ARCHETYPE_FACTORY = {
    hero_longsword: (scene, assets) => createHeroCharacter(scene, assets),
    rabble_stick: (scene, assets) => createRabbleStickCharacter(scene, assets),
    npc_traveller: (scene, assets) => createNpcCharacter(scene, assets),
    npc_merchant: (scene, assets) => createMerchantNpc(scene, assets),
    npc_customer: (scene, assets) => createCustomerNpc(scene, assets),
    npc_customer2: (scene, assets) => createCustomer2Npc(scene, assets),
    npc_bard: (scene, assets) => createBardNpc(scene, assets),
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
    const entity = factory(scene, assets);

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
                    { type: "switchMode", atMs: 2000, modeId: "battle", payload: { battleDef } }
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
// SceneDef：场景定义
// ---------------------------------------------------------------------------

export const OUTDOOR_VILLAGE = {
    id: "outdoor_village",
    camera: {
        defaultRig: "explore",
    },
    entities: [
        {
            archetype: "hero_longsword",
            id: "hero",
            name: "hero",
            kind: "player",
            pos: [-12, 0],
            controller: "player",
        },
        {
            archetype: "rabble_stick",
            id: "enemy_1",
            name: "rabble_stick",
            kind: "enemy",
            pos: [3.2, 0],
            controller: "dummy",
        },
        {
            archetype: "npc_traveller",
            id: "npc_1",
            name: "npc",
            kind: "npc",
            pos: [-14, -1],
            controller: "npc",
        },
        {
            archetype: "npc_merchant",
            id: "merchant",
            name: "merchant",
            kind: "npc",
            pos: [-11, -0.9],
            controller: "npc",
        },
    ],
    walkArea: {
        minX: -24, maxX: -7,
        minY: -1,  maxY: 0.7,
    },
    triggers: [
        {
            type: "battle",
            id: "bt_field_1",
            pos: [-6, 0, 0],
            size: [4, 8, 4],
            battleId: "battle_field_1",
            debugColor: [0, 1, 0],
            debugVisible: false,
        },
        {
            type: "scriptedCamera",
            id: "sc_test_1",
            pos: [-15, 1, 0],
            size: [4, 8, 4],
            debugColor: [0, 0, 1],
            debugVisible: false,
        },
    ],
};

// ---------------------------------------------------------------------------
// 环境配置
// ---------------------------------------------------------------------------

export const HOUSE_ENVIRONMENT_CONFIG = {
    layers: [
        {
            id: "BG_FAR",
            z: 40,
            parallaxFactor: 0.15,
            renderingGroupId: 0,
            loopX: true,
            loopWidth: 40,
            elements: [
                {
                    id: "sky_1",
                    texture: "Art/Environment/skybase.png",
                    kind: "tile",
                    x: 0,
                    y: 8,
                    width: 48,
                    height: 32,
                    alphaIndex: 0
                }
            ]
        },
        {
            id: "STAGE",
            z: 10,
            parallaxFactor: 1.0,
            renderingGroupId: 0,
            loopX: false,
            elements: [
                {
                    id: "indoor_floor",
                    texture: "Art/Environment/Tavern_indoorstage.png",
                    kind: "single",
                    x: 0,
                    y: 0,
                    width: 32.4,
                    height: 12.0,
                    alphaIndex: 1
                }
            ]
        }
    ]
};

// ---------------------------------------------------------------------------
// 室内场景定义
// ---------------------------------------------------------------------------

export const HOUSE_INTERIOR = {
    id: "house_interior",
    environment: HOUSE_ENVIRONMENT_CONFIG,
    camera: {
        defaultRig: "explore",
    },
    stageMask: "tavern_indoor",
    entities: [
        // --- 临时：只加载 hero，方便单独测试室内场景渲染和 WalkArea ---
        // TODO: 场景切换和战斗测试完成后，恢复 innkeeper / enemy_1
        {
            archetype: "hero_longsword",
            id: "hero",
            name: "hero",
            kind: "player",
            pos: [0, 0],
            controller: "player",
        },
        {
            archetype: "npc_customer",
            id: "customer",
            name: "customer",
            kind: "npc",
            pos: [2.8, -2.04],
            controller: "npc",
        },
        {
            archetype: "npc_customer2",
            id: "customer2",
            name: "customer2",
            kind: "npc",
            pos: [5.6, -3.54],
            controller: "npc",
        },
        {
            archetype: "npc_bard",
            id: "bard",
            name: "bard",
            kind: "npc",
            pos: [11.0, -3.2],
            controller: "npc",
        },
        {
            archetype: "rabble_stick",
            id: "enemy_1",
            name: "rabble_stick",
            kind: "enemy",
            pos: [8.47, -4.92],
            controller: "dummy",
        },
    ],
    walkArea: {
        minX: -6.75, maxX: 13.98,
        minY: -4.77, maxY: -1.65,
    },
    triggers: [
        {
            type: "sceneSwitch",
            id: "exit_house",
            pos: [0, -1, 0],
            size: [2, 2, 2],
            targetScene: "outdoor_village",
            targetSpawn: "house_door",
            debugColor: [1, 0.5, 0],
            debugVisible: false,
        },
        {
            type: "battle",
            id: "bt_field_2",
            pos: [2.47, -4.90, 0],
            size: [1,2, 3],
            battleId: "battle_field_2",
            debugColor: [0, 1, 0],
            debugVisible: false,
        },
    ],
};

// ---------------------------------------------------------------------------
// 第二场战斗定义
// ---------------------------------------------------------------------------

export const BATTLE_FIELD_2 = {
    id: "battle_field_2",
    combatants: ["hero", "enemy_1"],
    stageBounds: { minX: -0.5, maxX: 12, minY: -4.85, maxY: -4.75 },
    battleYBaseline: -4.8,
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
                    { type: "switchMode", atMs: 2000, modeId: "battle", payload: { battleDef } }
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
// BattleDef 索引（按 id 快速查找）
// ---------------------------------------------------------------------------

export const BATTLE_DEFS = {
    [BATTLE_FIELD_1.id]: BATTLE_FIELD_1,
    [BATTLE_FIELD_2.id]: BATTLE_FIELD_2,
};