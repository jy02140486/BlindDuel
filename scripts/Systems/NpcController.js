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
            this._behavior.update(dtMs, npc, context);
            if (this._debugDisc && this._debugRootNode) {
                this._debugDisc.position.x = this._debugRootNode.position.x;
                this._debugDisc.position.y = this._debugRootNode.position.y;
            }
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
        if (this._dialogueBubble) {
            this._dialogueBubble.hide();
        }
        this._idleBehavior.enter(npc, {});
    }

    enterFollowing(npc) {
        this.state = "following";
        if (!this._followingBehavior) {
            this._followingBehavior = new FollowingBehavior();
        }
        this._behavior = this._followingBehavior;
        this._behavior.enter(npc, { dialogueBubble: this._dialogueBubble });
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

    setupDebugVisual(scene, rootNode) {
        this._debugDisc = BABYLON.MeshBuilder.CreateDisc("npc_greeting_disc", {
            radius: this.greetingRadius,
            tessellation: 32,
            sideOrientation: BABYLON.Mesh.DOUBLESIDE
        }, scene);
        this._debugRootNode = rootNode;
        this._debugDisc.rotation.z = Math.PI / 2;
        this._debugDisc.position.z = -0.01;
        this._debugDisc.renderingGroupId = 2;

        this._debugMaterial = new BABYLON.StandardMaterial("npc_greeting_mat", scene);
        this._debugMaterial.diffuseColor = new BABYLON.Color3(0.3, 0.9, 0.3);
        this._debugMaterial.alpha = 0.2;
        this._debugMaterial.backFaceCulling = false;
        this._debugMaterial.disableLighting = true;
        this._debugDisc.material = this._debugMaterial;
        this._debugDisc.setEnabled(false);
    }

    setDebugVisible(value) {
        if (this._debugDisc) {
            this._debugDisc.setEnabled(value);
        }
    }
}