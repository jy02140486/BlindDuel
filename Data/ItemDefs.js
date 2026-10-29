/**
 * ItemDefs — 物品定义注册表
 * 集中管理所有物品的元数据。
 */
export const ITEM_DEFS = {
    ham: {
        id: "ham",
        name: "火腿",
        consumeType: "eat",
        atlasKey: "ham",
        textureUrl: "./Art/Sprite/items/Ham.png",
    },
    tea: {
        id: "tea",
        name: "茶",
        consumeType: "drink",
        atlasKey: "tea",
        textureUrl: "./Art/Sprite/items/Tea.png",
    },
    dagger: {
        id: "dagger",
        name: "匕首",
        consumeType: "pocket",
        throwable: true,
        atlasKey: "dagger",
        textureUrl: "./Art/Sprite/items/dagger.png",
    },
    daggerpack: {
        id: "daggerpack",
        name: "一袋匕首",
        consumeType: "pocket",
        throwable: true,
        atlasKey: "daggerpack",
        textureUrl: "./Art/Sprite/items/daggerpack.png",
        count: 5,
        yieldsItem: "dagger",
    },
    altar_gem: {
        id: "altar_gem",
        name: "祭坛宝石",
        consumeType: "pocket",
        atlasKey: "altar_gem",
        textureUrl: "./Art/Sprite/items/altar_gem.png",
    },
    music_sheet: {
        id: "music_sheet",
        name: "乐谱",
        consumeType: "pocket",
        atlasKey: "music_sheet",
        textureUrl: "./Art/Sprite/items/MusicSheet.png",
    },
};

/**
 * 根据 itemId 获取物品定义，未找到返回 null
 */
export function getItemDef(itemId) {
    return ITEM_DEFS[itemId] ?? null;
}