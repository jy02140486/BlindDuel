# Sequence Camera 与 Facing Policy 方案

> 目标：解决序列演出期间相机只能依赖现有 rig、角色镜像行为被 GameMode 隐式控制的问题。
> 当前建议：优先新增 `ScriptedCameraRig` 与角色级 `FacingPolicy`，暂不新增 `CutSceneMode`。

---

## 1. 当前问题

### 1.1 序列相机缺少独立控制源

当前相机系统已经拆成：

- `CameraManager`：统一持有 Babylon Camera，负责 rig 切换、blend、最终写入相机。
- `DuelCameraRig`：根据战斗双方位置计算相机。
- `ExploreCameraRig`：根据探索目标位置跟随主角。
- `SceneSequencer`：通过 `startCameraBlend` / `switchCamera` 调用相机系统。

问题在于：`SceneSequencer` 目前只能让相机切到已有 rig，或者 blend 到已有 rig 临时算出的状态。

这意味着过场序列无法直接表达：

- 看向一个固定场景点。
- 从 A 机位推到 B 机位。
- 暂时脱离主角和敌人的位置关系。
- 用一个演出专用 rig 控制相机运动。

目前能做到的是“从探索相机过渡到战斗相机”或反向，但不能做到真正的 sequence-authored camera。

### 1.2 角色镜像行为被 GameMode 隐式控制

当前主角是否根据移动方向镜像，主要由 `character.allowFacing` 控制：

- `ExploreMode.enter()` 设置 `allowFacing = true`。
- `ExploreMode.exit()` 设置 `allowFacing = false`。
- `CharacterBase._applyMovement()` 根据 `moveIntent.x` 和 `allowFacing` 更新 `facing`。

这个设计在普通探索和普通战斗里能工作，但在 sequence 里会出现边界问题。

进入战斗时，我们通常希望最后一步才切到 `battle` mode，所以进入战斗 sequence 实际上大部分时间跑在 `explore` mode。

退出战斗时，我们也通常希望 sequence 结束前仍保留 `battle` mode，所以退出战斗 sequence 实际上大部分时间跑在 `battle` mode。

于是会出现不一致：

- 进入战斗 sequence 中，角色仍处于探索镜像规则。
- 退出战斗 sequence 中，角色仍处于战斗镜像规则。
- 如果退出战斗 sequence 里要求主角向左移动，`allowFacing = false` 会导致主角不转身，看起来像后退。

本质问题是：角色表现策略不应该完全跟随 GameMode。Sequence 需要临时接管角色朝向。

---

## 2. 是否需要新增 CutSceneMode / SequenceMode

短期不建议优先新增。

`GameMode` 现在承担的是整套玩法更新规则：

- 输入如何处理。
- 探索碰撞是否启用。
- NPC 是否更新。
- 战斗 AI 是否更新。
- pushbox / stage boundary / combat resolver 是否运行。
- 当前相机 rig 默认切到谁。

而这两个问题的核心不是“需要第三套玩法更新规则”，而是：

- 相机需要一个 sequence-authored rig。
- 角色朝向需要从 mode 中解耦。

如果现在新增 `CutSceneMode`，它很容易变成一个半探索、半战斗、半演出的混合模式：

- 有些过场需要探索碰撞。
- 有些过场需要战斗角色继续播放状态机。
- 有些过场需要敌人冻结。
- 有些过场需要 NPC 继续 idle。
- 有些过场只想接管相机。

这会让 `CutSceneMode` 很快膨胀。

更稳的做法是：先让 `SceneSequencer` 获得必要的局部控制能力。只有当 sequence 真的需要系统性接管整套 update pipeline 时，再考虑新增 `SequenceMode`。

---

## 3. 推荐方案 A：新增 ScriptedOrthoCameraRig

### 3.1 设计目标

新增一个专门给序列使用的正交相机 rig：

```js
cameraManager.registerRig("scripted", scriptedCameraRig);
```

它不根据主角或敌人自动计算位置，而是持有一份可由 `SceneSequencer` 设置的标准正交 camera state。

它的职责是：

- 保存当前演出相机状态。
- 在 `compute()` 中返回这份状态。
- 支持直接设置镜头中心、高度和可视范围。
- 支持从当前 `CameraManager.state` 进入，避免切换时跳变。

重要约束：

- 游戏标准镜头是正交镜头。
- 透视镜头只作为 dev/debug 功能，不作为 sequence 方案的默认能力。
- 相机旋转不参与 sequence 控制。
- 相机始终保持平视，与 z 轴方向平行。
- sequence 主要调整的是位置、高度、可视范围，而不是自由 look-at 或任意旋转。

