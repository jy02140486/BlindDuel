//纯查询层，不持有 BABYLON 依赖。 hasClip 用于让 AudioManager 区分「id 未配置」与「资源加载失败」
export class AudioDatabase {
    constructor(clips = {}, buses = {}) {
        this._clips = clips;
        this._buses = buses;
    }

    getClipDef(id) {
        return this._clips[id] ?? null;
    }

    getBusVolume(busName) {
        const bus = this._buses[busName];
        if (!bus) return 1.0;
        const v = bus.volume;
        return (typeof v === "number" && Number.isFinite(v)) ? v : 1.0;
    }

    hasClip(id) {
        return id in this._clips;
    }
}