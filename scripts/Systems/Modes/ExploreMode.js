import { BaseMode } from "./BaseMode.js";
import { ExploreCollisionSystem } from "../ExploreCollisionSystem.js";
import { WalkAreaSampler } from "../WalkAreaSampler.js";
import { FACING_MODE } from "../../Enties/CharacterBase.js";
import { getItemDef } from "../../../Data/ItemDefs.js";
import { getSceneDefSync, getSceneDef } from "../../SceneDefRegistry.js";
import { createBattleSession } from "../BattleSession.js";


export class ExploreMode extends BaseMode {
    constructor(context) {
        super("explore", context);
        this._cameraTarget = new BABYLON.Vector3();
        // 战斗触发记录：per-trigger id 集合，仅作本次 ExploreMode 期间的运行时锁，
        // 防止 enterBattleSequence 播放期间同一 trigger 重复触发。
        // 战斗是否「已发生过」属于情境记录，归 WorldState.flags，不在此处。
        this._firedBattleTriggerIds = new Set();
        this._scriptedCameraTriggerFired = false;
        this.dynamicActors = [];
        this.staticBlockers = [];
        this.interactables = [];
        this.renderables = [];
        this.pickables = [];
        this.props = [];
        this.enemies = [];
        this._playedCutsceneIds = new Set();
        this._cutsceneTimers = new Map();
        this._collisionSystem = new ExploreCollisionSystem();
        this._pickupSequence = null;
        this._giveSequence = null;
    }

    fixedUpdate(dtMs, tickCount) {
        const { inputSystem, playerController, character, sceneSequencer } = this.context;
        const sequencerBusy = !!sceneSequencer?.isBusy();

        // sequencer 播放 outro/intro/cutscene 期间跳过 trigger 检查，
        // 避免误触场景切换/战斗/相机 trigger 中断序列
        if (!sequencerBusy) {
            this.#updateCutsceneInvokers(dtMs);
            this.#syncTriggerEnabled();
            this.#updateSceneSwitchTrigger(character, tickCount);
            this.#checkBattleTrigger(character, sceneSequencer);
            this.#checkSequenceTrigger(character, sceneSequencer);
            this.#checkScriptedCameraTrigger(character, sceneSequencer);
        }

        inputSystem.fixedUpdate(tickCount);
        playerController.fixedUpdate(dtMs, tickCount);
        character.fixedUpdate(dtMs, tickCount);

        for (const npc of this.interactables) {
            npc.fixedUpdate(dtMs, tickCount);
            const controller = npc.npcController;
            if (controller) {
                controller.update(dtMs, npc, {
                    player: character,
                    questManager: this.context.questManager,
                    inventoryManager: this.context.inventoryManager,
                    dialogueBubble: this.context.dialogueBubble,
                    sequencerBusy,
                    walkArea: this.context.walkArea,
                    blockers: this.staticBlockers,
                });
            }
        }

        // sequencer 期间跳过 walkArea clamp 与交互，避免 moveActorTo 结束后
        // controlledBySequence=false 时 hero 被钳回 trigger 位置
        if (!sequencerBusy) {
            for (const actor of this.dynamicActors) {
                this._collisionSystem.resolveMovement(actor, this.staticBlockers, this.context.walkArea);
            }
            this.#checkInteraction(character, tickCount);
            this.#updatePickupSequence(character);
            this.#updateGiveSequence(character, dtMs);
        }

        // 箭头显隐放在 sequencer 门控之外：sequencer 期间需强制隐藏箭头，
        // 避免玩家在 trigger 内时箭头亮起后穿过整个 cutscene
        this.#updateTriggerArrows(character, dtMs, sequencerBusy);
        this.#updateDialogueBubble();

        for (const prop of this.props) {
            prop.fixedUpdate(dtMs);
        }

        // enemy 在 ExploreMode 期间作为待战斗实体需推进动画帧
        // sequencer 期间 controlledBySequence=true 守卫已防止 _applyMovement 双写位置
        for (const enemy of this.enemies) {
            enemy.fixedUpdate(dtMs, tickCount);
        }
    }

    #checkInteraction(character, tickCount) {
        const { inputSystem } = this.context;

        if (!inputSystem.consumeAction("interact", tickCount)) return;

        // give 流程进行中（含 approach）禁止重复触发，避免 approach 期间按 J 重入
        if (this._giveSequence) return;

        // 检查 give-item NPC
        for (const npc of this.interactables) {
            const controller = npc.npcController;
            if (!controller?._needsInteract) continue;

            const dx = character.root.position.x - npc.root.position.x;
            const dy = character.root.position.y - npc.root.position.y;
            const distSq = dx * dx + dy * dy;
            const interactRadius = controller.greetingRadius ?? 1.6;
            if (distSq <= interactRadius * interactRadius) {
                this._startGiveSequence(character, controller, npc);
                return;
            }
        }

