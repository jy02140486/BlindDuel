# 统一时间源与 Render 采样架构设计

> 目标：统一项目时间源，引入 FrameClock 权威时钟，将 Sequencer 与 Camera Blend 改造为按时间采样（Sampleable）模型，并为非采样型对象提供 Render 插值，根治过场与跟随相机抖动问题。

---

## 1. 背景与问题

### 1.1 抖动现象

intro 过场在 83ms 帧卡顿时，日志显示单帧相机位移 9.30 单位：
[CAM_JITTER_POS] delta=(0.0000,-1.1078,-9.2313) dist=9.2975
[CAM_JITTER_BLEND] elapsed=83.0ms duration=100ms toRig=scripted
### 1.2 根因

项目当前有 4 处分散的时间信源，基准不一致：

| 子系统 | 时间信源 | 性质 |
|--------|---------|------|
| 主循环 | `engine.getDeltaTime()` | 真实帧时（变量） |
| 固定步长 | `FIXED_DT = 1000/60` | 固定步长 |
| Sequencer 时钟 | `TimelineSequencer.currentTimeMs` | FIXED_DT 累加 |
| Blend 时钟 | `CameraManager._blend.elapsedMs` | 真实 dtMs 累加 ← 断层 |

Sequencer 用 FIXED_DT 在 83ms 卡顿里"瞬间启动"了 blend，而 blend 的 elapsedMs 在 render 帧用真实 dtMs 一次性吃掉 83ms，跳到 t=0.83。两个时钟基准不一致导致单帧跳变。

### 1.3 次要问题

