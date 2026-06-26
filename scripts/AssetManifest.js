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
            standing: "./Art/Sprite/longswordman/longswordman_standing.json",
            draw: "./Art/Sprite/longswordman/longswordman_draw.json",
            sheath: "./Art/Sprite/longswordman/longswordman_sheath.json",
            walk: "./Art/Sprite/longswordman/longswordman_walk.json",
            idle: "./Art/Sprite/longswordman/longswordman_idle.json",
            move: "./Art/Sprite/longswordman/longswordman_move.json",
            thrust: "./Art/Sprite/longswordman/longswordman_thrust.json",
            quart: "./Art/Sprite/longswordman/longswordman_quart.json",
            zornhut: "./Art/Sprite/longswordman/longswordman_zornhut.json",
            fullthrust: "./Art/Sprite/longswordman/longswordman_fullthrust.json",
            guard: "./Art/Sprite/longswordman/longswordman_Guard.json",
            dodge: "./Art/Sprite/longswordman/longswordman_dodge.json",
            clash: "./Art/Sprite/longswordman/longswordman_clash.json",
            hit: "./Art/Sprite/longswordman/longswordman_hit.json",
            defeated: "./Art/Sprite/longswordman/longswordman_defeated.json",
            pickup: "./Art/Sprite/longswordman/longswordman_pickup.json",
            eat: "./Art/Sprite/longswordman/longswordman_eat.json",
            drink: "./Art/Sprite/longswordman/longswordman_drink.json",
            topack: "./Art/Sprite/longswordman/longswordman_topack.json"
        },
        rabble: {
            idle: "./Art/Sprite/rabble_stick/rabble_stick_idle.json",
            move: "./Art/Sprite/rabble_stick/rabble_stick_move.json",
            swing: "./Art/Sprite/rabble_stick/rabble_stick_swing.json",
            thrust: "./Art/Sprite/rabble_stick/rabble_stick_thrust.json",
            hit: "./Art/Sprite/rabble_stick/rabble_stick_hit.json",
            dodge: "./Art/Sprite/rabble_stick/rabble_stick_dodge.json",
            die: "./Art/Sprite/rabble_stick/rabble_stick_die.json"
        },
        npc: {
            traveller: "./Art/Sprite/NPCs/traveller.json",
            merchant: "./Art/Sprite/NPCs/merchant.json",
            customer: "./Art/Sprite/NPCs/customer.json",
            customer2: "./Art/Sprite/NPCs/customer2.json",
            bard: "./Art/Sprite/NPCs/bard.json"
        }
    },
    colliders: {
        hero: {
            standing: "./Data/CollisionMask/longswordman/longswordman_standing.collider.json",
            draw: "./Data/CollisionMask/longswordman/longswordman_draw.collider.json",
            sheath: "./Data/CollisionMask/longswordman/longswordman_sheath.collider.json",
            walk: "./Data/CollisionMask/longswordman/longswordman_walk.collider.json",
            idle: "./Data/CollisionMask/longswordman/longswordman_idle.collider.json",
            move: "./Data/CollisionMask/longswordman/longswordman_move.collider.json",
            thrust: "./Data/CollisionMask/longswordman/longswordman_thrust.collider.json",
            quart: "./Data/CollisionMask/longswordman/longswordman_quart.collider.json",
            zornhut: "./Data/CollisionMask/longswordman/longswordman_zornhut.collider.json",
            fullthrust: "./Data/CollisionMask/longswordman/longswordman_fullthrust.collider.json",
            guard: "./Data/CollisionMask/longswordman/longswordman_Guard.collider.json",
            dodge: "./Data/CollisionMask/longswordman/longswordman_dodge.collider.json",
            clash: "./Data/CollisionMask/longswordman/longswordman_clash.collider.json",
            hit: "./Data/CollisionMask/longswordman/longswordman_hit.collider.json",
            defeated: "./Data/CollisionMask/longswordman/longswordman_defeated.collider.json"
        },
        rabble: {
            idle: "./Data/CollisionMask/rabble_stick/rabble_stick_idle.collider.json",
            move: "./Data/CollisionMask/rabble_stick/rabble_stick_move.collider.json",
            swing: "./Data/CollisionMask/rabble_stick/rabble_stick_swing.collider.json",
            thrust: "./Data/CollisionMask/rabble_stick/rabble_stick_thrust.collider.json",
            dodge: "./Data/CollisionMask/rabble_stick/rabble_stick_Dodge.collider.json",
            die: "./Data/CollisionMask/rabble_stick/rabble_stick_die.collider.json"
        }
    },
    rootMotion: {
        hero: {
            eat: "./Data/RootMotion/longswordman/longswordman_eat.occupancy.json",
            pickup: "./Data/RootMotion/longswordman/longswordman_pickup.occupancy.json",
            drink: "./Data/RootMotion/longswordman/longswordman_drink.occupancy.json",
            topack: "./Data/RootMotion/longswordman/longswordman_topack.occupancy.json"
        },
        npc: {
            traveller: "./Data/RootMotion/NPCs/traveller.json",
            merchant: "./Data/RootMotion/NPCs/merchant.json",
            customer: "./Data/RootMotion/NPCs/customer.json",
            customer2: "./Data/RootMotion/NPCs/customer2.json",
            bard: "./Data/RootMotion/NPCs/bard.json"
        }
    },
    occupancy: {
        npc: {
            traveller: "./Data/RootMotion/NPCs/traveller.occupancy.json",
            merchant: "./Data/RootMotion/NPCs/merchant.occupancy.json",
            customer: "./Data/RootMotion/NPCs/customer.occupancy.json",
            customer2: "./Data/RootMotion/NPCs/customer2.occupancy.json",
            bard: "./Data/RootMotion/NPCs/bard.occupancy.json"
        }
    },
    stageMasks: {
        tavern_indoor: "./Data/StageMask/Tavern_indoorstage.mask.json"
    },
    items: {
        ham: "./Art/Sprite/items/Ham.json",
        tea: "./Art/Sprite/items/Tea.json",
        dagger: "./Art/Sprite/items/dagger.json"
    }
};
