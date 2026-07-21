/*
 * 音频池，用于缓存和管理音频资源。
 * 每个音频资源都有一个唯一的 URL，用于标识和加载。
 * 加载状态包括：待加载、已加载、加载失败。
 * 播放时，会根据加载状态判断是否可以播放。
 */
const LOAD_STATE = { PENDING: 0, LOADED: 1, FAILED: 2 };

export class AudioPool {
    constructor() {
        this._scene = null;
        this._cache = new Map();
    }
/*
attachScene / detachScene 跟随 Scene 生命周期
scene 切换时 cache 整体清空（旧 Sound 已随旧 scene.dispose 被销毁）
*/
    attachScene(scene) {
        this._scene = scene;
    }

    detachScene() {
        this._scene = null;
        this._cache.clear();
    }

    getOrLoad(url) {
        if (!this._scene) return { state: LOAD_STATE.FAILED, sound: null };
        const cached = this._cache.get(url);
        if (cached) return cached;

        const entry = { state: LOAD_STATE.PENDING, sound: null };
        this._cache.set(url, entry);

        try {
            const sound = new BABYLON.Sound(
                url,
                url,
                this._scene,
                () => { entry.state = LOAD_STATE.LOADED; },
                { autoplay: false, spatialSound: false }
            );
            entry.sound = sound;
        } catch (err) {
            console.warn("[AudioPool] create failed", url, err);
            entry.state = LOAD_STATE.FAILED;
        }
        return entry;
    }

    canPlay(url) {
        const entry = this._cache.get(url);
        if (!entry) return false;
        return entry.state === LOAD_STATE.LOADED && entry.sound;
    }

    play(url, options) {
        const entry = this._cache.get(url);
        if (!entry || !entry.sound) return false;
        if (entry.state !== LOAD_STATE.LOADED) return false;
        try {
            const opts = options || {};
            if (typeof opts.volume === "number") entry.sound.setVolume(opts.volume);
            entry.sound.setPlaybackRate(opts.pitch ?? 1);
            entry.sound.play();
            return true;
        } catch (err) {
            console.warn("[AudioPool] play failed", url, err);
            return false;
        }
    }
}

export { LOAD_STATE };