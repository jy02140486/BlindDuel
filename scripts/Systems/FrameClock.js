export class FrameClock {
    constructor(fixedDeltaMs = 1000 / 60) {
        this.fixedDeltaMs = fixedDeltaMs;
        this.tick = 0;
        this.fixedTime = 0;
        this.accumulator = 0;
        this.renderAlpha = 0;
        this.renderTime = 0;
        this.timeScale = 1.0;
        this.paused = false;
        this.realDtMs = 0;
    }

    advance(realDtMs) {
        this.realDtMs = realDtMs;
        if (this.paused) return;
        this.accumulator += realDtMs * this.timeScale;
        if (this.accumulator > this.fixedDeltaMs * 5) {
            this.accumulator = this.fixedDeltaMs * 5;
        }
    }

    stepFixed() {
        if (this.accumulator < this.fixedDeltaMs) return false;
        this.accumulator -= this.fixedDeltaMs;
        this.tick++;
        this.fixedTime = this.tick * this.fixedDeltaMs;
        return true;
    }

    refreshRender() {
        this.renderAlpha = this.accumulator / this.fixedDeltaMs;
        this.renderTime = this.fixedTime + this.accumulator;
    }
}