# 战斗角色动画反向播放（reverse）实施计划

> 目标：让 `FrameAnimationComponent` 支持从最后一帧倒着播回第一帧，用于 sequencer 里 `longswordman_sleep` 等"起身/恢复"类非战斗动画。

---

## 一、背景

`longswordman_sleep.png` 是一个非战斗动画（类似 pickup / eat / drink），需要在 sequence 里以 **反向** 方式播放（从"睡着"姿势恢复到"站立"）。

核心设计原则：**reverse 是纯运行时参数，不在 stateDef 里声明。sequencer 没指定就正向播放。**

### 当前能力缺口

| 项 | 现状 | 需求 |
|---|---|---|
| 帧推进方向 | 只有 `+1`（正向） | 支持 `-1`（反向） |
| 循环回跳 | 末尾 → 开头 | 反向时开头 → 末尾 |
| finished 判断 | 到达末尾帧时置 finished | 反向时到达帧 0 也置 finished |
| normalizedTime | 正向递增 0→1 | 反向时也应递增 0→1（让转移条件正常触发） |
| frameSpeeds 负数 | 只影响世界空间位移 | 与帧索引方向无关，不承担反向职责 |

**为什么不用负 timeScale？** 负 timeScale 让 `timeInFrameMs` 递减，`while (timeInFrameMs >= durationMs)` 永远不成立 → 动画卡死在当前帧。方向控制必须用独立标志。

---

## 二、改动范围（6 个文件）

### A. 核心能力：`scripts/Components/FrameAnimationComponent.js`

```js
// constructor 新增
this.reverse = false;
```

```js
// play(clipName, options) 入口
const reverse = options.reverse ?? false;
this.reverse = reverse;
if (restart) {
    this.currentFrameIndex = reverse ? this.frames.length - 1 : 0;
    this.timeInFrameMs = 0;
    this.finished = false;
    this._firedEventKeys = new Set();
}
```

```js
// fixedUpdate(dtMs) 帧推进——分两支
if (this.reverse) {
    // 反向：帧索引递减
    while (this.timeInFrameMs >= this.currentFrame.durationMs) {
        this.timeInFrameMs -= this.currentFrame.durationMs;
        if (this.currentFrameIndex - 1 >= 0) {
            this.currentFrameIndex -= 1;
            this.#tryFireEvents(this.currentFrameIndex);
        } else if (this.loop) {
            this.currentFrameIndex = this.frames.length - 1;
            this._firedEventKeys.clear();
            this.#tryFireEvents(this.currentFrameIndex);
        } else {
            this.currentFrameIndex = 0;
            this.timeInFrameMs = 0;
            this.finished = true;
            break;
        }
    }
} else {
    // 原有正向逻辑不变
}
```

```js
// normalizedTime getter
if (this.reverse) {
    return Math.min(
        1 - (this.currentFrameIndex + frameProgress) / this.frames.length,
        1
    );
}
```
### B. 入口传递：`scripts/Enties/CharacterBase.js`

```diff
- enterState(stateName, tickCount) {
+ enterState(stateName, tickCount, overrides = {}) {
      ...
-     this.animation.play(stateDef.clip, { restart: true });
+     const reverse = overrides.reverse ?? false;
+     this.animation.play(stateDef.clip, { restart: true, reverse });
```

> **overrides 设计意图**：`reverse` 是纯运行时参数，不写进 stateDef。sequencer 等调用者按需覆写，不传就正向。
> `overrides` 容器设计为通用入口，未来可扩展 `timeScale`、`loop` 等。

### C. 资源注册：`scripts/AssetManifest.js`

`atlas.hero` 里加：

```js
sleep: "./Art/Sprite/longswordman/longswordman_sleep.json",
```

`colliders.hero` 里加：

```js
sleep: "./Data/CollisionMask/longswordman/longswordman_sleep.collider.json",
```

（没有 animationEvents / rootMotion；collider 是空 boxes，与 walk 同理）

### D. Clip 定义：`scripts/CharacterFactory.js`

`createHeroCharacter` 的 `clips` 对象里加：

```js
sleep: {
    spriteSheetUrl: "./Art/Sprite/longswordman/longswordman_sleep.png",
    atlasData: assets.atlas.hero.sleep,
    colliderData: assets.colliders.hero.sleep,
    loop: false
}
```

无 eventsData、无 rootMotionData（非战斗状态）。

### E. 状态定义：`Data/StateGraphDef/LongSwordMan.json`

`inputs.commands` 数组追加 `"sleep"`；

`states` 对象追加（**不写 reverse，让 sequencer 在运行时传入**）：

```json
"sleep": {
    "clip": "sleep",
    "allowMoveInput": false,
    "loop": false,
    "transitions": []
}
```

