export class ImpactContext {
    constructor(options = {}) {
        this.frames = options.frames ?? 0;
        this.nextState = options.nextState ?? null;
        this.knockbackX = options.knockbackX ?? 0;
        this.preTimeScale = options.preTimeScale ?? 1.0;
        this.expectedStateAtResolve = options.expectedStateAtResolve ?? null;
        this.stateEntrySerialAtCreate = options.stateEntrySerialAtCreate ?? null;
        this.startTick = options.startTick ?? null;
    }
}

export class TimeControlComponent {
    constructor() {
        this.hitstopFrames = 0;
        this.preHitstopTimeScale = 1.0;
        this.blockstunFrames = 0;
        this.hitstunFrames = 0;
        this.impactContext = null;
        // hitstop 结束后 attacker pushback 逐帧消费
        this.hitstopPushbackFrames = 0;
        this.hitstopPushbackPerFrame = 0;
        // pending 延迟启动：hitstop 解冻后等 sprite 切到下一帧才开始
        this.hitstopPushbackPending = false;
        this.hitstopPushbackStartFrameIndex = 0;
    }
}
