import { AudioDatabase } from "./Audio/AudioDatabase.js";
import { AudioPool } from "./Audio/AudioPool.js";
import { AudioPlayer } from "./Audio/AudioPlayer.js";
import { MusicPlayer } from "./Audio/MusicPlayer.js";
import { AmbientPlayer } from "./Audio/AmbientPlayer.js";

const DEFAULT_THROTTLE_MS = 50;
const STORAGE_KEY = "blinduel_audio_bus_volumes";

export class AudioManager {
    constructor(audioAssets = {}) {
        const clips = audioAssets.clips ?? {};
        const buses = audioAssets.buses ?? {};
        const music = audioAssets.music ?? {};
        this._database = new AudioDatabase(clips, buses);
        this._pool = new AudioPool();
        this._player = new AudioPlayer(this._database, this._pool);
        this._musicDefs = music;
        this._music = new MusicPlayer();
        this._ambient = new AmbientPlayer();
        this._lastPlayAt = new Map();
        this._paused = false;
        this._unsubGameplay = null;
        this._activeSounds = new Map();
        this._busVolumes = this._loadBusVolumes(buses);
        this._wireCallbacks();
        this._registerUnlock();
        this._registerContextResumeListener();
    }

    _registerContextResumeListener() {
        if (typeof window === "undefined") return;
        const audioEngine = BABYLON?.Engine?.audioEngine;
        if (!audioEngine) return;
        this._audioResumeDone = false;
        const onResumed = () => {
            if (this._audioResumeDone) return;
            setTimeout(() => {
                const ctx = audioEngine.audioContext;
                if (!ctx || ctx.state !== "running") return;
                this._audioResumeDone = true;
                for (const [sound, meta] of this._activeSounds) {
                    if (!sound.isReady) continue;
                    if (!meta || !meta.loop) continue;
                    try { sound.play(); } catch (e) {}
                }
            }, 0);
        };
        if (audioEngine.onUnlock) audioEngine.onUnlock.add(onResumed);
        window.addEventListener("pointerdown", onResumed);
        window.addEventListener("keydown", onResumed);
    }

