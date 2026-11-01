// TrailRenderer — 刀光组件（plans/26.10.31 刀光计划.MD）
// Step 0 落地范围：ribbon 几何构建 + 纯色材质。
// Step 3-4 落地范围：update(ctx) 采样链路（marker → 世界空间换算）+ debug 采样点
// + peek-ahead"进入最后 marker 帧"建 ribbon + TRAIL_COLORS 上色。
// 生命周期 hide 挂点（Step 5）随后落地，接口签名保持稳定。
//
// 设计要点（对应计划 §5）：
// - 自建 VertexData ribbon，不用 Babylon TrailMesh（D1）
// - 世界空间采样点直接构建，mesh 挂场景根（D4）
// - 顶点 uv.u 携带沿轨迹进度 t ∈ [0,1]（首标记=0，末标记=1），为下一任务沿轨迹渐隐预留（D7）
// - 单点采样 width=0 → 两顶点重合，自然收尖（§2.2）
import { getTrailColor } from "../../Data/TrailColors.js";

export class TrailRenderer {
    /** debug 采样点开关（验证 marker 采样用，false 关闭；与 ThrowComponent.DEBUG_INFINITE_AMMO 同风格） */
    static DEBUG_POINTS = true;

    // 控制点间每段插入的子采样数——稀疏采样点下把折线近似为曲线（同 Unity Line/TrailRenderer 思路）
    static SUBDIVISIONS_PER_SEGMENT = 10;

    /**
     * @param {BABYLON.Scene} babylonScene
     * @param {object|null} character - CombatCharacter 引用；Step 0 假数据为 null
     */
    constructor(babylonScene, character = null) {
        this.babylonScene = babylonScene;
        this.character = character;
        this.mesh = null;
        this.material = null;
        this.samples = [];          // 最近一次构建的世界空间采样点（调试/续作用）
        // Step 3 采样链路状态
        this.collectedSamples = [];     // 本次攻击已采集的世界空间采样点（按帧序）
        this.debugPoints = [];          // debug 采样点 mesh 池（挂场景根，世界空间，D4）
        this.debugMaterial = null;
        this._lastSampledClip = null;   // 采样去重 / 重播检测用
        this._lastSampledFrameIndex = -1;
    }

