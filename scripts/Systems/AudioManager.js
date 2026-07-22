import { AudioDatabase } from "./Audio/AudioDatabase.js";
import { AudioPool } from "./Audio/AudioPool.js";
import { AudioPlayer } from "./Audio/AudioPlayer.js";

const DEFAULT_THROTTLE_MS = 50;

export class AudioManager {
    constructor(audioAssets = {}) {
        const clips = audioAssets.clips ?? {};
        const buses = audioAssets.buses ?? {};
        this._database = new AudioDatabase(clips, buses);
        this._pool = new AudioPool();
        this._player = new AudioPlayer(this._database, this._pool);
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
    }

    detachScene() {
        this._pool.detachScene();
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
    }

    playMusic(id, options = {}) {
    }

    stopMusic() {
    }

    setBusVolume(busName, value) {
    }

    update(deltaTimeMs) {
    }

    setPaused(paused) {
        this._paused = !!paused;
    }

    dispose() {
        if (this._unsubGameplay) {
            this._unsubGameplay();
            this._unsubGameplay = null;
        }
        this._pool.detachScene();
        this._lastPlayAt.clear();
    }
}