    _loadBusVolumes(busesConfig) {
        const map = new Map();
        for (const [name, def] of Object.entries(busesConfig)) {
            map.set(name, def?.volume ?? 1.0);
        }
        if (!map.has("master")) map.set("master", 1.0);
        if (!map.has("sfx")) map.set("sfx", 1.0);
        if (!map.has("music")) map.set("music", 1.0);
        if (!map.has("ui")) map.set("ui", 1.0);
        if (!map.has("ambient")) map.set("ambient", 1.0);
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                if (parsed && typeof parsed === "object") {
                    for (const [k, v] of Object.entries(parsed)) {
                        if (typeof v === "number" && map.has(k)) map.set(k, v);
                    }
                }
            }
        } catch (e) {}
        return map;
    }

    _saveBusVolumes() {
        try {
            const obj = {};
            for (const [k, v] of this._busVolumes) obj[k] = v;
            localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
        } catch (e) {}
    }

    _wireCallbacks() {
        this._pool.onSoundPlay = (sound, meta) => this._registerActiveSound(sound, meta);
        this._pool.onSoundStop = (sound) => this._unregisterActiveSound(sound);
        this._music.onSoundPlay = (sound, meta) => this._registerActiveSound(sound, meta);
        this._music.onSoundStop = (sound) => this._unregisterActiveSound(sound);
        this._ambient.onSoundPlay = (sound, meta) => this._registerActiveSound(sound, meta);
        this._ambient.onSoundStop = (sound) => this._unregisterActiveSound(sound);
        this._player.getBusVolume = (bus) => this.getBusVolume(bus);
        this._player.getMasterVolume = () => this.getBusVolume("master");
        this._music.getBusVolume = (bus) => this.getBusVolume(bus);
        this._music.getMasterVolume = () => this.getBusVolume("master");
        this._ambient.getBusVolume = (bus) => this.getBusVolume(bus);
        this._ambient.getMasterVolume = () => this.getBusVolume("master");
    }

    _registerActiveSound(sound, meta) {
        if (!sound || !meta) return;
        sound._audioMeta = meta;
        this._activeSounds.set(sound, meta);
        try {
            sound.onEnded = () => this._unregisterActiveSound(sound);
        } catch (e) {}
    }

    _unregisterActiveSound(sound) {
        if (!sound) return;
        this._activeSounds.delete(sound);
        try { sound.onEnded = null; } catch (e) {}
    }

    _registerUnlock() {
        if (typeof window === "undefined") return;
        const audioEngine = BABYLON?.Engine?.audioEngine;
        if (!audioEngine || audioEngine.unlocked) return;
        const unlock = () => {
            try {
                audioEngine.unlock?.();
                audioEngine.resume?.();
            } catch (err) {
                console.warn("[AudioManager] unlock failed", err);
            }
        };
        window.addEventListener("pointerdown", unlock, { once: true });
        window.addEventListener("keydown", unlock, { once: true });
    }

    wireGameplayEvents(bus) {
        if (this._unsubGameplay) {
            this._unsubGameplay();
            this._unsubGameplay = null;
        }
        if (!bus) return;
        this._unsubGameplay = bus.on("play_audio", (e) => {
            if (!e || typeof e.id !== "string") return;
            this.play(e.id, e.options ?? {});
        });
    }

    attachScene(babylonScene) {
        this._pool.attachScene(babylonScene);
        this._music.attachScene(babylonScene);
        this._ambient.attachScene(babylonScene);
    }

    detachScene() {
        this._pool.detachScene();
        this._music.detachScene();
        this._ambient.detachScene();
    }

    play(id, options = {}) {
        if (this._paused) return false;
        const now = performance.now();
        const throttleMs = options.throttleMs ?? DEFAULT_THROTTLE_MS;
        const last = this._lastPlayAt.get(id) ?? 0;
        if (now - last < throttleMs) return false;
        this._lastPlayAt.set(id, now);
        return this._player.play(id, options);
    }

    stop(id) {
        if (this._paused) return;
        const def = this._database.getClipDef(id);
        if (!def || !Array.isArray(def.clips)) return;
        for (const url of def.clips) {
            this._pool.stop(url);
        }
    }

    playMusic(id, options = {}) {
        const def = this._musicDefs[id];
        if (!def) {
            console.warn(`[AudioManager] playMusic: unknown music id: ${id}`);
            return false;
        }
        return this._music.play(id, def, options);
    }

    stopMusic() {
        this._music.stop();
    }

    switchMusic(id, transition = "crossfade", options = {}) {
        if (!id) {
            this._music.stop();
            return true;
        }
        const def = this._musicDefs[id];
        if (!def) {
            console.warn(`[AudioManager] switchMusic: unknown music id: ${id}`);
            return false;
        }
        return this._music.switchMusic(id, def, transition, options);
    }

    hasMusic(id) {
        return !!id && !!this._musicDefs[id];
    }

    switchAmbient(ids, transition = "cut", options = {}) {
        const targetIds = Array.isArray(ids) ? ids : (ids ? [ids] : []);
        const newSet = new Set(targetIds);
        for (const id of this._ambient.getActiveIds()) {
            if (!newSet.has(id)) this._ambient.stop(id);
        }
        for (const id of targetIds) {
            if (this._ambient.has(id)) continue;
            const def = this._database.getClipDef(id);
            if (!def) {
                console.warn(`[AudioManager] switchAmbient: unknown ambient id: ${id}`);
                continue;
            }
            this._ambient.play(id, def, options);
        }
        return true;
    }

    stopAllAmbient() {
        this._ambient.stopAll();
    }

    getBusVolume(busName) {
        const v = this._busVolumes.get(busName);
        return typeof v === "number" ? v : 1.0;
    }

    setBusVolume(busName, value) {
        if (!this._busVolumes.has(busName)) {
            console.warn(`[AudioManager] setBusVolume: unknown bus: ${busName}`);
            return;
        }
        const clamped = Math.max(0, Math.min(1, value));
        this._busVolumes.set(busName, clamped);
        this._saveBusVolumes();
        this._applyBusVolumesToActive(busName);
        if (busName === "master") {
            this._applyBusVolumesToActive(null);
        }
        if (busName === "music" || busName === "master") {
            this._music.applyBusVolumeChange();
        }
        if (busName === "ambient" || busName === "master") {
            this._ambient.applyBusVolumeChange();
        }
    }

    _applyBusVolumesToActive(targetBus) {
        const masterVol = this.getBusVolume("master");
        for (const [sound, meta] of this._activeSounds) {
            if (targetBus !== null && meta.bus !== targetBus) continue;
            const busVol = this.getBusVolume(meta.bus);
            const finalVol = meta.baseVolume * busVol * masterVol;
            try { sound.setVolume(finalVol); } catch (e) {}
        }
    }

    update(deltaTimeMs) {
        this._music.update(deltaTimeMs);
    }

    setPaused(paused) {
        this._paused = !!paused;
    }

    dispose() {
        if (this._unsubGameplay) {
            this._unsubGameplay();
            this._unsubGameplay = null;
        }
        this._music.detachScene();
        this._ambient.detachScene();
        this._pool.detachScene();
        this._lastPlayAt.clear();
    }
}