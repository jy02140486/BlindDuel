import { CombatCharacter } from "./Enties/CombatCharacter.js";
import { NpcCharacter } from "./Enties/NpcCharacter.js";
import { PickableEntity } from "./Enties/PickableEntity.js";
import { PropEntity } from "./Enties/PropEntity.js";

const DEFAULT_CHARACTER_OPTIONS = {
    pxToWorld: 0.03,
    collisionThicknessPx: 40,
    moveDeadzone: 0.2,
    walkSpeed: 0.41,
    showCollision: true
};

export function createHeroCharacter(scene, assets) {
    return new CombatCharacter(scene, {
        ...DEFAULT_CHARACTER_OPTIONS,
        name: "hero",
        kind: "player",
        blocksMovement: false,
        interactable: false,
        stateGraph: assets.stateGraphs.hero,
        clips: {
            standing: {
                spriteSheetUrl: "./Art/Sprite/longswordman/longswordman_standing.png",
                atlasData: assets.atlas.hero.standing,
                colliderData: assets.colliders.hero.standing,
                loop: true
            },
            draw: {
                spriteSheetUrl: "./Art/Sprite/longswordman/longswordman_draw.png",
                atlasData: assets.atlas.hero.draw,
                colliderData: assets.colliders.hero.draw,
                loop: false
            },
            sheath: {
                spriteSheetUrl: "./Art/Sprite/longswordman/longswordman_sheath.png",
                atlasData: assets.atlas.hero.sheath,
                colliderData: assets.colliders.hero.sheath,
                loop: false
            },
            walk: {
                spriteSheetUrl: "./Art/Sprite/longswordman/longswordman_walk.png",
                atlasData: assets.atlas.hero.walk,
                colliderData: assets.colliders.hero.walk,
                loop: true
            },
            idle: {
                spriteSheetUrl: "./Art/Sprite/longswordman/longswordman_idle.png",
                atlasData: assets.atlas.hero.idle,
                colliderData: assets.colliders.hero.idle,
                loop: true
            },
            move: {
                spriteSheetUrl: "./Art/Sprite/longswordman/longswordman_move.png",
                atlasData: assets.atlas.hero.move,
                colliderData: assets.colliders.hero.move,
                loop: true
            },
            thrust: {
                spriteSheetUrl: "./Art/Sprite/longswordman/longswordman_thrust.png",
                atlasData: assets.atlas.hero.thrust,
                colliderData: assets.colliders.hero.thrust,
                loop: false
            },
            quart: {
                spriteSheetUrl: "./Art/Sprite/longswordman/longswordman_quart.png",
                atlasData: assets.atlas.hero.quart,
                colliderData: assets.colliders.hero.quart,
                loop: false
            },
            zornhut: {
                spriteSheetUrl: "./Art/Sprite/longswordman/longswordman_zornhut.png",
                atlasData: assets.atlas.hero.zornhut,
                colliderData: assets.colliders.hero.zornhut,
                loop: false
            },
            guard: {
                spriteSheetUrl: "./Art/Sprite/longswordman/longswordman_Guard.png",
                atlasData: assets.atlas.hero.guard,
                colliderData: assets.colliders.hero.guard,
                loop: false
            },
            dodge: {
                spriteSheetUrl: "./Art/Sprite/longswordman/longswordman_dodge.png",
                atlasData: assets.atlas.hero.dodge,
                colliderData: assets.colliders.hero.dodge,
                loop: false
            },
            fullthrust: {
                spriteSheetUrl: "./Art/Sprite/longswordman/longswordman_fullthrust.png",
                atlasData: assets.atlas.hero.fullthrust,
                colliderData: assets.colliders.hero.fullthrust,
                loop: false
            },
            clash: {
                spriteSheetUrl: "./Art/Sprite/longswordman/longswordman_clash.png",
                atlasData: assets.atlas.hero.clash,
                colliderData: assets.colliders.hero.clash,
                loop: false
            },
            hit: {
                spriteSheetUrl: "./Art/Sprite/longswordman/longswordman_hit.png",
                atlasData: assets.atlas.hero.hit,
                colliderData: assets.colliders.hero.hit,
                loop: false
            },
            defeated: {
                spriteSheetUrl: "./Art/Sprite/longswordman/longswordman_defeated.png",
                atlasData: assets.atlas.hero.defeated,
                colliderData: assets.colliders.hero.defeated,
                loop: false
            },
            pickup: {
                spriteSheetUrl: "./Art/Sprite/longswordman/longswordman_pickup.png",
                atlasData: assets.atlas.hero.pickup,
                loop: false
            },
            eat: {
                spriteSheetUrl: "./Art/Sprite/longswordman/longswordman_eat.png",
                atlasData: assets.atlas.hero.eat,
                loop: false
            },
            drink: {
                spriteSheetUrl: "./Art/Sprite/longswordman/longswordman_drink.png",
                atlasData: assets.atlas.hero.drink,
                loop: false
            },
            topack: {
                spriteSheetUrl: "./Art/Sprite/longswordman/longswordman_topack.png",
                atlasData: assets.atlas.hero.topack,
                loop: false
            }
        },
        rootMotionData: assets.rootMotion?.hero ?? null,
    });
}

