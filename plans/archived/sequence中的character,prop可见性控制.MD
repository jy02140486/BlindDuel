## 1. 高层摘要 (TL;DR)

*   **影响范围：** **低** —— 仅在 TimelineSequencer 新增一个原生 clip type，不修改任何现有实体（CharacterBase / PropEntity / NpcCharacter 等）的源码。
*   **核心变更：**
    *   ✨ **新增 `setVisibility` clip type**：支持在 sequence 中显式控制任意 actor（character / prop / NPC / pickable）的视觉显隐。
    *   📚 用户文档同步更新 `docs/TimelineSequencer User Guide.md`。
*   **不涉及：** 碰撞、状态机、动画组件、WorldState。纯视觉层控制。

---

## 2. 背景与现状分析

### 2.1 问题

sequence 想表达"某个道具/角色先藏起来，到某个时间点再出现"的情景（例如：序章中一枚金币藏在桌下，主角走近后突然出现），当前 14 种 clip type 都做不到：

| 候选 clip | 能否做显隐 | 原因 |
|-----------|-----------|------|
| `command` | ❌ | 只切换 atlas 帧（PropEntity._setClip），没有"全透明"内置 clip，且 prop 仍在 staticBlockers 里阻挡 |
| `callback`（disposeProp） | ❌ | 永久销毁、不可恢复 |
| `dialogueBubble` | ❌ | 只管气泡，不碰 actor |
| `moveActorTo` | ❌ | 只移动 position |
| 其余 clip | ❌ | 均不涉及 actor 可见性 |

### 2.2 扩展 callback handler 方案为何放弃

callback handler 只能注册在 ExploreMode（文档 §10 已知限制 3）。如果走 `handlers.set("setActorVisible", ...)` 这条路，BattleMode 内的 sequence 无法使用。`setVisibility` 应该是**任意模式通用**的一等公民能力，走核心 `ACTION_HANDLERS` 路径才对。

### 2.3 为什么不新增 CharacterBase.setVisibility()

CharacterBase 和 PropEntity 都已经有 `this.root: BABYLON.TransformNode`。Babylon 的 `TransformNode.setEnabled(boolean)` 本身就是级联隐藏的标准 API——调用它会级联禁用所有子节点（spritePlane + debugMesh + rootDebugNode 等），但 node 仍保留在 scene graph 中、position 仍更新、碰撞 aggregate 不受影响。

sequencer handler 直接操作 Babylon node 即可，不需要 wrapper 方法。

### 2.4 所有实体 root 结构一致性确认

| 实体类型 | root 字段 | root 类型 | spritePlane 挂在 | 备注 |
|----------|-----------|-----------|------------------|------|
| CharacterBase（hero / rabble / NpcCharacter 基类） | `this.root` | TransformNode | root | spritePlane + rootDebugNode 都挂 root |
| PropEntity | `this.root` | TransformNode | root | spritePlane 挂 root |
| PickableEntity | 类似 | — | — | 也走 entityPool，actor 解析覆盖 |

结论：handler 可以安全用 `actor.root.setEnabled(visible)` 覆盖所有目标实体。

---

## 3. 设计方案

### 3.1 Clip 签名

走 **event clip** 模式（用 `atMs`），一次调用即瞬设。不提供 interval clip 的 update/end——用两条 event clip 就能表达"区间隐藏/可见"：

```jsonc
// 典型：prop 一开始藏起来，5 秒后显现
{
  "tracks": [
    {
      "id": "prop.visibility",
      "kind": "actor",
      "binding": { "actorId": "prop_coin" },
      "clips": [
        { "type": "setVisibility", "atMs": 0,    "visible": false },
        { "type": "setVisibility", "atMs": 5000, "visible": true }
      ]
    }
  ]
}
```

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `type` | string | 是 | — | `"setVisibility"` |
| `visible` | boolean | 是 | — | `false` 隐藏，`true` 显示 |
| `atMs` | number | 是 | — | 触发时刻（event clip） |
| `startMs` + `durationMs` | number | 否 | — | 也可写 interval clip 形式，但 handler 不提供 update/end，start 时一次性设置 |

### 3.2 Handler 伪代码

位置：`scripts/Systems/TimelineSequencer.js` 的 `ACTION_HANDLERS` 对象（紧接现有 clip type 条目）。

```js
setVisibility: {
    start(ctx, clip, track) {
        const actor = _resolveActor(ctx, track.binding);
        if (!actor) {
            console.warn(`[TimelineSequencer] setVisibility: actor not found`);
            return;
        }
        const visible = clip.visible !== false; // 防御性默认 true

        // 主路径：root.setEnabled 级联隐藏所有子节点（spritePlane + debug 元素）
        if (actor.root && typeof actor.root.setEnabled === "function") {
            actor.root.setEnabled(visible);
        } else {
            // fallback：没有 root 时直接控 spritePlane（PickableEntity 等轻量实体）
            if (actor.spritePlane) {
                actor.spritePlane.setEnabled(visible);
            } else {
                console.warn(`[TimelineSequencer] setVisibility: actor ${actor.id ?? actor.name} has no root or spritePlane`);
            }
        }
        console.log(`[TimelineSequencer] setVisibility: actor=${actor.id ?? actor.name} visible=${visible}`);
    }
    // 不提供 update / end —— setVisibility 是瞬设操作，区间隐藏用两条 event clip 表达
}
```