> **为什么 stateDef 里没有 reverse？** reverse 是纯运行时参数，由 sequencer command clip 的 `"reverse": true` 字段控制，不在状态图里声明。
> sequencer 没指定就正向播放。
>
> **为什么 transitions 留空？** sequence 专用状态不依赖状态机自动转移。
> 参考现有模式：`prologue_cs_rabble_flee.json` 里的 prop_faller 完全靠手工串 command clip（idle → fall → land → run），
> 不走任何自动 transition。sleep 也一样——播完停在最后一帧，由 sequence 里下一条 command clip 切到 standing 或其他状态。

### F. Sequencer 运行时覆写：`scripts/Systems/TimelineSequencer.js`

修改 `ACTION_HANDLERS.command.start`（现有代码已经有 pushCommand → enterState fallback 链路）：

```js
// 现有代码（第 396-414 行）
if (typeof actor.pushCommand === "function") {
    const accepted = actor.pushCommand(clip.command);
    if (!accepted && typeof actor.enterState === "function") {
        actor.enterState(clip.command);          // ← 无 overrides
    }
} else if (typeof actor.enterState === "function") {
    actor.enterState(clip.command);              // ← 无 overrides
}

// 改为：
const hasOverrides = clip.reverse !== undefined;
if (typeof actor.pushCommand === "function" && !hasOverrides) {
    const accepted = actor.pushCommand(clip.command);
    if (!accepted && typeof actor.enterState === "function") {
        actor.enterState(clip.command, null, {});
    }
} else if (typeof actor.enterState === "function") {
    actor.enterState(clip.command, null, hasOverrides ? { reverse: clip.reverse } : {});
}
```

> **为什么 reverse 存在时跳过 pushCommand？** pushCommand → 内部 enterState 不走 overrides 参数链（现有 enterState 签名是 `(stateName, tickCount)`），无法覆写 reverse。
> 所以当 clip 带了运行时覆写字段时，必须直接调 `enterState(command, null, { reverse })`。
> 不带覆写字段的普通 command clip 继续走原有 pushCommand 路径，零影响。

---

## 三、Sequencer 调用示例

```json
{
    "type": "command",
    "binding": { "actorId": "hero" },
    "command": "sleep",
    "reverse": true,
    "atMs": 1500,
    "durationMs": 2000
},
{
    "type": "command",
    "binding": { "actorId": "hero" },
    "command": "standing",
    "atMs": 3500
}
```

- 第一条 command clip：`reverse: true` 让 sleep 从最后一帧倒播回第一帧
- 第二条 command clip：sleep 播完停在最后一帧（`transitions: []`），手工切回 standing

这和 `prologue_cs_rabble_flee.json` 里 prop_faller 的 `fall → land → run` 手工切换模式完全一致。

---

## 四、不在本次改动范围内

| 项 | 原因 |
|---|---|
| `frameSpeeds` 负数 | 它只管世界空间位移，不承担帧索引方向，sleep 状态也不加 frameSpeeds |
| `NpcFrameComponent` | NPC 用独立组件，CombatCharacter 才用 FrameAnimationComponent |
| `PropEntity` 反向 | prop 有独立动画系统，CS prop 暂时不需要反向 |
| `_applyFrame` / `_getCurrentRootAnchor` | 都按 frameIndex 查数组，数组顺序不变，反向天然兼容 |
| `rabble_stick_CS_turnaround` | 同需求但属另一角色，按相同模式后续再加 |

---

## 五、验证清单

- [ ] `hero.enterState('sleep', null, { reverse: true })` 从最后一帧倒着播回第一帧
- [ ] `hero.enterState('sleep')`（不传 reverse）正向播放
- [ ] 播完停在最后一帧，不自动转移（`transitions: []`）
- [ ] `hero.enterState('standing')` 能正常切回
- [ ] 其他状态（idle / walk / draw 等）正向播放不受影响
- [ ] 循环模式 + reverse 时能从帧 0 正确跳回末尾帧（sleep 不用 loop，但逻辑要对）
- [ ] `#tryFireEvents` 在反向递减时也能正确触发事件（虽然 sleep 无 eventsData）

---

## 六、后续扩展

该机制设计为通用能力。其他角色要加反向动画只需：
1. AssetManifest 注册 atlas + collider
2. CharacterFactory 加 clip
3. StateGraphDef 加 state（transitions 留空走 sequencer 手工调度）
4. inputs.commands 里加对应命令名
5. Sequencer command clip 里按需加 `"reverse": true/false`

`overrides` 参数设计为通用容器，未来可扩展 `timeScale`、`loop` 等运行时覆写字段。