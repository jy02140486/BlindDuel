import { WorldState } from "./WorldState.js";
import { QuestManager } from "./Systems/QuestManager.js";
import { InventoryManager } from "./Systems/InventoryManager.js";
import { Scene } from "./Scene.js";

export class Game {
    constructor(engine, canvas) {
        this.worldState = new WorldState();
        this.inventoryManager = new InventoryManager();
        this.questManager = new QuestManager(this.worldState, this.inventoryManager);
        this.scene = new Scene(engine, canvas, {
            worldState: this.worldState,
            questManager: this.questManager,
            inventoryManager: this.inventoryManager,
        });
    }

    async init(sceneDef, battleDefs) {
        await this.scene.init(sceneDef, battleDefs);
    }

    fixedUpdate(dtMs, tickCount) {
        this.scene.fixedUpdate(dtMs, tickCount);
    }

    updateRender(dtMs) {
        this.scene.updateRender(dtMs);
    }

    render() {
        this.scene.render();
    }

    onResize() {
        this.scene.onResize();
    }

    dispose() {
        this.scene.dispose();
    }

    togglePause() {
        this.scene.togglePause();
    }

    toggleCameraProjection() {
        this.scene.toggleCameraProjection();
    }
}