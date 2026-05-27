export class NpcController {
    constructor(options = {}) {
        this.state = "idle";
        this.stateElapsedMs = 0;
        this.greetingRadius = options.greetingRadius ?? 1.6;
        this.greetingDurationMs = options.greetingDurationMs ?? 2000;
        this.hasGreetedInRange = false;
    }

    update(dtMs, npc, context) {
        const player = context.player;
        if (!player) {
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
        this.state = "greeting";
        this.stateElapsedMs = 0;
        if (npc.hasState("greeting")) {
            npc.enterState("greeting");
        }
    }

    enterIdle(npc) {
        this.state = "idle";
        this.stateElapsedMs = 0;
        if (npc.hasState("idle")) {
            npc.enterState("idle");
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