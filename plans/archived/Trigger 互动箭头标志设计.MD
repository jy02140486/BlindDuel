# Trigger 互动箭头标志设计

## 0. 目标与范围

### 目标

当主人公走进「需要交互键触发」的 trigger 且 trigger 当前可交互时，在 trigger 边缘显示一个带帧动画的箭头标志，提示玩家"此处可互动"。

### 范围

- **默认启用类型**：仅 `sceneSwitch`（走入后需按交互键触发，存在"已进入但未触发"的窗口期）
- **不默认启用类型**：`battle` / `scriptedCamera`（overlap 即自动触发，无等待窗口）
- **可选启用**：任何 trigger 可通过 `arrow.enabled: true` 显式开启（如未来给 battle trigger 加"警告"箭头）

### 不在本期范围

- 箭头跟随玩家上下浮动（仅做帧动画，不做位置浮动）
- 多种箭头皮肤切换（只支持 `arrow.png` 一套资源）
- 屏幕空间 HUD 箭头（仅在 3D 世界空间渲染）

***

## 1. 资源说明

| 项目             | 值                                  |
| -------------- | ---------------------------------- |
| 图集 URL         | `Art/Sprite/UI/arrow.png`          |
| Atlas JSON URL | `Art/Sprite/UI/arrow.json`         |
| 总图尺寸           | 128 × 48 px                        |
| 单帧尺寸           | 32 × 48 px                         |
| 帧数             | 4                                  |
| 帧时长            | 250 ms / 帧（来自 atlas `duration` 字段） |
| 默认朝向           | **向上**（资源原始朝向，0° 旋转时箭头指向 +Y）       |
| 帧布局            | 水平排列：frame 0 在最左，frame 3 在最右       |

Atlas 中无 `frameTags`，4 帧按 0→1→2→3→0 循环播放即默认动画。

***

## 2. 设计概览

SceneDef.triggers\[].arrow (JSON 配置)
↓
Scene.init() 创建 AABBTrigger 时，读取 arrow 配置 → 调用 trigger.setupArrow(config)
↓
AABBTrigger 内部懒加载 ArrowIndicator 子组件（plane + material + texture）
↓
ExploreMode.fixedUpdate() 每帧调 #updateTriggerArrows(character)
↓ 对每个 arrow 配置的 trigger：
↓   - 触发条件 = trigger.\_enabled && !sequencerBusy && trigger.checkOverlap(character)
↓   - true → ArrowIndicator.show() + stepAnimationFrame(dtMs)
↓   - false → ArrowIndicator.hide()
↓
trigger.dispose() 时一并销毁 ArrowIndicator

### 模块职责

| 模块                                         | 职责                                                                        |
| ------------------------------------------ | ------------------------------------------------------------------------- |
| `AABBTrigger`                              | 持有 `ArrowIndicator` 实例；对外暴露 `setupArrow` / `updateArrow` / `disposeArrow` |
| `ArrowIndicator`（新类，位于 AABBTrigger.js 同文件） | 管理 plane + material + texture；帧动画步进；show/hide                             |
| `Scene.init`                               | 读 triggerDef.arrow 配置 → 调 `trigger.setupArrow(...)`；预加载 atlas JSON        |
| `ExploreMode.#updateTriggerArrows`（新方法）    | 每帧遍历带 arrow 的 trigger，根据 overlap + enabled + sequencerBusy 决定显隐           |

***

## 3. 数据结构

### 3.1 triggerDef.arrow 字段（SceneDef JSON）

```json
"arrow": {
    "enabled": true,           // 可选，默认 true（只要 "arrow" 键存在即视为启用）
    "edge": "bottom",          // "top" | "bottom" | "left" | "right"，默认 "bottom"
    "direction": "up",         // "up" | "down" | "left" | "right"，默认 "up"
    "offset": 0.3,             // 箭头与 trigger 边缘的间隙（世界单位），默认 0.3
    "scale": 1.0,              // 箭头缩放，默认 1.0（按 32×48 px → 世界单位的基准尺寸）
    "frameMs": 250             // 帧时长覆盖，默认读 atlas 的 duration 字段
}
```

### 3.2 默认配置（无 `arrow` 字段时）

不创建箭头（向后兼容，已有 trigger 无需改动）。

### 3.3 极简配置示例

