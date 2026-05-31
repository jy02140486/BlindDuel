import { CombatCharacter } from "./Enties/CombatCharacter.js";
import { NpcCharacter } from "./Enties/NpcCharacter.js";

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
            }
        }
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
            die: {
                spriteSheetUrl: "./Art/Sprite/rabble_stick/rabble_stick_die.png",
                atlasData: assets.atlas.rabble.die,
                colliderData: assets.colliders.rabble.die,
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
