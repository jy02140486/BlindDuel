/**
 * SceneVisualSystem - 多层卷轴视觉效果系统
 * 负责管理背景、中景、前景等视觉层的视差移动和渲染
 */
import { AnimatedTileComponent } from "../Components/AnimatedTileComponent.js";

export class SceneVisualSystem {
    constructor(scene) {
        this.scene = scene;
        this.layers = new Map();
        this.config = null;
        this.maskRoot = null;
        this._maskMeshes = [];
}
    /**
     * 初始化视觉系统
     * @param {Object} config - 环境配置
     */
    async init(config) {
        this.config = config;

        // 创建各层根节点
        for (const layerConfig of config.layers) {
            await this._createLayer(layerConfig);
        }

        console.log('SceneVisualSystem initialized with', this.layers.size, 'layers');
    }

    /**
     * 从 StageMask 数据创建深度遮罩 mesh（stencil buffer 方案）
     * @param {Object} maskData - .mask.json 解析后的数据
     */
    createDepthMasks(maskData) {
        this.disposeDepthMasks();

        if (!maskData || !maskData.masks) {
            console.warn('[SceneVisualSystem] No mask data provided');
            return;
        }

        // 获取 STAGE 层根节点用于视差同步
        const stageLayer = this.layers.get('STAGE');
        this.maskRoot = new BABYLON.TransformNode('maskRoot', this.scene);
        this.maskRoot.parent = stageLayer ? stageLayer.root : null;
        this.maskRoot.position.z = -0.03;

        const gl = this.scene.getEngine()._gl;
        if (!gl) {
            console.error('[SceneVisualSystem] WebGL context not available');
            return;
        }

        let createdCount = 0;
        for (const mask of maskData.masks) {
            const dm = mask.depthMask;
            if (!dm) continue;

            const plane = BABYLON.MeshBuilder.CreatePlane(
                `depthMask_${mask.id}`,
                { width: dm.w, height: dm.h },
                this.scene
            );
            plane.position.x = dm.x + dm.w / 2;
            plane.position.y = dm.y + dm.h / 2;
            plane.position.z = 0;
            plane.parent = this.maskRoot;

            // 材质：必须有 material 才能触发 draw call，但用 colorMask 关闭颜色写入
            const mat = new BABYLON.StandardMaterial(`mat_depthMask_${mask.id}`, this.scene);
            mat.disableLighting = true;
            mat.backFaceCulling = false;
            mat.emissiveColor = new BABYLON.Color3(0, 0, 0);
            mat.alpha = 1;
            plane.material = mat;

            // 与角色同 renderingGroup，alphaIndex 必须大于所有角色
            // 确保在 group 1 的 transparent 队列中 depthMask 最先绘制
            plane.renderingGroupId = 1;
            plane.alphaIndex = 10000;

            // stencil 三步法：只写 stencil，不写颜色
            // 参考 occludingtest.js：mask 先渲染，设置 stencil 状态后，后续 mesh 自动受遮挡
            plane.onBeforeRenderObservable.add(() => {
                gl.colorMask(false, false, false, false);
                gl.enable(gl.STENCIL_TEST);
                gl.stencilMask(0xFF);
                gl.stencilFunc(gl.ALWAYS, 1, 0xFF);
                gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
            });

            plane.onAfterRenderObservable.add(() => {
                gl.colorMask(true, true, true, true);
                gl.stencilFunc(gl.NOTEQUAL, 1, 0xFF);
                gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
                gl.stencilMask(0x00);
            });

            plane._maskAabb = { x: dm.x, y: dm.y, w: dm.w, h: dm.h };

            // debug panel（与角色同样的世界→屏幕投影方式）
            plane._debugPanel = this.#createMaskDebugPanel(mask.id);

            this._maskMeshes.push(plane);
            createdCount++;
        }

        console.log(`[SceneVisualSystem] Created ${createdCount} depth mask meshes (stencil mode)`);
    }

