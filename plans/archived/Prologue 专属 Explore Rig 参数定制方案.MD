# Prologue 专属 Explore Rig 参数定制方案

## 1. 背景与现状

- `prologue.json` 原 `camera.defaultRig` 是**死字段**，代码无任何读取点。真正决定 prologue 启动 rig 的是 `Scene.js:292` 的硬编码 `gameModeManager.start("explore")` + `ExploreMode.enter` 里的 `switchRig("explore")`。
- `exploreCameraRig` 是 **game 级单例**（`Game.js:96` 创建，`Game.js:128` 以 id `"explore"` 注册），各场景复用，**当前无场景级参数覆写**。
- 对照：`duelRig` 同为 game 级单例，但 `Scene.js:203-213` 已有 `Object.assign(cameraRig, {...duelCameraCfg})` 范式——不过 duel 的参数源在 `battleDef.duelCamera`（`Scene.js:173`），**不在 `sceneDef` 这层**。且 duel rig 的覆写是直接写 rig 实例的扁平字段（`zoomMinDistance` 等），explore rig 则覆写 `config` 子对象，两者字段组织不同，只是"Object.assign 场景级参数"的大模式对齐，非严格对称。
- scripted rig 无"场景级参数"，帧由 `setCameraFrame` clip 在 sequence 里就地设（`TimelineSequencer.js:747`）。

## 2. 目标

- 给 prologue 定制一套 explore rig 参数（跟随距离/高度/平滑度/正交宽度），用 JSON 声明。
- 通过 `prologue.json` 顶层 `exploreCamera` 字段读取并应用。
- **其他场景（outdoor_village / house_interior）行为不变**：未声明 `exploreCamera` 时回退到 `ExploreCameraRig` 默认 config。
- rig id `"explore"` 保持不变，不新增 rig，不牵连 `ExploreMode.enter` / `TimelineSequencer.cameraBlend` 分支 / `cameraBlend` clip 的 `to` 字段。

## 3. 非目标（本次不做）

- 启用 `defaultRig` 字段：当前唯一合理取值就是 `"explore"`（duel 无入口、scripted 需解 mode 耦合），写了等于没写；启用它需要解耦 `ExploreMode.enter` 的硬编码 `switchRig`，scope 上升，列为后续可选项。
- 暴露 `projection` 字段：游戏设定默认正交相机，不会配别的；透视相机仅供开发用，已有按键切换功能（`ExploreCameraRig.toggleProjection()`），不进 JSON。
- 给 scripted / duel 补场景级定制入口（前者无此需求，后者参数本就在 battleDef）。
- 参数 schema 校验：本次仅 `Object.assign`，传错字段名静默无效（与现有 `duelRig` 行为一致）。

## 4. 为什么平铺到顶层（不包 `camera` 壳，也不包 `rigOverrides`）

事实核对：场景级相机参数定制**实际只会有 explore 一个 rig**——

| rig | 会作为初始 rig？ | 会在 sceneDef 配参数？ |
|-----|----|----|
| duel | 否（无场景启动入口进 duel mode） | 否（参数在 battleDef.duelCamera） |
| scripted | 当前否；将来即便启用，帧也由 setCameraFrame clip 就地配 | 否 |
| explore | 是（恒） | **是（本方案唯一）** |

由此推出两层简化：

1. **不包 `rigOverrides` 一层**：给一个只会有一个值的 map 包 key 是多余的。
2. **不保留 `camera` 壳**：`camera` 壳当前只装了 `defaultRig` 一个死字段，删 defaultRig 后壳是空的，留着是噪音。`exploreCamera` 提到顶层与 `battleDef.duelCamera` 形成 scene/battle 两层对称（都是 `<scope>.<rigName>Camera`），命名风格一致。

真到某天要启用 `defaultRig`（场景初始用 scripted），顶层加个 `defaultRig` 字段和 `exploreCamera` 并存，结构也不丑。

## 5. 设计

### 5.1 JSON 结构扩展

`prologue.json` 顶层新增 `exploreCamera` 字段，删除原 `camera` 壳与 `defaultRig`：

```json
{
  "id": "prologue",
  "exploreCamera": {
    "followDistance": 17,
    "followHeight": 4.5,
    "smoothing": 0.12,
    "orthoWidth": 26
  },
  "transition": { ... },
  ...
}
```

字段对齐 `ExploreCameraRig` 的 `config`：

| 字段 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `followDistance` | number | 15 | 跟随距离（z 偏移） |
| `followHeight` | number | 3.2 | 跟随高度（y 偏移） |
| `smoothing` | number | 0.15 | 位置插值系数 |
| `orthoWidth` | number | 20 | 正交模式视口宽 |

（`projection` 不暴露，见 §3。）

### 5.2 ExploreCameraRig 改造

两处小改，默认值保证其他场景零行为变化：