        // 检查拾取物交互
        const PICKUP_RADIUS = 1.6;
        for (const pickable of this.pickables) {
            if (pickable.isDisposed) continue;

            const dx = character.root.position.x - pickable.root.position.x;
            const dy = character.root.position.y - pickable.root.position.y;
            const distSq = dx * dx + dy * dy;
            if (distSq <= PICKUP_RADIUS * PICKUP_RADIUS) {
                const itemName = pickable.itemDef?.name ?? pickable.id;
                const consumeType = pickable.itemDef?.consumeType ?? "pocket";
                console.log(`[Pickup] 捡起 ${itemName} (${consumeType})`);

                // 开始拾取序列
                this._startPickupSequence(character, pickable, consumeType);
                return;
            }
        }
    }

    #updateSceneSwitchTrigger(character, tickCount) {
        const triggers = this.context.scene.triggers;
        if (!triggers) return;

        const { inputSystem, scene } = this.context;

        const sceneSwitchTriggers = this.context.sceneDef?.triggers?.filter(t => t.type === "sceneSwitch") ?? [];
        for (const triggerDef of sceneSwitchTriggers) {
            const trigger = triggers.get(triggerDef.id);
            if (!trigger || !trigger._enabled) continue;

            const inside = trigger.checkOverlap(character);
            if (inside) {
                this._currentSceneSwitchTrigger = { trigger, triggerDef };
                if (inputSystem.consumeAction("interact", tickCount)) {
                    this._currentSceneSwitchTrigger = null;
                    const game = this.context.game;
                    // 优先同步查缓存（已 resolve 过的场景），fallback 异步 fetch（首次访问的 JSON 场景）
                    const cached = getSceneDefSync(triggerDef.targetScene);
                    if (cached) {
                        game.requestSceneSwitch(cached, triggerDef.targetSpawn);
                    } else {
                        getSceneDef(triggerDef.targetScene).then(targetDef => {
                            if (targetDef) {
                                game.requestSceneSwitch(targetDef, triggerDef.targetSpawn);
                            } else {
                                console.warn(`[ExploreMode] targetScene not found: ${triggerDef.targetScene}`);
                            }
                        });
                    }
                    return;
                }
                return;
            }
        }
        this._currentSceneSwitchTrigger = null;
    }

    #syncTriggerEnabled() {
        const { sceneDef, worldState, scene } = this.context;
        if (!sceneDef?.triggers || !worldState || !scene?.triggers) return;

        for (const triggerDef of sceneDef.triggers) {
            const trigger = scene.triggers.get(triggerDef.id);
            if (!trigger) continue;

            const enabled = scene._evaluateCondition(triggerDef.condition, worldState);
            trigger.setEnabled(enabled);
        }
    }

    #updateTriggerArrows(character, dtMs, sequencerBusy) {
        const { sceneDef, scene } = this.context;
        if (!sceneDef?.triggers || !scene?.triggers) return;

        for (const triggerDef of sceneDef.triggers) {
            if (!triggerDef.arrow) continue;
            const trigger = scene.triggers.get(triggerDef.id);
            if (!trigger?.updateArrow) continue;

            const visible = !sequencerBusy
                && trigger._enabled
                && trigger.checkOverlap(character);

            trigger.updateArrow(visible, dtMs);
        }
    }

    #checkBattleTrigger(character, sceneSequencer) {
        const { sceneDef, scene, battleDefs, actorRegistry } = this.context;
        const battleTriggers = sceneDef?.triggers?.filter(t => t.type === "battle") ?? [];
        if (!scene?.triggers || !battleTriggers.length) return;

        // 1+2. 收集当前与 hero 重叠的未消费 battle trigger，选中心距 hero 最近的一个；
        // 严格小于比较使等距时自然保持 JSON 顺序兜底。用无副作用的 checkOverlap 收集，
        // 只对选中者调 check()（会 latch triggered），避免落选 trigger 被提前锁死。
        let winner = null; // { triggerDef, trigger, distSq }
        for (const triggerDef of battleTriggers) {
            if (this._firedBattleTriggerIds.has(triggerDef.id)) continue;
            const trigger = scene.triggers.get(triggerDef.id);
            // triggered 锁存守卫与旧 check() 路径一致（check 内部先查 triggered 再查 overlap）
            if (!trigger || trigger.triggered || !trigger.checkOverlap(character)) continue;
            const dx = trigger.position.x - character.root.position.x;
            const dy = trigger.position.y - character.root.position.y;
            const distSq = dx * dx + dy * dy;
            if (!winner || distSq < winner.distSq) {
                winner = { triggerDef, trigger, distSq };
            }
        }
        if (!winner) return;

        const { triggerDef, trigger } = winner;

        // 3. BattleDef 缺失：明确报错并中止（不锁 trigger、不存 checkpoint、不入序列）
        const battleDef = battleDefs?.[triggerDef.battleId];
        if (!battleDef) {
            console.error(
                `[ExploreMode] battle trigger "${triggerDef.id}" references unknown battleId "${triggerDef.battleId}"; battle entry aborted`
            );
            return;
        }

        // 5. 解析本场 enter/exit 序列并固定进 session。
        // 优先级：BattleDef 优先 → SceneDef 默认 → 代码 fallback（计划 §4.2）。
        // 阶段 A 曾刻意反转 SceneDef 默认优先，为维持原 prologue 入场表现的行为等价门禁；
        // 阶段 B 翻转回来——SceneDef 默认 sequence 现已写作场景级通用（companion 固定向左撤退），
        // 每场战斗只需 BattleDef 显式 override 极少数需要专属表演的情况。
        const enterSequence = this.#resolveEnterSequence(battleDef, sceneDef);
        const exitSequence = this.#resolveExitSequence(battleDef, sceneDef);

        // 6. 本场战败恢复 spawn（trigger AABB 内的点不安全；未配置时 fallback 首个 spawn）
        const retryCheckpointSpawnId = triggerDef.checkpointSpawn
            ?? Object.keys(sceneDef.spawns ?? {})[0]
            ?? "house_door";

        // 4+7. 严格 1v1 校验通过后生成 pending session；配置/实体错误在入场序列之前暴露
        let session;
        try {
            session = createBattleSession({
                triggerId: triggerDef.id,
                battleDef,
                actorRegistry,
                retryCheckpointSpawnId,
                enterSequence,
                exitSequence,
            });
        } catch (err) {
            console.error(
                `[ExploreMode] battle entry from trigger "${triggerDef.id}" failed validation:`,
                err.message,
            );
            return;
        }

        // 全部校验通过后才消费 trigger（check 内部 latch triggered 并触发 onEnter），
        // 再加 ExploreMode 本次存活期的运行时锁；若此刻 trigger 刚被禁用则放弃本次。
        if (!trigger.check(character)) return;
        this._firedBattleTriggerIds.add(triggerDef.id);

        // pending 阶段：入场镜头/双方从 pendingBattleSession 读（Timeline/Camera 第 4 步切换消费方）
        this.context.pendingBattleSession = session;
        // 兼容字段：TimelineSequencer.battleYBaseline 与未改造的 BattleMode 仍在读，第 4/5 步后摘除
        this.context.pendingBattleDef = battleDef;

        // 入场 blend 启动前应用本场镜头参数（duel rig 的 zoom/高度映射），
        // 必须在 sceneSequencer.play 之前：首个 cameraBlend clip atMs=0 即读 rig 参数（§4.4）
        if (battleDef.duelCamera) {
            this.context.cameraManager?.applyRigConfig?.("duel", battleDef.duelCamera);
        }

        // switchMode("battle") clip 统一注入 battleDef + session（内联/BattleDef/fallback 三源一致）
        this.#injectBattleSwitchPayload(enterSequence, battleDef, session);

        // 失败重试 checkpoint（阶段 A 维持现行保存行为；第 5 步拆分 retry/进度 checkpoint 语义）
        // 不传 useHeroPos：restoreCheckpoint 时用 retryCheckpointSpawnId 对应点，避免重置后立即重入 trigger
        this.context.game?.saveCheckpoint(sceneDef.id, retryCheckpointSpawnId);

        sceneSequencer.play(enterSequence);
    }

    /**
     * 解析本场入场序列（解析结果固定进 BattleSession，消费方不再各查各的）。
     * 现行优先级：SceneDef.enterBattleSequence（深拷贝，避免 sequencer 运行时标注污染数据）→
     * BattleDef.enterSequence(battleDef) → 代码 fallback。
     */
    #resolveEnterSequence(battleDef, sceneDef) {
        // BattleDef 优先：每场战斗可自定义入场；没写则 SceneDef 默认（场景级通用）
        if (typeof battleDef.enterSequence === "function") return battleDef.enterSequence(battleDef);
        if (battleDef.enterSequence) return JSON.parse(JSON.stringify(battleDef.enterSequence));
        const inlineSeq = sceneDef?.enterBattleSequence;
        if (inlineSeq) return JSON.parse(JSON.stringify(inlineSeq));
        return {
            id: "enter_battle_fallback",
            durationMs: 1000,
            tracks: [
                {
                    id: "camera",
                    kind: "camera",
                    binding: { cameraId: "duel" },
                    channel: "blend",
                    clips: [
                        { type: "cameraBlend", startMs: 0, durationMs: 800, to: "duel" }
                    ]
                },
                {
                    id: "mode",
                    kind: "mode",
                    clips: [
                        { type: "switchMode", atMs: 800, modeId: "battle" }
                    ]
                }
            ]
        };
    }

    /**
     * 解析本场退场序列：SceneDef.exitBattleSequence → BattleDef.exitSequence；
     * 两者皆无时返回 null，由结算侧走代码 fallback。
     * BattleDef 上为跨战斗共享对象，此处深拷贝防止同一对象被多个 session/场次 sequencer 标注。
     */
    #resolveExitSequence(battleDef, sceneDef) {
        if (battleDef.exitSequence) return JSON.parse(JSON.stringify(battleDef.exitSequence));
        const inlineSeq = sceneDef?.exitBattleSequence;
        if (inlineSeq) return JSON.parse(JSON.stringify(inlineSeq));
        return null;
    }

    // 给序列中所有 switchMode("battle") clip 注入本场 battleDef 与 session
    #injectBattleSwitchPayload(sequence, battleDef, session) {
        for (const track of sequence.tracks ?? []) {
            for (const clip of track.clips ?? []) {
                if (clip.type === "switchMode" && clip.modeId === "battle") {
                    clip.payload = { ...(clip.payload || {}), battleDef, session };
                }
            }
        }
    }

    #checkScriptedCameraTrigger(character, sceneSequencer) {
        if (this._scriptedCameraTriggerFired) {
            return;
        }

        const trigger = this.context.scene.scriptedCameraTrigger;
        if (!trigger) {
            return;
        }

        const triggered = trigger.check(character);
        if (!triggered) {
            return;
        }

        this._scriptedCameraTriggerFired = true;

        const testSequence = {
            id: "test_timeline_scripted_camera",
            durationMs: 6000,
            tracks: [
                {
                    id: "hero.input",
                    kind: "actor",
                    binding: { actorId: "hero" },
                    channel: "input",
                    clips: [
                        { type: "inputLock", atMs: 0, locked: true },
                        { type: "inputLock", atMs: 5500, locked: false }
                    ]
                },
                {
                    id: "hero.movement",
                    kind: "actor",
                    binding: { actorId: "hero" },
                    channel: "movement",
                    clips: [
                        { type: "moveActorTo", startMs: 0, durationMs: 2000, x: -16, y: 0.6 }
                    ]
                },
                {
                    id: "camera.frame",
                    kind: "camera",
                    binding: { cameraId: "scripted" },
                    channel: "frame",
                    clips: [
                        { type: "setCameraFrame", atMs: 0, center: [-16, -1.5, 0], height: 4.2, orthoWidth: 18 }
                    ]
                },
                {
                    id: "camera.blend",
                    kind: "camera",
                    binding: { cameraId: "scripted" },
                    channel: "blend",
                    clips: [
                        { type: "cameraBlend", startMs: 0, durationMs: 0, to: "scripted" },
                        { type: "cameraBlend", startMs: 4000, durationMs: 1200, to: "explore" }
                    ]
                },
                {
                    id: "camera.fx",
                    kind: "camera",
                    channel: "fx",
                    clips: [
                        { type: "cameraEffect", atMs: 0, effect: "letterbox", durationMs: 5000, height: 72, speed: 240 },
                        { type: "cameraEffect", atMs: 200, effect: "fade", durationMs: 300, color: "black", from: 1, to: 0 },
                        { type: "cameraEffect", atMs: 800, effect: "shake", durationMs: 220, amplitude: 0.22 },
                        { type: "cameraEffect", atMs: 800, effect: "flash", durationMs: 120, color: "white" }
                    ]
                }
            ]
        };

        sceneSequencer.play(testSequence);
    }

    #checkSequenceTrigger(character, sceneSequencer) {
        const { sceneDef, scene, questManager, worldState } = this.context;
        const seqTriggers = sceneDef?.triggers?.filter(t => t.type === "sequence") ?? [];
        if (!scene?.triggers || !seqTriggers.length || !worldState) return;
        if (sceneSequencer?.isBusy?.()) return;

        for (const triggerDef of seqTriggers) {
            if (this._firedBattleTriggerIds.has(triggerDef.id)) continue; // 复用锁（sequence trigger 也一次性）
            const trigger = scene.triggers.get(triggerDef.id);
            if (!trigger || trigger.triggered) continue;

            // condition 门禁（scenarioMin/Max/flagNot 等）
            const cond = triggerDef.condition;
            if (cond) {
                if (cond.scenarioMin !== undefined && worldState.scenario < cond.scenarioMin) continue;
                if (cond.scenarioMax !== undefined && worldState.scenario > cond.scenarioMax) continue;
                if (cond.flagNot && worldState.flags?.[cond.flagNot]) continue;
                if (cond.flagOn && !worldState.flags?.[cond.flagOn]) continue;
            }

            if (!trigger.checkOverlap(character)) continue;
            if (!trigger.check(character)) continue;
            this._firedBattleTriggerIds.add(triggerDef.id);

            // 可选 scenario 推进（如 tutor→react 中间段：触发后从 102 升到 105 开启 gem cutscene）
            if (typeof triggerDef.scenarioAdvance === "number") {
                questManager?.advanceTo(triggerDef.scenarioAdvance);
            }
            // 可选 flag 置位
            if (triggerDef.flagOnPlay) {
                worldState.flags[triggerDef.flagOnPlay] = true;
            }

            // 播 sequence：从 URL 加载（与 cutsceneInvoker 同模式）
            if (triggerDef.sequenceUrl) {
                fetch(triggerDef.sequenceUrl, { cache: "no-cache" })
                    .then(r => r.json())
                    .then(seq => sceneSequencer.play(seq))
                    .catch(err => console.warn(`[ExploreMode] sequence trigger "${triggerDef.id}" load failed`, err));
            }
            return;
        }
    }

    enter(_payload) {
        // 复位 per-trigger 运行时锁：每次进入 ExploreMode 重新允许触发
        this._firedBattleTriggerIds.clear();

        const { cameraManager, character } = this.context;
        if (cameraManager?.activeRigId === "explore" && cameraManager.activeRig?.enter) {
            cameraManager.activeRig.enter(this.context);
        } else {
            cameraManager?.switchRig("explore");
        }
        if (character) {
            character.setFacingMode(FACING_MODE.AUTO_FROM_MOVE);
            // 防御性复位：BattleMode.exit 正常情况下已写回 "walk"；
            // 若异常路径跳过 exit，此处兜底，并 warn 提示
            if (character.activeSpeedMode !== "walk") {
                console.warn(`[ExploreMode] character.activeSpeedMode was "${character.activeSpeedMode}" on enter (expected "walk"); BattleMode.exit may have been skipped. Resetting to "walk".`);
            }
            character.activeSpeedMode = "walk";
        }
        this._buildIndices();
        this._setupDrawOrderDebug();
        this._setupPerCharacterStencil();
        this._collisionSystem.createDebugMeshes(this.staticBlockers, this.context.babylonScene, this.dynamicActors);
        this._collisionSystem.setDebugVisible(this.context.scene?._debugVisible ?? true);
        this._registerSequenceHandlers();
    }

    exit() {
        const { character } = this.context;
        if (character) {
            character.setFacingMode(FACING_MODE.LOCKED);
        }
        this._collisionSystem.disposeDebugMeshes();
        this._unregisterSequenceHandlers();
    }

    _registerSequenceHandlers() {
        const handlers = this.context.sequenceHandlers;
        if (!handlers) return;
        const disposeHandler = (ctx, clip) => this.#handleDisposeActor(ctx, clip);
        handlers.set("disposeActor", disposeHandler);
        handlers.set("disposeProp", disposeHandler);  // backward compat
        handlers.set("enterCompanionFollowing", (ctx, clip) => this.#handleEnterCompanionFollowing(ctx, clip));
        handlers.set("enterCompanionIdle", (ctx, clip) => this.#handleEnterCompanionIdle(ctx, clip));
    }

    _unregisterSequenceHandlers() {
        const handlers = this.context.sequenceHandlers;
        if (!handlers) return;
        handlers.delete("disposeProp");
        handlers.delete("disposeActor");
        handlers.delete("enterCompanionFollowing");
        handlers.delete("enterCompanionIdle");
    }

    #updateCutsceneInvokers(dtMs) {
        const { sceneDef, worldState, sceneSequencer, scene } = this.context;
        if (!sceneDef?.cutsceneInvokers?.length || !worldState) return;
        if (sceneSequencer?.isBusy()) return;

        for (const invoker of sceneDef.cutsceneInvokers) {
            if (this._playedCutsceneIds.has(invoker.id)) continue;
            const flagKey = invoker.flagOnPlay;
            if (flagKey && worldState.flags[flagKey]) {
                this._playedCutsceneIds.add(invoker.id);
                continue;
            }
            const ok = scene?._evaluateCondition(invoker.condition, worldState) ?? true;
            if (!ok) continue;

            let timer = this._cutsceneTimers.get(invoker.id);
            if (!timer) {
                timer = { remainingMs: invoker.armDelayMs ?? 500 };
                this._cutsceneTimers.set(invoker.id, timer);
                console.log(`[ExploreMode] cutscene "${invoker.id}" armed, firing in ${timer.remainingMs}ms`);
            }
            timer.remainingMs -= dtMs;
            if (timer.remainingMs > 0) continue;

            this._cutsceneTimers.delete(invoker.id);
            this._playedCutsceneIds.add(invoker.id);
            if (flagKey) worldState.flags[flagKey] = true;
            console.log(`[ExploreMode] cutscene "${invoker.id}" firing, fetching ${invoker.sequenceUrl}`);
            fetch(invoker.sequenceUrl, { cache: "no-cache" })
                .then(r => r.json())
                .then(seq => {
                    console.log(`[ExploreMode] cutscene sequence loaded: ${seq.id}`);
                    sceneSequencer.play(seq);
                })
                .catch(err => console.warn(`[ExploreMode] cutscene sequence load failed: ${invoker.sequenceUrl}`, err));
        }
    }

    #handleDisposeActor(_ctx, clip) {
        const entityPool = this.context.entityPool;
        const targetId = clip?.actorId;
        const match = (e) => e && (targetId == null || e.id === targetId || e.name === targetId);

        // 收集所有要 dispose 的实体（从 entityPool 统一找，覆盖 prop / npc / pickable）
        const targets = [];
        if (entityPool) {
            for (const e of entityPool) {
                if (match(e)) targets.push(e);
            }
        }
        if (!targets.length) return;

        for (const entity of targets) {
            const id = entity.id ?? entity.name ?? "?";
            console.log(`[ExploreMode] disposeActor: kind=${entity.kind} id=${id}`);
            entity.dispose?.();

            // 从各个运行时列表里移除（列表重叠没关系，splice 自身防重复）
            this._spliceWhere(this.props, match);
            this._spliceWhere(this.renderables, match);
            this._spliceWhere(this.staticBlockers, match);
            this._spliceWhere(this.dynamicActors, match);
            this._spliceWhere(this.interactables, match);
            this._spliceWhere(this.pickables, match);
            this._spliceWhere(this.enemies, match);
        }

        // 最后从 entityPool 移除（持久清单，防止 _buildIndices 重新收集）
        if (entityPool) this._spliceWhere(entityPool, match);
    }

    _spliceWhere(arr, match) {
        if (!arr?.length) return;
        for (let i = arr.length - 1; i >= 0; i--) {
            if (match(arr[i])) arr.splice(i, 1);
        }
    }

    #handleEnterCompanionFollowing(_ctx, _clip) {
        const companion = this.interactables.find(n => n.id === "companion");
        if (companion?.npcController && companion.npcController.state !== "following") {
            companion.npcController.enterFollowing(companion);
        }
    }

    #handleEnterCompanionIdle(_ctx, _clip) {
        const companion = this.interactables.find(n => n.id === "companion");
        if (companion?.npcController) {
            companion.npcController.enterIdle(companion);
        }
    }

    _buildIndices() {
        const { entityPool, stageMaskData } = this.context;
        if (!entityPool) return;

        this.dynamicActors.length = 0;
        this.staticBlockers.length = 0;
        this.interactables.length = 0;
        this.renderables.length = 0;
        this.pickables.length = 0;
        this.props.length = 0;
        this.enemies.length = 0;

        for (const entity of entityPool) {
            if (entity.kind === "player") {
                this.dynamicActors.push(entity);
            } else if (entity.kind === "npc" && entity.isCompanion && typeof entity.getBlockerAabb === "function") {
                this.dynamicActors.push(entity);
            }
            if (entity.kind === "enemy") {
                this.enemies.push(entity);
            }
            if ((entity.kind === "npc" || entity.kind === "prop")
                && entity.blocksMovement
                && typeof entity.getBlockerAabb === "function") {
                this.staticBlockers.push(entity);
            }
            if (entity.kind === "npc" && entity.interactable) {
                this.interactables.push(entity);
            }
            if (entity.kind === "pickable" && !entity.isDisposed) {
                this.pickables.push(entity);
            }
            if (entity.kind === "prop" && !entity.isDisposed) {
                this.props.push(entity);
            }
            if (entity.spritePlane) {
                this.renderables.push(entity);
            }
        }

        // WalkArea 内定义的虚拟障碍（无对应 prop 实体的纯 AABB 障碍区）
        const wa = this.context.walkArea;
        if (wa?.obstacles?.length) {
            for (const ob of wa.obstacles) {
                this.staticBlockers.push({
                    kind: "walkAreaObstacle",
                    label: ob.label ?? "obstacle",
                    getBlockerAabb: () => ({
                        minX: ob.minX, maxX: ob.maxX,
                        minY: ob.minY, maxY: ob.maxY
                    })
                });
            }
        }

        // --- StageMask pushbox 作为静态障碍物 ---
        if (stageMaskData && stageMaskData.masks) {
            for (const mask of stageMaskData.masks) {
                const pb = mask.pushbox;
                if (!pb) continue;
                this.staticBlockers.push({
                    _maskId: mask.id,
                    getBlockerAabb: () => ({
                        minX: pb.x,
                        maxX: pb.x + pb.w,
                        minY: pb.y,
                        maxY: pb.y + pb.h,
                    })
                });
            }
        }
    }

    _setupDrawOrderDebug() {
        const scene = this.context.babylonScene;
        if (!scene) return;

        const drawCounter = { value: 0 };
        const drawnThisFrame = new Set();

        // 每帧开始时重置计数器
        scene.onBeforeRenderObservable.add(() => {
            drawCounter.value = 0;
            drawnThisFrame.clear();
        });

        const shouldLog = () => this.context.scene.tickCount % 60 === 0;

        const hook = (mesh, label) => {
            mesh.onBeforeRenderObservable.add(() => {
                const order = ++drawCounter.value;
                drawnThisFrame.add(mesh);
                if (shouldLog()) {
                    const m = mesh.material;
                    // console.log(`[draw #${order}] ${label} | alpha:${mesh.alphaIndex} | group:${mesh.renderingGroupId} | depthWrite:${m?.disableDepthWrite} | depthPrePass:${m?.needDepthPrePass} | transp:${m?.transparencyMode}`);
                }
            });
        };

        // 角色 spritePlane
        for (const entity of this.renderables) {
            if (entity.spritePlane) {
                const m = entity.spritePlane.material;
                // console.log(`[mat] ${entity.id ?? entity.name} | depthWrite:${m?.disableDepthWrite} | depthPrePass:${m?.needDepthPrePass} | transp:${m?.transparencyMode} | alphaCutOff:${m?.alphaCutOff}`);
                hook(entity.spritePlane, `${entity.id ?? entity.name}`);
            }
        }

        // mask mesh
        const masks = this.context.sceneVisualSystem?._maskMeshes;
        if (masks) {
            for (const mesh of masks) {
                const m = mesh.material;
                // console.log(`[mat] ${mesh.name} | depthWrite:${m?.disableDepthWrite} | depthPrePass:${m?.needDepthPrePass} | transp:${m?.transparencyMode} | alpha:${m?.alpha}`);
                hook(mesh, mesh.name);
            }
        }

        // 每帧结束后检查哪些 mask 没被绘制
        scene.onAfterRenderObservable.add(() => {
            if (!shouldLog() || !masks) return;
            for (const mesh of masks) {
                if (drawnThisFrame.has(mesh)) continue;
                const wp = mesh.getAbsolutePosition();
                const planes = scene.activeCamera?.frustumPlanes;
                let inFrustum = '?';
                if (planes && planes.length === 6 && planes.every(p => p != null)) {
                    inFrustum = mesh.isInFrustum(planes);
                }
                // console.log(`[MISSING] ${mesh.name} | visible:${mesh.isVisible} | inFrustum:${inFrustum} | wp:(${wp.x.toFixed(2)},${wp.y.toFixed(2)},${wp.z.toFixed(2)})`);
            }
        });

        // console.log(`[ExploreMode] draw order debug hooked: ${this.renderables.length} characters + ${masks?.length ?? 0} masks`);
    }

    _setupPerCharacterStencil() {
        const scene = this.context.babylonScene;
        if (!scene) return;
        const engine = scene.getEngine();
        const gl = engine._gl;
        const masks = this.context.sceneVisualSystem?._maskMeshes;
        if (!masks?.length) {
            // console.log('[stencil] no masks, skip per-character stencil setup');
            return;
        }

        for (const entity of this.renderables) {
            const plane = entity.spritePlane;
            if (!plane) continue;

            if (entity.kind === "pickable") continue;

            plane.onBeforeRenderObservable.add(() => {
                // 角色之间纯 painter 排序，不参与 depth pipeline
                plane._prevDepthTest = gl.getParameter(gl.DEPTH_TEST);
                gl.disable(gl.DEPTH_TEST);

                const pos = entity.root.position;
                let needMask = false;
                let hitMaskId = null;
                for (const mesh of masks) {
                    const aabb = mesh._maskAabb;
                    if (!aabb) continue;
                    const worldLeft = aabb.x;
                    const worldRight = aabb.x + aabb.w;
                    const worldBottom = aabb.y;
                    const worldTop = aabb.y + aabb.h;
                    // 实体 pushbox 与 mask AABB 做完整重叠检测
                    if (typeof entity.getBlockerAabb === 'function') {
                        const blocker = entity.getBlockerAabb();
                        if (blocker) {
                            if (blocker.maxX < worldLeft || blocker.minX > worldRight) continue;
                            if (blocker.maxY < worldBottom || blocker.minY > worldTop) continue;
                            needMask = true;
                            hitMaskId = mesh.name || mesh.id || '?';
                            break;
                        }
                    }
                    // 无 pushbox 的实体回退宽松判断
                    if (pos.x < worldLeft - 1.0 || pos.x > worldRight + 1.0) continue;
                    if (pos.y >= worldBottom && pos.y <= worldTop) {
                        needMask = true;
                        hitMaskId = mesh.name || mesh.id || '?';
                        break;
                    }
                }

                if (needMask) {
                    gl.enable(gl.STENCIL_TEST);
                    gl.stencilMask(0x00);
                    gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
                    gl.stencilFunc(gl.NOTEQUAL, 1, 0xFF);
                } else {
                    gl.disable(gl.STENCIL_TEST);
                }
            });

            plane.onAfterRenderObservable.add(() => {
                gl.disable(gl.STENCIL_TEST);
                if (plane._prevDepthTest) {
                    gl.enable(gl.DEPTH_TEST);
                } else {
                    gl.disable(gl.DEPTH_TEST);
                }
            });
        }

        // console.log(`[ExploreMode] per-character stencil hooked for ${this.renderables.length} characters`);
    }

    updateRender(dtMs) {
        const { character, cameraManager, sceneVisualSystem, sceneSequencer, hpBar } = this.context;

        if (hpBar && character?.hp !== undefined) {
            hpBar.update(character.hp, character.maxHp);
        }

        const Z_FACTOR = 0.1;
        for (const entity of this.renderables) {
            if (entity.spritePlane) {
                entity.root.position.z = entity.root.position.y * Z_FACTOR;
                // ALPHABLEND 队列按 alphaIndex 排序，y 越小越近，alphaIndex 越大越后画（在上面）
                entity.spritePlane.alphaIndex = 1000 + Math.round(-entity.root.position.y * 100);
            }
        }
        // 拾取/give 时物品永远比主角多一层
        const seq = this._pickupSequence;
        if (seq?.pickable?.spritePlane && character?.spritePlane) {
            seq.pickable.spritePlane.alphaIndex = character.spritePlane.alphaIndex + 1;
        }
        const gs = this._giveSequence;
        if (gs?.plane && character?.spritePlane) {
            gs.plane.alphaIndex = character.spritePlane.alphaIndex + 1;
        }

        const pos = character.root.position;
        this._cameraTarget.set(pos.x, pos.y, pos.z);
        this.context.target = this._cameraTarget;

        //if (sceneSequencer?.isBusy()) {
            //console.log(`[ExploreMode] updateRender during sequence — context.target set to char pos=(${pos.x.toFixed(2)},${pos.y.toFixed(2)},${pos.z.toFixed(2)}) activeRig=${cameraManager?.activeRigId}`);
        //}

        for (const entity of this.renderables) {
            if (entity.kind === "pickable") {
                entity._updateDebugPanel?.();
            }
        }

        const activeCamera = cameraManager?.getCamera();
        if (sceneVisualSystem && activeCamera) {
            const characterPositions = this.renderables
                .filter(e => e.root)
                .map(e => ({ x: e.root.position.x, y: e.root.position.y }));
            sceneVisualSystem.update(dtMs, { camera: activeCamera, characterPositions });
        }

        this.#updateDialogueBubblePosition();

        // 使用 SceneVisualSystem 的 panel 方案进行调试
        sceneVisualSystem?.updateDebugPanel?.();

        // 所有角色渲染完成后关闭 stencil，避免影响后续渲染组（前景、UI 等）
        const engine = this.context.babylonScene?.getEngine();
        const gl = engine?._gl;
        if (gl) {
            gl.disable(gl.STENCIL_TEST);
        }
    }

    /** 发起拾取序列：锁定输入 → pickup动画 → eat/drink/topack动画 → 恢复 */
    _startPickupSequence(character, pickable, consumeType) {
        // 将物品从场景中移到角色身上
        pickable.root.setParent(character.root);
        pickable.root.position.set(0, 0, 0);

        // 移除 Y 偏移（手持时不需要，仅地面放置时才需要）
        if (pickable.spritePlane) {
            pickable.spritePlane.position.y = 0;
        }

        // 进入 pickup 动画（状态机自动禁止移动输入）
        character.enterState("pickup");

        this._pickupSequence = {
            phase: "pickup",
            pickable,
            consumeType,
        };
    }

    /** 每帧更新拾取序列，推进动画状态机 */
    #updatePickupSequence(character) {
        const seq = this._pickupSequence;
        if (!seq) return;

        const pickable = seq.pickable;
        const pxToWorld = character.pxToWorld ?? 0.03;

        // 更新物品位置：跟随 action 锚点
        if (pickable && !pickable.isDisposed && seq.phase !== "done") {
            const frameIdx = character.animation.currentFrameIndex;
            const actionAnchor = character.getActionAnchor(frameIdx);
            const rootAnchor = character.getRootAnchor(frameIdx);
            if (actionAnchor && rootAnchor) {
                const dx = (actionAnchor.cx - rootAnchor.cx) * pxToWorld * character.facing;
                const dy = (rootAnchor.cy - actionAnchor.cy) * pxToWorld;
                pickable.root.position.x = dx;
                pickable.root.position.y = dy;
                pickable.root.position.z = -0.01;
            }
        }

        // 检查阶段转换
        if (seq.phase === "pickup" && character.currentStateName !== "pickup") {
            // pickup 动画播完，进入 consume 动画
            if (seq.consumeType === "eat") {
                character.enterState("eat");
                seq.phase = "eat";
            } else if (seq.consumeType === "drink") {
                character.enterState("drink");
                seq.phase = "drink";
                pickable.spritePlane.rotation.z = Math.PI / 4 * character.facing;
            } else {
                // pocket 类型：收进背包
                character.enterState("topack");
                seq.phase = "topack";
                pickable.spritePlane.isVisible = false;
            }
        } else if (
            (seq.phase === "eat" || seq.phase === "drink" || seq.phase === "topack")
            && character.currentStateName !== seq.phase
        ) {
            // consume 动画播完，收尾
            seq.phase = "done";
            if (seq.consumeType === "eat") {
                character.heal(1);
            }
            if (seq.consumeType === "drink" && this.context.playerController) {
                this.context.playerController.addBuff({
                    type: "speedMultiplier",
                    value: 0.5,
                    icon: "\uD83E\uDDB5",
                    iconType: "unicode"
                });
                this.context.buffBar?.update(this.context.playerController.buffs);
            }
            if (seq.consumeType === "pocket" && this.context.inventoryManager) {
                this.context.inventoryManager.addItem(pickable.itemDef);
                this.context.inventoryBar?.update(this.context.inventoryManager.items);
            }
            pickable.spritePlane.rotation.z = 0;
            pickable.pickup();
            this.context.questManager?.markPickableCollected(this.context.sceneDef.id, pickable.id);
            this._pickupSequence = null;
        }
    }


    _startGiveSequence(character, controller, npc) {
        const itemDef = getItemDef(controller._pendingGiveItem);
        if (!itemDef) {
            controller._pendingGiveItem = null;
            controller._pendingAction = null;
            controller._needsInteract = false;
            return;
        }

        // 算 approach 目标点：NPC 同侧下方约一个 NPC block 高，两人 AABB 刚好不接触
        const heroPos = character.root.position;
        const npcPos = npc.root.position;
        const side = heroPos.x < npcPos.x ? -1 : 1; // hero 在左 → target 在左（同侧）

        const npcAabb = npc.getBlockerAabb?.();
        const heroAabb = character.getBlockerAabb?.();
        const npcHalfW = npcAabb ? (npcAabb.maxX - npcAabb.minX) * 0.5 : 0.4;
        const heroHalfW = heroAabb ? (heroAabb.maxX - heroAabb.minX) * 0.5 : 0.4;
        const npcFullH = npcAabb ? (npcAabb.maxY - npcAabb.minY) : 0.48; // NPC block 面积高

        const EPS = 0.02;
        const rawTargetX = npcPos.x + side * (npcHalfW + heroHalfW + EPS);
        const rawTargetY = npcPos.y - npcFullH; // NPC 下方约一个 block 高

        // sample：hero 自己不进 blockers（不能挡自己 target）；padding 取 hero 半宽保证 AABB 不与 blocker 重叠
        const padding = heroAabb
            ? Math.max((heroAabb.maxX - heroAabb.minX) * 0.5, (heroAabb.maxY - heroAabb.minY) * 0.5)
            : 0.4;
        const sampled = WalkAreaSampler.sample(
            rawTargetX, rawTargetY,
            this.context.walkArea ?? null, this.staticBlockers,
            { padding, agentX: heroPos.x, agentY: heroPos.y }
        );

        // approach 期间锁 controller，跳过 resolveMovement clamp+推离（target 已 sample 保证可达）
        character.controlledBySequence = true;
        // 进 walk 态以播放走动画（controlledBySequence 不影响 enterState/动画推进，只拦 _applyMovement 位移）
        if (character.hasState("walk")) {
            character.enterState("walk");
        }

        this._giveSequence = {
            phase: "approach",
            itemDef, // 延后创建 plane 时用
            controller,
            npc,
            timerMs: 0,
            bubbleDurationMs: 1000,
            targetX: sampled.x,
            targetY: sampled.y,
            npcSide: side, // approach 结束转 give 时朝 NPC 转向
            plane: null,
        };

        this.context.game?.exploreCameraRig?.setClampEnabled?.(false, 400);
    }

    // approach 结束转 give 时创建 plane（延后创建，避免 approach 期间 plane 跟着 hero 跑）
    #createGivePlane(character, itemDef) {
        const assets = this.context.assets ?? {};
        const atlas = assets.items?.[itemDef.atlasKey ?? "ham"];
        let frameWidth = 32;
        let frameHeight = 32;
        if (atlas?.frames) {
            const firstFrame = Object.values(atlas.frames)[0];
            if (firstFrame?.frame) {
                frameWidth = firstFrame.frame.w;
                frameHeight = firstFrame.frame.h;
            }
        }
        const pxToWorld = 0.02;
        const plane = BABYLON.MeshBuilder.CreatePlane("give_item", {
            width: frameWidth * pxToWorld, height: frameHeight * pxToWorld
        }, this.context.babylonScene);
        const texture = new BABYLON.Texture(itemDef.textureUrl, this.context.babylonScene);
        const material = new BABYLON.StandardMaterial("give_item_mat", this.context.babylonScene);
        material.diffuseTexture = texture;
        material.diffuseTexture.hasAlpha = true;
        material.useAlphaFromDiffuseTexture = true;
        material.emissiveColor = new BABYLON.Color3(1, 1, 1);
        material.backFaceCulling = false;
        material.disableLighting = true;
        material.disableDepthWrite = true;
        material.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
        plane.material = material;
        plane.parent = character.root;
        plane.position.z = -0.01;
        plane.renderingGroupId = 1;
        return plane;
    }

    #updateGiveSequence(character, dtMs) {
        const seq = this._giveSequence;
        if (!seq) return;

        const pxToWorld = character.pxToWorld ?? 0.03;
        const { dialogueBubble } = this.context;

        // approach phase：hero 走向采样后的 target，到位后转 give
        if (seq.phase === "approach") {
            const dx = seq.targetX - character.root.position.x;
            const dy = seq.targetY - character.root.position.y;
            const dist = Math.hypot(dx, dy);
            const ARRIVAL = 0.05;
            if (dist <= ARRIVAL) {
                // 到位：释放 controller 锁，朝 NPC 转向（NPC 在 hero 对侧：hero 在 NPC 左 → NPC 在 hero 右 → 朝右）
                character.controlledBySequence = false;
                character.setFacing(-seq.npcSide);
                seq.plane = this.#createGivePlane(character, seq.itemDef);
                character.enterState("give");
                seq.phase = "give";
            } else {
                // 保持 walk 态（controlledBySequence 拦 transition，但防御性确保动画不丢）
                if (character.currentStateName !== "walk" && character.hasState("walk")) {
                    character.enterState("walk");
                }
                const speed = character.baseWalkSpeed ?? 1.4;
                const dtSec = dtMs / 1000;
                const step = speed * dtSec;
                // 防止最后一帧越过 target
                const moveDist = Math.min(step, dist);
                character.root.position.x += (dx / dist) * moveDist;
                character.root.position.y += (dy / dist) * moveDist;
                character.setFacing(dx >= 0 ? 1 : -1);
            }
            return;
        }

        if (seq.phase === "give") {
            if (seq.plane && !seq.plane.isDisposed()) {
                const frameIdx = character.animation.currentFrameIndex;
                const actionAnchor = character.getActionAnchor(frameIdx);
                const rootAnchor = character.getRootAnchor(frameIdx);
                if (actionAnchor && rootAnchor) {
                    const dx = (actionAnchor.cx - rootAnchor.cx) * pxToWorld * character.facing;
                    const dy = (rootAnchor.cy - actionAnchor.cy) * pxToWorld;
                    seq.plane.position.x = dx;
                    seq.plane.position.y = dy;
                }
            }

            if (character.currentStateName !== "give") {
                seq.phase = "bubble1";
                seq.timerMs = 0;
                if (seq.plane && !seq.plane.isDisposed()) {
                    seq.plane.isVisible = false;
                }
                if (dialogueBubble && seq.npc) {
                    dialogueBubble.setText("👍");
                    dialogueBubble.show(seq.npc);
                }
            }
            return;
        }

        if (seq.phase === "bubble1" || seq.phase === "bubble2") {
            seq.timerMs += dtMs;
            if (seq.timerMs >= seq.bubbleDurationMs) {
                if (seq.phase === "bubble1") {
                    seq.phase = "bubble2";
                    seq.timerMs = 0;
                    if (dialogueBubble) {
                        dialogueBubble.setText(seq.controller._pendingCompleteText ?? "👋👊");
                    }
                } else {
                    if (seq.controller._pendingAction && this.context.questManager) {
                        const action = seq.controller._pendingAction;
                        if (Array.isArray(action)) {
                            this.context.questManager.executeDirectives(action);
                        } else {
                            this.context.questManager.executeAction(action);
                        }
                    }
                    this.context.inventoryBar?.update(this.context.inventoryManager?.items ?? []);
                    if (dialogueBubble) dialogueBubble.hide();
                    if (seq.plane && !seq.plane.isDisposed()) seq.plane.dispose();
                    seq.controller._pendingGiveItem = null;
                    seq.controller._pendingAction = null;
                    seq.controller._pendingCompleteText = null;
                    seq.controller._needsInteract = false;
                    this._giveSequence = null;
                }
            }
            return;
        }
    }

    #updateDialogueBubble() {
        const { dialogueBubble, sceneSequencer } = this.context;
        if (!dialogueBubble) return;

        if (this._giveSequence) return;

        // sequencer 期间不接管气泡生命周期：让 dialogueBubble clip 显式管理 show/hide
        if (sceneSequencer?.isBusy()) return;

        for (const npc of this.interactables) {
            const controller = npc.npcController;
            if (controller && controller.state === "greeting") {
                dialogueBubble.show(npc);
                return;
            }
        }
        dialogueBubble.hide();
    }

    #updateDialogueBubblePosition() {
        const { dialogueBubble, babylonScene } = this.context;
        if (!dialogueBubble?.isVisible) return;
        dialogueBubble.update(babylonScene);
    }
}