    _updateMaskVisibility(characterPositions) {
        for (const mesh of this._maskMeshes) {
            const aabb = mesh._maskAabb;
            if (!aabb) continue;

            const maskBottom = aabb.y;
            const maskLeft = aabb.x;
            const maskRight = aabb.x + aabb.w;

            let shouldHide = false;
            for (const pos of characterPositions) {
                if (pos.x < maskLeft - 1.0 || pos.x > maskRight + 1.0) continue;
                if (pos.y < maskBottom) {
                    shouldHide = true;
                    break;
                }
            }

            // 不再隐藏 mask —— 每个角色自行判断是否参与 stencil 裁剪
            mesh.isVisible = true;
        }
    }

    disposeDepthMasks() {
        for (const mesh of this._maskMeshes) {
            if (mesh._debugPanel) {
                mesh._debugPanel.remove();
                mesh._debugPanel = null;
            }
            if (mesh.material) {
                mesh.material.dispose();
            }
            mesh.dispose();
        }
        this._maskMeshes.length = 0;
        if (this.maskRoot) {
            this.maskRoot.dispose();
            this.maskRoot = null;
        }
    }

    #createMaskDebugPanel(maskId) {
        const panel = document.createElement("div");
        panel.style.position = "absolute";
        panel.style.pointerEvents = "none";
        panel.style.background = "rgba(128, 0, 0, 0.7)";
        panel.style.color = "#ffcccc";
        panel.style.font = "11px/1.2 Consolas, monospace";
        panel.style.padding = "2px 6px";
        panel.style.borderRadius = "3px";
        panel.style.border = "1px solid rgba(255, 128, 128, 0.4)";
        panel.style.whiteSpace = "nowrap";
        panel.style.zIndex = "1000";
        panel.style.display = "none";
        document.body.appendChild(panel);
        return panel;
    }

    _updateMaskDebugPanels() {
        const canvas = this.scene.getEngine().getRenderingCanvas();
        if (!canvas) return;

        for (const mesh of this._maskMeshes) {
            const panel = mesh._debugPanel;
            if (!panel) continue;

            if (!mesh.isVisible) {
                panel.style.display = "none";
                continue;
            }

            const wp = mesh.getAbsolutePosition();
            const projected = BABYLON.Vector3.Project(
                wp,
                BABYLON.Matrix.Identity(),
                this.scene.getTransformMatrix(),
                this.scene.activeCamera.viewport.toGlobal(canvas.width, canvas.height)
            );

            const aabb = mesh._maskAabb;
            const baseY = aabb ? wp.y - aabb.h / 2 : wp.y;
            if (projected.z > 0 && projected.z < 1) {
                panel.style.display = "block";
                panel.style.left = `${projected.x - panel.offsetWidth / 2}px`;
                panel.style.top = `${projected.y}px`;
                panel.textContent = `${mesh.name} baseline:${baseY.toFixed(2)} center:${wp.y.toFixed(2)} z:${wp.z.toFixed(2)}`;
            } else {
                panel.style.display = "none";
            }
        }
    }

    /**
     * 创建单个视觉层
     * @param {Object} layerConfig - 层配置
     */
    async _createLayer(layerConfig) {
        const layer = {
            config: layerConfig,
            root: new BABYLON.TransformNode(`layer_${layerConfig.id}`, this.scene),
            elements: []
        };

        // 设置层的基础位置
        layer.root.position.z = layerConfig.z;
        
        // 创建层内的视觉元素
        for (const elementConfig of layerConfig.elements) {
            await this._createVisualElement(layer, elementConfig);
        }

        this.layers.set(layerConfig.id, layer);
    }

    /**
     * 创建视觉元素（Plane + 贴图）
     * @param {Object} layer - 所属层
     * @param {Object} elementConfig - 元素配置
     */
    async _createVisualElement(layer, elementConfig) {
        if (elementConfig.kind === "animated_tile") {
            await this._createAnimatedTileElement(layer, elementConfig);
            return;
        }

        // 创建平面网格
        const plane = BABYLON.MeshBuilder.CreatePlane(
            `element_${elementConfig.id}`,
            {
                width: elementConfig.width,
                height: elementConfig.height
            },
            this.scene
        );

        // 设置位置
        plane.position.x = elementConfig.x;
        plane.position.y = elementConfig.y;
        plane.position.z = elementConfig.zOffset || 0;
        
        // 设置父节点
        plane.parent = layer.root;

        // 创建材质
        const material = new BABYLON.StandardMaterial(`mat_${elementConfig.id}`, this.scene);
        
        // 加载贴图
        const texture = new BABYLON.Texture(elementConfig.texture, this.scene);
        material.diffuseTexture = texture;
        
        // 正确设置透明属性（修复黑底问题）
        material.useAlphaFromDiffuseTexture = true;
        material.diffuseTexture.hasAlpha = true;
        material.backFaceCulling = false;
        
        // 禁用光照影响，使用贴图原始颜色
        material.disableLighting = true;
        material.specularColor = new BABYLON.Color3(0, 0, 0);
        material.emissiveColor = new BABYLON.Color3(1, 1, 1);
        
        plane.material = material;

        // 设置渲染组（必须在 mesh 上，不是 material 上）
        plane.renderingGroupId = layer.config.renderingGroupId;

        // alphaIndex：同层内精细排序（数值大的在前）
        if (elementConfig.alphaIndex !== undefined) {
            plane.alphaIndex = elementConfig.alphaIndex;
        }

        // 水平翻转
        if (elementConfig.flipX) {
            plane.rotation.y = Math.PI;
        }

        // 存储元素信息
        const element = {
            mesh: plane,
            config: elementConfig,
            originalX: elementConfig.x
        };
        
        layer.elements.push(element);
    }

    /**
     * 创建动画 tile 元素（spritesheet 帧动画 + 平铺重复）
     * @param {Object} layer - 所属层
     * @param {Object} elementConfig - 元素配置
     */
    async _createAnimatedTileElement(layer, elementConfig) {
        // 加载 atlas json
        const atlasResponse = await fetch(elementConfig.atlas || elementConfig.texture.replace('.png', '.json'));
        const atlasData = await atlasResponse.json();

        // 创建 Plane（尺寸由配置决定，如 1024x256）
        const plane = BABYLON.MeshBuilder.CreatePlane(
            `element_${elementConfig.id}`,
            {
                width: elementConfig.width,
                height: elementConfig.height
            },
            this.scene
        );

        plane.position.x = elementConfig.x;
        plane.position.y = elementConfig.y;
        plane.position.z = elementConfig.zOffset || 0;
        plane.parent = layer.root;

        // 创建材质
        const material = new BABYLON.StandardMaterial(`mat_${elementConfig.id}`, this.scene);
        const texture = new BABYLON.Texture(elementConfig.texture, this.scene);

        // 设置 wrap 模式以支持 tile 重复
        texture.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE;
        texture.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
        texture.hasAlpha = true;

        material.diffuseTexture = texture;
        material.useAlphaFromDiffuseTexture = true;
        material.backFaceCulling = false;
        material.disableLighting = true;
        material.specularColor = new BABYLON.Color3(0, 0, 0);
        material.emissiveColor = new BABYLON.Color3(1, 1, 1);
        plane.material = material;

        // 设置渲染组（必须在 mesh 上，不是 material 上）
        plane.renderingGroupId = layer.config.renderingGroupId;

        // alphaIndex：同层内精细排序（数值大的在前）
        if (elementConfig.alphaIndex !== undefined) {
            plane.alphaIndex = elementConfig.alphaIndex;
        }

        // 计算 tile 重复次数
        const atlasW = atlasData.meta.size.w;
        const atlasH = atlasData.meta.size.h;
        const firstFrameKey = Object.keys(atlasData.frames)[0];
        const frameW = atlasData.frames[firstFrameKey].frame.w;
        const frameH = atlasData.frames[firstFrameKey].frame.h;

        // uScale/vScale 决定贴图在 Plane 上重复多少次
        const tileSizeW = elementConfig.tileSize?.width ?? (frameW * (elementConfig.pxToWorld || 0.03));
        const tileSizeH = elementConfig.tileSize?.height ?? (frameH * (elementConfig.pxToWorld || 0.03));

        texture.uScale = elementConfig.width / tileSizeW;
        texture.vScale = elementConfig.height / tileSizeH;

        // 创建动画组件
        const animator = new AnimatedTileComponent(atlasData, {
            loop: elementConfig.loop ?? true,
            frameDurationMs: elementConfig.frameDurationMs ?? null
        });

        // 应用初始帧的 UV 偏移
        this.#applyAnimatedTileFrame(texture, animator.currentFrame, atlasW, atlasH);

        if (elementConfig.flipX) {
            plane.rotation.y = Math.PI;
        }

        const element = {
            mesh: plane,
            config: elementConfig,
            originalX: elementConfig.x,
            animator: animator,
            texture: texture,
            atlasW: atlasW,
            atlasH: atlasH
        };

        layer.elements.push(element);
    }

    #applyAnimatedTileFrame(texture, frame, atlasW, atlasH) {
        // 水平排列的 spritesheet：每帧占 atlas 宽度的一部分
        texture.uOffset = frame.x / atlasW;
        // vOffset 保持 0（单排水平排列）
        texture.vOffset = 0;
    }

    /**
     * 更新视觉系统（每帧调用）
     * @param {number} dtMs - 时间增量（毫秒）
     * @param {Object} context - 上下文信息（包含相机）
     */
    update(dtMs, context) {
        if (!context.camera) return;

        // 获取相机锚点（UniversalCamera 使用 position.x 作为视差驱动）
        const cameraAnchorX = context.camera.position ? context.camera.position.x : 0;

        // 更新各层的视差偏移
        for (const [layerId, layer] of this.layers) {
            this._updateLayerParallax(layer, cameraAnchorX);
        }

        if (context.characterPositions) {
            this._updateMaskVisibility(context.characterPositions);
        }

        this._updateMaskDebugPanels();

        // 更新动画 tile 的帧
        for (const [layerId, layer] of this.layers) {
            for (const element of layer.elements) {
                if (element.animator) {
                    element.animator.update(dtMs);
                    this.#applyAnimatedTileFrame(
                        element.texture,
                        element.animator.currentFrame,
                        element.atlasW,
                        element.atlasH
                    );
                }
            }
        }
    }

    /**
     * 更新层的视差偏移
     * @param {Object} layer - 层对象
     * @param {number} cameraAnchorX - 相机锚点X坐标
     */
    _updateLayerParallax(layer, cameraAnchorX) {
        const parallaxFactor = layer.config.parallaxFactor;
        
        // 计算层偏移：layerOffsetX = cameraAnchorX * (1 - parallaxFactor)
        const layerOffsetX = cameraAnchorX * (1 - parallaxFactor);
        
        // 应用偏移到层根节点
        layer.root.position.x = layerOffsetX;

        // 处理循环层
        if (layer.config.loopX && layer.config.loopWidth) {
            this._handleLayerLooping(layer, cameraAnchorX);
        }
    }

    /**
     * 处理层的循环逻辑
     * @param {Object} layer - 层对象
     * @param {number} cameraAnchorX - 相机锚点X坐标
     */
    _handleLayerLooping(layer, cameraAnchorX) {
        const loopWidth = layer.config.loopWidth;
        const parallaxFactor = layer.config.parallaxFactor;
        
        // 计算当前元素相对于相机的位置
        const effectiveX = cameraAnchorX * (1 - parallaxFactor);
        
        // 检查是否需要循环
        // 这里先实现基础逻辑，后续可以根据需要扩展
        // 当前简单地将所有元素保持在可见范围内
        for (const element of layer.elements) {
            const worldX = element.originalX + effectiveX;
            
            // 简单的循环逻辑：当元素移出屏幕时，将其移动到另一侧
            if (worldX < -loopWidth / 2) {
                element.originalX += loopWidth;
            } else if (worldX > loopWidth / 2) {
                element.originalX -= loopWidth;
            }
        }
    }

    /**
     * 销毁系统，释放资源
     */
    dispose() {
        for (const [layerId, layer] of this.layers) {
            // 销毁所有网格
            for (const element of layer.elements) {
                element.mesh.dispose();
            }
            
            // 销毁根节点
            layer.root.dispose();
        }
        
        this.layers.clear();
        console.log('SceneVisualSystem disposed');
    }
}

