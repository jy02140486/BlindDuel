import { FollowingBehavior } from "./NpcBehaviors/FollowingBehavior.js";
import { IdleBehavior } from "./NpcBehaviors/IdleBehavior.js";

export class NpcController {
    constructor(worldState, npcDef, options = {}) {
        this.world = worldState;
        this.npcDef = npcDef;
        this.state = "idle";
        this.stateElapsedMs = 0;
        this.greetingRadius = options.greetingRadius ?? 1.6;
        this.hasGreetedInRange = false;
        this._activeText = null;
        this._activeAction = null;
        this._dialogueTimerMs = 0;
        this._dialogueDurationMs = options.dialogueDurationMs ?? 3000;
        this._inventoryManager = null;
        this._dialogueBubble = null;
        this._activeGiveItem = null;
        this._needsInteract = false;
        this._pendingGiveItem = null;
        this._pendingAction = null;
        this._pendingCompleteText = null;
        this._behavior = null;
        this._followingBehavior = null;
        this._debugVisible = true;
        const idleClip = npcDef?.idle?.clip ?? "idle";
        this._idleBehavior = new IdleBehavior({ clip: idleClip });
    }

    update(dtMs, npc, context) {
        const player = context.player;
        if (!player) {
            console.warn("[NpcController] update skipped: player is null");
            return;
        }

        this._inventoryManager = context.inventoryManager ?? this._inventoryManager;
        this._dialogueBubble = context.dialogueBubble ?? this._dialogueBubble;

        if (this._behavior) {
            if (!context.sequencerBusy) {
                this._behavior.update(dtMs, npc, context);
            }
            if (this._debugDisc && this._debugRootNode) {
                this._debugDisc.position.x = this._debugRootNode.position.x;
                this._debugDisc.position.y = this._debugRootNode.position.y;
            }
            // Target disc updated by behavior.update() below (via _debugData)
            return;
        }

        const sequencerBusy = context.sequencerBusy;
        const dx = player.root.position.x - npc.root.position.x;
        const dy = player.root.position.y - npc.root.position.y;
        const distSq = dx * dx + dy * dy;
        const inGreetingRange = distSq <= this.greetingRadius * this.greetingRadius;

        // sequencer 期间不触发 greeting（避免 intro 中 hero 路过 Charlotte 误弹气泡）
        if (this.state === "idle" && inGreetingRange && !this.hasGreetedInRange && !sequencerBusy) {
            if (this._isQuestCompleted()) {
                this.hasGreetedInRange = true;
                return;
            }
            this.enterGreeting(npc);
            this.hasGreetedInRange = true;
            return;
        }

        // sequencer 期间不推进 greeting 计时（避免气泡计时与 sequencer 冲突）
        if (this.state === "greeting" && !sequencerBusy) {
            this._dialogueTimerMs += dtMs;
            if (this._dialogueTimerMs >= this._dialogueDurationMs) {
                this._triggerAction(context.questManager);
                this.enterIdle(npc);
                return;
            }
        }


        if (!inGreetingRange) {
            this.hasGreetedInRange = false;
        }

        if (this._debugDisc && this._debugRootNode) {
            this._debugDisc.position.x = this._debugRootNode.position.x;
            this._debugDisc.position.y = this._debugRootNode.position.y;
        }
        // Hide target disc when not in following state
        if (this._targetDisc) {
            this._targetDisc.setEnabled(false);
        }
    }

    enterGreeting(npc) {
        const entry = this.resolve();
        if (!entry) return;

        if (entry.giveItem) {
            this._needsInteract = true;
            this._pendingGiveItem = entry.giveItem;
            this._pendingAction = entry.action ?? null;
            this._pendingCompleteText = entry.completeText ?? null;
            if (npc.hasState("greeting")) {
                npc.enterState("greeting");
            }
            return;
        }

        this.state = "greeting";
        this._dialogueTimerMs = 0;
        this._activeText = entry.text;
        this._activeAction = entry.action ?? null;
        if (this._dialogueBubble) {
            if (Array.isArray(entry.content)) {
                this._dialogueBubble.setContent(entry.content);
            } else {
                this._dialogueBubble.setText(entry.text);
            }
            this._dialogueBubble.show(npc);
        }
        if (npc.hasState("greeting")) {
            npc.enterState("greeting");
        }
    }

    enterIdle(npc) {
        this.state = "idle";
        this.stateElapsedMs = 0;
        this._behavior = null;
        if (typeof npc.setFollowing === "function") npc.setFollowing(false);
        if (this._dialogueBubble) {
            this._dialogueBubble.hide();
        }
        if (this._targetDisc) {
            this._targetDisc.setEnabled(false);
        }
        this._idleBehavior.enter(npc, {});
    }