- `moveActorTo` 的 start 直接写 `actor.position`（[TimelineSequencer.js:396](file:///e:/se/BlindDuel/scripts/Systems/TimelineSequencer.js#L396)），求值依赖 start 快照而非绝对定义
- render 帧（可能 144Hz）只能读 fixedUpdate 的最后一次残留值，无子帧插值
- `tickCount` 作为独立参数在各系统间传递，接口容易随需求扩张而反复变更

---

## 2. 目标

1. **单一权威时钟**：全游戏只有一份 FrameClock，所有系统只读不写
2. **采样化求值**：Sequencer 与 Camera Blend 演进为 `sample(time)` 纯函数求值
3. **Render 连续性**：非采样型对象通过 previous/current 插值，采样型对象直接 sample(renderTime)
4. **依赖方向清晰**：Game → FrameClock → Systems，Clock 不依赖任何人
5. **未来可扩展**：支持 Seek / Pause / Preview / 变速 / 倒放

---

## 3. 架构总览：Simulation / Render 二分模型

把世界明确分成两类系统：
Simulation（固定步长 60Hz）
↓ 生成离散的权威状态（authoritative state）
Render（每帧，可变帧率）
↓ 把离散状态变成连续画面
Render 实现连续性有两种方式：

| 方式 | 适用对象 | 原理 |
|------|---------|------|
| **Sampling（采样）** | Sampleable 对象 | 本身有连续函数 f(time)，按 renderTime 直接求值 |
| **Interpolation（插值）** | Simulation Driven 对象 | 只有离散状态，在 previous/current 之间用 alpha 插值 |

Sampling 是比 Interpolation 更高级的 Render 连续性实现。两者解决同一问题——让 60Hz 模拟在 144Hz 屏上看起来连续。

### 3.1 判据：Sampleable vs Simulation Driven

**判据不是"是不是 Sequencer 控制"，而是"能否根据 renderTime 精确重建状态"。**

| Sampleable | Simulation Driven |
|------------|-------------------|
| `position = f(time)` 闭式函数 | `velocity += gravity*dt; position += velocity*dt` 积分 |
| moveActorTo / cameraBlend / Spline / Bezier / Camera Rail / Animation Curve | 物理抛射 / NavMesh 跟随 / Ragdoll / Root Motion（积分型）/ 玩家实时输入 |

- Sampleable → 走 Sampling 路径，`sample(renderTime)` 直接求值
- Simulation Driven → 走 Interpolation 路径，fixedUpdate 快照 previous/current，render 用 alpha 插值

这个分类对未来出现的 Root Motion / 物理抛射 / NavMesh / IK / 粒子 / Camera Shake 都成立，不会因"是不是 Sequencer"而加特判。

---

## 4. FrameClock 设计

### 4.1 数据结构

整个游戏只有一份 FrameClock 实例，持有所有时间相关字段：

```js
class FrameClock {
    constructor(fixedDeltaMs = 1000 / 60) {
        this.fixedDeltaMs = fixedDeltaMs;  // 固定步长（ms）
        this.tick = 0;                     // fixedUpdate 次数（uint64 语义）
        this.fixedTime = 0;                // 逻辑模拟时间 = tick * fixedDelta（ms）
        this.accumulator = 0;              // fixedUpdate 之间的剩余真实时间（ms）
        this.renderAlpha = 0;              // accumulator / fixedDelta，0~1
        this.renderTime = 0;               // 渲染采样时间 = fixedTime + accumulator（ms）
        this.timeScale = 1.0;              // 变速
        this.paused = false;
    }
}
```

### 4.2 依赖方向
Game Loop（唯一调用者）
↓ advance() / stepFixed()
FrameClock（唯一权威）
↓ const FrameClock&（只读）
Systems（Timeline / Camera / Animation / Particle / TimeControlSystem）
- **只有 Game Loop 调 `clock.advance()` / `clock.stepFixed()`**
- 所有系统收到的都是 `const FrameClock&`（只读引用），不能修改时钟
- Clock 不依赖任何系统

### 4.3 推进协议（Gaffer On Games 经典 Fixed Timestep）

```js
// 主循环每帧
advance(realDtMs) {
    if (this.paused) return;
    this.accumulator += realDtMs * this.timeScale;
    if (this.accumulator > this.fixedDeltaMs * 5) {
        this.accumulator = this.fixedDeltaMs * 5;  // 防螺旋死亡
    }
}

// fixedUpdate 循环
stepFixed() {
    if (this.accumulator < this.fixedDeltaMs) return false;
    this.accumulator -= this.fixedDeltaMs;
    this.tick++;
    this.fixedTime = this.tick * this.fixedDeltaMs;
    return true;
}

// render 帧前刷新派生字段
refreshRender() {
    this.renderAlpha = this.accumulator / this.fixedDeltaMs;
    this.renderTime = this.fixedTime + this.accumulator;
}
```

### 4.4 暂停语义

- `paused = true`：advance 直接 return，accumulator 不增，tick 不推进，renderTime 冻结
- Sequencer / Camera Blend / Animation 全部自然停止（它们读 clock）
- TimeControlSystem 的角色冻结不受影响（它收的是 fixedDelta 参数，不读 clock 内部状态）

---

## 5. TimeControlSystem 关系

### 5.1 职责澄清

TimeControlSystem **不是全局时钟**，而是**单个战斗角色的冻结/停滞状态机**（Character Temporal Effects）。每个 CombatCharacter 实例自己持有一个。管理 hitstop / blockstun / hitstun / impactContext（整数帧计数）。

### 5.2 与 FrameClock 的关系

**完全正交，不合并。** TimeControlSystem 通过参数注入 clock.fixedDelta，不自己读 clock：

```js
// ✅ 正确：Game Loop → Character → TimeControlSystem，参数注入
character.fixedUpdate(clock);
// Character 内部：
timeControlSystem.tick(this, clock.fixedDelta);

// ❌ 错误：TimeControlSystem 自己读全局 clock
timeControlSystem.tick();  // 内部 Game.instance.clock.fixedDelta
```

### 5.3 文件头注释

在 [TimeControlSystem.js](file:///e:/se/BlindDuel/scripts/Systems/TimeControlSystem.js) 文件头加注释，标明其职责为"Character Temporal Effects（角色级冻结/停滞）"，与全局 FrameClock 区分，避免后续混淆。

---

## 6. Clip 接口分类与改造

### 6.1 现有 handler 三分类

按"是否有连续属性"分类，不统一强制改造：

| 类型 | 现有 handler | 改造后接口 |
|------|-------------|-----------|
| **事件型** | command / callback / playAudio / dialogueBubble(show,hide) / disposeProp / setCameraFrame / setCameraFollow | 只有 `onEnter`（等价于现在的 start） |
| **连续型** | moveActorTo | `onEnter` / `sample(time)` / `onExit` |
| **混合型** | cameraBlend / moveActorByDirection（视情况） | `onEnter`（带副作用如切 rig）/ `sample(time)` / `onExit` |

### 6.2 接口语义约束（必须遵守）

- **`onEnter(ctx, clip, state)`**：一次性初始化。**不能写最终属性**（position / camera state），只能写 state 缓存
- **`sample(ctx, clip, state, time)`**：纯函数求值。给定 time，算出值并写入绑定对象。**不推进任何时间、不修改 state 的 time 相关字段、无副作用**
- **`onExit(ctx, clip, state)`**：一次性收尾。**不能 snap**（因为 sample 在 time=duration 时已算到终值，onExit 再 snap 是冗余且可能引入跳变）

### 6.3 sample 与离散事件的职责边界（路线 X）

- **FixedUpdate**：推进 Simulation Time，根据 `[lastTime, currentTime]` 区间触发所有离散事件（onEnter / onExit / Audio / Spawn / Dialogue / Quest / Animation Event）
- **sample(time)**：只负责连续属性求值，可在任意 Render Frame 调用任意次数，无副作用

### 6.4 兼容性过渡

现有 handler 都用 `update`。过渡期保留 `update` 作为 `sample` 的 alias，逐步迁移。签名变化：

```js
// 旧
update(ctx, clip, state, localMs, dtMs)
// 新
sample(ctx, clip, state, time)  // 去掉 dtMs，sample 不应用增量
```

### 6.5 Mode 切换 clip 位置规范

**规范**：涉及 mode 变化的 sequence，`switchMode` clip 必须放在 sequence 的**末尾**（`atMs == durationMs`），禁止放在中间。

**理由**：
- mode 变化意味着 gameplay 语义切换（探索↔战斗）。放末尾 = "先演再打"，cinematic 期间 gameplay 语义保持旧 mode，语义清晰。
- 放中间会引入"上下文未就绪窗口"：新 mode 的 `rig.compute` 依赖新 mode 写入的 context（如 BattleMode 的 `fighterDistance`），但 `mode.enter` 在 switchMode 触发时才执行，导致窗口期 `rig.compute` 拿到缺失/旧值，相机 drift。

**支撑机制**（确保末尾规范稳定，不依赖跨 track 精确数值对齐）：

1. **mode.enter 解耦**：sequence 期间 `mode.enter` 不调 `switchRig`，rig 切换完全由 `cameraBlend` clip 的 `endBlend` 负责。消除 enter 的 switchRig 与 blend 的 switchRig 互相覆盖（即 Handoff 方案 B 描述的交接问题）。
2. **rig.compute 安全网**：`rig.compute` 在 mode 上下文未就绪时（如 `fighterDistance == null`）return prevState 克隆，hold 在 blend 终值，不 drift。这是 fail-safe，任何原因导致的窗口期都稳定。

**窗口期语义**（switchMode 在末尾时的 `blend.endMs` → `switchMode.atMs` 窗口）：
- 相机 hold 在 blend 终值（不跟随角色），属于 cinematic 定格语义，**不是 bug**。
- 窗口期结束后（switchMode fire → mode.enter 写上下文），`rig.compute` 恢复正常 follow。

**反模式**（禁止）：
- `switchMode` 放在 sequence 中间（非末尾）。
- `mode.enter` 在 sequence 期间无条件调 `switchRig`（与 cameraBlend clip 争抢 rig 控制权）。
- `rig.compute` 在上下文缺失时 fallback 到默认值（如 `fighterDistance ?? 0`），导致 zoom/位置 drift。

---

## 7. 实施阶段

### 阶段 1：FrameClock 落地（最高优先级）

**目标**：建立唯一权威时钟，所有系统读同一份 FrameClock。

**改动**：
1. 新增 `scripts/Systems/FrameClock.js`
2. [character_demo.js](file:///e:/se/BlindDuel/character_demo.js) 主循环改造：用 clock.advance / stepFixed 替换裸 accumulator + tickCount
3. [Game.js](file:///e:/se/BlindDuel/scripts/Game.js) 持有 `this.clock`，fixedUpdate / updateRender 签名改为 `(clock)` 或 `(clock.fixedDelta, clock.tick)`（过渡期）
4. [Scene.js](file:///e:/se/BlindDuel/scripts/Scene.js) 持有 `this.clock`（从 Game 注入），子系统通过 sharedContext 访问
5. TimeControlSystem.js 文件头加职责注释
6. TimeControlSystem.tick 签名保持 `(character, dtMs)`，由 Character.fixedUpdate 传入 `clock.fixedDelta`

**验收**：
- 全游戏只有一个 FrameClock 实例
- 主循环日志 `[FrameClock] tick=N fixedTime=Xms renderTime=Yms alpha=Z` 正常输出
- 现有功能无回归（intro / 战斗 / 探索 / 场景切换）

### 阶段 2：Sequencer + Camera Blend 采样化

**目标**：TimelineSequencer 与 CameraManager 从 `update(dt)` 演进为 `sample(time)`。

**改动**：
1. TimelineSequencer 新增 `sample(renderTime)` 方法：遍历 active clip，调 handler.sample
2. TimelineSequencer.fixedUpdate 只负责推进时间 + 触发 onEnter/onExit 离散事件
3. TimelineSequencer 内部 currentTimeMs 改为读 clock（不再自己累加 dtMs）
4. moveActorTo 改造为 onEnter / sample / onExit（onEnter 不写 actor.position）
5. cameraBlend 改造为 onEnter（记 startGameTime = clock.fixedTime）/ sample（算 t + lerp + 写 camera）/ onExit
6. CameraManager._blend.elapsedMs 改为 `clock.renderTime - startGameTime`，不再自己累加
7. 事件型 handler 保持 start 不变（过渡期 alias 为 onEnter）

**验收**：
- intro 第一个 cameraBlend（durationMs=100）在 83ms 卡顿下单帧位移 < 0.5 单位
- moveActorTo 期间 actor 位置平滑，无 start 时跳变
- `[CAM_JITTER_*]` 日志在 blend 期间不再触发
- Seek 测试：手动设 clock.fixedTime，sequencer 状态能正确重建（验证 sample 纯函数性）

### 阶段 3：Render 插值（Simulation Driven 对象）

**目标**：为非 Sampleable 对象（玩家走位、普通 NPC）提供 previous/current 插值。

**改动**：
1. CharacterBase 新增 `renderTransform`（previous / current 两个 Vector）
2. CharacterBase.fixedUpdate 末尾快照：previous = current; current = root.position
3. Scene.updateRender 遍历实体：
   - Sampleable 对象（`supportsRenderSampling === true`）→ 走 sample(renderTime)，跳过插值
   - Simulation Driven 对象 → `root.position = lerp(previous, current, clock.renderAlpha)`
4. CameraManager.update 在 follow 模式下，target 位置读插值后的实体位置

**判据字段**：`supportsRenderSampling`（boolean，默认 false）。Sequencer 控制期间设 true，结束设 false。未来 Spline / Bezier / Camera Rail 等可独立设 true 而不依赖 Sequencer 标记。

**验收**：
- 144Hz 屏上玩家走位无阶梯感
- Sequencer 控制的 actor 走 sample 路径，不双次平滑
- sequencer 结束后 actor 切回插值路径无跳变

### 阶段 4：完整曲线化（以后需要时）

**目标**：Track / Channel / Sample / Apply 完整 Pipeline，支持多关键帧曲线。

**暂不实施**。当前项目规模不需要 Evaluate → State → Resolve → Apply 完整 Pipeline。等出现多关键帧曲线、多通道混合、复杂 blend 需求时再演进。

---

## 8. 接口定义与伪代码

### 8.1 FrameClock.js

```js
export class FrameClock {
    constructor(fixedDeltaMs = 1000 / 60) {
        this.fixedDeltaMs = fixedDeltaMs;
        this.tick = 0;
        this.fixedTime = 0;
        this.accumulator = 0;
        this.renderAlpha = 0;
        this.renderTime = 0;
        this.timeScale = 1.0;
        this.paused = false;
    }

    advance(realDtMs) {
        if (this.paused) return;
        this.accumulator += realDtMs * this.timeScale;
        if (this.accumulator > this.fixedDeltaMs * 5) {
            this.accumulator = this.fixedDeltaMs * 5;
        }
    }

    stepFixed() {
        if (this.accumulator < this.fixedDeltaMs) return false;
        this.accumulator -= this.fixedDeltaMs;
        this.tick++;
        this.fixedTime = this.tick * this.fixedDeltaMs;
        return true;
    }

    refreshRender() {
        this.renderAlpha = this.accumulator / this.fixedDeltaMs;
        this.renderTime = this.fixedTime + this.accumulator;
    }
}
```

### 8.2 主循环改造（character_demo.js）

```js
import { FrameClock } from "./scripts/Systems/FrameClock.js";

const clock = new FrameClock(1000 / 60);

engine.runRenderLoop(() => {
    const realDt = engine.getDeltaTime();
    clock.advance(realDt);

    while (clock.stepFixed()) {
        game.fixedUpdate(clock);
    }

    clock.refreshRender();
    game.updateRender(clock);
    game.render();
});
```

### 8.3 Game.js 签名演进

```js
// 过渡期：兼容旧签名
fixedUpdate(clock) {
    // 内部调用 scene.fixedUpdate(clock)
    // scene.fixedUpdate 内部：
    //   this.sceneSequencer.fixedUpdate(clock)
    //   this.gameModeManager.fixedUpdate(clock)
    //   每个实体：entity.fixedUpdate(clock)
    // CombatCharacter.fixedUpdate 内部：
    //   this.timeControlSystem.tick(this, clock.fixedDelta)
}

updateRender(clock) {
    // scene.updateRender(clock)
    // scene 内部：
    //   this.sceneSequencer.sample(clock.renderTime)
    //   this._interpolateNonSampledEntities(clock.renderAlpha)
    //   this.cameraManager.update(clock)
}
```

### 8.4 TimelineSequencer 采样化

```js
fixedUpdate(clock) {
    if (!this.busy) return;
    const prevTime = this.currentTimeMs;
    this.currentTimeMs = clock.fixedTime - this.sequenceStartGameTime;

    // 触发 onEnter / onExit 离散事件
    for (const track of this.timeline.tracks) {
        for (const clip of track.clips) {
            this._updateClipLifecycle(clip, track, prevTime, this.currentTimeMs);
        }
    }

    if (this.currentTimeMs >= this.timeline.durationMs) {
        this._onComplete();
    }
}

sample(renderTimeMs) {
    if (!this.busy) return;
    const localTime = renderTimeMs - this.sequenceStartGameTime;

    for (const track of this.timeline.tracks) {
        for (const clip of track.clips) {
            if (!this._isClipActiveAtTime(clip, localTime)) continue;
            const handler = this._getHandler(clip.type);
            if (handler?.sample) {
                const clipLocalTime = localTime - (clip.startMs ?? clip.atMs);
                handler.sample(this.context, clip, this.activeClipStates.get(clip._id), clipLocalTime);
            }
            // 事件型 clip 没有 sample，靠 fixedUpdate 的 onEnter/onExit 处理
        }
    }
}
```

### 8.5 moveActorTo 改造

```js
moveActorTo: {
    onEnter(ctx, clip, state) {
        const actor = _resolveActor(ctx, state.track.binding);
        if (!actor) { state.invalid = true; return; }
        state.actor = actor;
        // ❌ 不写 actor.position（即使是 startPos override 也不写）
        // ✅ 只缓存 from/to，让 sample 来写
        state.fromX = clip.startPos ? clip.startPos[0] : actor.root.position.x;
        state.fromY = clip.startPos ? clip.startPos[1] : actor.root.position.y;
        state.toX = clip.x ?? state.fromX;
        state.toY = clip.y ?? state.fromY;
        if ("controlledBySequence" in actor) {
            actor.controlledBySequence = true;
            actor.supportsRenderSampling = true;  // 阶段3用
        }
    },

    sample(ctx, clip, state, time) {
        if (state.invalid) return;
        const t = Math.min(time / (clip.durationMs || 1), 1);
        const eased = easeInOut(t);  // 纯函数
        // ✅ 唯一写入点
        state.actor.root.position.x = state.fromX + (state.toX - state.fromX) * eased;
        state.actor.root.position.y = state.fromY + (state.toY - state.fromY) * eased;
    },

    onExit(ctx, clip, state) {
        if (state.invalid) return;
        // ❌ 不 snap（sample 在 time=duration 时已算到 toX/toY）
        // ✅ 只收尾状态
        if ("controlledBySequence" in state.actor) {
            state.actor.controlledBySequence = false;
            state.actor.supportsRenderSampling = false;
        }
    }
}
```

### 8.6 cameraBlend 改造

```js
cameraBlend: {
    onEnter(ctx, clip, state) {
        // 用 fixedTime 而非 renderTime，避免 blend 起点因子帧小数漂移
        state.startGameTime = ctx.clock.fixedTime;
        ctx.cameraManager.startBlend(clip.to);
    },

    sample(ctx, clip, state, time) {
        const t = Math.min(time / (clip.durationMs || 1), 1);
        ctx.cameraManager.updateBlend(t);  // 内部 lerp(from, to, smoothstep(t))
    },

    onExit(ctx, clip, state) {
        ctx.cameraManager.endBlend();
    }
}
```

### 8.7 Render 插值（阶段3）

```js
// CharacterBase.fixedUpdate 末尾
if (this.renderTransform) {
    this.renderTransform.previous.copyFrom(this.renderTransform.current);
    this.renderTransform.current.copyFrom(this.root.position);
}

// Scene.updateRender
for (const entity of this.entities) {
    if (entity.supportsRenderSampling) continue;  // 走 sample 路径
    if (!entity.renderTransform) continue;

    const prev = entity.renderTransform.previous;
    const curr = entity.renderTransform.current;
    entity.root.position.x = lerp(prev.x, curr.x, clock.renderAlpha);
    entity.root.position.y = lerp(prev.y, curr.y, clock.renderAlpha);
}
```

---

## 9. 迁移清单

### 阶段 1 涉及文件

| 文件 | 改动 |
|------|------|
| `scripts/Systems/FrameClock.js` | 新增 |
| `character_demo.js` | 主循环改用 clock.advance / stepFixed / refreshRender |
| `scripts/Game.js` | 持有 this.clock；fixedUpdate/updateRender 签名改 (clock) |
| `scripts/Scene.js` | 持有 this.clock（Game 注入）；fixedUpdate/updateRender 签名改 (clock) |
| `scripts/Systems/Modes/ExploreMode.js` | fixedUpdate/updateRender 签名适配 |
| `scripts/Systems/Modes/BattleMode.js` | fixedUpdate/updateRender 签名适配 |
| `scripts/Enties/CharacterBase.js` | fixedUpdate 签名适配 |
| `scripts/Enties/CombatCharacter.js` | fixedUpdate 签名适配；timeControlSystem.tick 传 clock.fixedDelta |
| `scripts/Enties/NpcCharacter.js` | fixedUpdate 签名适配 |
| `scripts/Systems/NpcController.js` | update 签名适配 |
| `scripts/Systems/CombatSystem.js` | fixedUpdate 签名适配 |
| `scripts/Systems/TimeControlSystem.js` | 文件头加职责注释（Character Temporal Effects） |

### 阶段 2 涉及文件

| 文件 | 改动 |
|------|------|
| `scripts/Systems/TimelineSequencer.js` | 新增 sample(renderTime)；fixedUpdate 改读 clock；moveActorTo/cameraBlend handler 改造 |
| `scripts/Systems/CameraManager.js` | _blend.elapsedMs 改为读 clock.renderTime - startGameTime；新增 updateBlend(t) |
| `scripts/Systems/SceneSequencer.js` | 转发 clock 给 TimelineSequencer |

### 阶段 3 涉及文件

| 文件 | 改动 |
|------|------|
| `scripts/Enties/CharacterBase.js` | 新增 renderTransform + supportsRenderSampling |
| `scripts/Scene.js` | updateRender 加非采样型实体插值循环 |
| `scripts/Systems/CameraManager.js` | follow 模式 target 读插值后位置 |

---

## 10. 验收标准

### 10.1 阶段 1 验收

- [ ] 全游戏只有一个 FrameClock 实例（grep `new FrameClock` 只有一处）
- [ ] 主循环日志 `[FrameClock] tick=N fixedTime=Xms renderTime=Yms alpha=Z` 正常
- [ ] intro / 战斗 / 探索 / 场景切换无回归
- [ ] TimeControlSystem.tick 仍收 `(character, dtMs)` 参数，未自己读 clock

### 10.2 阶段 2 验收

- [ ] intro 第一个 cameraBlend（durationMs=100）在 83ms 卡顿下单帧位移 < 0.5 单位
- [ ] `[CAM_JITTER_*]` 日志在 blend 期间不再触发
- [ ] moveActorTo 期间 actor 位置平滑，无 start 时跳变
- [ ] Seek 测试：手动设 clock.fixedTime，sequencer.sample(renderTime) 能正确重建状态
- [ ] cameraBlend 起点稳定（用 fixedTime 而非 renderTime）

### 10.3 阶段 3 验收

- [ ] 144Hz 屏上玩家走位无阶梯感
- [ ] Sequencer 控制的 actor 走 sample 路径，不双次平滑
- [ ] sequencer 结束后 actor 切回插值路径无跳变
- [ ] Camera follow 模式下无抖动

---

## 11. 决策记录

| # | 决策点 | 决定 | 理由 |
|---|--------|------|------|
| 1 | GameClock 时间基准 | Hybrid: fixedTime + accumulator | fixedUpdate 在整数帧边界，renderTime 有子帧精度，可省掉 Sampleable 对象的 previous/current 插值 |
| 2 | sample 与离散事件边界 | 路线 X：sample 只管连续属性，离散事件归 fixedUpdate 的 onEnter/onExit | 避免事件型 clip 强行加 sample 造成职责混乱 |
| 3 | Clip 接口 | 按类型声明能力（事件型 onEnter / 连续型 onEnter+sample+onExit / 混合型），不统一强制改造 | 现有 handler 实际是 3 种类型，统一改造反而引入空洞接口 |
| 4 | 统一时钟范围 | TimelineSequencer + CameraManager；SceneSequencer 排除 | SceneSequencer 是 step-based 事件驱动，无 ms 时钟概念 |
| 5 | Camera Blend 暂停语义 | 跟 FrameClock 同暂停 | 当前无"过场不暂停、游戏暂停"需求 |
| 6 | TimeControlSystem 关系 | 完全正交，不合并；通过参数注入 clock.fixedDelta | TimeControlSystem 是角色级冻结，非全局时钟；依赖注入避免耦合 |
| 7 | tickCount 归属 | 纳入 FrameClock.tick | 统一接口 `fixedUpdate(clock)`，未来扩展不需改签名 |
| 8 | Render 插值判据 | Sampleable vs Simulation Driven，非 controlledBySequence | 后者对未来 Root Motion / 物理 / NavMesh / IK 不成立，需加特判 |
| 9 | Render 连续性两种方式 | Sampling（按 renderTime 求值）+ Interpolation（previous/current 插值） | Sampling 是更高级的 Interpolation，统一框架 |
| 10 | 阶段3是否对所有对象插值 | 否，仅对 Simulation Driven 对象；Sampleable 对象直接 sample(renderTime) | 选 Hybrid 时钟后 Sampleable 已连续，再插值是双次平滑 |
| 11 | 完整 Evaluate Pipeline | 暂不实施 | 当前项目规模不需要，等复杂需求出现再演进 |

---

## 12. 风险与注意事项

1. **moveActorTo 的 startPos override 时序**：onEnter 不再写 actor.position，第一个 sample(renderTime) 调用才把 actor 写到 from 位置。因 render 帧在 fixedUpdate 之后立即执行，时序无空隙。但需验证 sequencer 启动首帧无视觉跳变。
2. **事件型 clip 的 update 兼容**：过渡期保留 update 作为 sample alias，但事件型 clip 没有 update，不受影响。
3. **cameraBlend 的 from/to 动态性**：当前改造仍用 startGameTime 快照 from 状态。未来若需"blend 中段反映 rig 内部状态变化"，需改为每帧 sample 两个 rig 再 lerp。当前不实施。
4. **阶段3的 supportsRenderSampling 字段**：与现有 controlledBySequence 并存。sequencer 期间两者同设 true，但语义不同：controlledBySequence 是"控制器不要干扰"，supportsRenderSampling 是"render 走 sample 路径"。未来独立 Sampleable 系统（如 Spline）可只设后者。
5. **回滚风险**：阶段1改签名面较大，建议先在 Game/Scene 层做 (clock) → (clock.fixedDelta, clock.tick) 的兼容拆解，子系统逐个迁移，避免一次性大改。

---

## 13. 参考资源

- Gaffer On Games: "Fix Your Timestep!"（经典 Fixed Timestep 模型）
- Unity Legacy Animation System（AnimationState.time + AnimationCurve.Evaluate 纯函数求值）
- UE5 Level Sequence / MovieScene（Tick/Evaluate/Apply 三阶段 + FMovieSceneSequenceInterrogator 任意 time 重建）
- UE5 AnimInstance（游戏线程 Tick 推进时间 + Worker 线程 Evaluate 求值分离）