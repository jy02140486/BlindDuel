/**
 * StaminaBar — 角色头顶耐力条（世界坐标锚定）
 * 普通模式：填充左锚定、随耐力从右端收缩，剩余部分右缘的颜色即当前耐力状态色
 * 镜像模式（mirrored: true）：填充右锚定、随耐力从左端收缩，剩余部分左缘为状态色
 *   （用于对手侧，呈现传统格斗游戏血条的对称布局）
 * 光谱渐变：左端红 → 右端蓝
 */
const HEAD_OFFSET_Y = 3;

export class StaminaBar {
    constructor(character, options = {}) {
        this.character = character;
        this.mirrored = options.mirrored === true;

        this.track = document.createElement("div");
        this.track.className = "stamina-bar-track";

        this.fill = document.createElement("div");
        this.fill.className = this.mirrored
            ? "stamina-bar-fill stamina-bar-fill--mirrored"
            : "stamina-bar-fill";

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
