import { MainMenuUI } from "../UI/MainMenuUI.js";
import { EndingOverlay } from "../UI/EndingOverlay.js";

export const FLOW_STATE = {
    MENU: "menu",
    STARTING: "starting",
    PLAYING: "playing",
    ENDING: "ending",
};

export class GameFlowManager {
    constructor(game) {
        this.game = game;
        this.state = FLOW_STATE.MENU;
        this._starting = false;
        this.ui = new MainMenuUI({
            onNewGame: () => this.startNewGame(),
            onContinue: () => this.continueGame(),
            hasCheckpoint: () => this.game.hasCheckpoint(),
            playClickSound: () => this.game.audioManager?.play("ui_button_click"),
        });
        this._endingUI = new EndingOverlay({ onContinue: () => this._onEndingDismiss() });
    }

    isPlaying() {
        return this.state === FLOW_STATE.PLAYING;
    }

    // HUD DOM 容器显隐（teardownGameplay 只清 Babylon 侧对象，这些容器需要单独隐藏，
    // 否则主菜单/通关画面背后透出血条/背包/buff 条残留）
    _setHudVisible(visible) {
        for (const id of ["hp-bar", "hud-left", "dialogue-bubble-container"]) {
            const el = document.getElementById(id);
            if (el) el.style.display = visible ? "" : "none";
        }
    }

    // 步骤 4/5 的 ending→回主菜单 也会走这里：菜单期间冻结玩家输入，
    // 场景侧由 teardownGameplay/ending 分支负责
    showMainMenu() {
        this.state = FLOW_STATE.MENU;
        this.game.playerController.enabled = false;
        this._endingUI.hide();
        this._setHudVisible(false);
        this.ui.show();
    }

    // 通关画面（计划 §5.4）：黑屏 + 一行字 + 任意键继续 → 回主菜单。
    // 调用时机：ending sequence 播到黑屏 callback（battle_on_ending_black）之后
    showEnding(text) {
        this.state = FLOW_STATE.ENDING;
        this.game.playerController.enabled = false;
        this._setHudVisible(false);
        this._endingUI.show(text);
    }

    _onEndingDismiss() {
        this._endingUI.hide();
        // 卸载场景退回冷启动等效态（含 teardownGameplay），菜单背后不再保留世界
        this.game.unloadScene();
        this.showMainMenu();
    }

    dispose() {
        this._endingUI.dispose();
    }

    async startNewGame() {
        if (this._starting || this.isPlaying()) return;
        this._starting = true;
        this.state = FLOW_STATE.STARTING;
        this.ui.hide();
        try {
            this.game.prepareNewRun();
            await this.game.init();
            this.game.playerController.enabled = true;
            this._setHudVisible(true);
            this.state = FLOW_STATE.PLAYING;
        } catch (err) {
            console.error("[GameFlowManager] startNewGame failed", err);
            this.showMainMenu();
        }
        this._starting = false;
    }

    async continueGame() {
        if (this._starting || this.isPlaying()) return;
        if (!this.game.hasCheckpoint()) return;
        this._starting = true;
        this.state = FLOW_STATE.STARTING;
        this.ui.hide();
        try {
            // 冷启动路径：_checkpoint 恢复 worldState/inventory/_pendingRestore 后
            // 经 requestSceneSwitch → _loadSceneInternal 完成建场景（Scene.dispose 空守卫已确认安全）
            await this.game.restoreCheckpoint({ fadeInAfter: true });
            this.game.playerController.enabled = true;
            this._setHudVisible(true);
            this.state = FLOW_STATE.PLAYING;
        } catch (err) {
            console.error("[GameFlowManager] continueGame failed", err);
            this.showMainMenu();
        }
        this._starting = false;
    }
}