### 3.3 行为边界

| 维度 | 行为 |
|------|------|
| **视觉渲染** | `root.setEnabled(false)` 级联禁用所有子节点（spritePlane、rootDebugMesh 等） |
| **碰撞/阻挡** | ❗ 不受影响 —— Babylon TransformNode.setEnabled 不影响 physics aggregate；若需要同时取消阻挡需配合其他机制（不在本次范围） |
| **位置更新** | 不受影响 —— moveActorTo / moveActorByDirection 照常写 root.position |
| **动画推进** | 不受影响 —— FrameAnimationComponent 独立组件，仍正常推进帧 |
| **恢复** | `visible: true` 即恢复，无状态残留 |
| **sequence 结束兜底** | ⚠️ **不自动恢复** —— sequencer 不知道调用前的 visible 状态。编排者需显式配 `visible: true` clip 或接受状态残留。这与 `cameraBlend` 等 clip 的"不回滚"约定一致 |
| **调试面板** | HTML debug panel 位置由 `ExploreMode.#updateDialogueBubblePosition` / `SceneVisualSystem` 驱动，检查的是 mesh.isVisible。root.setEnabled(false) 会让 Babylon 内部跳过渲染，但 **debug panel 的 display 不会自动变成 none**——本次不处理这个边角（sequencer 期间通常也不开 debug panel） |

### 3.4 interval clip 形式的处理（可选支持）

如果序列作者写了 interval 形式：

```jsonc
{ "type": "setVisibility", "startMs": 1000, "durationMs": 3000, "visible": false }
```

handler start 时设 visible=false，**end 时不自动恢复**——由后续 clip 负责。这和现有 clip（如 moveActorTo end 不恢复位置）的"不回滚"约定一致。

---

## 4. 改动清单

| # | 文件 | 改动内容 | 规模 |
|---|------|---------|------|
| 1 | `scripts/Systems/TimelineSequencer.js` | `ACTION_HANDLERS` 对象新增 `setVisibility` 条目 | ~20 行 |
| 2 | `docs/TimelineSequencer User Guide.md` | 新增 §5.15 setVisibility 章节（字段表 + 示例 + 行为边界） | ~30 行 |

**不改动**：CharacterBase.js、PropEntity.js、NpcCharacter.js、PickableEntity.js、ExploreMode.js、任何 JSON 数据。

---

## 5. 改动前后对比

### 5.1 改动前：要藏一个 prop 只能用全透明 atlas 帧

```jsonc
// 非常别扭：要先在 PropEntity 的 clips 里配一个全透明帧
{ "type": "command", "atMs": 0, "command": "hidden" }
// 前提：PropEntity 有 "hidden" clip = 全透明帧
// 而且 prop 仍然会阻挡玩家（blocksMovement=true 没动）
```


### 5.2 改动后：干净的原生 clip

```jsonc
// 直接 setVisibility，一次性解决视觉隐藏
{ "type": "setVisibility", "atMs": 0,    "visible": false }
{ "type": "setVisibility", "atMs": 5000, "visible": true }
```


### 5.3 验证 checklist（写 sequence 时自测）

- [ ] `atMs=0` 隐藏生效：prop 瞬间消失
- [ ] 中间过程中 prop 位置仍被 moveActorTo 正常驱动（sequencer 日志有 INTERVAL START / INTERVAL END）
- [ ] `atMs=5000` 显形生效：prop 瞬间在新位置出现
- [ ] 控制台无 `actor not found` 警告

---

## 6. 已知限制（与决策说明）

| # | 限制 | 决策说明 |
|---|------|---------|
| 1 | 隐藏后仍阻挡玩家（若 `blocksMovement=true`） | 本次范围只做视觉层；碰撞阻挡是 ExploreCollisionSystem 的逻辑层，需要同步取消的话另行加 handler（或后续扩展 `setActorBlocking` clip） |
| 2 | sequence 结束不自动恢复 visible | 不回滚是 sequencer 整体约定。编排者有责任显式恢复。 |
| 3 | interval clip end 不自动恢复 | 同上。 |
| 4 | HTML debug panel 不跟随隐藏 | 边角情况：sequencer 期间通常也不开 debug panel。如后续有需求再加 `actor.rootDebugVisible = false` 同步。 |
| 5 | BattleMode 内也可用 | ✅ 这是选 ACTION_HANDLERS 而非 callback handler 的核心优势——核心 clip 不依赖模式。 |

---

## 7. 扩展预留（不在本次范围）

如果后续发现有需求，可以在同一个方向上扩展但不破坏本次设计：

| 可能扩展 | 说明 |
|----------|------|
| `visible` 支持渐变（淡入淡出） | 当前瞬设；可加 `fadeMs` 字段让 handler 用 interval clip 做 alpha 插值。但 alpha 插值涉及 material.opacity 而非 root.setEnabled，实现复杂度陡增，等有明确需求再做 |
| `setActorBlocking` clip | 只关碰撞阻挡不关视觉。当前隐藏后仍阻挡是用户最可能遇到的第二个问题 |
| sequence 结束时自动恢复 | 需要 TimelineSequencer 跟踪调用前状态，改动较大且与现有"不回滚"约定冲突，暂不做 |