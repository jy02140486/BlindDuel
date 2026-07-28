export class AmbientPlayer {
    constructor() {
        this._scene = null;
        this._active = new Map();
        this.onSoundPlay = null;
        this.onSoundStop = null;
        this.getBusVolume = null;
        this.getMasterVolume = null;
    }

    attachScene(scene) { this._scene = scene; }

    detachScene() {
        this.stopAll();
        this._scene = null;
    }

    dispose() {
        this.stopAll();
        this._scene = null;
    }

    getActiveIds() {
        return [...this._active.keys()];
    }

    has(id) {
        return this._active.has(id);
    }

    play(id, def, options = {}) {
        console.log('[Ambient sfx] AmbientPlayer.play enter, id=', id, 'hasScene=', !!this._scene, 'alreadyActive=', this._active.has(id));
        if (!this._scene || !def) return false;
        if (!Array.isArray(def.clips) || def.clips.length === 0) {
            console.warn(`[AmbientPlayer] no clips for ambient id: ${id}`);
            return false;
        }
        if (this._active.has(id)) return true;

        const url = def.clips[0];
        const baseVolume = (typeof options.volume === "number")
            ? options.volume
            : (def.volume ?? 1.0);

        const sound = new BABYLON.Sound(
            `ambient_${id}`,
            url,
            this._scene,
            () => {
                sound.isReady = true;
                console.log('[Ambient sfx] AmbientPlayer onload, id=', id, 'hasPending=', !!sound._pendingPlay);
                if (sound._pendingPlay) {
                    const p = sound._pendingPlay;
                    sound._pendingPlay = null;
                    try {
                        sound.setVolume(p.volume);
                        sound.play();
                        if (this.onSoundPlay) this.onSoundPlay(sound, p.meta);
                        console.log('[Ambient sfx] AmbientPlayer pending play OK, id=', id);
                    } catch (e) {
                        console.warn(`[AmbientPlayer] pending play failed: ${id}`, e);
                    }
                }
            },
            { loop: true, autoplay: false, volume: 0 }
        );

        this._active.set(id, { sound, baseVolume });
        this._applyPlay(sound, baseVolume);
        return true;
    }

    stop(id) {
        const entry = this._active.get(id);
        if (!entry) return;
        console.log('[Ambient sfx] AmbientPlayer.stop, id=', id, 'isReady=', entry.sound.isReady);
        if (this.onSoundStop) this.onSoundStop(entry.sound);
        try { entry.sound.stop(); } catch (e) {}
        try { entry.sound.dispose(); } catch (e) {}
        this._active.delete(id);
    }

    stopAll() {
        for (const id of [...this._active.keys()]) {
            this.stop(id);
        }
    }

    applyBusVolumeChange() {
        const busVol = this.getBusVolume ? this.getBusVolume("ambient") : 1.0;
        const masterVol = this.getMasterVolume ? this.getMasterVolume() : 1.0;
        for (const [, entry] of this._active) {
            if (entry.sound.isReady) {
                try {
                    entry.sound.setVolume(entry.baseVolume * busVol * masterVol);
                } catch (e) {}
            }
        }
    }

    _applyPlay(sound, baseVolume) {
        const busVol = this.getBusVolume ? this.getBusVolume("ambient") : 1.0;
        const masterVol = this.getMasterVolume ? this.getMasterVolume() : 1.0;
        const finalVolume = baseVolume * busVol * masterVol;
        if (sound.isReady) {
            console.log('[Ambient sfx] _applyPlay immediate, sound ready');
            try {
                sound.setVolume(finalVolume);
                sound.play();
                if (this.onSoundPlay) this.onSoundPlay(sound, { bus: "ambient", baseVolume, loop: true });
                console.log('[Ambient sfx] _applyPlay immediate play OK');
            } catch (e) {
                console.warn(`[AmbientPlayer] play failed`, e);
            }
            return;
        }
        console.log('[Ambient sfx] _applyPlay set pending (sound not ready)');
        sound._pendingPlay = { volume: finalVolume, meta: { bus: "ambient", baseVolume, loop: true } };
    }
}