    /**
     * Catmull-Rom 样条取值：p1→p2 段上 t ∈ [0,1] 处的插值（p0/p3 为邻接控制点，端点钳制）。
     * p0=p1 且 p3=p2 时退化为端点缓动曲线，故仅对 ≥3 控制点启用细分。
     */
    static #catmullRom(p0, p1, p2, p3, t) {
        const t2 = t * t;
        const t3 = t2 * t;
        return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
    }

    /**
     * 控制点间 Catmull-Rom 平滑细分，宽度线性插值（D7 语义不变：细分不改变首尾收尖/齐头）。
     * @returns {Array<{x:number, y:number, width:number}>} 细分后的密集采样点
     */
    _densifySamples(samples) {
        const k = TrailRenderer.SUBDIVISIONS_PER_SEGMENT;
        if (samples.length < 3) {
            return samples.map((s) => ({ ...s }));   // 2 点即直线段，细分无几何收益
        }
        const out = [];
        const get = (idx) => samples[Math.min(samples.length - 1, Math.max(0, idx))];
        for (let i = 0; i < samples.length - 1; i += 1) {
            const p0 = get(i - 1);
            const p1 = get(i);
            const p2 = get(i + 1);
            const p3 = get(i + 2);
            for (let j = 0; j < k; j += 1) {
                const t = j / k;
                // 刃向线性插值 + 归一化；反向对插退化时回退起点方向（宽度仍线性插值）
                let dirX = p1.dirX + (p2.dirX - p1.dirX) * t;
                let dirY = p1.dirY + (p2.dirY - p1.dirY) * t;
                const dirLen = Math.hypot(dirX, dirY);
                if (dirLen >= 1e-6) {
                    dirX /= dirLen;
                    dirY /= dirLen;
                } else {
                    dirX = p1.dirX;
                    dirY = p1.dirY;
                }
                out.push({
                    x: TrailRenderer.#catmullRom(p0.x, p1.x, p2.x, p3.x, t),
                    y: TrailRenderer.#catmullRom(p0.y, p1.y, p2.y, p3.y, t),
                    width: p1.width + (p2.width - p1.width) * t,
                    dirX,
                    dirY,
                });
            }
        }
        out.push({ ...samples[samples.length - 1] });
        return out;
    }

    /**
     * 用世界空间采样点构建（或重建）ribbon。
     * @param {Array<{x:number, y:number, width:number}>} samples - 按帧序的世界空间采样点，至少 2 个
     * @param {string} colorHex - "#RRGGBB"
     * @param {number} [z=0] - ribbon 平面 z（sprite 平面在 root -0.02 偏移，默认 0 在 sprite 之前）
     */
    buildRibbon(samples, colorHex, z = 0) {
        if (!samples || samples.length < 2) return;
        const dense = this._densifySamples(samples);   // 曲线细分后的实际建带点列
        this.samples = dense;

        const n = dense.length;
        const positions = new Float32Array(n * 2 * 3);
        const uvs = new Float32Array(n * 2 * 2);

        for (let i = 0; i < n; i += 1) {
            const p = dense[i];
            const prev = dense[Math.max(0, i - 1)];
            const next = dense[Math.min(n - 1, i + 1)];
            // 截面方向：双点 marker 采样自带刃向（两点连线方向）；
            // 无方向（单点收尖）时回退轨迹法向——宽 0，两顶点重合，方向无实际影响
            let perpX = p.dirX ?? 0;
            let perpY = p.dirY ?? 0;
            const perpLen = Math.hypot(perpX, perpY);
            if (perpLen >= 1e-6) {
                perpX /= perpLen;
                perpY /= perpLen;
            } else {
                const dx = next.x - prev.x;
                const dy = next.y - prev.y;
                const len = Math.hypot(dx, dy) || 1;
                perpX = -dy / len;
                perpY = dx / len;
            }
            const halfW = (p.width ?? 0) / 2;

            const base = i * 6;
            positions[base + 0] = p.x + perpX * halfW;
            positions[base + 1] = p.y + perpY * halfW;
            positions[base + 2] = z;
            positions[base + 3] = p.x - perpX * halfW;
            positions[base + 4] = p.y - perpY * halfW;
            positions[base + 5] = z;

            // uv.u = 沿轨迹进度 t（D7 渐隐预留）；uv.v 固定占位
            const t = n > 1 ? i / (n - 1) : 0;
            const uvBase = i * 4;
            uvs[uvBase + 0] = t;
            uvs[uvBase + 1] = 0;
            uvs[uvBase + 2] = t;
            uvs[uvBase + 3] = 1;
        }

        const indices = [];
        for (let i = 0; i < n - 1; i += 1) {
            const a = i * 2;
            const b = i * 2 + 1;
            const c = i * 2 + 2;
            const d = i * 2 + 3;
            indices.push(a, b, c, b, d, c);
        }

        if (!this.mesh) {
            this.mesh = new BABYLON.Mesh("trailRibbon", this.babylonScene);
            this.material = new BABYLON.StandardMaterial("trailRibbonMat", this.babylonScene);
            this.material.disableLighting = true;
            this.material.backFaceCulling = false;
            this.material.diffuseColor = BABYLON.Color3.Black();
            this.material.specularColor = BABYLON.Color3.Black();
            this.material.alpha = 1;
            this.material.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
            this.material.disableDepthWrite = true;   // 与 sprite 材质一致，靠渲染顺序压盖
            this.mesh.material = this.material;
            this.mesh.isPickable = false;
            this.mesh.renderingGroupId = this.character?.spritePlane?.renderingGroupId ?? 1;   // 与 sprite 同组，否则被后画的角色像素盖住
            this.mesh.renderingOrder = 100;           // 透明 pass 内最后绘制，压在 sprite 之上
        }
        this.material.emissiveColor = BABYLON.Color3.FromHexString(colorHex);

        const vertexData = new BABYLON.VertexData();
        vertexData.positions = positions;
        vertexData.uvs = uvs;
        vertexData.indices = indices;
        vertexData.applyToMesh(this.mesh);
        this.mesh.setEnabled(true);
    }

    /**
     * 每 fixed tick 调用（动画帧推进之后）：读当前帧 trailMarkers → 世界空间采样入列；
     * peek-ahead 命中最后 marker 帧 → 建 ribbon 上色显示。
     * @param {object} ctx - { colliderClip, frameIndex, rootPosition, facing, trajectory }
     */
    update(ctx) {
        if (!ctx || !this.character) return;
        const frame = ctx.colliderClip?.frames?.[ctx.frameIndex];

        // clip 变化或重播（帧号回退）→ 清空采样列并隐藏 debug 点（新攻击从头采样，防上次残留）
        if (ctx.colliderClip !== this._lastSampledClip || ctx.frameIndex < this._lastSampledFrameIndex) {
            this.collectedSamples = [];
            this._lastSampledClip = ctx.colliderClip;
            this._lastSampledFrameIndex = -1;
            for (const p of this.debugPoints) p.setEnabled(false);
        }

        const markers = frame?.trailMarkers;
        if (!markers || markers.length === 0) {
            // v1 消失规则（修订，偏离计划 §5.4）：取样帧结束——帧推进越过最后 marker 帧——刀光即消失。
            // 攻击被打断进无 marker 状态时同样在此生效；enterState 的 hide 保留为兜底。
            if (this.mesh && this.mesh.isEnabled()) {
                this.hide();
            }
            return;
        }
        if (ctx.frameIndex === this._lastSampledFrameIndex) return;   // 长帧持续多 tick，同帧只采一次
        this._lastSampledFrameIndex = ctx.frameIndex;

        const rootAnchor = frame.anchors?.root;
        if (!rootAnchor) return;

        // 像素 → 世界空间（§5.2 公式）。sprite 镜像翻 spritePlane 不翻 root，故采集时手动应用 facing（D4）
        const pxToWorld = this.character.pxToWorld ?? 0.02;
        const facing = ctx.facing ?? 1;

        // marker 语义（§2.1）：单点 = 采样点 + 宽 0（收尖）；
        // 双点 = 连线中点 + 点距为宽度，连线方向即该处刃向（ribbon 截面方向）
        let px, py, widthPx, dirX = 0, dirY = 0;
        if (markers.length === 1) {
            px = markers[0].cx;
            py = markers[0].cy;
            widthPx = 0;
        } else {
            const a = markers[0];
            const b = markers[1];
            px = (a.cx + b.cx) / 2;
            py = (a.cy + b.cy) / 2;
            widthPx = Math.hypot(b.cx - a.cx, b.cy - a.cy);
            // 连线方向归一化（像素 y 向下 → 世界 y 向上；x 随 facing 镜像，符号不影响对称截面）
            dirX = facing * (b.cx - a.cx);
            dirY = -(b.cy - a.cy);
            const dirLen = Math.hypot(dirX, dirY) || 1;
            dirX /= dirLen;
            dirY /= dirLen;
        }

        this.collectedSamples.push({
            x: ctx.rootPosition.x + facing * (px - rootAnchor.cx) * pxToWorld,
            y: ctx.rootPosition.y + (rootAnchor.cy - py) * pxToWorld,
            width: widthPx * pxToWorld,
            dirX,
            dirY,
        });
        this._renderDebugPoints(ctx.rootPosition.z);

        // peek-ahead（§5.4）：下一帧无 marker（含 clip 末帧，frames[i+1] 为 undefined）→
        // 本帧即最后 marker 帧，采完立即建 ribbon 上色显示
        const nextFrame = ctx.colliderClip.frames[ctx.frameIndex + 1];
        const isLastMarkerFrame = !nextFrame?.trailMarkers || nextFrame.trailMarkers.length === 0;
        if (isLastMarkerFrame) {
            this.buildRibbon(this.collectedSamples, getTrailColor(ctx.trajectory), ctx.rootPosition.z);
        }
    }

    /** Step 3 debug：把已采样点画成青色小圆盘（挂场景根 = 世界空间，不随角色移动） */
    _renderDebugPoints(z) {
        if (!TrailRenderer.DEBUG_POINTS) return;
        const count = this.collectedSamples.length;
        if (!this.debugMaterial) {
            this.debugMaterial = new BABYLON.StandardMaterial("trailDebugMat", this.babylonScene);
            this.debugMaterial.disableLighting = true;
            this.debugMaterial.emissiveColor = BABYLON.Color3.FromHexString("#00FFFF");
            this.debugMaterial.backFaceCulling = false;
            this.debugMaterial.disableDepthWrite = true;
            // 与 sprite 同为 alpha blend：点要叠在角色像素之上，必须进透明 pass
            this.debugMaterial.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
        }
        // 与 spritePlane 同 renderingGroupId，否则点先画、后被不透明刀刃像素盖住
        const renderingGroupId = this.character?.spritePlane?.renderingGroupId ?? 1;
        while (this.debugPoints.length < count) {
            const disc = BABYLON.MeshBuilder.CreateDisc("trailDebugPoint", {
                radius: 3 * (this.character.pxToWorld ?? 0.02),
                tessellation: 16
            }, this.babylonScene);
            disc.material = this.debugMaterial;
            disc.isPickable = false;
            disc.renderingGroupId = renderingGroupId;
            disc.renderingOrder = 101;   // 透明 pass 内压在 sprite / ribbon(100) 之上
            disc.alphaIndex = 10;        // 双保险：sprite alphaIndex=0
            this.debugPoints.push(disc);
        }
        for (let i = 0; i < this.debugPoints.length; i += 1) {
            const point = this.debugPoints[i];
            if (i < count) {
                const s = this.collectedSamples[i];
                point.position.set(s.x, s.y, z + 0.01);
                point.setEnabled(true);
            } else {
                point.setEnabled(false);
            }
        }
    }

    /** v1：直接隐藏（下一任务渐隐时此方法内部改为启动消散，D8） */
    hide() {
        this.samples = [];
        this.collectedSamples = [];
        for (const p of this.debugPoints) p.setEnabled(false);
        if (this.mesh) this.mesh.setEnabled(false);
    }

    dispose() {
        if (this.mesh) {
            this.mesh.dispose();
            this.mesh = null;
        }
        if (this.material) {
            this.material.dispose();
            this.material = null;
        }
        for (const p of this.debugPoints) p.dispose();
        this.debugPoints = [];
        if (this.debugMaterial) {
            this.debugMaterial.dispose();
            this.debugMaterial = null;
        }
        this.samples = [];
        this.collectedSamples = [];
    }
}
