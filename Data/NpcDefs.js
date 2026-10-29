export const NPC_DEFS = {
    companion: {
        id: "companion",
        name: "Charlotte",
        idle: {
            clip: "observe",
            clipMap: [
                { if: { scenarioMin: 103, scenarioMax: 104 }, clip: "observe" },
                { if: {}, clip: "idle" }
            ]
        },
        // 初始状态由 scenario 进度派生（非 cutscene flag）：
        // scenario >= 105 (PROLOGUE_CHARLOTTE_JOIN) 后跟随，之前 idle。
        // 重置/跨场景时按当前 scenario 重新评估，与 checkpoint 自然兼容。
        initialStateMap: [
            // scenario=105 第一场战斗：Charlotte 退到左侧后方（targetOffsetX 为负 = hero 的左侧）
            // 避免大敌当前时走在 hero 右侧像引路 NPC
            { if: { scenarioMin: 100, scenarioMax: 101 }, state: "following", followOffset: { targetOffsetX: -0.8, targetOffsetY: 0.3 } },
            // scenario>=106 tutor 战斗及之后：恢复默认右侧跟随（FollowingBehavior 内部默认 targetOffsetX=2.0）
            { if: { scenarioMin: 102, scenarioMax: 109 }, state: "following" },
            { if: {}, state: "idle" }
        ],
        dialogues: [
            {
                priority: 100,
                condition: { scenarioMin: 105, scenarioMax: 109 },
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
                condition: { quest: "music_sheet", completed: true },
                text: "👋👊",
            },
            {
                priority: 90,
                condition: { quest: "music_sheet", stage: 1, hasItem: "music_sheet" },
                text: "👍",
                giveItem: "music_sheet",
                action: [
                    { type: "removeItem", item: "music_sheet" },
                    { type: "completeQuest", id: "music_sheet" }
                ],
            },
            {
                priority: 0,
                condition: {},
                text: "🎵",
                content: [
                    { type: "image", src: "./Art/Sprite/items/MusicSheet.png", width: 20, height: 20, alt: "music_sheet" }
                ],
                action: [
                    { type: "startQuest", id: "music_sheet" }
                ],
            },
        ],
    },
};

export function getNpcDef(npcId) {
    return NPC_DEFS[npcId] ?? null;
}