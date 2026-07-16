# Sequencer 期间门控修复计划

> 关联文档：[docs/TimelineSequencer User Guide.md](../docs/TimelineSequencer%20User%20Guide.md)
> 关联 issue：intro 播放期间 Charlotte 对话气泡误触；intro/outro walkArea clamp 行为不对称

## 1. 问题与根因回顾

### 1.1 现象 A：intro 期间 Charlotte 对话气泡误触
- [ExploreMode.fixedUpdate](../scripts/Systems/Modes/ExploreMode.js#L41-L52) 的 NPC 循环**不检查 sequencer 是否 busy**，每帧调 `npcController.update(...)`
- [NpcController.update](../scripts/Systems/NpcController.js#L64-L72) 在 idle 态检测 hero 进入 `greetingRadius`(1.6) 就 `enterGreeting` → `dialogueBubble.show(npc)`
- intro 中 hero(-26→-18) 与 Charlotte(-24→-18) 必然进入 1.6 半径 → 气泡弹出
- 对照：hero 移动有 `controlledBySequence` 守卫挡住 controller，Charlotte 动画靠 `command:"walk"` clip 直接 enterState；**唯独 greeting 路径没有任何 sequencer 门控**

### 1.2 现象 B：sequencer 缺通用对话气泡 clip
- 现有 clip 类型：`command / moveActorTo / cameraBlend / setCameraFrame / cameraEffect / inputLock / faceWorldX / switchMode / callback / wait`，无 `dialogueBubble`
- 仅有的气泡控制是两个写死 Charlotte 的 callback：`showCompanionBubble` / `hideCompanionBubble`（[ExploreMode.js#L386-L393](../scripts/Systems/Modes/ExploreMode.js#L386-L393)）
  - 硬编码 `find(id==="companion")`、文本写死 `"!"`、不能指定 NPC、不能指定文本
- 不是通用机制，无法满足"对话气泡由 sequence 控制"的诉求

### 1.3 现象 C：intro/outro walkArea clamp 行为不对称
- **intro 时 hero 被 clamp**：[ExploreCollisionSystem.resolveMovement](../scripts/Systems/ExploreCollisionSystem.js#L46-L48) 末尾 `walkArea.clampPosition(pos)` 不检查 `controlledBySequence`；[CharacterBase._applyMovement](../scripts/Enties/CharacterBase.js#L324-L328) 的守卫只挡 `_applyMovement` 内部位移，挡不住这层 clamp
  - 具体到 [prologue_intro.json](../Data/Sequences/prologue_intro.json) hero 目标 `y=1`，[prologue.json walkAreas](../Data/SceneDefs/prologue.json) scenario<105 时 `maxY=0.7` → hero y 被钳到 0.7
- **Charlotte 不被 clamp**：[ExploreMode.fixedUpdate#L53](../scripts/Systems/Modes/ExploreMode.js#L53) 的 `resolveMovement` 只传 `character`(hero)，NPC 永远不走这条路径
- **outro 时 hero 能走出 walkArea**：[Scene.fixedUpdate#L335-L338](../scripts/Scene.js#L335-L338) 在 `_loading=true` 时早退，跳过 `gameModeManager.fixedUpdate` → ExploreMode 不跑 → clamp 不生效。outro 在 [Game._loadSceneInternal#L280](../scripts/Game.js#L280) 播放时 `_loading` 已为 true；intro 在 [Game.js#L318](../scripts/Game.js#L318) `_loading=false` 之后才播

## 2. 修复顺序（从最简单开始）

按改动半径递增排序，每阶段独立可验证、可回滚。

| 阶段 | 内容 | 改动半径 | 风险 |
|------|------|----------|------|
| 阶段 1 | walkArea clamp 门控（`controlledBySequence` 跳过 clamp） | 1 处 if | 低 |
| 阶段 2 | sequencer busy 门控 NPC greeting（透传 isBusy + NpcController 早退） | 2 文件 | 低-中 |
| 阶段 3 | 新增通用 `dialogueBubble` clip，迁移现有 callback | 3 文件 + JSON | 中 |

## 3. 阶段 1：walkArea clamp 门控

### 3.1 目标
sequencer 驱动 `moveActorTo` 期间，`ExploreCollisionSystem.resolveMovement` 跳过 walkArea clamp，让 sequencer 全权写位置（hero/Charlotte 对称）。

### 3.2 改动点
**唯一改动**：[ExploreCollisionSystem.resolveMovement](../scripts/Systems/ExploreCollisionSystem.js#L21-L49) 开头加守卫。

```js
resolveMovement(entity, blockers, walkArea) {
    const pos = entity.root.position;

    // sequencer 驱动期间不 clamp：让 moveActorTo 全权写位置，避免 y=1 被钳到 maxY=0.7
    if (entity.controlledBySequence) return;

    for (const blocker of blockers) { ... }
    if (walkArea) walkArea.clampPosition(pos);
}
```

### 3.3 不改什么
- 不改 [CharacterBase._applyMovement](../scripts/Enties/CharacterBase.js#L324-L328)（守卫已存在）
- 不改 [ExploreMode.fixedUpdate](../scripts/Systems/Modes/ExploreMode.js#L53)（调用点不动）
- 不改 outro 路径（本来就不 clamp，门控只让 intro 与 outro 行为一致）
- 不让 Charlotte 进 `resolveMovement`（Charlotte 本来就不被 clamp，对称问题通过"hero 也不 clamp"自然解决，无需引入新逻辑）

### 3.4 验证
- [ ] intro 期间 hero 能走到 `y=1`，不再被钳到 `y=0.7`
- [ ] intro 期间 hero 与 Charlotte 到达点对称（都到 `-18, y`）
- [ ] sequencer 结束后 hero 回归 walkArea clamp（手动走到边界外验证）
- [ ] outro 行为不变（hero 仍能走到 x=20）

### 3.5 风险与边界
- `controlledBySequence` 仅 CombatCharacter 有，NpcCharacter/PropEntity 无此标记 → 守卫对它们无效，但因为它们本来就不进 `resolveMovement`，无副作用
- 若 sequencer 异常未清标记，hero 会永久不被 clamp（已有 [SceneSequencer._resetControlledActors](../scripts/Systems/SceneSequencer.js#L31-L40) 兜底清理，无新增风险）

## 4. 阶段 2：sequencer busy 门控 NPC greeting

### 4.1 目标
sequencer 播放期间，NpcController 跳过 greeting 触发（idle→greeting 状态转换 + 气泡显示），但保留：
- FollowingBehavior 的跟随更新（Charlotte 仍能跟随）
- 已在 greeting 态的 dialogue 计时（避免中断已显示气泡）
- `enterIdle`/`enterFollowing` 等 sequence callback 触发的状态切换

### 4.2 改动点

**改动 1**：[ExploreMode.fixedUpdate](../scripts/Systems/Modes/ExploreMode.js#L41-L52) NPC 循环 context 透传 `sequencerBusy`

```js
const sequencerBusy = !!this.context.sceneSequencer?.isBusy();
for (const npc of this.interactables) {
    npc.fixedUpdate(dtMs, tickCount);
    const controller = npc.npcController;
    if (controller) {
        controller.update(dtMs, npc, {
            player: character,
            questManager: this.context.questManager,
            inventoryManager: this.context.inventoryManager,
            dialogueBubble: this.context.dialogueBubble,
            sequencerBusy,  // ← 新增
        });
    }
}
```

**改动 2**：[NpcController.update](../scripts/Systems/NpcController.js#L64-L72) greeting 触发分支加门控

```js
update(dtMs, npc, context) {
    // ... context 初始化 ...

    // following 等行为态不受 sequencer busy 影响（已在 enterFollowing 时由 sequence 显式驱动）
    if (this._behavior) {
        this._behavior.update(dtMs, npc, context);
        // ... debug sync ...
        return;
    }

    const sequencerBusy = context.sequencerBusy;
    const dx = player.root.position.x - npc.root.position.x;
    // ... 计算 inGreetingRange ...

    // sequencer 期间不触发 greeting（保留 idle 态，不弹气泡）
    if (this.state === "idle" && inGreetingRange && !this.hasGreetedInRange && !sequencerBusy) {
        if (this._isQuestCompleted()) {
            this.hasGreetedInRange = true;
            return;
        }
        this.enterGreeting(npc);
        this.hasGreetedInRange = true;
        return;
    }

    // sequencer 期间即使进入范围也不置 hasGreetedInRange，避免 sequencer 结束后立刻弹气泡
    if (this.state === "greeting" && !sequencerBusy) {
        this._dialogueTimerMs += dtMs;
        // ...
    }

    if (!inGreetingRange) {
        this.hasGreetedInRange = false;
    }
    // ...
}
```

### 4.3 不改什么
- 不改 `enterGreeting`/`enterIdle`/`enterFollowing` 本身（sequence callback 仍能正常调用）
- 不改 FollowingBehavior（其 update 在 `_behavior` 分支已早退，不受门控影响）
- 不改 BattleMode（其没有 NPC greeting 路径）

### 4.4 验证
- [ ] intro 期间 Charlotte 不弹气泡（hero 走过她身边也不弹）
- [ ] intro 结束（`enterCompanionIdle` callback 已调）后，hero 再次靠近 Charlotte 才弹气泡
- [ ] prologue_cs_rabble_flee.json 播放期间 Charlotte 不弹气泡
- [ ] sequencer 结束后 greeting 正常触发（手动走到 NPC 附近验证）
- [ ] Charlotte 跟随状态不受影响（intro 后 enterCompanionFollowing callback 仍能驱动跟随）

### 4.5 风险与边界
- 门控只挡 idle→greeting 转换，已 greeting 态保留计时（避免气泡卡住不消失）
- 如果 sequencer 异常卡住 busy 标记不重置，NPC 永远不 greeting → 已有 sequencer 完成时 `_resetControlledActors` 兜底，`isBusy()` 也会变 false
- BattleMode 无此路径，不影响战斗内 NPC 行为

## 5. 阶段 3：新增通用 dialogueBubble clip

### 5.1 目标
提供数据驱动的对话气泡控制，替代写死的 `showCompanionBubble`/`hideCompanionBubble` callback。

### 5.2 clip schema

```jsonc
// 显示气泡（带文本）
{ "type": "dialogueBubble", "atMs": 4200, "actorId": "companion", "text": "!" }

// 显示气泡（带多行 content）
{ "type": "dialogueBubble", "atMs": 4200, "actorId": "companion",
  "content": ["第一行", "第二行"] }

// 隐藏气泡（actorId 可省，省略则 hide 全局）
{ "type": "dialogueBubble", "atMs": 6200, "action": "hide" }
{ "type": "dialogueBubble", "atMs": 6200, "action": "hide", "actorId": "companion" }
```

字段：
| 字段 | 类型 | 说明 |
|------|------|------|
| `actorId` | string | 目标 NPC（查 interactables，与 moveActorTo binding 同语义） |
| `text` | string | 单行文本（与 content 二选一） |
| `content` | string[] | 多行文本（与 text 二选一） |
| `action` | string | `"show"`（默认） / `"hide"` |

### 5.3 改动点

**改动 1**：[TimelineSequencer.js ACTION_HANDLERS](../scripts/Systems/TimelineSequencer.js) 加 `dialogueBubble` handler

```js
dialogueBubble: {
    start(ctx, clip, state) {
        const bubble = ctx.dialogueBubble;
        if (!bubble) { console.warn("[TimelineSeq] dialogueBubble: no bubble in ctx"); return; }

        // hide 分支
        if (clip.action === "hide") {
            if (clip.actorId) {
                const actor = ctx.exploreMode?.interactables?.find(n => n.id === clip.actorId);
                // 当前 DialogueBubble 是单例（一个气泡对象），无 per-actor hide，hide 即 hide 全局
            }
            bubble.hide();
            return;
        }

        // show 分支
        const actorId = clip.actorId;
        if (!actorId) { console.warn("[TimelineSeq] dialogueBubble show: missing actorId"); return; }
        const actor = ctx.exploreMode?.interactables?.find(n => n.id === actorId)
                   ?? ctx.entityPool?.find(e => e.id === actorId);
        if (!actor) { console.warn(`[TimelineSeq] dialogueBubble: actor not found: ${actorId}`); return; }

        if (Array.isArray(clip.content)) {
            bubble.setContent(clip.content);
        } else {
            bubble.setText(clip.text ?? "");
        }
        bubble.show(actor);
    }
}
```

**改动 2**：[ExploreMode._registerSequenceHandlers](../scripts/Systems/Modes/ExploreMode.js#L303-L315) 删除 `showCompanionBubble`/`hideCompanionBubble`，保留 `disposeProp`/`enterCompanionFollowing`/`enterCompanionIdle`

**改动 3**：TimelineSequencer 需能访问 `exploreMode.interactables` —— 在 ACTION_HANDLERS 调用前注入 ctx。需确认 ctx 字段是否已有 exploreMode 引用；若无，需在 `sharedContext` 加 `exploreMode`（或借道 `gameModeManager.modes.get("explore")`）

**改动 4**：迁移 [prologue_cs_rabble_flee.json](../Data/Sequences/prologue_cs_rabble_flee.json) 现有 callback：

```jsonc
// 旧
{ "type": "callback", "atMs": 4200, "fn": "showCompanionBubble" },
{ "type": "callback", "atMs": 6200, "fn": "hideCompanionBubble" }

// 新
{ "type": "dialogueBubble", "atMs": 4200, "actorId": "companion", "text": "!" },
{ "type": "dialogueBubble", "atMs": 6200, "action": "hide" }
```

### 5.4 不改什么
- 不改 DialogueBubble 本身（仍是单例，不支持多 NPC 同时不同气泡——若需要 per-actor 气泡是更大改动，本阶段不做）
- 不改 [prologue_intro.json](../Data/Sequences/prologue_intro.json)（intro 本来不依赖气泡 callback，阶段 2 已用门控解决）

### 5.5 验证
- [ ] prologue_cs_rabble_flee.json 播放到 4200ms 时 Charlotte 头顶显示 "!"
- [ ] 6200ms 时气泡消失
- [ ] 旧 callback 名 `showCompanionBubble`/`hideCompanionBubble` 在日志中不再被调用（应打 unknown handler warn，或确认已删除注册）
- [ ] 阶段 2 的 sequencer busy 门控不影响阶段 3 的 clip（dialogueBubble clip 由 sequencer 主动触发，不经过 NpcController greeting 路径）

### 5.6 风险与边界
- DialogueBubble 单例意味着多 NPC 同时显示气泡会冲突（现状已如此，本阶段不引入新问题）
- ctx 注入 exploreMode 引用需注意 BattleMode 期间 sequencer 是否会用到此 clip（文档 §10 已记 BattleMode 不注册 callback handler）—— dialogueBubble clip 应只在 ExploreMode 期间可用，需在 handler 内加 ctx.exploreMode 存在性检查
- 迁移 JSON 后需双保险：保留旧 callback 注册一段时间直到确认无其他 sequence 引用（grep `showCompanionBubble`/`hideCompanionBubble`）

## 6. 整体验证清单

阶段 1 完成后：
- [ ] intro 期间 hero 走到 y=1 不被钳
- [ ] Charlotte 仍到 y=0（无变化）
- [ ] outro 行为不变

阶段 2 完成后：
- [ ] intro 期间不弹 Charlotte 气泡
- [ ] intro 结束后靠近 Charlotte 才弹
- [ ] 跟随态切换不受影响

阶段 3 完成后：
- [ ] prologue_cs_rabble_flee.json 气泡正常显示/隐藏
- [ ] 无 unknown handler warn
- [ ] 文档更新（[docs/TimelineSequencer User Guide.md](../docs/TimelineSequencer%20User%20Guide.md) §5 新增 dialogueBubble 类型说明 + §10 更新 callback handler 限制说明）

## 7. 不在本计划范围

- per-actor 多气泡（DialogueBubble 单例改造）
- sequencer 期间其他子系统门控（如 pickable 拾取、sceneSwitch trigger）—— 当前未观察到问题，按需另立
- BattleMode 期间 callback handler 注册（文档 §10 已记已知限制，本次不解决）
- Charlotte 战斗内 idle/following 的更深层解耦

## 8. 实施记录

待阶段 1 完成后在此追加。