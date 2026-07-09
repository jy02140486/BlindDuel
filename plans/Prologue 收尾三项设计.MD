e:\se\BlindDuel\plans\Prologue 收尾三项设计.MD
# Prologue 收尾三项设计

> **状态：设计评审中（未实施）。** 覆盖 Prologue 剩余三块内容：① cutscene 按需生成（scenario 推进）② ScriptedCamera 在 sequence 内跟随对象 ③ NPC idle 解耦为 behavior（Charlotte observe 常驻）。
> **关联文档**：[Prologue 内容与演出流程实施计划.MD](./Prologue%20内容与演出流程实施计划.MD)、[Scene 生命周期与稳定对象上移重构-回归.MD](./Scene%20生命周期与稳定对象上移重构-回归.MD)。

---

## 0. 背景与目标

Prologue Step 6-8 已落地 PropEntity + cutscene + companion 跟随 + PROLOGUE_BATTLE（见 INDEX.md 归档）。剩三块收尾：

| # | 需求 | 一句话目标 |
|---|------|-----------|
| 1 | cutscene 按需生成 | cutscene 演员像 battle 敌人一样 scenario-gated spawn，不在场景 init 时就生成 |
| 2 | ScriptedCamera 跟随 | scripted 相机能在 sequence 中跟随一个 actor（prop/character），不再只盯固定坐标 |
| 3 | NPC idle behavior 化 | Charlotte 的 observe 变常驻 idle 行为，由数据配置；不同 NPC idle 可不同 clip |

三者互相独立，可分别实施（依赖关系见 §4）。

---

## 1. 需求一：cutscene 按需生成（按 scenario 推进）

### 1.1 现状

