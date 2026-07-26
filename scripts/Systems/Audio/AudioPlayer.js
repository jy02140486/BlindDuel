/*
- 取随机 clip URL → 触发 lazy load → 设置 volume/pitch → play
- pitch 支持 number 或 [min,max] （线性随机，设计稿 E 项确认）
- PendingPlays 队列：首次 play 时若 wav 仍在加载，请求入队，loaded 后自动回放
- 不阻塞游戏启动；第一次播放有 50-200ms 延迟（本地 wav）
*/

export class AudioPlayer {
    constructor(database, pool) {
        this._database = database;
        this._pool = pool;
        this.getBusVolume = null;
        this.getMasterVolume = null;
    }
    play(id, options = {}) {
        const def = this._database.getClipDef(id);
        if (!def) {
            console.warn(`[AudioPlayer] unknown clip id: ${id}`);
            return false;
        }
        if (!Array.isArray(def.clips) || def.clips.length === 0) {
            console.warn(`[AudioPlayer] clip id has no clips: ${id}`);
            return false;
        }

        const clipUrl = def.clips[Math.floor(Math.random() * def.clips.length)];
        this._pool.getOrLoad(clipUrl);

        const baseVolume = (typeof options.volume === "number")
            ? options.volume
            : (def.volume ?? 1.0);
        const bus = typeof options.bus === "string" ? options.bus : this._database.getClipBus(id);
        const busVol = this.getBusVolume ? this.getBusVolume(bus) : 1.0;
        const masterVol = this.getMasterVolume ? this.getMasterVolume() : 1.0;
        const finalVolume = baseVolume * busVol * masterVol;
        const pitch = this._resolvePitch(options.pitch ?? def.pitch);

        return this._pool.play(clipUrl, { volume: finalVolume, pitch, _meta: { bus, baseVolume } });
    }

    _resolvePitch(pitchSpec) {
        if (typeof pitchSpec === "number") return pitchSpec;
        if (Array.isArray(pitchSpec) && pitchSpec.length === 2) {
            const [min, max] = pitchSpec;
            return min + Math.random() * (max - min);
        }
        return 1.0;
    }
}