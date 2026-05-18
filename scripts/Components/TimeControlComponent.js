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
    }
}
