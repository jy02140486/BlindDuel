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
            z: 50,
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
            renderingGroupId: 1,
            loopX: false,
            elements: [
                {
                    id: "building_1",
                    texture: "Art/Environment/House1.png",
                    kind: "single",
                    x: -5,
                    y: 3,
                    width: 6,
                    height: 6,
                    alphaIndex: 0
                },
                {
                    id: "building_2",
                    texture: "Art/Environment/House2.png",
                    kind: "single",
                    x: 4,
                    y: 4,
                    width: 16,
                    height: 8,
                    alphaIndex: 1
                }
            ]
        },
        {
            id: "STAGE",
            z: 0,
            parallaxFactor: 1.0,
            renderingGroupId: 2,
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
                    loop: true
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
                    loop: true
                }
            ]
        }
    ]
};