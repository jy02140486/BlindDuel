export const NPC_DEFS = {
    companion: {
        id: "companion",
        name: "Charlotte",
        idle: { clip: "observe" },
        // 初始状态由 scenario 进度派生（非 cutscene flag）：
        // scenario >= 105 (PROLOGUE_CHARLOTTE_JOIN) 后跟随，之前 idle。
        // 重置/跨场景时按当前 scenario 重新评估，与 checkpoint 自然兼容。
        initialStateMap: [
            { if: { scenarioMin: 105 }, state: "following" },
            { if: {}, state: "idle" }
        ],
        dialogues: [
            {
                priority: 100,
                condition: { scenarioMin: 105 },
                text: "👍"
            },
            {
                priority: 90,
                condition: { quest: "prologue_pickup_quest", stage: 1, hasItem: "altar_gem" },
                text: "👍",
                giveItem: "altar_gem",
                completeText: "👍",
                action: [
                    { type: "removeItem", item: "altar_gem" },
                    { type: "advanceScenario", value: 105 }
                ],
            },
            {
                priority: 0,
                condition: {},
                text: "🗡️",
                content: [
                    { type: "text", value: "👉 " },
                    { type: "image", src: "./Art/Sprite/items/altar_gem.png", width: 20, height: 20, alt: "altar_gem" }
                ],
                action: [
                    { type: "startQuest", id: "prologue_pickup_quest" }
                ]
            }
        ]
    },
    bard: {
        id: "bard",
        name: "吟游诗人",
        idle: { clip: "Play" },
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