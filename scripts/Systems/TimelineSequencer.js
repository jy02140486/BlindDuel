export class TimelineSequencer {
    constructor(context) {
        this.context = context;
        this.timeline = null;
        this.currentTimeMs = 0;
        this.busy = false;
        this.activeClipStates = new Map();
        this.firedEventClipIds = new Set();
        this._clipIdCounter = 0;
    }

    isBusy() {
        return this.busy;
    }

    play(timeline, payload) {
        if (!timeline || !Array.isArray(timeline.tracks)) {
            console.warn("[TimelineSequencer] play called with invalid timeline");
            return;
        }

        this._validateTimeline(timeline);

        this.timeline = timeline;
        this.currentTimeMs = 0;
        this.busy = true;
        this.activeClipStates.clear();
        this.firedEventClipIds.clear();
        this._clipIdCounter = 0;

        console.log(`[TimelineSequencer] start timeline: ${timeline.id}`);

        for (const track of timeline.tracks) {
            for (const clip of track.clips) {
                clip._id = clip._id || `clip_${this._clipIdCounter++}`;
            }
        }
    }

    stop() {
        if (!this.busy) return;

        for (const [clipId, state] of this.activeClipStates) {
            const clip = state.clip;
            const handler = this._getHandler(clip.type);
            if (handler && typeof handler.end === "function") {
                try {
                    handler.end(this.context, clip, state);
                } catch (e) {
                    console.error(`[TimelineSequencer] end error for clip ${clipId}:`, e);
                }
            }
        }

        this._resetControlledActors();
        console.log("[TimelineSequencer] stop");
        this.busy = false;
        this.timeline = null;
        this.currentTimeMs = 0;
        this.activeClipStates.clear();
        this.firedEventClipIds.clear();
    }

    _resetControlledActors() {
        for (const state of this.activeClipStates.values()) {
            const actor = state.actor;
            if (actor && "controlledBySequence" in actor) {
                actor.controlledBySequence = false;
            }
        }
    }

    clear() {
        this.stop();
    }

    fixedUpdate(dtMs, tickCount) {
        if (!this.busy) return;

        const timeline = this.timeline;
        const prevTimeMs = this.currentTimeMs;
        this.currentTimeMs += dtMs;

        //console.log(`[TimelineSeq] tick prev=${prevTimeMs.toFixed(1)} cur=${this.currentTimeMs.toFixed(1)} dt=${dtMs.toFixed(2)} activeClips=${this.activeClipStates.size}`);

        for (const track of timeline.tracks) {
            for (const clip of track.clips) {
                this._updateClip(clip, track, prevTimeMs, this.currentTimeMs, dtMs);
            }
        }

        if (this.currentTimeMs >= timeline.durationMs) {
            if (timeline.loop) {
                this._onLoop();
            } else {
                this._onComplete();
            }
        }
    }

    _onLoop() {
        for (const [clipId, state] of this.activeClipStates) {
            const clip = state.clip;
            const handler = this._getHandler(clip.type);
            if (handler && typeof handler.end === "function") {
                try {
                    handler.end(this.context, clip, state);
                } catch (e) {
                    console.error(`[TimelineSequencer] loop end error for clip ${clipId}:`, e);
                }
            }
        }
        this._resetControlledActors();
        this.activeClipStates.clear();
        this.firedEventClipIds.clear();
        this.currentTimeMs = 0;
        console.log(`[TimelineSequencer] loop: ${this.timeline.id}`);
    }

    _onComplete() {
        console.log(`[TimelineSeq] _onComplete activeClipIds=[${[...this.activeClipStates.keys()].join(", ")}]`);
        for (const [clipId, state] of this.activeClipStates) {
            const clip = state.clip;
            const handler = this._getHandler(clip.type);
            if (handler && typeof handler.end === "function") {
                try {
                    console.log(`[TimelineSeq] _onComplete calling end() for ${clipId} (type=${clip.type})`);
                    handler.end(this.context, clip, state);
                } catch (e) {
                    console.error(`[TimelineSequencer] complete end error for clip ${clipId}:`, e);
                }
            }
        }
        console.log(`[TimelineSequencer] sequence complete: ${this.timeline.id}`);
        this._resetControlledActors();
        this.busy = false;
        this.timeline = null;
        this.currentTimeMs = 0;
        this.activeClipStates.clear();
        this.firedEventClipIds.clear();
    }

    _updateClip(clip, track, prevTimeMs, currentTimeMs, dtMs) {
        const clipId = clip._id;
        const isEvent = "atMs" in clip;
        const startMs = isEvent ? clip.atMs : clip.startMs;
        const endMs = isEvent ? clip.atMs : (clip.startMs + (clip.durationMs || 0));

        const wasActive = this.activeClipStates.has(clipId);
        const isNowActive = currentTimeMs >= startMs && currentTimeMs < endMs;
        const justCrossedStart = prevTimeMs <= startMs && currentTimeMs > startMs;
        const justCrossedEnd = prevTimeMs <= endMs && currentTimeMs > endMs;

        if (isEvent) {
            if (justCrossedStart && !this.firedEventClipIds.has(clipId)) {
                //console.log(`[TimelineSeq] EVENT FIRE ${clipId} type=${clip.type} atMs=${startMs}`);
                this.firedEventClipIds.add(clipId);
                const handler = this._getHandler(clip.type);
                if (handler && typeof handler.start === "function") {
                    try {
                        handler.start(this.context, clip, track);
                    } catch (e) {
                        console.error(`[TimelineSequencer] event error for clip ${clipId}:`, e);
                    }
                }
            }
            return;
        }

        if (!wasActive && isNowActive) {
            console.log(`[TimelineSeq] INTERVAL START ${clipId} type=${clip.type} [${startMs}, ${endMs}]`);
            const state = { clip, track, startMs };
            this.activeClipStates.set(clipId, state);
            const handler = this._getHandler(clip.type);
            if (handler && typeof handler.start === "function") {
                try {
                    handler.start(this.context, clip, state);
                } catch (e) {
                    console.error(`[TimelineSequencer] start error for clip ${clipId}:`, e);
                }
            }
        } else if (!wasActive && !isNowActive && justCrossedStart && currentTimeMs >= endMs) {
            console.log(`[TimelineSeq] INTERVAL SHORT-LIVED ${clipId} type=${clip.type} [${startMs}, ${endMs}] — start+end in same frame`);
            const state = { clip, track, startMs };
            this.activeClipStates.set(clipId, state);
            const handler = this._getHandler(clip.type);
            if (handler) {
                try {
                    if (typeof handler.start === "function") {
                        handler.start(this.context, clip, state);
                    }
                    if (typeof handler.end === "function") {
                        handler.end(this.context, clip, state);
                    }
                } catch (e) {
                    console.error(`[TimelineSequencer] short-lived clip error for ${clipId}:`, e);
                }
            }
            this.activeClipStates.delete(clipId);
        }

        if (wasActive && isNowActive) {
            const state = this.activeClipStates.get(clipId);
            const localMs = currentTimeMs - startMs;
            const handler = this._getHandler(clip.type);
            if (handler && typeof handler.update === "function") {
                try {
                    const keepActive = handler.update(this.context, clip, state, localMs, dtMs);
                    if (keepActive === false) {
                        console.log(`[TimelineSeq] INTERVAL END (update→false) ${clipId} type=${clip.type}`);
                        this._endClip(clipId, clip, state);
                    }
                } catch (e) {
                    console.error(`[TimelineSequencer] update error for clip ${clipId}:`, e);
                }
            }
        }

        if (wasActive && justCrossedEnd) {
            console.log(`[TimelineSeq] INTERVAL END (crossedEnd) ${clipId} type=${clip.type}`);
            const state = this.activeClipStates.get(clipId);
            this._endClip(clipId, clip, state);
        }
    }

    _endClip(clipId, clip, state) {
        const handler = this._getHandler(clip.type);
        if (handler && typeof handler.end === "function") {
            try {
                handler.end(this.context, clip, state);
            } catch (e) {
                console.error(`[TimelineSequencer] end error for clip ${clipId}:`, e);
            }
        }
        this.activeClipStates.delete(clipId);
    }

    _getHandler(type) {
        return ACTION_HANDLERS[type] || null;
    }

    _validateTimeline(timeline) {
        if (!timeline.durationMs || timeline.durationMs <= 0) {
            console.warn(`[TimelineSequencer] timeline ${timeline.id} has invalid durationMs`);
        }

        const intervalMap = new Map();
        for (const track of timeline.tracks) {
            for (const clip of track.clips) {
                const isEvent = "atMs" in clip;
                if (isEvent) {
                    if (clip.atMs < 0 || clip.atMs > timeline.durationMs) {
                        console.warn(`[TimelineSequencer] clip ${clip.type} atMs=${clip.atMs} out of bounds`);
                    }
                } else {
                    const startMs = clip.startMs ?? 0;
                    const endMs = startMs + (clip.durationMs || 0);
                    if (startMs < 0 || endMs > timeline.durationMs) {
                        console.warn(`[TimelineSequencer] clip ${clip.type} interval [${startMs}, ${endMs}] out of bounds`);
                    }

                    if (track.binding && track.channel) {
                        const key = `${JSON.stringify(track.binding)}|${track.channel}`;
                        const intervals = intervalMap.get(key) || [];
                        for (const iv of intervals) {
                            if (startMs < iv.endMs && endMs > iv.startMs) {
                                console.warn(`[TimelineSequencer] overlapping interval clips on same binding+channel: ${key} [${startMs},${endMs}] vs [${iv.startMs},${iv.endMs}]`);
                            }
                        }
                        intervals.push({ startMs, endMs });
                        intervalMap.set(key, intervals);
                    }
                }
            }
        }
    }
}

