# FacingPolicy 实施步骤

> 基于 SEQUENCE_CAMERA_AND_FACING_POLICY_PROPOSAL.md 的 Phase 1
> 目标：将 `character.allowFacing` 升级为 `facingMode` 枚举，让角色朝向策略可由 mode 或 sequence 显式控制。

---

## 第 1 步：CharacterBase 改造

**文件**：`scripts/Enties/CharacterBase.js`

### 1.1 新增 FACING_MODE 枚举

在文件顶部（类定义之前）新增：

```js
export const FACING_MODE = Object.freeze({
    AUTO_FROM_MOVE: "autoFromMove",
    LOCKED: "locked",
    SCRIPTED: "scripted"
});
```

### 1.2 Constructor 改造

将：
```js
this.allowFacing = false;
```

改为：
```js
this.facingMode = FACING_MODE.LOCKED;
```

### 1.3 新增 API

在类中新增方法：

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

### 1.4 重命名 #updateSpriteFacing → _syncSpriteFacing

将私有方法 `#updateSpriteFacing()` 改名为 `_syncSpriteFacing()`（去掉 `#` 前缀，改为 protected 语义）。

方法体保持不变：
```js
_syncSpriteFacing() {
    if (!this.spritePlane) {
        return;
    }
    const currentScaleX = Math.abs(this.spritePlane.scaling.x);
    this.spritePlane.scaling.x = currentScaleX * this.facing;
    this.spritePlane.position.x = -this.spritePlane.position.x;
}
```

### 1.5 _applyMovement 改造

将：
```js
if (this.allowFacing && Math.abs(nx) > 0.1) {
    const newFacing = nx > 0 ? 1 : -1;
    if (newFacing !== this.facing) {
        this.facing = newFacing;
        this.#updateSpriteFacing();
    }
}
```

改为：
```js
if (this.facingMode === FACING_MODE.AUTO_FROM_MOVE && Math.abs(nx) > 0.1) {
    this.setFacing(nx > 0 ? 1 : -1);
}
```

---

## 第 2 步：Mode 切换时更新 facingMode

**文件**：`scripts/Systems/Modes/ExploreMode.js`、`scripts/Systems/Modes/BattleMode.js`

### 2.1 ExploreMode

`enter()` 中：
```js
// 旧代码
character.allowFacing = true;

// 新代码
character.setFacingMode(FACING_MODE.AUTO_FROM_MOVE);
```

`exit()` 中：
```js
// 旧代码
character.allowFacing = false;

// 新代码
character.setFacingMode(FACING_MODE.LOCKED);
```

> 注意：ExploreMode.js 需要 import FACING_MODE
> ```js
> import { FACING_MODE } from "../../Enties/CharacterBase.js";
> ```

### 2.2 BattleMode

`enter()` 中增加：
```js
const { character, rabbleStick } = this.context;
if (character) character.setFacingMode(FACING_MODE.LOCKED);
if (rabbleStick) rabbleStick.setFacingMode(FACING_MODE.LOCKED);
```

> 注意：BattleMode.js 需要 import FACING_MODE
> ```js
> import { FACING_MODE } from "../../Enties/CharacterBase.js";
> ```

---

## 第 3 步：SceneSequencer 支持 facing 相关 step

**文件**：`scripts/Systems/SceneSequencer.js`

### 3.1 新增 setActorFacingMode step

在 `_startCurrentStep()` 的 switch 中新增 case：

```js
case "setActorFacingMode": {
    this._setActorFacingMode(step);
    break;
}
```

在 `_updateStep()` 的 switch 中新增 case（立即完成）：

```js
case "setActorFacingMode": {
    return true;
}
```

新增方法：

```js
_setActorFacingMode(step) {
    const actor = this._getActor(step.actorId);
    if (!actor || typeof actor.setFacingMode !== "function") return;
    actor.setFacingMode(step.mode);
}
```

### 3.2 修正 setActorFacing

将现有 `_setActorFacing()`：

```js
_setActorFacing(step) {
    const actor = this._getActor(step.actorId);
    if (!actor || !actor.root) return;
    const scaleX = step.facing >= 0 ? 1 : -1;
    actor.root.scaling.x = Math.abs(actor.root.scaling.x) * scaleX;
}
```

改为：

```js
_setActorFacing(step) {
    const actor = this._getActor(step.actorId);
    if (!actor || typeof actor.setFacing !== "function") return;
    actor.setFacing(step.facing);
}
```

---

## 验证清单

- [ ] 探索模式主角左右移动正常镜像
- [ ] 探索模式 NPC 保持不镜像（NPC 默认 LOCKED）
- [ ] 战斗模式所有角色左右移动均不自动改镜像
- [ ] 退出战斗 sequence 中主角向左移动时能正常镜像到左
- [ ] Sequence 可以显式设置 `FACING_MODE.SCRIPTED` 并调用 `setActorFacing`
- [ ] `setActorFacing` 不再直接改 `root.scaling.x`，而是走 `actor.setFacing()`

---

## 相关文件汇总

| 步骤 | 文件 | 改动类型 |
|------|------|----------|
| 1 | `scripts/Enties/CharacterBase.js` | 新增枚举、改 constructor、新增方法、改 _applyMovement |
| 2 | `scripts/Systems/Modes/ExploreMode.js` | 改 enter/exit，新增 import |
| 2 | `scripts/Systems/Modes/BattleMode.js` | 改 enter，新增 import |
| 3 | `scripts/Systems/SceneSequencer.js` | 新增 step 类型、修正 setActorFacing |
