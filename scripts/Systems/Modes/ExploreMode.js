import { BaseMode } from "./BaseMode.js";
import { ExploreCollisionSystem } from "../ExploreCollisionSystem.js";
import { FACING_MODE } from "../../Enties/CharacterBase.js";


export class ExploreMode extends BaseMode {
    constructor(context) {
        super("explore", context);
        this._cameraTarget = new BABYLON.Vector3();
        this._battleTriggerFired = false;
        this._scriptedCameraTriggerFired = false;
        this.dynamicActors = [];
        this.staticBlockers = [];
        this.interactables = [];
        this.renderables = [];
        this.pickables = [];
        this._collisionSystem = new ExploreCollisionSystem();
        this._pickupSequence = null;
    }

    fixedUpdate(dtMs, tickCount) {
        const { inputSystem, playerController, character, sceneSequencer } = this.context;

        this.#checkBattleTrigger(character, sceneSequencer);
        this.#checkScriptedCameraTrigger(character, sceneSequencer);

        inputSystem.fixedUpdate(tickCount);
        playerController.fixedUpdate(dtMs, tickCount);
        character.fixedUpdate(dtMs, tickCount);

        for (const npc of this.interactables) {
            npc.fixedUpdate(dtMs, tickCount);
            const controller = npc.npcController;
            if (controller) {
                controller.update(dtMs, npc, { player: character });
            }
        }

        this._collisionSystem.resolveMovement(character, this.staticBlockers, this.context.walkArea);

        this.#checkInteraction(character, tickCount);
        this.#updatePickupSequence(character);
    }

    #checkInteraction(character, tickCount) {
        const { inputSystem } = this.context;

        if (!inputSystem.consumeAction("interact", tickCount)) return;