export function createRabbleStickCharacter(scene, assets) {
    return new CombatCharacter(scene, {
        ...DEFAULT_CHARACTER_OPTIONS,
        name: "rabble_stick",
        kind: "enemy",
        deathState: "die",
        blocksMovement: false,
        interactable: false,
        stateGraph: assets.stateGraphs.rabble,
        clips: {
            idle: {
                spriteSheetUrl: "./Art/Sprite/rabble_stick/rabble_stick_idle.png",
                atlasData: assets.atlas.rabble.idle,
                colliderData: assets.colliders.rabble.idle,
                loop: true
            },
            move: {
                spriteSheetUrl: "./Art/Sprite/rabble_stick/rabble_stick_move.png",
                atlasData: assets.atlas.rabble.move,
                colliderData: assets.colliders.rabble.move,
                loop: true
            },
            thrust: {
                spriteSheetUrl: "./Art/Sprite/rabble_stick/rabble_stick_thrust.png",
                atlasData: assets.atlas.rabble.thrust,
                colliderData: assets.colliders.rabble.thrust,
                loop: false
            },
            swing: {
                spriteSheetUrl: "./Art/Sprite/rabble_stick/rabble_stick_swing.png",
                atlasData: assets.atlas.rabble.swing,
                colliderData: assets.colliders.rabble.swing,
                loop: false
            },
            hit: {
                spriteSheetUrl: "./Art/Sprite/rabble_stick/rabble_stick_hit.png",
                atlasData: assets.atlas.rabble.hit,
                // Temporary fallback: reuse idle collider data until hit collider is exported.
                colliderData: assets.colliders.rabble.idle,
                loop: false
            },
            dodge: {
                spriteSheetUrl: "./Art/Sprite/rabble_stick/rabble_stick_dodge.png",
                atlasData: assets.atlas.rabble.dodge,
                colliderData: assets.colliders.rabble.dodge,
                loop: false
            },
            guard: {
                spriteSheetUrl: "./Art/Sprite/rabble_stick/rabble_stick_guard.png",
                atlasData: assets.atlas.rabble.guard,
                colliderData: assets.colliders.rabble.guard,
                loop: false
            },
            clash: {
                spriteSheetUrl: "./Art/Sprite/rabble_stick/rabble_stick_clash.png",
                atlasData: assets.atlas.rabble.clash,
                colliderData: assets.colliders.rabble.clash,
                loop: false
            },
            die: {
                spriteSheetUrl: "./Art/Sprite/rabble_stick/rabble_stick_die.png",
                atlasData: assets.atlas.rabble.die,
                colliderData: assets.colliders.rabble.die,
                loop: false
            }
        }
    });
}