### 3.2 Sequence 相机参数

sequence 不需要直接暴露完整 camera pose，建议暴露更贴近游戏镜头语义的参数：

```js
{
    center: BABYLON.Vector3, // 屏幕中心对应的世界点
    height: 4.2,             // 相机 y 高度
    zOffset: -25,            // 固定或少量可调的 z 偏移
    orthoWidth: 18           // 可视范围宽度
}
```

`ScriptedCameraRig` 内部再把它转换成当前 `CameraManager` 使用的 state：

```js
{
    pos: new BABYLON.Vector3(center.x, height, center.z + zOffset),
    target: new BABYLON.Vector3(center.x, center.y, center.z),
    projection: "orthographic",
    orthoLeft: -orthoWidth / 2,
    orthoRight: orthoWidth / 2,
    orthoTop: orthoWidth / aspect / 2,
    orthoBottom: -orthoWidth / aspect / 2
}
```

> **注意**：`aspect` 必须使用 `window.innerWidth / window.innerHeight`，与 `DuelCameraRig` / `ExploreCameraRig` 保持一致。`CameraManager.state.aspect`（基于 `canvas.width / canvas.height`）可能因 `devicePixelRatio` 导致与 CSS 像素比例不一致，若直接复用会产生正交畸变。

这里的 `target` 只是为了复用 state 结构和 debug 信息，不表示相机会自由旋转到任意 look-at。Babylon 相机当前代码也没有调用 `setTarget()`，实际控制重点仍是位置和正交范围。

### 3.3 Blend 约束

`CameraManager._lerpState()` 在 blend 过程中固定 `projection: "orthographic"`，不处理 projection 类型切换。游戏标准镜头始终正交，透视仅作为 dev/debug 功能，不参与 sequence blend。

```js
function _lerpState(a, b, t) {
    return {
        pos: BABYLON.Vector3.Lerp(a.pos, b.pos, t),
        target: BABYLON.Vector3.Lerp(a.target, b.target, t),
        projection: "orthographic",
        orthoLeft: a.orthoLeft + (b.orthoLeft - a.orthoLeft) * t,
        orthoRight: a.orthoRight + (b.orthoRight - a.orthoRight) * t,
        orthoTop: a.orthoTop + (b.orthoTop - a.orthoTop) * t,
        orthoBottom: a.orthoBottom + (b.orthoBottom - a.orthoBottom) * t,
        fov: b.fov,
        aspect: a.aspect + (b.aspect - a.aspect) * t
    };
}
```

### 3.4 建议 API

最小 API：

```js
scriptedCameraRig.setFrame({
    center: new BABYLON.Vector3(x, y, z),
    height: 4.2,
    orthoWidth: 18,
    zOffset: -25
});
```

可选 API：

```js
scriptedCameraRig.setOrthoWidth(18);
scriptedCameraRig.setCenter(new BABYLON.Vector3(x, y, z));
scriptedCameraRig.setHeight(4.2);
```

如果之后需要在 scripted rig 内部自己做移动，再加：

```js
scriptedCameraRig.moveToFrame({
    center,
    height,
    orthoWidth,
    durationMs: 1200
});
```

初期可以不做 `moveToFrame()`，只依赖 `CameraManager.startBlend({ toRigId: "scripted" })` 完成进入 scripted rig 的过渡。

### 3.5 Sequencer Step 扩展

建议新增 step：

```js
{ type: "setCameraFrame", cameraId: "scripted", center: [0, 0, 0], height: 4.2, orthoWidth: 18 }
{ type: "startCameraBlend", to: "scripted", durationMs: 1200 }
{ type: "switchCamera", cameraId: "scripted" }
```

第一阶段建议只做 `setCameraFrame`，不要做 `lookAtPoint`，避免把 sequence 相机误导成自由旋转摄影机。

### 3.6 使用示例

进入战斗前先切到固定战场画幅：

```js
{
    id: "enter_battle",
    steps: [
        { type: "lockInput", actorId: "hero" },
        { type: "moveActorTo", actorId: "hero", x: -3.2, y: 0, tolerance: 0.1 },
        {
            type: "setCameraFrame",
            cameraId: "scripted",
            center: [-3.0, 0.0, 0.0],
            height: 4.2,
            orthoWidth: 18
        },
        { type: "startCameraBlend", to: "scripted", durationMs: 900 },
        { type: "sendCommand", actorId: "hero", command: "draw" },
        { type: "waitUntil", condition: (ctx) => ctx.character.currentStateName === "idle" },
        { type: "startCameraBlend", to: "duel", durationMs: 1800 },
        { type: "switchMode", modeId: "battle" },
        { type: "unlockInput", actorId: "hero" }
    ]
}
```