    enterFollowing(npc) {
        this.state = "following";
        if (!this._followingBehavior) {
            this._followingBehavior = new FollowingBehavior();
        }
        this._behavior = this._followingBehavior;
        if (typeof npc.setFollowing === "function") npc.setFollowing(true);
        // Show target disc when entering following (controlled by global debug flag)
        if (this._targetDisc) {
            this._targetDisc.setEnabled(this._debugVisible === true);
        }
        this._behavior.enter(npc, { dialogueBubble: this._dialogueBubble });
    }

    // 根据当前 worldState 评估 initialStateMap，应用初始 behavior state。
    // state 由 scenario 进度派生，与 checkpoint 恢复后的 worldState 自然兼容。
    // 应在 NPC 创建后、ExploreMode.enter 之前调用。
    // hero 用于 following 状态下将 NPC 初始位置设到 hero 旁，避免从远处走过来。
    applyInitialState(npc, worldState, hero) {
        const map = this.npcDef?.initialStateMap;
        if (!Array.isArray(map) || map.length === 0) return;
        for (const entry of map) {
            if (this._matchCondition(entry.if, worldState)) {
                const target = entry.state;
                console.log(`[NpcCtrl] applyInitialState ${npc.id} scenario=${worldState.scenario} match=${JSON.stringify(entry.if)} → ${target}`);
                if (target === "following") {
                    this.enterFollowing(npc);
                    // 进入 following 时立即 teleport 到 hero 旁，避免依赖后续 fixedUpdate 拉回
                    if (hero) {
                        const offsetX = this._followingBehavior?.options?.targetOffsetX ?? 1.0;
                        const heroPos = hero.root.position;
                        npc.root.position.set(heroPos.x + offsetX, heroPos.y, heroPos.z);
                    }
                } else if (target === "idle") {
                    this.enterIdle(npc);
                }
                return;
            }
        }
    }


    resolve() {
        if (!this.world || !this.npcDef?.dialogues) return null;
        const sorted = [...this.npcDef.dialogues].sort((a, b) => b.priority - a.priority);
        for (const entry of sorted) {
            if (this._matchCondition(entry.condition)) {
                return entry;
            }
        }
        return null;
    }

    _matchCondition(cond) {
        if (!cond || Object.keys(cond).length === 0) return true;
        if (cond.quest !== undefined) {
            const q = this.world.getQuest(cond.quest);
            if (cond.stage !== undefined && q.stage !== cond.stage) return false;
            if (cond.completed !== undefined && q.completed !== cond.completed) return false;
        }
        if (cond.flag !== undefined && !this.world.flags[cond.flag]) return false;
        if (cond.scenario !== undefined && this.world.scenario !== cond.scenario) return false;
        if (cond.scenarioMin !== undefined && this.world.scenario < cond.scenarioMin) return false;
        if (cond.scenarioMax !== undefined && this.world.scenario > cond.scenarioMax) return false;
        if (cond.hasItem !== undefined) {
            if (!this._inventoryManager) return false;
            return this._inventoryManager.hasItem(cond.hasItem);
        }
        return true;
    }

    _triggerAction(questManager) {
        if (this._activeAction && questManager) {
            if (Array.isArray(this._activeAction)) {
                questManager.executeDirectives(this._activeAction);
            } else {
                questManager.executeAction(this._activeAction);
            }
        }
        this._activeText = null;
        this._activeAction = null;
        this._checkPendingGive();
    }

    _isQuestCompleted() {
        const entry = this.resolve();
        return entry?.condition?.completed === true;
    }

    _checkPendingGive() {
        const entry = this.resolve();
        if (entry?.giveItem) {
            this._needsInteract = true;
            this._pendingGiveItem = entry.giveItem;
            this._pendingAction = entry.action ?? null;
            this._pendingCompleteText = entry.completeText ?? null;
        }
    }

