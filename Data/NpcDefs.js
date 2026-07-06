export const NPC_DEFS = {
    companion: {
        id: "companion",
        name: "Charlotte",
        dialogues: [
            {
                priority: 100,
                condition: { scenarioMin: 105 },
                text: "👍"
            },
            {
                priority: 90,
                condition: { quest: "prologue_pickup_quest", stage: 1, hasItem: "dagger" },
                text: "👍",
                action: [
                    { type: "removeItem", item: "dagger" },
                    { type: "advanceScenario", value: 105 }
                ],
                giveItem: "dagger"
            },
            {
                priority: 0,
                condition: {},
                text: "🗡️",
                action: [
                    { type: "startQuest", id: "prologue_pickup_quest" }
                ]
            }
        ]
    },
    bard: {
        id: "bard",
        name: "吟游诗人",
        dialogues: [
            {
                priority: 100,
                condition: { quest: "dagger", completed: true },
                text: "👋👊",
            },
            {
                priority: 90,
                condition: { quest: "dagger", stage: 1, hasItem: "dagger" },
                text: "👍",
                action: "completeDaggerQuest",
                giveItem: "dagger",
            },
            {
                priority: 0,
                condition: {},
                text: "🗡️",
                action: "startDaggerQuest",
            },
        ],
    },
};

export function getNpcDef(npcId) {
    return NPC_DEFS[npcId] ?? null;
}