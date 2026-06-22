export const NPC_DEFS = {
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