```json
{
    "type": "sceneSwitch",
    "id": "dev_to_outdoor",
    "pos": [9, 0, 0],
    "size": [2, 2, 2],
    "targetScene": "outdoor_village",
    "targetSpawn": "house_door",
    "arrow": {}
}
```

空对象 `{}` 即采用全部默认值：下边缘 + 朝上 + offset 0.3 + scale 1.0 + 250ms/帧。

### 3.4 完整配置示例

```json
{
    "type": "sceneSwitch",
    "id": "door_to_main_hall",
    "pos": [9, 0, 0],
    "size": [2, 2, 2],
    "targetScene": "main_hall",
    "targetSpawn": "entrance",
    "arrow": {
        "edge": "right",
        "direction": "right",
        "offset": 0.4,
        "scale": 1.2,
        "frameMs": 200
    }
}
```

箭头在 trigger 右边缘、朝右指、间隙 0.4、放大 1.2 倍、200ms/帧。

***

## 4. 位置与朝向计算

### 4.1 基准点

箭头 plane 的 position 直接写在 trigger 局部（不挂 parent，因为 trigger 的 collisionBox / debugMesh 也是直接 position.copyFrom）。Z 用 trigger 的 z 值。

### 4.2 边缘锚点公式

设 trigger 中心 `(cx, cy, cz)`，size `{width=W, height=H, depth=D}`，offset `o`：

| edge     | 箭头中心位置                   |
| -------- | ------------------------ |
| `bottom` | `(cx, cy - H/2 - o, cz)` |
| `top`    | `(cx, cy + H/2 + o, cz)` |
| `left`   | `(cx - W/2 - o, cy, cz)` |
| `right`  | `(cx + W/2 + o, cy, cz)` |

### 4.3 方向 → 旋转角（绕 Z 轴）

资源默认朝向 = up（+Y），所以 rotation.z = 0 即朝上。

| direction | rotation.z（弧度） |
| --------- | -------------- |
| `up`      | `0`            |
| `right`   | `-Math.PI / 2` |
| `down`    | `Math.PI`      |
| `left`    | `Math.PI / 2`  |

> **注**：Babylon 左手系，绕 +Z 旋转方向需在实施时实测验证（可能正负号相反）。MD 给出的是数学约定，实施时若发现镜像，直接翻转符号即可。资源默认朝向以实测为准。

### 4.4 plane 尺寸

- 像素 → 世界单位：采用约定 `1 世界单位 = 32 px`（与现有 sprite 资源惯例一致；可调）
- 默认箭头尺寸：宽 32px = 1.0 世界单位，高 48px = 1.5 世界单位
- `scale` 字段对 plane 整体缩放

***

## 5. 渲染方案

