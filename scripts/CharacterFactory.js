import { Character } from "./Enties/Character.js";

const DEFAULT_CHARACTER_OPTIONS = {
    pxToWorld: 0.03,
    collisionThicknessPx: 40,
    moveDeadzone: 0.2,
    walkSpeed: 0.41,
    showCollision: true
};

export function createHeroCharacter(scene, assets) {
    return new Character(scene, {
        ...DEFAULT_CHARACTER_OPTIONS,
        name: "hero",
        stateGraph: assets.stateGraphs.hero,
        clips: {
            idle: {
                spriteSheetUrl: "./Art/Sprite/longswordman_idle.png",
                atlasData: assets.atlas.hero.idle,
                colliderData: assets.colliders.hero.idle,
                loop: true
            },
            move: {
                spriteSheetUrl: "./Art/Sprite/longswordman_move.png",
                atlasData: assets.atlas.hero.move,
                colliderData: assets.colliders.hero.move,
                loop: true
            },
            thrust: {
                spriteSheetUrl: "./Art/Sprite/longswordman_thrust.png",
                atlasData: assets.atlas.hero.thrust,
                colliderData: assets.colliders.hero.thrust,
                loop: false
            },
            quart: {
                spriteSheetUrl: "./Art/Sprite/longswordman_quart.png",
                atlasData: assets.atlas.hero.quart,
                colliderData: assets.colliders.hero.quart,
                loop: false
            },
            hit: {
                spriteSheetUrl: "./Art/Sprite/longswordman_hit.png",
                atlasData: assets.atlas.hero.hit,
                colliderData: assets.colliders.hero.hit,
                loop: false
            }
        }
    });
}

export function createRabbleStickCharacter(scene, assets) {
    return new Character(scene, {
        ...DEFAULT_CHARACTER_OPTIONS,
        name: "rabble_stick",
        stateGraph: assets.stateGraphs.rabble,
        clips: {
            idle: {
                spriteSheetUrl: "./Art/Sprite/rabble_stick_idle.png",
                atlasData: assets.atlas.rabble.idle,
                colliderData: assets.colliders.rabble.idle,
                loop: true
            },
            move: {
                spriteSheetUrl: "./Art/Sprite/rabble_stick_move.png",
                atlasData: assets.atlas.rabble.move,
                colliderData: assets.colliders.rabble.move,
                loop: true
            },
            thrust: {
                spriteSheetUrl: "./Art/Sprite/rabble_stick_thrust.png",
                atlasData: assets.atlas.rabble.thrust,
                colliderData: assets.colliders.rabble.thrust,
                loop: false
            },
            swing: {
                spriteSheetUrl: "./Art/Sprite/rabble_stick_swing.png",
                atlasData: assets.atlas.rabble.swing,
                colliderData: assets.colliders.rabble.swing,
                loop: false
            },
            hit: {
                spriteSheetUrl: "./Art/Sprite/rabble_stick_hit.png",
                atlasData: assets.atlas.rabble.hit,
                // Temporary fallback: reuse idle collider data until hit collider is exported.
                colliderData: assets.colliders.rabble.idle,
                loop: false
            }
        }
    });
}