---

## 4. 推荐方案 B：新增角色 FacingPolicy

### 4.1 设计目标

角色是否根据移动方向自动镜像，应该由角色自己的表现策略决定，而不是完全绑在 `ExploreMode` / `BattleMode` 上。

建议把当前布尔值：

```js
character.allowFacing = true / false;
```

替换成更明确的枚举模式。不要在各处散写裸字符串，统一定义 `FACING_MODE`：

```js
export const FACING_MODE = Object.freeze({
    AUTO_FROM_MOVE: "autoFromMove",
    LOCKED: "locked",
    SCRIPTED: "scripted"
});
```

角色内部只保存枚举值：

```js
character.facingMode = FACING_MODE.LOCKED;
```

含义：

- `FACING_MODE.AUTO_FROM_MOVE`：根据移动输入自动镜像，典型场景为探索模式下的主角。
- `FACING_MODE.LOCKED`：不根据移动输入改镜像。探索模式下的 NPC 默认即为此模式；战斗模式下所有角色均为此模式。
- `FACING_MODE.SCRIPTED`：由 sequencer 或程序显式设置镜像，适合过场。

`LOCKED` 和 `SCRIPTED` 在第一版代码里的运动行为可以相同：都不会根据 `moveIntent` 自动改朝向。保留两个枚举值是为了表达所有权差异：

- `LOCKED` 表示战斗或系统规则锁住朝向。
- `SCRIPTED` 表示 sequence 正在临时接管朝向。

### 4.2 CharacterBase 建议 API

> **关于 `facing` 的语义**：`facing` 仅表达精灵是否镜像（`spritePlane.scaling.x` 的正负），不表达绝对方向。
> 实际画面上人物朝左还是朝右，由 spritesheet 原始绘制方向决定：部分角色的 spritesheet 原始朝向为右，部分为左。
> `facing = 1` 表示使用 spritesheet 原始方向（不镜像），`facing = -1` 表示水平镜像。

```js
setFacingMode(mode) {
    if (!Object.values(FACING_MODE).includes(mode)) {
        console.warn(`[CharacterBase] unknown facing mode: ${mode}`);
        return;
    }
    this.facingMode = mode;
}

setFacing(facing) {
    const nextFacing = facing >= 0 ? 1 : -1;
    if (nextFacing === this.facing) return;
    this.facing = nextFacing;
    this._syncSpriteFacing();
}
```

`_applyMovement()` 中的判断从：

```js
if (this.allowFacing && Math.abs(nx) > 0.1) {
    ...
}
```

改为：

```js
if (this.facingMode === FACING_MODE.AUTO_FROM_MOVE && Math.abs(nx) > 0.1) {
    this.setFacing(nx > 0 ? 1 : -1);
}
```

这样 sequence 可以在不切 mode 的情况下明确控制角色朝向。

### 4.3 Sequencer Step 扩展

建议新增：

```js
{ type: "setActorFacingMode", actorId: "hero", mode: FACING_MODE.SCRIPTED }
{ type: "setActorFacing", actorId: "hero", facing: -1 }
{ type: "setActorFacingMode", actorId: "hero", mode: FACING_MODE.AUTO_FROM_MOVE }
```

如果后续 sequence 外部 JSON 化，JSON 中仍然只能存字符串值，例如 `"scripted"`。加载阶段再转换或校验为 `FACING_MODE.SCRIPTED` 对应的值。代码层面上 step 定义统一使用 `FACING_MODE` 常量，外部化适配留待后续处理。

同时修正现有 `setActorFacing` 的实现。

当前 `SceneSequencer._setActorFacing()` 直接改的是：

```js
actor.root.scaling.x = ...
```

但当前角色真正的精灵镜像发生在 `CharacterBase` 的 `spritePlane.scaling.x` 与 `facing` 上。直接改 `root.scaling.x` 容易绕开角色内部状态，也可能影响碰撞、debug、子节点坐标。

所以 `setActorFacing` 应该调用角色 API：

```js
actor.setFacing(step.facing);
```

### 4.4 使用示例

退出战斗时，让主角向左走且显示为向左：