        // 优先检查 NPC 交互（距离最近者优先）
        for (const npc of this.interactables) {
            const controller = npc.npcController;
            if (!controller || controller.state === "ask") continue;

            const dx = character.root.position.x - npc.root.position.x;
            const dy = character.root.position.y - npc.root.position.y;
            const distSq = dx * dx + dy * dy;
            const interactRadius = controller.greetingRadius ?? 1.6;
            if (distSq <= interactRadius * interactRadius) {
                controller.enterAsk(npc);
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

    #checkSceneSwitchTrigger(character) {
        const sceneSwitchTriggers = this.context.sceneDef?.triggers?.filter(t => t.type === "sceneSwitch") ?? [];
        for (const triggerDef of sceneSwitchTriggers) {
            const trigger = this.context.scene.triggers.get(triggerDef.id);
            if (trigger && trigger.check(character)) {
                const targetDef = ALL_SCENES[triggerDef.targetScene];
                if (!targetDef) {
                    console.warn(`[ExploreMode] targetScene not found: ${triggerDef.targetScene}`);
                    return;
                }
                this.context.scene._pendingSceneLoad = { sceneDef: targetDef, spawnId: triggerDef.targetSpawn };
                return;
            }
        }
    }

    enter(_payload) {
        this._battleTriggerFired = false;
    }

    #checkBattleTrigger(character, sceneSequencer) {
        if (this._battleTriggerFired) {
            return;
        }

        const battleTriggers = this.context.sceneDef?.triggers?.filter(t => t.type === "battle") ?? [];
        let pendingBattleDef = null;
        const triggers = this.context.scene.triggers;
        if (!triggers) return;
        for (const triggerDef of battleTriggers) {
            const trigger = triggers.get(triggerDef.id);
            if (trigger && trigger.check(character)) {
                this._battleTriggerFired = true;
                pendingBattleDef = this.context.battleDefs?.[triggerDef.battleId];
                break;
            }
        }
        if (!this._battleTriggerFired || !pendingBattleDef) return;

        const enterBattleSequence = pendingBattleDef.enterSequence?.(pendingBattleDef) ?? {
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
                        { type: "switchMode", atMs: 800, modeId: "battle", payload: { battleDef: pendingBattleDef } }
                    ]
                }
            ]
        };

        sceneSequencer.play(enterBattleSequence);
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

    enter(_payload) {
        const { cameraManager, character } = this.context;
        cameraManager?.switchRig("explore");
        if (character) {
            character.setFacingMode(FACING_MODE.AUTO_FROM_MOVE);
        }
        this._buildIndices();
        this._setupDrawOrderDebug();
        this._setupPerCharacterStencil();
        this._collisionSystem.createDebugMeshes(this.staticBlockers, this.context.babylonScene, this.dynamicActors);
    }

    exit() {
        const { character } = this.context;
        if (character) {
            character.setFacingMode(FACING_MODE.LOCKED);
        }
        this._collisionSystem.disposeDebugMeshes();
    }

    _buildIndices() {
        const { entityPool, stageMaskData } = this.context;
        if (!entityPool) return;

        this.dynamicActors.length = 0;
        this.staticBlockers.length = 0;
        this.interactables.length = 0;
        this.renderables.length = 0;
        this.pickables.length = 0;

        for (const entity of entityPool) {
            if (entity.kind === "player") {
                this.dynamicActors.push(entity);
            }
            if (entity.kind === "npc" && entity.blocksMovement) {
                this.staticBlockers.push(entity);
            }
            if (entity.kind === "npc" && entity.interactable) {
                this.interactables.push(entity);
            }
            if (entity.kind === "pickable" && !entity.isDisposed) {
                this.pickables.push(entity);
            }
            if (entity.spritePlane) {
                this.renderables.push(entity);
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

        const shouldLog = () => this.context.scene.tickCount % 60 === 0;

        for (const entity of this.renderables) {
            const plane = entity.spritePlane;
            if (!plane) continue;

            plane.onBeforeRenderObservable.add(() => {
                // 角色之间纯 painter 排序，不参与 depth pipeline
                plane._prevDepthTest = gl.getParameter(gl.DEPTH_TEST);
                gl.disable(gl.DEPTH_TEST);

                const pos = entity.root.position;
                let needMask = false;
                for (const mesh of masks) {
                    const aabb = mesh._maskAabb;
                    if (!aabb) continue;
                    const wp = mesh.getAbsolutePosition();
                    const worldLeft = wp.x - aabb.w / 2;
                    const worldRight = wp.x + aabb.w / 2;
                    const worldBottom = wp.y - aabb.h / 2;
                    if (pos.x < worldLeft - 1.0 || pos.x > worldRight + 1.0) continue;
                    if (pos.y >= worldBottom) {
                        needMask = true;
                        break;
                    }
                }

                if (needMask) {
                    gl.enable(gl.STENCIL_TEST);
                    gl.stencilMask(0x00);
                    gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
                    gl.stencilFunc(gl.NOTEQUAL, 1, 0xFF);
                    // if (shouldLog()) {
                    //     console.log(`[stencil ON] ${entity.id ?? entity.name} y:${pos.y.toFixed(2)}`);
                    // }
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
        const { character, cameraManager, sceneVisualSystem, sceneSequencer } = this.context;

        const Z_FACTOR = 0.1;
        for (const entity of this.renderables) {
            if (entity.spritePlane) {
                entity.root.position.z = entity.root.position.y * Z_FACTOR;
                // ALPHABLEND 队列按 alphaIndex 排序，y 越小越近，alphaIndex 越大越后画（在上面）
                entity.spritePlane.alphaIndex = 1000 + Math.round(-entity.root.position.y * 100);
            }
        }
        //拾取时物品永远比主角多一层，画在前面
        const seq = this._pickupSequence;
        if (seq?.pickable?.spritePlane && character?.spritePlane) {
            seq.pickable.spritePlane.alphaIndex = character.spritePlane.alphaIndex + 1;
        }

        const pos = character.root.position;
        this._cameraTarget.set(pos.x, pos.y, pos.z);
        this.context.target = this._cameraTarget;

        if (sceneSequencer?.isBusy()) {
            console.log(`[ExploreMode] updateRender during sequence — context.target set to char pos=(${pos.x.toFixed(2)},${pos.y.toFixed(2)},${pos.z.toFixed(2)}) activeRig=${cameraManager?.activeRigId}`);
        }

        for (const entity of this.renderables) {
            if (entity.spritePlane) {
                // alphaIndex 不再显式设置，保持默认
            }
        }

        const activeCamera = cameraManager?.getCamera();
        if (sceneVisualSystem && activeCamera) {
            const characterPositions = this.renderables
                .filter(e => e.root)
                .map(e => ({ x: e.root.position.x, y: e.root.position.y }));
            sceneVisualSystem.update(dtMs, { camera: activeCamera, characterPositions });
        }

        this._collisionSystem.updateDebugMeshes(this.staticBlockers, this.context.babylonScene, this.dynamicActors);

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
            this._pickupSequence = null;
        }
    }
}