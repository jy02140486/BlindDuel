import { FollowingBehavior } from "./NpcBehaviors/FollowingBehavior.js";

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

        const dx = player.root.position.x - npc.root.position.x;
        const dy = player.root.position.y - npc.root.position.y;
        const distSq = dx * dx + dy * dy;
        const inGreetingRange = distSq <= this.greetingRadius * this.greetingRadius;

        if (this.state === "idle" && inGreetingRange && !this.hasGreetedInRange) {
            if (this._isQuestCompleted()) {
                this.hasGreetedInRange = true;
                return;
            }
            this.enterGreeting(npc);
            this.hasGreetedInRange = true;
            return;
        }

        if (this.state === "greeting") {
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
            this._dialogueBubble.setText(entry.text);
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
        if (npc.hasState("idle")) {
            npc.enterState("idle");
        } else {
            console.warn("[NpcController] NPC has no 'idle' state!");
        }
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