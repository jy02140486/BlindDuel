export class NpcFrameComponent {
    constructor(clips = {}) {
        this.clips = {};
        this.currentClipName = null;
        this.currentClip = null;
        this.frames = [];
        this.currentFrameIndex = 0;
        this.timeInFrameMs = 0;
        this.timeScale = 1.0;
        this.loop = true;
        this.finished = false;

        this.#buildClips(clips);
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
        for (const [clipName, clipDef] of Object.entries(clips)) {
            const atlasData = clipDef.atlasData;
            const frames = this.#buildFrames(atlasData);
            const frameTags = atlasData.meta?.frameTags || [];

            const tag = frameTags.find((t) => t.name === clipName);
            const frameTag = tag ? { from: tag.from, to: tag.to } : { from: 0, to: 0 };

            this.clips[clipName] = {
                ...clipDef,
                frames,
                frameTag
            };
        }
    }

    play(clipName, options = {}) {
        const clip = this.clips[clipName];
        if (!clip) {
            throw new Error(`Unknown NPC animation clip: ${clipName}`);
        }

        const restart = options.restart ?? this.currentClipName !== clipName;
        this.currentClipName = clipName;
        this.currentClip = clip;
        this.frames = clip.frames;
        this.loop = clip.loop ?? true;

        if (restart) {
            this.currentFrameIndex = clip.frameTag.from;
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
        return this.finished ? 1 : 0;
    }

    get isFinished() {
        return this.finished;
    }

    fixedUpdate(dtMs) {
        if (!this.currentClip) {
            return;
        }

        const tag = this.currentClip.frameTag;
        const tagFrameCount = tag.to - tag.from + 1;

        if (tagFrameCount <= 1) {
            if (!this.loop) {
                this.finished = true;
            }
            return;
        }

        const scaledDt = dtMs * this.timeScale;
        this.timeInFrameMs += scaledDt;
        while (this.timeInFrameMs >= this.currentFrame.durationMs) {
            this.timeInFrameMs -= this.currentFrame.durationMs;
            if (this.currentFrameIndex + 1 <= tag.to) {
                this.currentFrameIndex += 1;
            } else if (this.loop) {
                this.currentFrameIndex = tag.from;
            } else {
                this.currentFrameIndex = tag.to;
                this.timeInFrameMs = 0;
                this.finished = true;
                break;
            }
        }
    }
}