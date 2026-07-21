/*
- 取随机 clip URL → 触发 lazy load → 设置 volume/pitch → play
- pitch 支持 number 或 [min,max] （线性随机，设计稿 E 项确认）
- 第一次 play 会因 lazy load 未完成而静默失败；第二次起开始有声（这是 Step 1 的简化，后续可加预加载）
*/

export class AudioPlayer {
    constructor(database, pool) {
        this._database = database;
        this._pool = pool;
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

        const volume = (typeof options.volume === "number")
            ? options.volume
            : (def.volume ?? 1.0);
        const pitch = this._resolvePitch(options.pitch ?? def.pitch);

        return this._pool.play(clipUrl, { volume, pitch });
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