/**
 * 默认环境配置（Phase A：最小可见层）
 * 包含BG_FAR、BG_MID、STAGE三层
 */
export const DEFAULT_ENVIRONMENT_CONFIG = {
    layers: [
        {
            id: "BG_FAR",
            z: 40,
            parallaxFactor: 0.15,
            renderingGroupId: 0,
            loopX: true,
            loopWidth: 40,
            elements: [
                {
                    id: "sky_1",
                    texture: "Art/Environment/skybase.png",
                    kind: "tile",
                    x: 0,
                    y: 8,
                    width: 48,
                    height: 32,
                    alphaIndex: 0
                },
                {
                    id: "mountain_1",
                    texture: "Art/Environment/Mountain.png",
                    kind: "tile",
                    x: 0,
                    y: 8,
                    width: 48,
                    height: 16,
                    parallaxFactor: 0.08,
                    alphaIndex: 1
                }
            ]
        },
        {
            id: "BG_MID", 
            z: 30,
            parallaxFactor: 0.45,
            renderingGroupId: 0,
            loopX: false,
            elements: [
                {
                    id: "building_1",
                    texture: "Art/Environment/House1.png",
                    kind: "single",
                    x: -5,
                    y: 2.7,
                    width: 6,
                    height: 6,
                    alphaIndex: 2
                },
                {
                    id: "building_2",
                    texture: "Art/Environment/House2.png",
                    kind: "single",
                    x: 4,
                    y: 4,
                    width: 16,
                    height: 8,
                    alphaIndex: 3
                },
                {
                    id: "tavern",
                    texture: "Art/Environment/Tavern.png",
                    kind: "single",
                    x: -12,
                    y: 5,
                    width: 16,
                    height: 10,
                    alphaIndex: 4
                },
                {
                    id: "treeline",
                    texture: "Art/Environment/treeline.png",
                    kind: "single",
                    x: 0,
                    y: 3.2,
                    width: 48,
                    height: 4.8,
                    alphaIndex: 1,
                    parallaxFactor: 1.6,
                }
            ]
        },
        {
            id: "STAGE",
            z: 10,
            parallaxFactor: 1.0,
            renderingGroupId: 1,
            loopX: true,
            loopWidth: 20,
            elements: [
                {
                    id: "ground_1",
                    texture: "Art/Environment/grassbase.png",
                    atlas: "Art/Environment/grassbase.json",
                    kind: "animated_tile",
                    x: 0,
                    y: -3.2,
                    width: 64,
                    height: 8,
                    tileSize: { width: 1.28, height: 1.28 },
                    loop: true,
                    alphaIndex: 1
                },
                {
                    id: "ground_2",
                    texture: "Art/Environment/grasstop.png",
                    atlas: "Art/Environment/grasstop.json",
                    kind: "animated_tile",
                    x: 0,
                    y: 0.9,
                    width: 64,
                    height: 0.32,
                    tileSize: { width: 1.28, height: 0.32 },
                    loop: true,
                    alphaIndex: 1
                }
            ]
        },
        {
            id: "FG_DECOR",
            z: -10,
            parallaxFactor: 1.35,
            renderingGroupId: 2,
            loopX: false,
            elements: [
                {
                    id: "fence_1",
                    texture: "Art/Environment/FG_Fence.png",
                    kind: "single",
                    x: 4,
                    y: -0.2,
                    width: 8,
                    height: 4,
                    alphaIndex: 0
                }
            ]
        }
    ]
};