export function createManatarmsCharacter(scene, assets) {
    return new CombatCharacter(scene, {
        ...DEFAULT_CHARACTER_OPTIONS,
        name: "manatarms",
        kind: "enemy",
        deathState: "defeated",
        blocksMovement: false,
        interactable: false,
        guardType: "shield",
        stateGraph: assets.stateGraphs.manatarms,
        clips: {
            idle: {
                spriteSheetUrl: "./Art/Sprite/manatarms_sword/manatarms_sword_idle.png",
                atlasData: assets.atlas.manatarms.idle,
                colliderData: assets.colliders.manatarms.idle,
                loop: true
            },
            move: {
                spriteSheetUrl: "./Art/Sprite/manatarms_sword/manatarms_sword_move.png",
                atlasData: assets.atlas.manatarms.move,
                colliderData: assets.colliders.manatarms.move,
                loop: true
            },
            quart: {
                spriteSheetUrl: "./Art/Sprite/manatarms_sword/manatarms_sword_quart.png",
                atlasData: assets.atlas.manatarms.quart,
                colliderData: assets.colliders.manatarms.quart,
                loop: false
            },
            reverse_quart: {
                spriteSheetUrl: "./Art/Sprite/manatarms_sword/manatarms_sword_reverse_quart.png",
                atlasData: assets.atlas.manatarms.reverse_quart,
                colliderData: assets.colliders.manatarms.reverse_quart,
                loop: false
            },
            smash: {
                spriteSheetUrl: "./Art/Sprite/manatarms_sword/manatarms_sword_smash.png",
                atlasData: assets.atlas.manatarms.smash,
                colliderData: assets.colliders.manatarms.smash,
                loop: false
            },
            hit: {
                spriteSheetUrl: "./Art/Sprite/manatarms_sword/manatarms_sword_hit.png",
                atlasData: assets.atlas.manatarms.hit,
                colliderData: assets.colliders.manatarms.hit,
                loop: false
            },
            knockdown: {
                spriteSheetUrl: "./Art/Sprite/manatarms_sword/manatarms_sword_knockdown.png",
                atlasData: assets.atlas.manatarms.knockdown,
                colliderData: assets.colliders.manatarms.knockdown,
                loop: false
            }
        }
    });
}

export function createNpcCharacter(scene, assets) {
    const npcAtlas = assets.atlas.npc.traveller;
    const spriteUrl = "./Art/Sprite/NPCs/traveller.png";

    return new NpcCharacter(scene, {
        ...DEFAULT_CHARACTER_OPTIONS,
        name: "npc",
        kind: "npc",
        blocksMovement: true,
        interactable: true,
        capabilities: { combat: false, interaction: true },
        showCollision: false,
        stateGraph: {
            initialState: "idle",
            states: {
                idle: { clip: "idle", loop: true },
                greeting: { clip: "greeting", loop: true },
                ask: { clip: "ask", loop: true }
            }
        },
        clips: {
            idle: {
                spriteSheetUrl: spriteUrl,
                atlasData: npcAtlas,
                loop: true
            },
            greeting: {
                spriteSheetUrl: spriteUrl,
                atlasData: npcAtlas,
                loop: true
            },
            ask: {
                spriteSheetUrl: spriteUrl,
                atlasData: npcAtlas,
                loop: true
            }
        },
        rootMotion: assets.rootMotion?.npc?.traveller ?? null,
        occupancy: assets.occupancy?.npc?.traveller ?? null
    });
}

export function createMerchantNpc(scene, assets) {
    const merchantAtlas = assets.atlas.npc.merchant;
    const spriteUrl = "./Art/Sprite/NPCs/merchant.png";

    return new NpcCharacter(scene, {
        ...DEFAULT_CHARACTER_OPTIONS,
        name: "merchant",
        kind: "npc",
        blocksMovement: true,
        interactable: true,
        capabilities: { combat: false, interaction: true },
        showCollision: false,
        stateGraph: {
            initialState: "idle",
            states: {
                idle: { clip: "Talking", loop: true }
            }
        },
        clips: {
            Talking: {
                spriteSheetUrl: spriteUrl,
                atlasData: merchantAtlas,
                loop: true
            }
        },
        rootMotion: assets.rootMotion?.npc?.merchant ?? null,
        occupancy: assets.occupancy?.npc?.merchant ?? null
    });
}

