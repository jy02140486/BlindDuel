export const ASSET_MANIFEST = {
    stateGraphs: {
        hero: "./Data/StateGraphDef/LongSwordMan.json",
        rabble: "./Data/StateGraphDef/RabbleStick.json"
    },
    testScripts: {
        rabbleBasicSequence: "./Data/TestScripts/rabble_stick_basic_sequence.json"
    },
    atlas: {
        hero: {
            idle: "./Art/Sprite/longswordman_idle.json",
            move: "./Art/Sprite/longswordman_move.json",
            thrust: "./Art/Sprite/longswordman_thrust.json",
            quart: "./Art/Sprite/longswordman_quart.json",
            zornhut: "./Art/Sprite/longswordman_zornhut.json",
            guard: "./Art/Sprite/longswordman_Guard.json",
            clash: "./Art/Sprite/longswordman_clash.json",
            hit: "./Art/Sprite/longswordman_hit.json"
        },
        rabble: {
            idle: "./Art/Sprite/rabble_stick_idle.json",
            move: "./Art/Sprite/rabble_stick_move.json",
            swing: "./Art/Sprite/rabble_stick_swing.json",
            thrust: "./Art/Sprite/rabble_stick_thrust.json",
            hit: "./Art/Sprite/rabble_stick_hit.json",
            dodge: "./Art/Sprite/Dodge.json"
        }
    },
    colliders: {
        hero: {
            idle: "./Data/CollisionMask/longswordman_idle.collider.json",
            move: "./Data/CollisionMask/longswordman_move.collider.json",
            thrust: "./Data/CollisionMask/longswordman_thrust.collider.json",
            quart: "./Data/CollisionMask/longswordman_quart.collider.json",
            zornhut: "./Data/CollisionMask/longswordman_zornhut.collider.json",
            guard: "./Data/CollisionMask/longswordman_Guard.collider.json",
            clash: "./Data/CollisionMask/longswordman_clash.collider.json",
            hit: "./Data/CollisionMask/longswordman_hit.collider.json"
        },
        rabble: {
            idle: "./Data/CollisionMask/rabble_stick_idle.collider.json",
            move: "./Data/CollisionMask/rabble_stick_move.collider.json",
            swing: "./Data/CollisionMask/rabble_stick_swing.collider.json",
            thrust: "./Data/CollisionMask/rabble_stick_thrust.collider.json",
            dodge: "./Data/CollisionMask/Dodge.collider.json"
        }
    }
};