```js
{
    id: "exit_battle",
    steps: [
        { type: "lockInput", actorId: "hero" },
        { type: "wait", durationMs: 1500 },
        { type: "sendCommand", actorId: "hero", command: "sheath" },
        { type: "wait", durationMs: 1500 },
        { type: "setActorFacingMode", actorId: "hero", mode: FACING_MODE.SCRIPTED },
        { type: "setActorFacing", actorId: "hero", facing: -1 },
        { type: "moveActorTo", actorId: "hero", x: -6.4, y: 0, tolerance: 0.1 },
        { type: "startCameraBlend", to: "explore", durationMs: 2000 },
        { type: "switchMode", modeId: "explore" },
        { type: "setActorFacingMode", actorId: "hero", mode: FACING_MODE.AUTO_FROM_MOVE },
        { type: "unlockInput", actorId: "hero" }
    ]
}
```

---

## 5. 推荐落地顺序

### Phase 1：FacingPolicy 最小修复

目标：先修复退出战斗 sequence 中主角向左走不镜像的问题。

改动：

1. `CharacterBase`
   - 增加 `FACING_MODE` 枚举。
   - 增加 `facingMode`，默认 `FACING_MODE.LOCKED`。
   - 增加 `setFacingMode(mode)`。
   - 增加 `setFacing(facing)`。
   - `_applyMovement()` 改用 `facingMode === FACING_MODE.AUTO_FROM_MOVE`。

2. `ExploreMode`
   - `enter()` 中对主角设置 `character.setFacingMode(FACING_MODE.AUTO_FROM_MOVE)`；NPC 保持默认的 `FACING_MODE.LOCKED`，不额外设置。
   - `exit()` 中对主角设置 `character.setFacingMode(FACING_MODE.LOCKED)`。

3. `SceneSequencer`
   - 新增 `setActorFacingMode` step。
   - 修正 `setActorFacing`，改为调用 `actor.setFacing()`。

验证：

- 探索模式主角左右移动正常镜像，NPC 保持不镜像。
- 战斗模式所有角色左右移动均不自动改镜像。
- 退出战斗 sequence 中主角向左移动时能正常镜像到左。

### Phase 2：ScriptedCameraRig 最小能力

目标：让 sequence 能控制一个固定正交画幅。

当前架构基础：

- `Scene.js` 会创建 `sharedContext`。
- `CameraManager`、`BattleMode`、`ExploreMode`、`SceneSequencer` 都拿到同一个 `sharedContext` 引用。
- `SceneSequencer` 构造函数已经保存了 `this.context = context`。
- 所以 `sharedContext.scriptedCameraRig = this.scriptedCameraRig` 不需要额外改造 sequencer 的持有方式，sequencer 已经可以通过 `this.context.scriptedCameraRig` 访问。

改动：

1. 新增 `scripts/ScriptedCameraRig.js`。
   - 默认输出 `projection: "orthographic"`。
   - 不暴露旋转控制。
   - 不暴露透视参数作为 sequence 常规能力。
   - 使用 `center / height / zOffset / orthoWidth` 生成 camera state。
2. `Scene.js` 中创建并注册：

```js
this.scriptedCameraRig = new ScriptedCameraRig();
this.cameraManager.registerRig("scripted", this.scriptedCameraRig);
sharedContext.scriptedCameraRig = this.scriptedCameraRig;
```

3. `SceneSequencer` 增加 `setCameraFrame` step。
4. `_startCameraBlend()` 支持 `to: "scripted"`，不再只特殊处理 `duel` / `explore`。
   - 需要先检查 `step.to` 是否存在。
   - 需要检查 `cameraManager.rigs.has(step.to)` 或提供 `cameraManager.hasRig(step.to)`。
   - 如果目标 rig 未注册，打印 warning，并让该 step 立即失败/完成，避免 sequence 卡住。
   - `CameraManager.startBlend()` 当前已经会对未知 rig 返回 `false`，但 `SceneSequencer` 侧仍建议显式处理，方便定位是哪条 sequence 配错了。
5. 明确 mode 与 scripted rig 的边界：
   - `ExploreMode.updateRender()` 可以继续写 `context.target`，但 `ScriptedCameraRig.compute()` 必须忽略 `context.target`，只使用自身保存的 frame。
   - `BattleMode.updateRender()` 当前会读取 `cameraManager.activeRig.smoothing` 来平滑 fighter distance。scripted rig 不应该被当成 duel rig 使用，所以这里需要加 guard：只有 `cameraManager.activeRigId === "duel"` 时才执行 duel camera context 计算。
   - `ExploreMode.enter()` / `BattleMode.enter()` 仍然可以切换默认 rig；sequence 如果需要在 mode 切换后继续保持 scripted rig，必须在 `switchMode` 之后再显式 `switchCamera` / `startCameraBlend` 到 `"scripted"`。