function _resolveActor(context, binding) {
    if (!binding) return null;
    if (binding.actorId) {
        if (context.actorRegistry) {
            return context.actorRegistry.get(binding.actorId) || null;
        }
        if (binding.actorId === "hero") return context.character || null;
        if (binding.actorId === "enemy") return context.rabbleStick || null;
        for (const entity of context.entityPool || []) {
            if (entity.id === binding.actorId || entity.name === binding.actorId) {
                return entity;
            }
        }
    }
    return null;
}

function _resolveController(context, binding) {
    if (!binding) return null;
    if (binding.actorId) {
        if (context.controllerRegistry) {
            return context.controllerRegistry.get(binding.actorId) || null;
        }
        if (binding.actorId === "hero") return context.playerController || null;
    }
    return null;
}

const ACTION_HANDLERS = {
    command: {
        start(ctx, clip, track) {
            const actor = _resolveActor(ctx, track.binding);
            if (!actor) {
                console.warn(`[TimelineSequencer] command: actor not found`);
                return;
            }
            // pushCommand 失败时 fallback 到 enterState（支持无 transitions 的 actor，如 PropEntity / companion）
            if (typeof actor.pushCommand === "function") {
                const accepted = actor.pushCommand(clip.command);
                if (!accepted && typeof actor.enterState === "function") {
                    actor.enterState(clip.command);
                }
            } else if (typeof actor.enterState === "function") {
                actor.enterState(clip.command);
            } else {
                console.warn(`[TimelineSequencer] command: actor has no pushCommand or enterState`);
            }
        }
    },

    callback: {
        start(ctx, clip, track) {
            const fn = clip.fn;
            if (!fn) {
                console.warn(`[TimelineSequencer] callback: clip.fn missing`);
                return;
            }
            let handler;
            if (typeof fn === "function") {
                handler = fn;
            } else if (typeof fn === "string" && ctx.sequenceHandlers) {
                handler = ctx.sequenceHandlers.get(fn);
            }
            if (typeof handler !== "function") {
                console.warn(`[TimelineSequencer] callback: handler not found for fn=${fn}`);
                return;
            }
            try {
                handler(ctx, clip);
            } catch (e) {
                console.error(`[TimelineSequencer] callback handler "${fn}" threw:`, e);
            }
        }
    },

    moveActorTo: {
        start(ctx, clip, state) {
            const actor = _resolveActor(ctx, state.track.binding);
            if (!actor || !actor.root) {
                console.warn(`[TimelineSequencer] moveActorTo: actor not found`);
                state.invalid = true;
                return;
            }
            state.actor = actor;
            state.startX = actor.root.position.x;
            state.startY = actor.root.position.y;
            state.targetX = clip.x ?? state.startX;
            state.targetY = clip.y ?? state.startY;
            if ("controlledBySequence" in actor) {
                actor.controlledBySequence = true;
            }
            console.log(`[TimelineSeq] moveActorTo START from (${state.startX.toFixed(2)}, ${state.startY.toFixed(2)}) → (${state.targetX.toFixed(2)}, ${state.targetY.toFixed(2)}) durationMs=${clip.durationMs}`);
        },
        update(ctx, clip, state, localMs, dtMs) {
            if (state.invalid) return false;
            const actor = state.actor;
            const durationMs = clip.durationMs || 1;
            const t = Math.min(localMs / durationMs, 1);
            const easedT = clip.easing === "linear" ? t : t;

            actor.root.position.x = state.startX + (state.targetX - state.startX) * easedT;
            actor.root.position.y = state.startY + (state.targetY - state.startY) * easedT;

            const dx = state.targetX - actor.root.position.x;
            const dy = state.targetY - actor.root.position.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > 0.001 && typeof actor.setMoveIntent === "function") {
                actor.setMoveIntent({ x: dx / dist, y: dy / dist });
            }

            return t < 1;
        },
        end(ctx, clip, state) {
            if (state.invalid) return;
            const actor = state.actor;
            const beforeY = actor.root.position.y;
            actor.root.position.x = state.targetX;
            actor.root.position.y = state.targetY;
            console.log(`[TimelineSeq] moveActorTo END snap to (${state.targetX.toFixed(2)}, ${state.targetY.toFixed(2)}) yDelta=${(state.targetY - beforeY).toFixed(3)}`);
            if ("controlledBySequence" in actor) {
                actor.controlledBySequence = false;
            }
            if (typeof actor.setMoveIntent === "function") {
                actor.setMoveIntent({ x: 0, y: 0 });
            }
        }
    },

    cameraBlend: {
        start(ctx, clip, state) {
            const cameraManager = ctx.cameraManager;
            if (!cameraManager) {
                console.warn("[TimelineSequencer] cameraBlend: cameraManager not found");
                state.invalid = true;
                return;
            }

            const toRigId = clip.to;
            if (!toRigId) {
                console.warn("[TimelineSequencer] cameraBlend: missing target rig");
                state.invalid = true;
                return;
            }

            if (!cameraManager.rigs?.has(toRigId)) {
                console.warn(`[TimelineSequencer] cameraBlend: unknown rig "${toRigId}"`);
                state.invalid = true;
                return;
            }

            console.log(`[TimelineSeq] cameraBlend START to="${toRigId}" durationMs=${clip.durationMs} activeRig=${cameraManager.activeRigId}`);

            const { character, rabbleStick } = ctx;
            let frameCtx = null;

            if (toRigId === "duel" && character && rabbleStick) {
                const heroPos = character.root.position;
                const opponentPos = rabbleStick.root.position;
                const centerX = (heroPos.x + opponentPos.x) * 0.5;
                const centerZ = (heroPos.z + opponentPos.z) * 0.5;
                const centerY = (heroPos.y + opponentPos.y) * 0.5;
                const fighterDistance = Math.abs(opponentPos.x - heroPos.x);
                frameCtx = {
                    basePosition: new BABYLON.Vector3(centerX, 8, centerZ - 25),
                    target: new BABYLON.Vector3(centerX, centerY, centerZ),
                    fighterDistance
                };
            } else if (toRigId === "explore" && character) {
                const pos = character.root.position;
                frameCtx = {
                    target: new BABYLON.Vector3(pos.x, pos.y, pos.z)
                };
            }

            const ok = cameraManager.startBlend({
                toRigId,
                durationMs: clip.durationMs,
                frameCtx
            });

            console.log(`[TimelineSeq] cameraBlend startBlend returned ok=${ok}`);

            state.cameraManager = cameraManager;
            state.invalid = !ok;
        },
        update(ctx, clip, state, localMs, dtMs) {
            if (state.invalid) return false;
            const blending = state.cameraManager?.isBlending() ?? false;
            //console.log(`[TimelineSeq] cameraBlend UPDATE localMs=${localMs.toFixed(1)} isBlending=${blending} activeRig=${state.cameraManager?.activeRigId}`);
            return blending;
        },
        end(ctx, clip, state) {
            console.log(`[TimelineSeq] cameraBlend END activeRig=${state.cameraManager?.activeRigId}`);
        }
    },

    inputLock: {
        start(ctx, clip, track) {
            const controller = _resolveController(ctx, track.binding);
            if (controller && "enabled" in controller) {
                controller.enabled = !clip.locked;
                console.log(`[TimelineSeq] inputLock locked=${clip.locked} controller.enabled=${controller.enabled}`);
            } else {
                console.warn(`[TimelineSequencer] inputLock: controller not found`);
            }
        }
    },

    faceWorldX: {
        start(ctx, clip, track) {
            const actor = _resolveActor(ctx, track.binding);
            if (!actor || typeof actor.setFacing !== "function") {
                console.warn(`[TimelineSequencer] faceWorldX: actor not found or no setFacing`);
                return;
            }
            const nativeFacingX = actor.nativeFacingX ?? 1;
            const spriteFacing = clip.direction === nativeFacingX ? 1 : -1;
            actor.setFacing(spriteFacing);
        }
    },

    switchMode: {
        start(ctx, clip, track) {
            const gameModeManager = ctx.gameModeManager;
            if (!gameModeManager) {
                console.warn("[TimelineSequencer] switchMode: gameModeManager not found");
                return;
            }
            gameModeManager.switchMode(clip.modeId, clip.payload);
        }
    },

    setCameraFrame: {
        start(ctx, clip, track) {
            const rig = ctx.scriptedCameraRig;
            if (!rig) {
                console.warn("[TimelineSequencer] setCameraFrame: scriptedCameraRig not available");
                return;
            }
            rig.setFrame({
                center: clip.center,
                height: clip.height,
                orthoWidth: clip.orthoWidth,
                zOffset: clip.zOffset
            });
        }
    },

    setCameraFollow: {
        start(ctx, clip, track) {
            const rig = ctx.scriptedCameraRig;
            if (!rig) {
                console.warn("[TimelineSequencer] setCameraFollow: scriptedCameraRig not available");
                return;
            }
            const binding = clip.actorId ? { actorId: clip.actorId } : track.binding;
            const actor = _resolveActor(ctx, binding);
            if (!actor || !actor.root) {
                console.warn(`[TimelineSequencer] setCameraFollow: actor not found (actorId=${clip.actorId ?? track.binding?.actorId})`);
                return;
            }
            rig.setFollowTarget(actor, {
                offsetX: clip.offsetX,
                offsetY: clip.offsetY,
                offsetZ: clip.offsetZ,
                lerp: clip.lerp,
                height: clip.height,
                orthoWidth: clip.orthoWidth
            });
        }
    },

    cameraEffect: {
        start(ctx, clip, state) {
            const cm = ctx.cameraManager;
            if (!cm) {
                console.warn("[TimelineSequencer] cameraEffect: cameraManager not found");
                return;
            }
            const effectType = clip.effect;
            const params = { ...clip.params };

            if (effectType === "shake" && clip.amplitude !== undefined) {
                params.amplitude = clip.amplitude;
                params.frequency = clip.frequency ?? 35;
            }
            if (effectType === "flash" && clip.color !== undefined) {
                params.color = clip.color;
            }
            if (effectType === "letterbox") {
                params.height = clip.height ?? params.height ?? 72;
                params.speed = clip.speed ?? params.speed ?? 240;
            }
            if (effectType === "fade") {
                params.color = clip.color ?? params.color ?? "black";
                params.from = clip.from ?? params.from ?? 0;
                params.to = clip.to ?? params.to ?? 1;
            }

            cm.enqueueEffect({
                type: effectType,
                durationMs: clip.durationMs,
                params
            });

            state.cm = cm;
            state.effectType = effectType;

            console.log(`[TimelineSeq] cameraEffect START type=${effectType} durationMs=${clip.durationMs}`);
        },
        end(ctx, clip, state) {
            if (state.effectType === "letterbox") {
                state.cm?.clearEffects(fx => fx.type === "letterbox");
            }
            if (state.effectType === "fade") {
                state.cm?.clearEffects(fx => fx.type === "fade");
            }
            console.log(`[TimelineSeq] cameraEffect END type=${state.effectType}`);
        }
    }
};
