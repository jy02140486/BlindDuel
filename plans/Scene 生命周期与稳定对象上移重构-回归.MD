# Scene 生命周期与稳定对象上移重构-回归

> **状态：待实施。** 本文档承接 `Scene 生命周期与稳定对象上移重构计划.MD`（B1-B10 已完成），记录重构后遗留的架构债分析与修复计划。
> **触发背景**：Prologue Step 2 设计主循环时序方案 W（bootstrap/init 分离）时排查发现。
> **核心结论**：B1-B10 重构已达成"稳定对象上移"的核心目标，**无双重创建、无孤儿对象、无 DOM 泄漏**。遗留问题主要是代码整洁性与职责边界清晰度，不阻塞 Prologue 开发，但建议在 Prologue Step 2 完成后清理。

---

## 1. 排查纠正

> Prologue 会话中曾基于 [Scene.js:261-271](file:///e:/se/BlindDuel/scripts/Scene.js#L261-271) 误判"Scene.init 双重创建 rigs 导致孤儿+泄漏"。经核对实际代码，**此判断错误**，特此纠正：

| 误判项 | 实际真相 | 证据 |
|--------|----------|------|
| Scene.init new 了 Scene 局部 rigs | ❌ 取 Game 引用 | [Scene.js:189-191](file:///e:/se/BlindDuel/scripts/Scene.js#L189-191) `this.cameraRig = this._game.cameraRig` |
| Game.bootstrap 的 rigs 是孤儿 | ❌ 被 Scene.init 复用 | 同上，Scene.init 注册进 cameraManager 的就是 Game 的 rigs |
| DuelCameraRig debug panel 泄漏 | ❌ 只一份 | [DuelCameraRig.js:51-64](file:///e:/se/BlindDuel/scripts/DuelCameraRig.js#L51-64) 只 Game.bootstrap new 一次 |

**结论**：B6/B8 步骤实际达成目标，无回退需要。

---

## 2. 真实遗留问题

### 2.1 Scene 持有稳定对象的别名（整洁性，低优先级）

**现状**：
- [Scene.js:261](file:///e:/se/BlindDuel/scripts/Scene.js#L261) `this.cameraManager = this._game.cameraManager;`
- [Scene.js:189-191](file:///e:/se/BlindDuel/scripts/Scene.js#L189-191) `this.cameraRig/exploreCameraRig/scriptedCameraRig = this._game.*`
- [Scene.js:271-273](file:///e:/se/BlindDuel/scripts/Scene.js#L271-273) `this.inventoryBar/buffBar/hpBar/dialogueBubble = this._game.*`
- Scene.updateRender/fixedUpdate 通过 `this.cameraManager` / `this.gameModeManager` 等访问

**问题**：
- Scene 既持 Game 引用别名，又持自己的局部对象（scene/camera/walkArea/entities/...），"半别名半局部"让职责边界模糊
- 别名字段在 Scene 构造时是 null（[Scene.js:30-37](file:///e:/se/BlindDuel/scripts/Scene.js#L30-37)），init 里才赋值——存在"半初始化窗口"

**影响**：
- 概念冗余，非 bug。行为完全等价于 `this._game.cameraManager`
- **对 Prologue 方案 W 的影响**：主循环在 bootstrap 后、scene.init 前跑时，`scene.cameraManager` 是 null，[Scene.js:358](file:///e:/se/BlindDuel/scripts/Scene.js#L358) `if (this.cameraManager)` null-safe 不崩，但 cameraManager.update 不被调。若改用 `this._game.cameraManager` 则无此窗口期

**修复方案**：
- 移除 Scene 上的稳定对象别名字段（cameraManager/cameraRig/exploreCameraRig/scriptedCameraRig/inventoryBar/buffBar/hpBar/dialogueBubble/inputSystem/playerController/combatSystem/gameModeManager/sceneSequencer）
- 改为通过 `this._game.xxx` 或 `this.sharedContext.xxx` 访问
- Scene 只保留自己的局部对象字段（scene/camera/walkArea/entities/triggers/sceneVisualSystem/stageBoundary/pushboxResolver）
- Scene 构造函数相应删掉这些字段的 null 初始化

**风险**：
- 改动面较大（grep cameraManager 在 Scene.js 有 16 处引用）
- 需逐处替换并验证

### 2.2 Scene.init 里 rigs.clear()+registerRig 幂等冗余（整洁性，低优先级）

**现状**：[Scene.js:262-267](file:///e:/se/BlindDuel/scripts/Scene.js#L262-267)
```js
this.cameraManager.rigs.clear();
this.cameraManager.registerRig("duel", this.cameraRig);      // this.cameraRig 就是 this._game.cameraRig
this.cameraManager.registerRig("explore", this.exploreCameraRig);
this.cameraManager.registerRig("scripted", this.scriptedCameraRig);
this.cameraManager.activeRig = null;
this.cameraManager.activeRigId = null;
```

**问题**：
- `this.cameraRig` 等是 Game 引用（§2.1），bootstrap 已 registerRig 过同名 rig
- 切场景时 clear + register 同一组，**幂等但冗余**
- `activeRig = null; activeRigId = null` 强制重置相机到无 rig 状态——这是有意的（新场景从默认 rig 开始，由 mode.enter 触发 switchRig），但缺乏注释说明意图

**影响**：无功能影响。每次切场景多做一次无意义的 map clear+refill。

**修复方案**：
- 移除 `rigs.clear()` 和三行 `registerRig`（bootstrap 已注册，跨场景稳定）
- 保留 `activeRig = null; activeRigId = null` 并加注释：`// 切场景后强制重置，由 mode.enter 重新 switchRig`
- 或：完全移除这段，让相机 rig 跨场景保持——需确认是否所有 mode.enter 都会显式 switchRig（若不会，跨场景 rig 残留会出 bug）

**风险**：低。改完跑三场景切换回归即可。

### 2.3 Scene.dispose 的 `!== this._game?.xxx` 死代码（整洁性，最低优先级）

**现状**：[Scene.js:390-407](file:///e:/se/BlindDuel/scripts/Scene.js#L390-407)
```js
if (this.buffBar && this.buffBar !== this._game?.buffBar) {
    this.buffBar.dispose();
}
// ... 同样模式 5 处：hpBar/cameraRig/exploreCameraRig/...
this.cameraManager = null;  // 只断引用，不 dispose
```

**问题**：
- 重构后 `this.buffBar` 等永远等于 `this._game.buffBar`（§2.1 别名），`!==` 判断永远为 false
- 这是 B8 步骤的过渡期防御代码，重构完成后成了死代码

**影响**：无。纯死代码。

**修复方案**：
- 移除这些 `if (xxx !== this._game?.xxx) xxx.dispose()` 块
- 留 `this.xxx = null` 断引用（配合 §2.1 移除别名字段，连 null 都不用设）

**风险**：零。

### 2.4 sharedContext 字段重复赋值（整洁性，低优先级）

**现状**：[Scene.js:228-247](file:///e:/se/BlindDuel/scripts/Scene.js#L228-247) Scene.init 里把 Game 已有的稳定对象重新赋给 sharedContext：
```js
sharedContext.combatSystem = this.combatSystem;       // Game.bootstrap 已赋
sharedContext.cameraRig = this.cameraRig;             // Game.bootstrap 已赋
sharedContext.exploreCameraRig = this.exploreCameraRig;  // 同上
sharedContext.scriptedCameraRig = this.scriptedCameraRig;  // 同上
// ...
```

**问题**：
- 稳定对象在 Game.bootstrap 已赋值进 sharedContext，Scene.init 重复赋值是冗余
- 但 Scene.init 也赋了必要的 Scene 局部字段（scene/babylonScene/actorRegistry/walkArea/...），不能整段删

**影响**：无功能影响。冗余赋值。

**修复方案**：
- 区分"稳定对象"（删）和"Scene 局部对象"（保留）
- 稳定对象：combatSystem/cameraRig/exploreCameraRig/scriptedCameraRig/cameraManager（这些 Game.bootstrap 已赋）
- Scene 局部对象：scene/babylonScene/inputSystem/playerController/rabbleController/actorRegistry/character/rabbleStick/pushboxResolver/stageBoundary/walkArea/sceneVisualSystem/entityPool/cameraBasePosition/cameraTarget/smoothedFighterDistance/sceneDef/battleDefs/stageMaskData
- 注意：inputSystem/playerController 虽然是 Game 稳定对象，但 Scene.init 里会 setCharacter 等更新，需确认是否真的稳定

**风险**：中。需逐字段确认归属，改完跑回归。

### 2.5 切场景期间 sharedContext 指向已 dispose 对象的窗口期（潜在 bug，中优先级）

**现状**：[Game.js:246-254](file:///e:/se/BlindDuel/scripts/Game.js#L246-254) `_loadSceneInternal` 流程：
```js
newScene._loading = true;
this.scene = newScene;          // 切引用
oldScene.dispose();             // 旧 scene 销毁，但 sharedContext.sceneVisualSystem/stageBoundary 等仍指向旧对象
await newScene.init(sceneDef, BATTLE_DEFS);  // 期间 sharedContext 是脏的
newScene._loading = false;
```

**问题**：
- `oldScene.dispose()` 后，`sharedContext.sceneVisualSystem/stageBoundary/walkArea/entityPool/...` 仍指向已 dispose 的旧对象
- `await newScene.init()` 期间（异步加载），主循环若调任何访问这些字段的代码，会访问到已 dispose 对象
- 当前靠 `scene._loading=true` 早退屏蔽（[Scene.js:344/355](file:///e:/se/BlindDuel/scripts/Scene.js#L344)），但 Prologue 方案 W 要在 `_loading` 期间仍调 cameraManager.update——需确认 cameraManager.update 不访问这些脏字段

**影响**：
- 当前不崩（_loading 早退保护）
- **对 Prologue 方案 W 的影响**：若 cameraManager.update / sceneSequencer.fixedUpdate 在 _loading 期间被调，且它们内部访问 sharedContext.sceneVisualSystem 等，会崩。需逐函数确认

**修复方案**：
- 选项 A：`oldScene.dispose()` 前先把 sharedContext 的 Scene 局部字段清 null，新 Scene.init 再赋值。访问处加 null check
- 选项 B：保持现状，确认 _loading 期间被放行的子系统（cameraManager/sceneSequencer）不访问脏字段即可
- 推荐 B（改动小），需在 Prologue Step 2 实施时验证

**风险**：中。是 Prologue 方案 W 的潜在阻塞点。

### 2.6 sequencer 与 character/controller 交互职责不清（架构，中优先级）

**触发**：Prologue Step 2b 验证 moveActorTo 原语时发现。

**现状**：[TimelineSequencer.js:314-363](file:///e:/se/BlindDuel/scripts/Systems/TimelineSequencer.js#L314-363) `moveActorTo` handler 直接调 `actor.setMoveIntent(...)`（写 character.moveIntent），但 character.moveIntent 的唯一写者应是 controller 的 `applyToCharacter`（[BaseController.js:45-55](file:///e:/se/BlindDuel/scripts/Systems/BaseController.js#L45-55)）。

**冲突**：同一 fixedUpdate tick 内执行顺序为
```
Scene.fixedUpdate:
  1. sceneSequencer.fixedUpdate → moveActorTo.update → actor.setMoveIntent({1,0})  ← 设了
  2. gameModeManager.fixedUpdate → PlayerController.fixedUpdate → applyToCharacter → character.setMoveIntent({0,0})  ← 覆盖
```
PlayerController 即使 `enabled=false`（inputLock），其 fixedUpdate 仍调 `this.setMoveIntent({0,0})` 后 return——但 enabled=false 时不调 applyToCharacter，所以 moveActorTo 的 moveIntent 保留。当前靠 inputLock 补丁让动画能播。

**问题**：
- sequencer 绕过 controller 直接写 character.moveIntent，违反“controller 是唯一写者”约束
- 依赖 inputLock 副作用（enabled=false 时不 applyToCharacter）才 work，隐式耦合
- NPC 移动（Step 5/6 companion 走入）走 NpcController 路径，可能有类似或不同问题

**修复方案（待定）**：
- 方案 A（现状）：moveActorTo 直接写 character.moveIntent + inputLock 补丁。简单但脆弱
- 方案 B：sequencer 走 controller 接口（`controller.setMoveIntent` / `controller.queueCommand`），controller 加“sequencer 模式”区分玩家输入与 sequencer 输入。维持“controller 唯一写者”约束
- 方案 C：moveActorTo 绕过 moveIntent，直接写 position + pushCommand 驱动状态机。与 character 内部 _applyMovement 并行，易不一致

**处理时机**：不单独修。等 Prologue Step 5/6（companion 走入 + NpcController 跟随）实施时一并统一 sequencer→controller/character 驱动路径，那时能看清 NPC 侧的实际冲突。

**当前 workaround**：moveActorTo sequence 必须配 inputLock（locked=true 覆盖移动段，结束后 locked=false）。见 [prologue_intro.json](file:///e:/se/BlindDuel/Data/Sequences/prologue_intro.json) hero.walk track。

### 2.7 cameraEffect event clip 不调 handler.end（架构，低优先级）

**触发**：Prologue Step 2c 验证 letterbox 时发现。

**现状**：[TimelineSequencer.js:143-155](file:///e:/se/BlindDuel/scripts/Systems/TimelineSequencer.js#L143-155) event clip（有 `atMs` 字段）只调 `handler.start`，直接 return，不走 wasActive/justCrossedEnd 分支，**永不调 `handler.end`**。

**影响**：[TimelineSequencer.js:521-529](file:///e:/se/BlindDuel/scripts/Systems/TimelineSequencer.js#L521-529) `cameraEffect.end` 里的 `clearEffects` 对 event 形式无效。但 letterbox/fade 的 DOM 仍能消失，靠的是 [CameraManager.js:438-471](file:///e:/se/BlindDuel/scripts/Systems/CameraManager.js#L438-471) effect 内部生命周期（entering→staying→exiting→return true 过期）自管，不依赖 clip.end。

**语义不一致**：
- event 形式（atMs）：effect 完全自管，durationMs 决定 enter+stay+exit 总时长
- interval 形式（startMs+durationMs）：clip.end 会调 clearEffects，可能跟 effect 自然过期冲突（若 clip durationMs ≠ effect 内部生命周期）

**处理时机**：不单独修。等 NPC 移动/sequencer 交互统一处理（§2.6）时一并考虑 clip 调度与 effect 生命周期的职责边界。

**当前状态**：2c 用 event 形式 + effect 自管生命周期，work 正常。不阻塞 2d/2e。

---

## 3. 修复优先级与顺序

| 优先级 | 问题 | 理由 | 时机 |
|--------|------|------|------|
| P1 | §2.5 切场景窗口期 | 潜在 bug，可能阻塞 Prologue 方案 W | Prologue Step 2 实施时验证，若崩则修 |
| P2 | §2.1 别名冗余 | 整洁性，但改动面大，需回归 | Prologue Step 2 完成后单独做 |
| P3 | §2.4 sharedContext 重复赋值 | 整洁性，依赖 §2.1 完成 | 跟 §2.1 一起做 |
| P4 | §2.2 rigs 幂等冗余 | 整洁性，独立小改 | 任意时机 |
| P5 | §2.3 dispose 死代码 | 整洁性，零风险 | 任意时机，可顺手清 |

---

## 4. 与 Prologue 计划的关系

- **不阻塞**：Prologue Step 2（主循环时序方案 W）可在当前架构上实施，§2.5 是唯一需验证的潜在阻塞点
- **依赖关系**：Prologue Step 2 完成后做 §2.1/§2.4 清理，避免一次改太多
- **共享验证**：§2.1/§2.4 清理后跑 Prologue Step 2 的分层验证（Layer 0-7）作为回归

---

## 5. 验证清单

### §2.1 完成后（别名移除）
- [ ] Scene.js grep `this.cameraManager =` 无赋值（只读访问可保留或改 `this._game.cameraManager`）
- [ ] Scene.js grep `this.cameraRig =` 同上
- [ ] Scene 构造函数删掉稳定对象字段的 null 初始化
- [ ] 三场景切换正常
- [ ] Prologue Step 2 Layer 0-7 全通过

### §2.2 完成后（rigs 冗余移除）
- [ ] Scene.init 不再 `rigs.clear()` + `registerRig`
- [ ] 切场景后相机 rig 正确（由 mode.enter switchRig）
- [ ] 三场景切换正常

### §2.3 完成后（死代码移除）
- [ ] Scene.dispose 不再有 `!== this._game?.xxx` 判断
- [ ] 切场景不崩

### §2.4 完成后（sharedContext 去重）
- [ ] Scene.init 只赋 Scene 局部字段，不重复赋稳定对象
- [ ] sharedContext 字段在切场景前后值正确

### §2.5 验证（窗口期）
- [ ] Prologue 方案 W 实施期间，_loading 期 cameraManager.update 不访问脏字段
- [ ] 或：sharedContext Scene 局部字段在 dispose 前清 null，访问处 null-safe

---

## 6. 实施建议

1. **不在 Prologue Step 2 之前动**：架构债清理改动面大，叠在 Step 2 上会模糊问题定位
2. **Prologue Step 2 完成后做 §2.1+§2.4**：作为独立小重构，用 Step 2 的分层验证当回归
3. **§2.2/§2.3 任意时机顺手清**：风险低，可单独 commit
4. **§2.5 在 Step 2 实施时顺带验证**：若 Layer 0 主循环提前后不崩，说明 §2.5 不是问题；若崩，单独修