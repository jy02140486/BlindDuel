import { AudioDatabase } from "./Audio/AudioDatabase.js";
import { AudioPool } from "./Audio/AudioPool.js";
import { AudioPlayer } from "./Audio/AudioPlayer.js";
import { MusicPlayer } from "./Audio/MusicPlayer.js";

const DEFAULT_THROTTLE_MS = 50;

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
        this._lastPlayAt = new Map();
        this._paused = false;
        this._unsubGameplay = null;
        this._registerUnlock();
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
    }

    detachScene() {
        this._pool.detachScene();
        this._music.detachScene();
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

    setBusVolume(busName, value) {
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
        this._pool.detachScene();
        this._lastPlayAt.clear();
    }
}