1. **存默认 config 副本**（构造时）：
   ```js
   constructor(config = {}) {
       this.config = { followDistance: 15, followHeight: 3.2, smoothing: 0.15, orthoWidth: 20, ...config };
       this._defaultConfig = { ...this.config };   // 新增
       ...
   }
   ```

2. **加 `resetConfig()` 方法**（场景切换时恢复默认）：
   ```js
   resetConfig() {
       this.config = { ...this._defaultConfig };
   }
   ```

`enter()` **不改**：`this.projection = "orthographic"` 保持硬编码（游戏默认正交，开发用透视靠 `toggleProjection()` 按键切换，不进 JSON）。

### 5.3 Scene._loadSceneInternal 改造

在 `Scene.js:203-213` 的 duelRig `Object.assign` 段之后，加一段 explore rig 的参数应用（走 `config` 子对象，与 duel 的扁平字段覆写不同）：

```js
// --- explore rig 场景级参数（无声明则用默认）---
exploreCameraRig.resetConfig();
const exploreCfg = sceneDef.exploreCamera;
if (exploreCfg) {
    Object.assign(exploreCameraRig.config, exploreCfg);
}
```

**顺序**：先 `resetConfig()` 恢复默认，再按当前 sceneDef 覆写——保证从 prologue 切到 outdoor_village 时参数不泄漏。

### 5.4 生命周期与场景切换

| 时机 | 行为 |
|------|------|
| Game.bootstrap | `new ExploreCameraRig()` 用默认 config，注册 rig id `"explore"` |
| Scene 加载（含切换） | `resetConfig()` → 按 `sceneDef.exploreCamera` 覆写 |
| ExploreMode.enter | `switchRig("explore")` → 触发 `rig.enter()`（projection 硬编码正交） |
| cameraBlend clip `to:"explore"` | rig id 不变，TimelineSequencer 分支无需改动 |
| 场景 dispose | rig 是 game 级，不 dispose；下次 Scene 加载会 reset |

## 6. 不改的部分（显式列出，避免误改）

- rig id `"explore"`：保持不变。
- `ExploreMode.enter` 的 `switchRig("explore")`：不变。
- `ExploreCameraRig.enter` 的 `this.projection = "orthographic"`：不变。
- `TimelineSequencer.cameraBlend` 里 `toRigId === "explore"` 分支：不变。
- `prologue.json` 内 `enterBattleSequence` / `exitBattleSequence` 的 `cameraBlend` clip `to: "explore"`：不变。

## 7. 代码改动清单

| 文件 | 位置 | 改动 |
|------|------|------|
| `scripts/ExploreCameraRig.js` | 构造 / 新增方法 | 存 `_defaultConfig`、加 `resetConfig()`（`enter` 不动） |
| `scripts/Scene.js` | `_loadSceneInternal` ~L211 后 | 加 `exploreCameraRig.resetConfig()` + `Object.assign(exploreCameraRig.config, exploreCfg)` |
| `Data/SceneDefs/prologue.json` | 顶层 | 删 `camera` 壳与 `defaultRig`，加 `exploreCamera` 子对象 |

共 3 个文件，改动面与现有 `duelRig` 定制范式对称。

## 8. 验证方案

1. **参数生效**：prologue.json 配一组显著不同于默认的值（`followHeight: 4.5, orthoWidth: 26`），加载 prologue，观察相机高度/视口与默认 explore 明显不同。
2. **不泄漏**：从 prologue 走 `dev_to_outdoor` trigger 切到 outdoor_village，确认 outdoor_village 的 explore 相机回到默认参数（高度 3.2、视口宽 20）。
3. **透视切换不受影响**：prologue 加载后按开发用按键触发 `toggleProjection()`，确认正交↔透视切换仍正常工作。
4. **cameraBlend 衔接**：触发 prologue `enterBattleSequence`，确认 `cameraBlend to:"explore"`（exitBattleSequence 末段）仍能正常 blend 回 explore rig，无 rig id 报错。
5. **控制台**：无 `[CameraManager] unknown rig` / `[TimelineSequencer] cameraBlend: unknown rig` 警告。

## 9. 风险与边界

- **参数泄漏**：必须 `resetConfig()` 在前、`Object.assign` 在后；顺序反了会导致切场景残留。已在 §5.3 强调。
- **rig 实例共享**：`exploreCameraRig` 是 game 级单例，参数覆写对当前场景即时生效；不存在多场景并存问题（同一时刻只有一个 Scene 活跃）。
- **blend 期间投影**：`CameraManager._lerpState` 硬编码 `projection: "orthographic"`（`CameraManager.js:46`），与本次设计一致（explore 恒正交），无新风险。

## 10. 可选后续（不在本次 scope）

- 启用 `defaultRig`：需解耦 `ExploreMode.enter` 的硬编码 `switchRig`，并厘清 rig id 与 mode id 的语义差，单独出方案。
- 加参数 schema 校验 / 未知字段 warn。