export function createCustomerNpc(scene, assets) {
    const customerAtlas = assets.atlas.npc.customer;
    const spriteUrl = "./Art/Sprite/NPCs/customer.png";

    return new NpcCharacter(scene, {
        ...DEFAULT_CHARACTER_OPTIONS,
        name: "customer",
        kind: "npc",
        blocksMovement: true,
        interactable: true,
        capabilities: { combat: false, interaction: true },
        showCollision: false,
        stateGraph: {
            initialState: "idle",
            states: {
                idle: { clip: "drink", loop: true }
            }
        },
        clips: {
            drink: {
                spriteSheetUrl: spriteUrl,
                atlasData: customerAtlas,
                loop: true
            }
        },
        rootMotion: assets.rootMotion?.npc?.customer ?? null,
        occupancy: assets.occupancy?.npc?.customer ?? null
    });
}

export function createCustomer2Npc(scene, assets) {
    const customer2Atlas = assets.atlas.npc.customer2;
    const spriteUrl = "./Art/Sprite/NPCs/customer2.png";

    return new NpcCharacter(scene, {
        ...DEFAULT_CHARACTER_OPTIONS,
        name: "customer2",
        kind: "npc",
        blocksMovement: true,
        interactable: true,
        capabilities: { combat: false, interaction: true },
        showCollision: false,
        stateGraph: {
            initialState: "idle",
            states: {
                idle: { clip: "drink", loop: true }
            }
        },
        clips: {
            drink: {
                spriteSheetUrl: spriteUrl,
                atlasData: customer2Atlas,
                loop: true
            }
        },
        rootMotion: assets.rootMotion?.npc?.customer2 ?? null,
        occupancy: assets.occupancy?.npc?.customer2 ?? null
    });
}

export function createBardNpc(scene, assets) {
    const bardAtlas = assets.atlas.npc.bard;
    const spriteUrl = "./Art/Sprite/NPCs/bard.png";

    return new NpcCharacter(scene, {
        ...DEFAULT_CHARACTER_OPTIONS,
        name: "bard",
        kind: "npc",
        blocksMovement: true,
        interactable: true,
        capabilities: { combat: false, interaction: true },
        showCollision: false,
        stateGraph: {
            initialState: "idle",
            states: {
                idle: { clip: "Play", loop: true }
            }
        },
        clips: {
            Play: {
                spriteSheetUrl: spriteUrl,
                atlasData: bardAtlas,
                loop: true
            }
        },
        rootMotion: assets.rootMotion?.npc?.bard ?? null,
        occupancy: assets.occupancy?.npc?.bard ?? null
    });
}

export function createCompanionNpc(scene, assets) {
    const charlotteAtlas = assets.atlas?.companion?.charlotte;
    const spriteUrl = "./Art/Sprite/NPCs/Charlotte.png";

    return new NpcCharacter(scene, {
        ...DEFAULT_CHARACTER_OPTIONS,
        name: "companion",
        kind: "npc",
        blocksMovement: false,
        interactable: true,
        capabilities: { combat: false, interaction: true },
        showCollision: false,
        walkSpeed: 1.1,
        stateGraph: {
            initialState: "idle",
            states: {
                idle: { clip: "idle", loop: true },
                walk: { clip: "walk", loop: true },
                observe: { clip: "observe", loop: true }
            }
        },
        clips: {
            idle: { spriteSheetUrl: spriteUrl, atlasData: charlotteAtlas, loop: true },
            walk: { spriteSheetUrl: spriteUrl, atlasData: charlotteAtlas, loop: true },
            observe: { spriteSheetUrl: spriteUrl, atlasData: charlotteAtlas, loop: true }
        },
        rootMotion: assets.rootMotion?.companion?.charlotte ?? null,
        occupancy: assets.occupancy?.companion?.charlotte ?? null
    });
}