- cutscene 触发：[ExploreMode.#updateCutsceneInvokers](file:///e:/se/BlindDuel/scripts/Systems/Modes/ExploreMode.js#L321-L352) 每帧扫 `sceneDef.cutsceneInvokers`，condition 满足 + `armDelayMs` 计时完 → `fetch(sequenceUrl)` → `sceneSequencer.play(seq)`。
- cutscene 演员：`prop_faller` 在 [prologue.json](file:///e:/se/BlindDuel/Data/SceneDefs/prologue.json#L36-L45) 里 `spawnIf: { flagNot: "prologue_prop_played" }` —— **只受 flag 锁，不限 scenario**。
- 对比 battle：`enemy_1` 用 `spawnIf: { scenarioMin: 105, flagNot: "prologue_battle" }`，scenario 未到不生成。

### 1.2 问题

`prop_faller` 在 scenario 100（章节开始）就被 spawn 出来挂在场景里，只是因为没动画/在画面外所以不显眼。这违反“按需生成”原则：

- 视觉风险：未来 cutscene 演员若带 idle 动画或落在画内，会提前穿帮。
- 资源占用：cutscene 专用 atlas/rootMotion 提前加载进实体。
- 语义不一致：cutscene 触发是 scenario-gated，演员却是 flag-only-gated，两条门槛不对齐。

### 1.3 设计

**核心思路：cutscene 演员的 spawnIf 与 cutsceneInvoker 的 condition 对齐，都按 scenario 推进。** 完全复用现有 `_pendingSpawns` + WorldState 观察者动态 spawn 机制（[Scene._onWorldStateChange](file:///e:/se/BlindDuel/scripts/Scene.js#L451-L461)），零新增系统。

并行结构对照：

| | battle | cutscene |
|---|--------|----------|
| 触发器 | `triggers[].type="battle"` + `condition.scenarioMin` | `cutsceneInvokers[]` + `condition.scenarioMin` |
| 演员 spawn | `enemy_1` entity `spawnIf.scenarioMin` | `prop_faller` entity `spawnIf.scenarioMin` ← **本次补** |
| 触发时机 | hero 进 AABB + 交互键 | condition 满足 + armDelay |
| 一次性锁 | `flagNot: "prologue_battle"` | `flagNot: "prologue_prop_played"` |

### 1.4 数据变更

[prologue.json](file:///e:/se/BlindDuel/Data/SceneDefs/prologue.json#L36-L45) `prop_faller`：

```jsonc
{
    "archetype": "prop",
    "id": "prop_faller",
    "name": "prop_faller",
    "kind": "prop",
    "pos": [-1.2, 1, 0],
    "controller": "none",
    "initialClip": "idle",
    "spawnIf": { "scenarioMin": 105, "flagNot": "prologue_prop_played" }
}
```

仅新增 `scenarioMin: 105`。其余不动。

### 1.5 时序验证点（关键）

scenario 100→105（交任务后 `advanceScenario`）触发链：

1. `QuestManager.advanceTo(105)` → `worldState.setScenario(105)` → `_notify`
2. `Scene._onWorldStateChange` → `prop_faller` 的 `spawnIf` 满足 → `_spawnEntity` → 注册进 `_actorRegistry`（[Scene.js:406-408](file:///e:/se/BlindDuel/scripts/Scene.js#L406-L408)）+ `entityPool` + `exploreMode._buildIndices()`
3. 同一帧 ExploreMode.fixedUpdate → `#updateCutsceneInvokers` → `prop_and_follow` condition 满足 → arm 500ms
4. 500ms 后 fire → `fetch(prologue_cs_rabble_flee.json)` → `sceneSequencer.play(seq)`
5. sequence 的 `prop.fall` track `binding.actorId:"prop_faller"` → `_resolveActor` 从 `actorRegistry` 命中 → `command:"fall"`

**需验证**：step 2 在 step 4 之前完成（同帧同步 spawn，armDelay 500ms 足够缓冲 fetch + build）。若偶发 miss，加大 `armDelayMs` 或在 `_spawnEntity` 末尾对 prop kind 做一次显式 `actorRegistry` 二次确认。

### 1.6 代码改动

- [prologue.json](file:///e:/se/BlindDuel/Data/SceneDefs/prologue.json#L36-L45)：`spawnIf` 加 `scenarioMin: 105`。
- 无代码改动（机制已就绪）。可选：给 `_spawnEntity` 的 prop 分支加一行 log 便于排查。

### 1.7 风险

- 低。复用成熟机制。唯一新点是 prop kind 的动态 spawn 路径（之前 prop 只在 init spawn），需回归一次 prop cutscene 正常播完 + dispose。

---

## 2. 需求二：ScriptedCamera 支持 sequence 内跟随对象

### 2.1 现状

[ScriptedCameraRig](file:///e:/se/BlindDuel/scripts/ScriptedCameraRig.js)：
- 持 `_center / _height / _orthoWidth / _zOffset`，由 `setFrame({...})` 设定静态画幅。
- `compute` 每帧用固定 `_center` 算 pos/target，**不读任何 actor**。
- sequence 侧：[setCameraFrame clip](file:///e:/se/BlindDuel/scripts/Systems/TimelineSequencer.js#L511-L524) 在 `atMs` 一次性调 `rig.setFrame`，之后相机钉死在该坐标。

### 2.2 问题

prop（rabble_flee）下落→落地→向右跑出画面，相机只能钉在固定坐标，演员会跑出画幅。需要“sequence 中相机跟随某 actor”的能力。

### 2.3 设计

**ScriptedCameraRig 增加 follow target 模式**，与现有静态 frame 模式互斥：

- `setFollowTarget(actor, { offsetX, offsetY, offsetZ, lerp })`：进入跟随，`compute` 每帧把 `_center` 向 `actor.root.position + offset` 插值。
- `clearFollow()`：退回静态 `_center`。
- `setFrame(...)`：隐式 `clearFollow()`（设静态框即停止跟随）。

新增一个 TimelineSequencer clip `setCameraFollow`，复用 `_resolveActor` 解析 actor。

### 2.4 数据形状（新 clip）

```jsonc
{
  "type": "setCameraFollow",
  "atMs": 1000,
  "actorId": "prop_faller",
  "offsetX": 0, "offsetY": 0, "offsetZ": 0,
  "lerp": 0.12,
  "height": 4.5,
  "orthoWidth": 14
}
```

字段：
- `actorId`：跟随目标（走 `_resolveActor`，与 moveActorTo 同源）。
- `offsetX/Y/Z`：目标点相对 actor root 的偏移（世界单位）。
- `lerp`：0~1，每帧逼近系数（1=瞬贴，0.1=缓慢拖曳）。`compute` 内按 `dtMs` 归一化：`k = 1 - Math.pow(1 - lerp, dtMs / 16.67)`。
- `height / orthoWidth`：可选，进入跟随时一并调整画幅。

退出跟随两种方式：
- 显式：后续 `setCameraFrame` clip（自动 clearFollow）。
- 隐式：`cameraBlend` 切回 explore/duel rig 后 scripted rig 不再 active，follow 状态残留无害（但下次进 scripted 前应 clear，见 §2.6）。

### 2.5 代码改动点

1. [ScriptedCameraRig.js](file:///e:/se/BlindDuel/scripts/ScriptedCameraRig.js)：
   - 加 `_followTarget / _followOffset / _followLerp`。
   - `setFollowTarget(actor, opts)` / `clearFollow()`。
   - `setFrame` 末尾调 `this._followTarget = null`。
   - `compute`：if `_followTarget` 存在且 `actor.root` 可达 → lerp `_center`；else 用原逻辑。

2. [TimelineSequencer.js](file:///e:/se/BlindDuel/scripts/Systems/TimelineSequencer.js#L511-L524) ACTION_HANDLERS：
   - 新增 `setCameraFollow` handler（event clip，只 start）：`_resolveActor(ctx, {actorId})` → `rig.setFollowTarget(actor, {...clip})`。
   - `setCameraFrame` handler 末尾保持现状（rig.setFrame 已隐式 clear follow）。

3. [prologue_cs_rabble_flee.json](file:///e:/se/BlindDuel/Data/Sequences/prologue_cs_rabble_flee.json)（可选示范）：prop 开始 run 时插入 `setCameraFollow`，dispose 前插 `setCameraFrame` 回静态框。

### 2.6 风险与边界

- **actor 被 dispose 中途**：prop 在 3000ms 被 `disposeProp` callback 销毁。若 follow 仍指向它，`compute` 访问 `actor.root.position` 会拿到 disposed TransformNode（Babylon 下 position 仍可读但不动）。**对策**：在 `disposeProp` handler（[ExploreMode.#handleDisposeProp](file:///e:/se/BlindDuel/scripts/Systems/Modes/ExploreMode.js#L355-L373)）里先 `scriptedCameraRig.clearFollow()` 再销毁；或在 sequence 里 dispose 前先发一个 `setCameraFrame` 切回静态框。推荐后者（数据驱动，不耦合 handler）。
- **lerp 抖动**：`moveActorTo` 驱动的 actor 位置每 fixedUpdate 跳变，camera 在 renderUpdate 插值可能略抖。可接受（原型阶段）。
- **跨 sequence 残留**：sequence A 设了 follow 未 clear，sequence B 进 scripted rig 时残留。对策：`cameraBlend` 切到 scripted 时 rig.enter 可 reset follow（[ScriptedCameraRig.enter](file:///e:/se/BlindDuel/scripts/ScriptedCameraRig.js#L9-L17) 已存在，加一行 `this._followTarget = null`）。

---

## 3. 需求三：NPC idle 解耦为 behavior（Charlotte observe 常驻）

### 3.1 现状

- Charlotte 的 `observe` 状态由 [prologue_intro.json#L51](file:///e:/se/BlindDuel/Data/Sequences/prologue_intro.json#L51) `{ "type": "command", "atMs": 3600, "command": "observe" }` 触发，是 intro sequence 的一次性指令。
- [NpcController](file:///e:/se/BlindDuel/scripts/Systems/NpcController.js#L91-L99) `enterIdle` 硬编码 `npc.enterState("idle")`；[FollowingBehavior](file:///e:/se/BlindDuel/scripts/Systems/NpcBehaviors/FollowingBehavior.js#L52-L55) 停下时也硬编码进 `"idle"`。
- Charlotte stateGraph（[CharacterFactory.createCompanionNpc](file:///e:/se/BlindDuel/scripts/CharacterFactory.js#L455-L475)）：`idle/walk/observe` 三态，`idle` clip="idle"，`observe` 是独立 state。
- [NpcDefs.js](file:///e:/se/BlindDuel/Data/NpcDefs.js) 只有 `dialogues`，无 idle 配置。

### 3.2 问题

- observe 依赖 intro command，intro 结束后无人重置就丢；玩家走近触发 greeting→enterIdle 进 "idle" clip，observe 永久丢失。**非常驻**。
- idle 行为硬编码在 NpcController/FollowingBehavior，不同 NPC 想要不同 idle 演出无法数据配置。
- “idle”在 companion 这里语义混乱：stateGraph 的 `idle` state 播 "idle" clip，但期望的常驻演出是 "observe" clip。

### 3.3 设计

**引入 IdleBehavior（NpcBehavior 子类），idle clip 数据驱动配置在 NpcDef。** NpcController.enterIdle 与 FollowingBehavior 停下时都走 IdleBehavior，统一 idle 入口。

#### IdleBehavior（新增）

```js
// scripts/Systems/NpcBehaviors/IdleBehavior.js
import { NpcBehavior } from "./NpcBehavior.js";

export class IdleBehavior extends NpcBehavior {
    enter(npc, context) {
        const clip = this.options.clip ?? "idle";
        // 优先直接播 clip（兼容 stateGraph 命名不一致，如 bard 的 idle→Play）
        if (npc.animation?.play) {
            npc.animation.play(clip, { restart: false });
            return;
        }
        if (npc.hasState(clip)) {
            npc.enterState(clip);
        }
    }
    // update 预留：未来可加 ambient（随机环视、小幅度徘徊、对玩家朝向）
}
```

直接走 `animation.play(clip)` 而非 `enterState`，绕开各 NPC stateGraph 命名差异（bard 的 idle state 播 Play clip、companion 有独立 observe state 等），更鲁棒。

#### NpcDef 扩展

[NpcDefs.js](file:///e:/se/BlindDuel/Data/NpcDefs.js) 每个 def 加 `idle` 字段：

```jsonc
companion: { ..., idle: { clip: "observe" } },
bard:      { ..., idle: { clip: "Play" } },
// 未配置的 NPC 回退 clip="idle"
```

#### NpcController 改造

- 构造：`this._idleBehavior = new IdleBehavior({ clip: npcDef?.idle?.clip ?? "idle" })`。
- [enterIdle](file:///e:/se/BlindDuel/scripts/Systems/NpcController.js#L91-L99)：改为 `this._behavior = this._idleBehavior; this._behavior.enter(npc, {...})`，不再直接 `npc.enterState("idle")`。
- `enterFollowing`：构造 FollowingBehavior 时传入 `idleClip`，让停下时也走 observe。
- `_behavior` 早退分支（[NpcController.update](file:///e:/se/BlindDuel/scripts/Systems/NpcController.js#L42-L52)）天然覆盖 idle/following 两态。

#### FollowingBehavior 改造

[FollowingBehavior.js#L52-L55](file:///e:/se/BlindDuel/scripts/Systems/NpcBehaviors/FollowingBehavior.js#L52-L55) 停下时：

```js
const idleClip = this.options.idleClip ?? "idle";
if (npc.animation?.play) npc.animation.play(idleClip, { restart: false });
else if (npc.hasState(idleClip)) npc.enterState(idleClip);
```

`enterFollowing` 时 `new FollowingBehavior({ idleClip: npcDef?.idle?.clip ?? "idle" })`。

### 3.4 与 intro 的关系

intro 的 `command: observe`（[prologue_intro.json#L51](file:///e:/se/BlindDuel/Data/Sequences/prologue_intro.json#L51)）改为 callback `enterCompanionIdle`，由 NpcController.enterIdle → IdleBehavior 接管：

```jsonc
{ "type": "callback", "atMs": 3600, "fn": "enterCompanionIdle" }
```

[ExploreMode._registerSequenceHandlers](file:///e:/se/BlindDuel/scripts/Systems/Modes/ExploreMode.js#L303-L310) 已注册一组 companion handler，新增：

```js
handlers.set("enterCompanionIdle", (ctx, clip) => {
    const companion = ctx.actorRegistry?.get("companion");
    companion?.npcController?.enterIdle(companion);
});
```

这样：
- intro 走位结束 → callback → enterIdle → IdleBehavior 播 observe。
- 之后玩家触发 greeting → 结束后 enterIdle → 重新播 observe（常驻）。
- prop cutscene 末尾 `enterCompanionFollowing` → 跟随态；停下时也播 observe（idleClip 传入）。

> **注意**：intro 期间 NpcController._behavior 仍为 null（构造时未 enterIdle），sequencer 的 `command: walk` / callback 不会被 IdleBehavior 覆盖，无冲突。这与 §2.6 的 `controlledBySequence` 无关（NpcCharacter 不加该标记，见回归文档 §2.6）。

### 3.5 代码改动点

1. 新增 [scripts/Systems/NpcBehaviors/IdleBehavior.js](file:///e:/se/BlindDuel/scripts/Systems/NpcBehaviors/IdleBehavior.js)。
2. [NpcController.js](file:///e:/se/BlindDuel/scripts/Systems/NpcController.js)：构造建 `_idleBehavior`；`enterIdle` 走 behavior；`enterFollowing` 传 `idleClip`。
3. [FollowingBehavior.js](file:///e:/se/BlindDuel/scripts/Systems/NpcBehaviors/FollowingBehavior.js)：停下时用 `idleClip`。
4. [NpcDefs.js](file:///e:/se/BlindDuel/Data/NpcDefs.js)：companion / bard 加 `idle.clip`。
5. [prologue_intro.json#L51](file:///e:/se/BlindDuel/Data/Sequences/prologue_intro.json#L51)：`command: observe` → `callback: enterCompanionIdle`。
6. [ExploreMode.js](file:///e:/se/BlindDuel/scripts/Systems/Modes/ExploreMode.js#L303-L310)：注册 `enterCompanionIdle` handler。

### 3.6 风险

- **animation.play 与 enterState 并存**：`animation.play` 不走 stateGraph transition 逻辑，对 NPC（无 transition）安全；但会绕开 `currentStateName` 同步。需确认 NpcCharacter 的 `currentStateName` 在 `animation.play` 后是否仍被读（FollowingBehavior 读 `npc.currentStateName` 判 walk/idle）。**对策**：IdleBehavior.enter 同时 `npc.enterState(clip)` 若 hasState，否则才 fallback `animation.play`；或在 NpcCharacter 上加 `playIdleClip(clip)` 方法统一两者。倾向后者，集中收口。
- **bard/customer 等存量 NPC 回归**：它们无 `idle` 配置 → 回退 "idle" clip，行为不变。需跑一遍 tavern 场景确认无回归。

---

## 4. 实施顺序与依赖

三者无强依赖。需求 2 的验证可借需求 1 的 prop cutscene（follow prop_faller 跑出画面），所以建议 1→2 顺序验证更顺；需求 3 与 2 无交集。

建议拆三个独立 commit，每个带一次 Prologue 全流程回归（intro → 拾取 → 交任务 → prop cutscene → 跟随 → 战斗 → outro）。

---

## 5. 开放问题（待拍板）

1. **cutscene 演员是否需要更通用的生命周期？** 当前方案是“演员 spawnIf 与 invoker condition 对齐”。若未来 cutscene 演员是纯临时（cutscene 结束即销毁，不占 entityDef），可考虑在 `cutsceneInvokers` 里声明 `requiredActors`，fire 时由 Scene 动态 spawn、结束时 dispose。当前 prop_faller 本就是 entityDef + flag 锁，不需要。**建议：暂不做，留 backlog。**
2. **setCameraFollow 是否需要 look-ahead（超前偏移）？** 演员高速移动时镜头滞后会丢出画。原型阶段先用 `lerp` + `offsetX` 手调，不够再加 `lookAhead` 字段。
3. **IdleBehavior.update 的 ambient 演出粒度**：本次只做 enter 播 clip。未来“随机环视/小徘徊”是否做成可配置脚本（类似 testController 的 scriptConfig）？**建议：未来需求驱动，本次不预留字段。**
4. **observe 是否要随玩家朝向翻转？** Charlotte observe 若面向玩家更自然。当前 NpcCharacter facing 由 controller/sequencer 设。**建议：本次不做，observe clip 本身朝向固定即可；未来 IdleBehavior.update 里按玩家方向 setFacing。**
5. **intro 的 `command: walk` 是否也改 callback？** 仅 observe 改 callback 即可让 idle 常驻；walk 是走位中动作，保留 command 无副作用。**建议：只改 observe 那条。**

---

## 6. 验证清单（实施后）

### 需求1
- [ ] scenario 100 时 prop_faller 不在 entityPool / actorRegistry
- [ ] scenario→105 同帧 prop_faller spawn 进 actorRegistry
- [ ] 500ms 后 cutscene 正常 fire，`_resolveActor("prop_faller")` 命中
- [ ] cutscene 播完 prop 被 dispose，flag `prologue_prop_played` 置位
- [ ] 重进场景（flag 已置）prop 不再 spawn

### 需求2
- [ ] `setCameraFollow` clip 触发后，相机随 actor 移动
- [ ] `lerp` 调参有效（0.1 拖曳 / 1.0 瞬贴）
- [ ] 后续 `setCameraFrame` 切回静态框，follow 停止
- [ ] actor dispose 前 clearFollow（不崩、镜头不钉死）
- [ ] 切回 explore rig 再切回 scripted，无残留 follow

### 需求3
- [ ] intro 3600ms callback 触发 enterIdle → Charlotte 播 observe
- [ ] 玩家走近触发 greeting → 结束后回 idle → 重新播 observe（常驻）
- [ ] prop cutscene 后 enterFollowing，跟随停下时播 observe
- [ ] bard（idle.clip="Play"）在 tavern 仍正常播 Play，无回归
- [ ] 未配 idle 的 NPC（customer 等）回退 "idle" clip，行为不变