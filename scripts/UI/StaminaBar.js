/**
 * StaminaBar — 玩家头顶耐力条（世界坐标锚定）
 * 光谱渐变：左端红 → 右端绿。填充左锚定、随耐力从绿端收缩，
 * 剩余部分右缘的颜色即当前耐力状态色（满耐力偏绿、低耐力偏红）
 */
const HEAD_OFFSET_Y = 3;

export class StaminaBar {
    constructor(character) {
        this.character = character;

        this.track = document.createElement("div");
        this.track.className = "stamina-bar-track";

        this.fill = document.createElement("div");
        this.fill.className = "stamina-bar-fill";

        this.track.appendChild(this.fill);
        document.body.appendChild(this.track);
    }

    update() {
        const c = this.character;
        if (!c || !c.combat || c.isDead) {
            this.track.style.display = "none";
            return;
        }

        const canvas = c.scene?.getEngine()?.getRenderingCanvas?.();
        if (!canvas || !c.scene?.activeCamera) return;

        const worldPos = c.root.position.clone();
        worldPos.y += HEAD_OFFSET_Y;

        const projected = BABYLON.Vector3.Project(
            worldPos,
            BABYLON.Matrix.Identity(),
            c.scene.getTransformMatrix(),
            c.scene.activeCamera.viewport.toGlobal(canvas.width, canvas.height)
        );

        if (projected.z > 0 && projected.z < 1) {
            const ratio = Math.max(0, Math.min(1, c.staminaRatio ?? 0));
            this.fill.style.width = `${ratio * 100}%`;
            this.track.style.display = "block";
            this.track.style.left = `${projected.x}px`;
            this.track.style.top = `${projected.y}px`;
        } else {
            this.track.style.display = "none";
        }
    }

    dispose() {
        this.track?.remove();
        this.track = null;
        this.fill = null;
        this.character = null;
    }
}
