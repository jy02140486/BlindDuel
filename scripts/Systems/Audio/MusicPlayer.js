const DEFAULT_CROSSFADE_MS = 800;

export class MusicPlayer {
    constructor() {
        this._scene = null;
        this._sounds = new Map();
        this._current = null;
        this._fade = null;
    }

    attachScene(scene) {
        this._scene = scene;
    }

    detachScene() {
        for (const sound of this._sounds.values()) {
            try { sound.dispose(); } catch (e) {}
        }
        this._sounds.clear();
        this._current = null;
        this._fade = null;
        this._scene = null;
    }

    play(id, def, options = {}) {
        if (!this._scene || !def || !def.url) return false;
        const sound = this._getOrLoad(id, def);
        if (!sound) return false;
        this._stopFade();
        if (this._current && this._current.id !== id) {
            try { this._current.sound.stop(); } catch (e) {}
        }
        const volume = (typeof options.volume === "number") ? options.volume : (def.volume ?? 1.0);
        this._current = { id, sound, volume };
        this._applyPlay(sound, volume);
        return true;
    }

    stop() {
        this._stopFade();
        if (this._current) {
            try { this._current.sound.stop(); } catch (e) {}
            this._current = null;
        }
    }

    switchMusic(id, def, transition = "crossfade", options = {}) {
        if (!this._scene) return false;
        if (!def || !def.url) {
            this.stop();
            return true;
        }
        if (!this._current || transition === "cut") {
            return this.play(id, def, options);
        }
        if (this._current.id === id) return true;

        const newSound = this._getOrLoad(id, def);
        if (!newSound) return false;

        const newVolume = (typeof options.volume === "number") ? options.volume : (def.volume ?? 1.0);
        const crossfadeMs = options.crossfadeMs ?? DEFAULT_CROSSFADE_MS;
        this._fade = {
            oldSound: this._current.sound,
            oldVolume: this._current.volume,
            newSound,
            newId: id,
            newVolume,
            elapsedMs: 0,
            durationMs: crossfadeMs
        };
        this._current = { id, sound: newSound, volume: newVolume };
        this._applyPlay(newSound, 0);
        return true;
    }

    update(dtMs) {
        if (!this._fade) return;
        this._fade.elapsedMs += dtMs;
        const t = Math.min(this._fade.elapsedMs / this._fade.durationMs, 1);
        try {
            if (this._fade.oldSound.isReady) {
                this._fade.oldSound.setVolume(this._fade.oldVolume * (1 - t));
            }
            if (this._fade.newSound.isReady) {
                this._fade.newSound.setVolume(this._fade.newVolume * t);
            }
        } catch (e) {}
        if (t >= 1) {
            try { this._fade.oldSound.stop(); } catch (e) {}
            this._fade = null;
        }
    }

    _stopFade() {
        if (!this._fade) return;
        try { this._fade.oldSound.stop(); } catch (e) {}
        try { this._fade.newSound.setVolume(this._fade.newVolume); } catch (e) {}
        this._fade = null;
    }

    _applyPlay(sound, initialVolume) {
        if (sound.isReady) {
            try {
                sound.setVolume(initialVolume);
                sound.play();
            } catch (e) {
                console.warn(`[MusicPlayer] play failed`, e);
            }
            return;
        }
        sound._pendingPlay = { volume: initialVolume };
    }

    _getOrLoad(id, def) {
        const cached = this._sounds.get(id);
        if (cached) return cached;
        if (!this._scene) return null;
        let sound = null;
        try {
            sound = new BABYLON.Sound(
                `music_${id}`,
                def.url,
                this._scene,
                () => {
                    sound.isReady = true;
                    if (sound._pendingPlay) {
                        const p = sound._pendingPlay;
                        sound._pendingPlay = null;
                        try {
                            sound.setVolume(p.volume);
                            sound.play();
                        } catch (e) {
                            console.warn(`[MusicPlayer] pending play failed: ${id}`, e);
                        }
                    }
                },
                { autoplay: false, loop: def.loop !== false, spatialSound: false }
            );
            sound.isReady = false;
        } catch (e) {
            console.warn(`[MusicPlayer] load failed: ${id} (${def.url})`, e);
            return null;
        }
        this._sounds.set(id, sound);
        return sound;
    }
}

export { DEFAULT_CROSSFADE_MS };