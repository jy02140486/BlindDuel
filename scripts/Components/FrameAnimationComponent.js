export class FrameAnimationComponent {
    constructor(clips = {}) {
        this.clips = this.#buildClips(clips);
        this.currentClipName = null;
        this.currentClip = null;
        this.frames = [];
        this.currentFrameIndex = 0;
        this.timeInFrameMs = 0;
        this.loop = true;
        this.finished = false;
        this.timeScale = 1.0;
    }

    setTimeScale(scale) {
        this.timeScale = scale;
    }

    #buildFrames(atlasData) {
        const entries = Object.entries(atlasData.frames || {});
        entries.sort((a, b) => {
            const fa = a[1].frame;
            const fb = b[1].frame;
            if (fa.y !== fb.y) return fa.y - fb.y;
            if (fa.x !== fb.x) return fa.x - fb.x;
            return a[0].localeCompare(b[0]);
        });

        return entries.map(([name, item], index) => ({
            index,
            name,
            x: item.frame.x,
            y: item.frame.y,
            w: item.frame.w,
            h: item.frame.h,
            durationMs: item.duration || 100
        }));
    }

    #buildClips(clips) {
        const result = {};
        for (const [clipName, clipDef] of Object.entries(clips)) {
            result[clipName] = {
                ...clipDef,
                frames: this.#buildFrames(clipDef.atlasData)
            };
        }
        return result;
    }

    setClips(clips) {
        this.clips = this.#buildClips(clips);
    }

    play(clipName, options = {}) {
        const clip = this.clips[clipName];
        if (!clip) {
            throw new Error(`Unknown animation clip: ${clipName}`);
        }

        const restart = options.restart ?? this.currentClipName !== clipName;
        this.currentClipName = clipName;
        this.currentClip = clip;
        this.frames = clip.frames;
        this.loop = clip.loop ?? true;

        if (restart) {
            this.currentFrameIndex = 0;
            this.timeInFrameMs = 0;
            this.finished = false;
        }
    }

    get frameCount() {
        return this.frames.length;
    }

    get currentFrame() {
        return this.frames[this.currentFrameIndex];
    }

    get normalizedTime() {
        if (this.finished && !this.loop) {
            return 1;
        }

        if (this.frames.length <= 1) {
            return this.finished ? 1 : 0;
        }

        const frameProgress = this.currentFrame.durationMs > 0
            ? this.timeInFrameMs / this.currentFrame.durationMs
            : 0;
        return Math.min((this.currentFrameIndex + frameProgress) / this.frames.length, 1);
    }

    get isFinished() {
        return this.finished;
    }

    fixedUpdate(dtMs) {
        if (this.frames.length <= 1) {
            if (!this.loop) {
                this.finished = true;
            }
            return;
        }

        const scaledDt = dtMs * this.timeScale;
        this.timeInFrameMs += scaledDt;
        while (this.timeInFrameMs >= this.currentFrame.durationMs) {
            this.timeInFrameMs -= this.currentFrame.durationMs;
            if (this.currentFrameIndex + 1 < this.frames.length) {
                this.currentFrameIndex += 1;
            } else if (this.loop) {
                this.currentFrameIndex = 0;
            } else {
                this.currentFrameIndex = this.frames.length - 1;
                this.timeInFrameMs = 0;
                this.finished = true;
                break;
            }
        }
    }
}