    setupDebugVisual(scene, rootNode, debugVisible = true) {
        const ownerName = rootNode?.name ?? "unknown_npc";
        this._debugDisc = BABYLON.MeshBuilder.CreateDisc(`npc_greeting_disc[${ownerName}]`, {
            radius: this.greetingRadius,
            tessellation: 32,
            sideOrientation: BABYLON.Mesh.DOUBLESIDE
        }, scene);
        this._debugRootNode = rootNode;
        this._debugDisc.rotation.z = Math.PI / 2;
        this._debugDisc.position.z = -0.01;
        this._debugDisc.renderingGroupId = 2;
        this._debugDisc.metadata = {
            owner: ownerName,
            kind: "npc_greeting_disc",
            greetingRadius: this.greetingRadius
        };

        this._debugMaterial = new BABYLON.StandardMaterial(`npc_greeting_mat[${ownerName}]`, scene);
        this._debugMaterial.diffuseColor = new BABYLON.Color3(0.3, 0.9, 0.3);
        this._debugMaterial.alpha = 0.2;
        this._debugMaterial.backFaceCulling = false;
        this._debugMaterial.disableLighting = true;
        this._debugDisc.material = this._debugMaterial;
        this._debugDisc.setEnabled(debugVisible);

        // Target sampling disc — shows where WalkAreaSampler output lands
        // Updated each frame by FollowingBehavior.update() via npc.npcController._targetDisc
        this._targetDisc = BABYLON.MeshBuilder.CreateDisc(`npc_target_disc[${ownerName}]`, {
            radius: 0.15,
            tessellation: 16,
            sideOrientation: BABYLON.Mesh.DOUBLESIDE
        }, scene);
        this._targetDisc.rotation.z = Math.PI / 2;
        this._targetDisc.position.z = -0.02;
        this._targetDisc.renderingGroupId = 2;
        this._targetDisc.isPickable = false;
        this._targetDisc.metadata = {
            owner: ownerName,
            kind: "npc_target_disc",
        };

        this._targetMaterial = new BABYLON.StandardMaterial(`npc_target_mat[${ownerName}]`, scene);
        this._targetMaterial.diffuseColor = new BABYLON.Color3(1.0, 0.55, 0.0); // orange
        this._targetMaterial.alpha = 0.85;
        this._targetMaterial.backFaceCulling = false;
        this._targetMaterial.disableLighting = true;
        this._targetMaterial.wireframe = true;
        this._targetDisc.material = this._targetMaterial;
        this._targetDisc.setEnabled(debugVisible);

        // Force visualization arrows: follow(blue), separation(red), combined(yellow)
        this._forceArrows = this._createForceArrows(scene, ownerName);
    }

    _createForceArrows(scene, ownerName) {
        const shaftThickness = 0.04; // ~8px at typical zoom
        const arrows = {};

        const defs = {
            follow:      { color: new BABYLON.Color3(0.1, 0.3, 1.0), label: "Follow" },
            separation:  { color: new BABYLON.Color3(1.0, 0.2, 0.2), label: "Separation" },
            combined:    { color: new BABYLON.Color3(1.0, 0.9, 0.1), label: "Combined" },
        };

        for (const [key, { color, label }] of Object.entries(defs)) {
            const shaft = BABYLON.MeshBuilder.CreateBox(`npc_force_${key}[${ownerName}]`, {
                width: 1.0,
                height: shaftThickness,
                depth: shaftThickness,
            }, scene);
            shaft.renderingGroupId = 3; // top debug layer (above walkArea)
            shaft.alphaIndex = 5000;      // ensure drawn after walkArea
            shaft.isPickable = false;
            shaft.position.x = 0.5; // offset so shaft starts at origin

            const tip = BABYLON.MeshBuilder.CreateCylinder(`npc_force_tip_${key}[${ownerName}]`, {
                height: 0.12,
                diameterTop: 0,
                diameterBottom: shaftThickness * 2.0,
            }, scene);
            tip.renderingGroupId = 3; // top debug layer
            tip.alphaIndex = 5000;
            tip.isPickable = false;
            tip.rotation.z = -Math.PI / 2; // cone points +X after rotation
            tip.position.x = 1.0 + 0.06; // at end of default shaft

            const mat = new BABYLON.StandardMaterial(`npc_force_mat_${key}[${ownerName}]`, scene);
            mat.diffuseColor = color;
            mat.emissiveColor = color;   // self-illuminated, no lighting dependency
            mat.disableLighting = true;
            mat.backFaceCulling = false;
            shaft.material = mat;
            tip.material = mat;

            const group = new BABYLON.TransformNode(`npc_force_group_${key}[${ownerName}]`, scene);
            shaft.parent = group;
            tip.parent = group;
            group.setEnabled(false);

            arrows[key] = {
                group,
                shaft,
                tip,
                update(originX, originY, dirX, dirY, length) {
                    if (length <= 0.001) {
                        group.setEnabled(false);
                        return;
                    }
                    group.setEnabled(true);
                    group.position.set(originX, originY, 0);
                    const angle = Math.atan2(dirY, dirX);
                    group.rotation.z = angle;
                    group.scaling.x = length;
                    // Keep thickness constant regardless of length
                    group.scaling.y = 1;
                    group.scaling.z = 1;
                }
            };
        }

        return arrows;
    }

    setDebugVisible(value) {
        this._debugVisible = !!value;
        if (this._debugDisc) {
            this._debugDisc.setEnabled(value);
        }
        if (this._targetDisc) {
            const show = !!value && this.state === "following";
            this._targetDisc.setEnabled(show);
        }
        // Force arrows: visible when debug ON AND in following state
        if (this._forceArrows) {
            const show = !!value && this.state === "following";
            for (const key of Object.keys(this._forceArrows)) {
                this._forceArrows[key].group.setEnabled(show);
            }
        }
    }
}