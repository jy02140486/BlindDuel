/**
 * AnimatedTileComponent - 可动画的平铺纹理组件
 *
 * 用途：为 SceneVisualSystem 的地面/环境层提供带帧动画的 tile 贴图支持。
 * 与 FrameAnimationComponent 的区别：
 *   - 只处理单条 clip（无状态机、无切换）
 *   - 输出当前帧索引，供外部更新 Texture 的 uOffset/vOffset
 *   - 支持从 LibreSprite 导出的 JSON 中读取每帧 duration
 *
 * 典型使用场景：
 *   - 2 帧循环的地面 tile（草皮闪烁、水面波动等）
 *   - 1 帧静态 tile（兼容普通贴图）
 *
 * 挂载方式：由 SceneVisualSystem 在创建 "animated_tile" 类型元素时实例化，
 * 不直接挂在 Babylon TransformNode 上，而是作为 element 的动画控制器存在。
 */
export class AnimatedTileComponent {
    /**
     * @param {Object} atlasData - LibreSprite 导出的 JSON 对象
     * @param {Object} options
     * @param {boolean} options.loop - 是否循环播放，默认 true
     * @param {number} options.frameDurationMs - 强制指定每帧时长（覆盖 json 中的 duration）
     */
    constructor(atlasData, options = {}) {
        this.frames = this.#buildFrames(atlasData);
        this.loop = options.loop ?? true;
        this.forcedDuration = options.frameDurationMs ?? null;

        this.currentFrameIndex = 0;
        this.timeInFrameMs = 0;
        this.finished = false;
    }

    #buildFrames(atlasData) {
        const entries = Object.entries(atlasData.frames || {});
        // 按 x 坐标排序（水平排列的 spritesheet）
        entries.sort((a, b) => {
            const fa = a[1].frame;
            const fb = b[1].frame;
            if (fa.y !== fb.y) return fa.y - fb.y;
            return fa.x - fb.x;
        });

        return entries.map(([name, item], index) => ({
            index,
            name,
            x: item.frame.x,
            y: item.frame.y,
            w: item.frame.w,
            h: item.frame.h,
            durationMs: item.duration || 100
        }));
    }

    get frameCount() {
        return this.frames.length;
    }

    get currentFrame() {
        return this.frames[this.currentFrameIndex];
    }

    get currentFrameIndex() {
        return this._currentFrameIndex;
    }

    set currentFrameIndex(value) {
        this._currentFrameIndex = value;
    }

    reset() {
        this.currentFrameIndex = 0;
        this.timeInFrameMs = 0;
        this.finished = false;
    }

    update(dtMs) {
        if (this.frames.length <= 1) {
            if (!this.loop && !this.finished) {
                this.finished = true;
            }
            return;
        }

        const frame = this.currentFrame;
        const duration = this.forcedDuration ?? frame.durationMs;

        this.timeInFrameMs += dtMs;
        while (this.timeInFrameMs >= duration) {
            this.timeInFrameMs -= duration;
            if (this.currentFrameIndex + 1 < this.frames.length) {
                this.currentFrameIndex += 1;
            } else if (this.loop) {
                this.currentFrameIndex = 0;
            } else {
                this.currentFrameIndex = this.frames.length - 1;
                this.timeInFrameMs = 0;
                this.finished = true;
                break;
            }
        }
    }
}