export class NpcController {
    constructor(options = {}) {
        this.state = "idle";
        this.stateElapsedMs = 0;
        this.greetingRadius = options.greetingRadius ?? 1.6;
        this.greetingDurationMs = options.greetingDurationMs ?? 2000;
        this.askDurationMs = options.askDurationMs ?? 3000;
        this.hasGreetedInRange = false;
    }

    update(dtMs, npc, context) {
        const player = context.player;
        if (!player) {
            console.warn("[NpcController] update skipped: player is null");
            return;
        }

        const dx = player.root.position.x - npc.root.position.x;
        const dy = player.root.position.y - npc.root.position.y;
        const distSq = dx * dx + dy * dy;
        const inGreetingRange = distSq <= this.greetingRadius * this.greetingRadius;

        if (this.state === "idle" && inGreetingRange && !this.hasGreetedInRange) {
            this.enterGreeting(npc);
            this.hasGreetedInRange = true;
            return;
        }

        if (this.state === "greeting") {
            this.stateElapsedMs += dtMs;
            if (this.stateElapsedMs >= this.greetingDurationMs) {
                console.log(`[NpcController] greeting timeout (${this.stateElapsedMs.toFixed(0)}ms >= ${this.greetingDurationMs}ms), entering idle`);
                this.enterIdle(npc);
            }
        }

        if (this.state === "ask") {
            this.stateElapsedMs += dtMs;
            if (this.stateElapsedMs >= this.askDurationMs) {
                console.log(`[NpcController] ask timeout (${this.stateElapsedMs.toFixed(0)}ms >= ${this.askDurationMs}ms), entering idle`);
                this.enterIdle(npc);
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
        console.log("[NpcController] enterGreeting called, prevState=" + this.state);
        this.state = "greeting";
        this.stateElapsedMs = 0;
        if (npc.hasState("greeting")) {
            npc.enterState("greeting");
        } else {
            console.warn("[NpcController] NPC has no 'greeting' state!");
        }
    }

    enterIdle(npc) {
        console.log("[NpcController] enterIdle called, prevState=" + this.state);
        this.state = "idle";
        this.stateElapsedMs = 0;
        if (npc.hasState("idle")) {
            npc.enterState("idle");
        } else {
            console.warn("[NpcController] NPC has no 'idle' state!");
        }
    }

    enterAsk(npc) {
        this.state = "ask";
        this.stateElapsedMs = 0;
        if (npc.hasState("ask")) {
            npc.enterState("ask");
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