export function createPropEntity(scene, assets, entityDef) {
    const csAtlas = assets.atlas?.csChars;
    const csRootMotion = assets.rootMotion?.csChars;
    const spriteBase = "./Art/Sprite/CS_Chars";
    const rmBase = "./Data/RootMotion/CS_Chars";
    const propKey = entityDef?.propKey ?? "prologue_rabble_flee";

    function buildClip(idx, mode) {
        const key = `${propKey}${idx}`;
        return {
            spriteSheetUrl: `${spriteBase}/${key}.png`,
            atlasData: csAtlas?.[key],
            rootMotionUrl: `${rmBase}/${key}.json`,
            rootMotion: csRootMotion?.[key],
            mode
        };
    }

    const pos = entityDef?.pos ?? [0, 0, 0];
    const baseConfig = {
        id: entityDef?.id ?? `prop_${Date.now()}`,
        name: entityDef?.name ?? entityDef?.id ?? "prop",
        pos,
        pxToWorld: 1,
        frameWidth: 3.84,
        frameHeight: 3.84,
        initialClip: entityDef?.initialClip ?? "idle",
        clips: {
            idle: buildClip(0, "hold"),
            fall: buildClip(1, "loop"),
            land: buildClip(2, "hold"),
            run:  buildClip(3, "loop")
        }
    };

    if (entityDef?.clips) {
        const cfg = baseConfig;
        cfg.clips = entityDef.clips;
        if (entityDef.spriteSheetUrl !== undefined) cfg.spriteSheetUrl = entityDef.spriteSheetUrl;
        if (entityDef.atlasKey !== undefined && entityDef.atlasData === undefined) {
            const parts = entityDef.atlasKey.split(".");
            let resolved = assets.atlas;
            for (const p of parts) {
                resolved = resolved?.[p];
                if (!resolved) break;
            }
            if (resolved) cfg.atlasData = resolved;
        }
        if (entityDef.atlasData !== undefined) cfg.atlasData = entityDef.atlasData;
        if (entityDef.frameWidth !== undefined) cfg.frameWidth = entityDef.frameWidth;
        if (entityDef.frameHeight !== undefined) cfg.frameHeight = entityDef.frameHeight;
        if (entityDef.pxToWorld !== undefined) cfg.pxToWorld = entityDef.pxToWorld;
        if (entityDef.initialClip !== undefined) cfg.initialClip = entityDef.initialClip;
        if (entityDef.blocker !== undefined) cfg.blocker = entityDef.blocker;
        if (entityDef.depthMask !== undefined) cfg.depthMask = entityDef.depthMask;
        if (entityDef.stateMap !== undefined) cfg.stateMap = entityDef.stateMap;
        if (entityDef.blocksMovement !== undefined) cfg.blocksMovement = entityDef.blocksMovement;
        if (entityDef.renderingGroupId !== undefined) cfg.renderingGroupId = entityDef.renderingGroupId;
    }

    return new PropEntity(scene, baseConfig);
}

export function createPickable(scene, assets, entityDef) {
    const itemDef = entityDef.itemDef ?? {};
    const atlas = assets.items?.[itemDef.atlasKey ?? "ham"];
    const textureUrl = itemDef.textureUrl ?? "./Art/Sprite/items/Ham.png";

    let frameWidth = 32;
    let frameHeight = 32;
    if (atlas?.frames) {
        const firstFrame = Object.values(atlas.frames)[0];
        if (firstFrame?.frame) {
            frameWidth = firstFrame.frame.w;
            frameHeight = firstFrame.frame.h;
        }
    }

    return new PickableEntity(scene, {
        id: entityDef.id,
        name: entityDef.name ?? entityDef.id,
        itemDef: itemDef,
        textureUrl: textureUrl,
        frameWidth: frameWidth,
        frameHeight: frameHeight,
        pxToWorld: entityDef.pxToWorld ?? 0.02,
        visualYOffset: entityDef.visualYOffset ?? 1.5,
        renderingGroupId: entityDef.renderingGroupId ?? 1,
    });
}