复用 [PropEntity.js](file:///e:/se/BlindDuel/scripts/Enties/PropEntity.js#L80-L115) 已验证的 plane + StandardMaterial + Texture 模式：

```javascript
// 伪代码（ArrowIndicator 构造）
this.plane = BABYLON.MeshBuilder.CreatePlane(`${id}_arrow`, { width, height }, scene);
this.plane.position.copyFrom(computedPosition);
this.plane.rotation.z = computedRotation;

this.material = new BABYLON.StandardMaterial(`${id}_arrow_mat`, scene);
this.material.emissiveColor = new BABYLON.Color3(1, 1, 1);
this.material.backFaceCulling = false;
this.material.useAlphaFromDiffuseTexture = true;
this.material.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
this.material.disableLighting = true;
this.material.disableDepthWrite = true;
this.plane.material = this.material;
this.plane.renderingGroupId = 3;   // 与 trigger debugMesh 一致，PROJECT_CONTEXT §6.11
this.plane.alphaIndex = 100;       // 触发器内部排序，高于场景元素
this.plane.setEnabled(false);      // 默认隐藏，由 update 显隐

const tex = new BABYLON.Texture(arrowAtlasUrl, scene, false, false, BABYLON.Texture.NEAREST_SAMPLINGMODE);
tex.hasAlpha = true;
tex.wrapU = BABYLON.Texture.CLAMP_ADDRESSMODE;
tex.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
this.material.diffuseTexture = tex;

// 水平 4 帧布局 → uScale = 1/4，uOffset = frameIndex / 4
tex.uScale = 1 / 4;
```

### 帧切换

```javascript
// stepAnimationFrame(dtMs)
this._accumMs += dtMs;
if (this._accumMs >= this._frameMs) {
    this._accumMs -= this._frameMs;
    this._frameIndex = (this._frameIndex + 1) % 4;
    this.material.diffuseTexture.uOffset = this._frameIndex / 4;
}
```

***

## 6. 显隐判定（ExploreMode 集成）

### 6.1 新增方法 `ExploreMode.#updateTriggerArrows(character)`

在 `fixedUpdate` 内、`#updateSceneSwitchTrigger` 之后调用：

```javascript
#updateTriggerArrows(character) {
    const { sceneDef, scene } = this.context;
    if (!sceneDef?.triggers || !scene?.triggers) return;

    const sequencerBusy = this.context.sceneSequencer?.isBusy() ?? false;

    for (const triggerDef of sceneDef.triggers) {
        if (!triggerDef.arrow) continue;
        const trigger = scene.triggers.get(triggerDef.id);
        if (!trigger?.updateArrow) continue;

        const visible = !sequencerBusy
            && trigger._enabled
            && trigger.checkOverlap(character);

        trigger.updateArrow(visible, this._lastDtMs ?? 16);
    }
}
```

### 6.2 显隐规则

| 条件                                       | 箭头状态      |
| ---------------------------------------- | --------- |
| sequencer 播放中（intro/outro/cutscene）      | 隐藏        |
| trigger 被 condition 禁用（如 flagNot 不满足）    | 隐藏        |
| 玩家不在 trigger 内                           | 隐藏        |
| 玩家在 trigger 内 + trigger 启用 + 非 sequencer | 显示 + 步进动画 |

### 6.3 sequencer 门控理由

- sequencer 期间 ExploreMode 跳过 trigger 检查（[ExploreMode.js#L32-33](file:///e:/se/BlindDuel/scripts/Systems/Modes/ExploreMode.js#L32)），避免 cutscene 中误触场景切换
- 箭头若在 cutscene 中亮起会破坏演出，所以同步门控

***

## 7. AABBTrigger 扩展接口

### 7.1 新增字段

```javascript
this._arrow = null;   // ArrowIndicator 实例，懒加载
```

### 7.2 新增方法

```javascript
setupArrow(config) {
    // config = { edge, direction, offset, scale, frameMs, atlasUrl, atlasData, scene }
    // 创建 ArrowIndicator，计算 position + rotation，预加载纹理
    this._arrow = new ArrowIndicator(this.scene, this.position, this.size, config);
}

updateArrow(visible, dtMs) {
    if (!this._arrow) return;
    this._arrow.setVisible(visible);
    if (visible) this._arrow.stepFrame(dtMs);
}

disposeArrow() {
    this._arrow?.dispose();
    this._arrow = null;
}
```

### 7.3 既有方法影响

- `setEnabled(false)`：不直接隐藏箭头（ExploreMode 会通过 updateArrow 自然隐藏，因为 checkOverlap 仍可能 true 但 \_enabled=false → visible=false）
- `setDebugVisible()`：保持独立，不影响箭头
- `dispose()`：末尾追加 `this.disposeArrow()`

***

## 8. Scene 集成

### 8.1 atlas 预加载

`Scene.init` 在创建 trigger 前，预加载 `Art/Sprite/UI/arrow.json`（fetch + JSON.parse），把 atlasData 缓存到 `this._arrowAtlasData`，供所有 trigger 共享。

### 8.2 trigger 创建循环扩展

[Scene.js#L102-114](file:///e:/se/BlindDuel/scripts/Scene.js#L102) 现有：

```javascript
for (const triggerDef of sceneDef.triggers) {
    const trigger = new AABBTrigger(scene, pos, size, { name, debugColor, debugVisible });
    this.triggers.set(triggerDef.id, trigger);
}
```

扩展为：

```javascript
for (const triggerDef of sceneDef.triggers) {
    const trigger = new AABBTrigger(scene, pos, size, { name, debugColor, debugVisible });
    if (triggerDef.arrow && this._arrowAtlasData) {
        trigger.setupArrow({
            ...triggerDef.arrow,
            atlasUrl: "Art/Sprite/UI/arrow.png",
            atlasData: this._arrowAtlasData,
            scene,
        });
    }
    this.triggers.set(triggerDef.id, trigger);
}
```

### 8.3 资源清单

[AssetManifest.js](file:///e:/se/BlindDuel/scripts/AssetManifest.js) 加入 `Art/Sprite/UI/arrow.png` + `Art/Sprite/UI/arrow.json`，确保打包/预加载覆盖（若有预加载机制）。

***

## 9. 实施步骤

| Step | 内容                                                                                                    | 验证                                                                                         |
| ---- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1    | `AABBTrigger.js` 内新增 `ArrowIndicator` 类 + `setupArrow/updateArrow/disposeArrow` 方法 + `dispose()` 追加清理 | 单元：构造 ArrowIndicator 不报错；setVisible(false) 后 plane.isEnabled === false                     |
| 2    | `Scene.init` 预加载 arrow\.json + 扩展 trigger 创建循环                                                        | 启动 prologue 无报错；带 arrow 配置的 trigger 创建后 `_arrow` 非空                                        |
| 3    | `ExploreMode.fixedUpdate` 加 `#updateTriggerArrows` 调用                                                 | 走进带 arrow 的 sceneSwitch trigger → 箭头出现 + 4 帧循环；走出 → 消失                                     |
| 4    | `prologue.json` 给 `dev_to_outdoor` 加 `"arrow": {}` 默认配置                                               | 实测：下边缘 + 朝上 + 帧动画正常                                                                        |
| 5    | 测试 edge/direction 四种组合                                                                                | 实测四种边缘 + 四种方向均位置正确、朝向正确                                                                    |
| 6    | 测试 sequencer 期间门控                                                                                     | 播 prologue\_intro 期间走到 trigger 边缘 → 箭头不显示                                                  |
| 7    | 测试 condition 禁用                                                                                       | `bt_prologue` 在 `prologue_battle` flag 置位后 trigger.setEnabled(false) → 箭头不显示（即便玩家 overlap） |

***

## 10. 已知限制与未来扩展

### 10.1 当前限制

1. 箭头只支持 `arrow.png` 一套资源（硬编码 URL）；多套资源需扩展为 `arrow.atlasKey` 字段
2. 帧动画仅"4 帧顺序循环"，不支持 tag 切换（atlas 也无 frameTags）
3. 位置不浮动（不做 Y 轴 sin 浮动效果），仅帧动画
4. 旋转方向依赖实测（Babylon 左手系 Z 旋转符号需 Step 4 实测确认）
5. 箭头不参与 y-sort（renderingGroupId = 3 固定在最上层），不会与角色前后关系正确；如未来需要"角色挡住箭头"效果，需降 renderingGroupId 并接入 y-sort

### 10.2 未来扩展点

- 箭头皮肤切换：`arrow.skin: "default" | "warning" | "quest"`，按 skin 选 atlas
- 箭头浮动：`arrow.bob: { amplitude: 0.1, periodMs: 800 }`，在 Y 上加 sin 偏移
- 屏幕空间 HUD 箭头（off-screen trigger 提示）
- 箭头触发条件自定义：`arrow.showWhen: "overlap" | "nearby" | "always"`

***

## 11. 风险与回退

### 风险

- atlas JSON 加载失败 → setupArrow 跳过，trigger 仍可用（降级为无箭头）
- ArrowIndicator 创建失败（纹理加载失败）→ catch + warn，trigger 不受影响

### 回退

- 删除 triggerDef.arrow 字段即可禁用，无需改代码
- AABBTrigger 在 `_arrow === null` 时所有 arrow 方法早退，对现有逻辑零影响

***

## 12. 文件改动清单

| 文件                                     | 改动                                               |
| -------------------------------------- | ------------------------------------------------ |
| `scripts/Enties/AABBTrigger.js`        | 新增 `ArrowIndicator` 类 + 3 个方法 + dispose 追加清理     |
| `scripts/Scene.js`                     | 预加载 arrow\.json + 扩展 trigger 创建循环                |
| `scripts/Systems/Modes/ExploreMode.js` | 新增 `#updateTriggerArrows` 方法 + fixedUpdate 调用    |
| `scripts/AssetManifest.js`             | 注册 arrow\.png + arrow\.json（若 manifest 覆盖 UI 资源） |
| `Data/SceneDefs/prologue.json`         | `dev_to_outdoor` 加 `"arrow": {}` 作为首个用例          |

改动总量预估：\~150 行新增代码，0 行删除既有代码。