推荐的 `BattleMode.updateRender()` guard：

```js
const activeRigId = cameraManager?.activeRigId;
if (activeRigId !== "duel") {
    const cam = cameraManager?.getCamera();
    if (sceneVisualSystem && cam) {
        sceneVisualSystem.update(dtMs, { camera: cam });
    }
    return;
}
```

这表示 mode 仍然负责战斗逻辑和场景视觉更新，但不会在非 duel rig 激活时更新 duel camera 的上下文。

推荐的 `_startCameraBlend()` 防御逻辑：

```js
_startCameraBlend(step) {
    const cameraManager = this.context.cameraManager;
    const toRigId = step.to;

    if (!toRigId) {
        console.warn("[SceneSequencer] startCameraBlend missing target rig");
        this._stepState.failed = true;
        return;
    }

    if (!cameraManager?.rigs?.has(toRigId)) {
        console.warn(`[SceneSequencer] startCameraBlend unknown rig: ${toRigId}`);
        this._stepState.failed = true;
        return;
    }

    const frameCtx = this._buildCameraBlendFrameCtx(step);
    const ok = cameraManager.startBlend({
        toRigId,
        durationMs: step.durationMs,
        frameCtx
    });

    this._stepState.failed = !ok;
}
```

对应的 `_updateStep()` 中，`startCameraBlend` 可以保持：

```js
return this._stepState.failed || !this.context.cameraManager?.isBlending();
```

后续如果给 `SceneSequencer` 增加统一的 `onStepFailed` / `cancel` 机制，再把这里的失败接进去。

验证：

- sequence 可以先 `setCameraFrame`，再 blend 到 `"scripted"`。
- scripted 相机不会被 `ExploreMode.updateRender()` 或 `BattleMode.updateRender()` 立刻覆盖。
- blend 结束后 active rig 为 `"scripted"`。
- 后续可以 blend 回 `"duel"` / `"explore"`。
- scripted rig 下相机保持正交，画面变化只来自中心、高度和可视宽度变化。
- 如果 `startCameraBlend.to` 写错，控制台给出明确 warning，sequence 不会卡死。

### Phase 3：再评估是否需要 SequenceMode

只有出现以下需求时，再考虑新增 `SequenceMode`：

- sequence 期间要统一冻结当前 mode 的大部分系统。
- sequence 需要一套独立 update pipeline。
- sequence 需要暂停战斗 resolver，但继续播放部分动画。
- sequence 需要暂停探索碰撞，但保留 NPC idle。
- sequence 开始和结束有通用生命周期，而不是每条 sequence 自己写 step。

如果只是相机和朝向，暂时不需要 `SequenceMode`。

---

## 6. 设计取舍

### 为什么不直接扩展 `startCameraBlend` 支持任意 pose？

可以做，但长期会把 `SceneSequencer` 变成相机 rig，也容易让 sequence 相机变成自由摄影机。

`CameraManager` 当前抽象已经是“rig 负责算状态，manager 负责应用状态”。新增一个受约束的正交 `ScriptedCameraRig` 更符合现有结构，也更符合游戏标准镜头。

### 为什么不把镜像直接写进 `moveActorTo`？

可以作为临时补丁，例如 `moveActorTo` 每帧按目标方向调用 `setFacing()`。

但这会让移动 step 隐含表现策略：

- 有些移动要自动转身。
- 有些移动要倒退。
- 有些移动要锁定朝向。
- 有些移动要由前一个 pose 决定。

所以更好的表达是：`moveActorTo` 只负责移动，`setActorFacingMode` / `setActorFacing` 负责表现。

### 为什么不让 mode 进入和退出时少改 `allowFacing`？

这能缓解一个具体 sequence，但不能解决根因。

根因是 mode 切换时机和 sequence 表现需求并不总是一致。Sequence 需要局部覆盖角色朝向策略。

---

## 7. 最小结论

建议：

1. 不急着新增 `CutSceneMode`。
2. 新增正交 `ScriptedCameraRig`，让 sequence 能控制镜头中心、高度和可视范围。
3. 将 `allowFacing` 升级为 `facingMode`，让角色朝向策略可由 mode 或 sequence 显式控制。
4. 修正 `SceneSequencer.setActorFacing`，不要直接改 `root.scaling.x`。

这条路线改动小，和现有架构一致，也能覆盖当前两个实际痛点。
