# Character + Animation + Collision（Babylon）实现方案

## 目标
在场景中创建一个 `Character` 对象：
1. 使用 `Art/Sprite` 下的 spritesheet 播放动画（按每帧 `duration` 推进）。
2. 使用 `Data/CollisionMask` 下对应的碰撞数据生成若干碰撞组件。
3. 动画循环播放时，碰撞组件随帧实时更新。
4. 碰撞组件先用最简单的 `diffuse` 可视化，便于检查位置和更新是否正确。

## 资源约定
1. 动画资源：
- 图片：`E:\se\GemeniPrototype-BlindBattle\Art\Sprite\<name>.png`
- 帧数据 JSON：`E:\se\GemeniPrototype-BlindBattle\Art\Sprite\<name>.json`

2. 碰撞资源：
- 图片：`E:\se\GemeniPrototype-BlindBattle\Data\CollisionMask\<name>.png`
- 图集 JSON：`E:\se\GemeniPrototype-BlindBattle\Data\CollisionMask\<name>.json`
- 扫描输出：`E:\se\GemeniPrototype-BlindBattle\Data\CollisionMask\<name>.collider.json`

3. 命名规则：
- 同一角色动画集统一 `<name>`，方便自动配对。
- `.collider.json` 的 `frames[].frameIndex` 与动画帧索引一一对应。

## 类结构（建议）

### 1) `FrameAnimationComponent`
职责：
1. 读取 spritesheet + atlas json。
2. 维护当前帧、累计时间、循环播放。
3. 对外提供 `currentFrameIndex`。

核心字段：
- `frames: Array<{x,y,w,h,durationMs}>`
- `currentFrameIndex: number`
- `timeInFrameMs: number`
- `loop: boolean = true`

核心方法：
- `update(dtMs)`：按 `durationMs` 推进帧。

### 2) `CollisionComponent`
职责：
1. 读取 `.collider.json` 并解析碰撞盒数据。
2. 为每个 `id` 创建并维护一个 `Mesh`（碰撞盒可视化）。
3. 根据当前帧索引更新碰撞盒位置、尺寸、旋转。

核心字段：
- `colliderData: Object`（解析后的 `.collider.json`）
- `collisionMeshes: Map<string, Mesh>`
- `visible: boolean = true`

核心方法：
- `syncToFrame(frameIndex, frameWidth, frameHeight, anchor)`
- `setVisible(visible)`

### 3) `Character`
职责：
1. 组合 `FrameAnimationComponent` + `CollisionComponent`。
2. 管理动画播放、碰撞更新、状态切换。

核心字段：
- `animation: FrameAnimationComponent`
- `collision: CollisionComponent`
- `root: TransformNode`（角色根节点）
- `spritePlane: Mesh`（精灵平面）

核心方法：
- `update(dtMs)`：驱动动画和碰撞更新。
- `play(clipName)`：切换动画。

## 碰撞盒生成规则（Babylon）
1. 以帧左上角为图像原点：
- `mesh.position.x = (cx - frameWidth/2) * pxToWorld`
- `mesh.position.y = (frameHeight/2 - cy) * pxToWorld`
2. 尺寸：
- `mesh.scaling.x = w * pxToWorld`
- `mesh.scaling.y = h * pxToWorld`
3. 厚度：
- `mesh.scaling.z = 40 * pxToWorld`（或直接 `depth=40`，二选一并全局统一）
4. 旋转：
- `mesh.rotation.z = -angle * Math.PI / 180`

备注：若后续接入真正物理碰撞，可再把这些 mesh 或其数据接到 Physics 插件；当前阶段以"可视化正确"为第一目标。

## 播放流程（运行时）
1. 加载角色资源（sprite atlas + collider json）。
2. `new Character(...)`，并在场景注册到 update loop。
3. 每帧：
- 读取 `engine.getDeltaTime()`
- `character.update(dtMs)`
4. Character 创建后立即播放，默认循环。

## 最小可视化规范
1. `hitbox`: 黄色 `diffuseColor(1,1,0)`，`alpha=0.35`
2. `weaponbox`: 红色 `diffuseColor(1,0.3,0.3)`，`alpha=0.35`
3. `pushbox`: 蓝色 `diffuseColor(0,0.6,1)`，`alpha=0.35`

即使当前只有 `hitbox`，也按这套结构预留，避免后续返工。

## 验收标准
1. 场景里出现 1 个 `Character`，sprite 自动循环。
2. 每帧碰撞盒数量与 `.collider.json` 一致。
3. 旋转矩形角度与画稿一致。
4. 当某个 `id` 在中间帧缺失时：该盒子隐藏；再次出现时复用同一 mesh。
5. 可通过开关显示/隐藏碰撞层。

## 下一步实现顺序（建议）
1. 新建 `Character.js`、`FrameAnimationComponent.js`、`CollisionComponent.js`。
2. 先让动画跑起来（不带碰撞）。
3. 接入 `.collider.json` 并显示静态 frame 0。
4. 绑定到帧推进，实现碰撞随动画更新。
5. 加一个 debug UI 开关（`showCollision`）。