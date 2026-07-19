# moveActorByDirection clip 设计

> TimelineSequencer 新增第 13 种 clip 类型：基于「归一化方向 + 时长」驱动的角色移动。
> 与现有 `moveActorTo`（目标点驱动）对偶，覆盖"朝某方向走一段时间"的场景。

## 1. 背景与动机

现有 [moveActorTo](file:///e:/se/BlindDuel/scripts/Systems/TimelineSequencer.js) clip 用**绝对目标点 + 时长**做线性插值，位置完全可预测，但有两个限制：

1. **距离与角色速度无关**：插值距离 = 起点→终点的几何距离，与 `walkSpeed` / `moveSpeed` / buff / `moveSpeedBonus` 解耦。想让角色"按自身速度走"无法表达。
2. **必须先算目标点**：编排者要先量出终点坐标，对于"朝右走 2 秒"这类需求，要先算 `targetX = startX + speed × duration`，不直观。

`moveActorByDirection` 解决这两点：**输入方向 + 时长，距离由角色自身速度（或 clip override）× 时长决定**。

## 2. 设计决策（已与用户确认）

| 决策点 | 选择 | 理由 |
|--------|------|------|
| clip 类型名 | `moveActorByDirection` | 与 `moveActorTo` 对偶（To = 去某点，ByDirection = 沿某方向）|
| 速度来源 | 默认 `actor.getEffectiveSpeed()`，可选 `clip.speed` override | 数据驱动为主，保留精确控制能力 |
| 碰撞策略 | **不走碰撞**（同 `moveActorTo`，设 `controlledBySequence = true`）| 原型阶段优先"看得见、对得上"；与 `moveActorTo` 风格一致 |
| 方向坐标系 | `[x, y]` 世界坐标，无 z 轴 | 与 `moveActorTo` 的 `x/y` 一致 |
| 缓动 | 纯匀速，无 easing | 与 `moveActorTo` 当前 `easing === "linear"` 行为对齐 |

## 3. clip schema

```jsonc
{
  "type": "moveActorByDirection",
  "startMs": 1000,        // 必填，interval clip 起始
  "durationMs": 2000,     // 必填，移动持续时间
  "dir": [1, 0],          // 必填，归一化方向 [x, y]；clip 内部再 normalize 一次防误用
  "speed": 2.4            // 可选，覆盖 actor.getEffectiveSpeed()；省略则用角色自身速度
}
```

**字段说明**：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `type` | string | 是 | 固定 `"moveActorByDirection"` |
| `startMs` | number | 是 | interval clip 起始时刻（ms） |
| `durationMs` | number | 是 | 持续时长（ms）；`0` 时退化为瞬时无位移 |
| `dir` | `[number, number]` | 是 | 归一化方向向量；非归一化输入会被内部归一化 |
| `speed` | number | 否 | 速度覆盖值（世界单位/秒）；省略则每帧用 `actor.getEffectiveSpeed()` |

**binding 解析**：复用 `track.binding.actorId`（与 `moveActorTo` 完全一致），支持 `hero` / `enemy` / `prop_*` / `companion` 等。

## 4. handler 行为

新增 `ACTION_HANDLERS.moveActorByDirection`，结构与 `moveActorTo` 同构（`start` / `update` / `end` 三段式）。

### 4.1 start
1. `_resolveActor(ctx, track.binding)` 解析 actor；失败置 `state.invalid = true` 并 warn，return。
2. **不写 `startPos` override**（与 `moveActorTo` 不同）：本 clip 无目标点，起点 = 当前 `root.position`，无需 override。
3. 归一化 `clip.dir`：`mag = hypot(dir.x, dir.y)`，`state.nx = dir[0] / mag`、`state.ny = dir[1] / mag`；`mag <= 0.0001` 时 warn 并置 invalid。
4. 缓存 `state.useClipSpeed = (typeof clip.speed === "number")`、`state.clipSpeed = clip.speed ?? 0`。
5. 设 `actor.controlledBySequence = true`（仅在 `"controlledBySequence" in actor` 时；与 `moveActorTo` 一致）。
6. 日志：`[TimelineSeq] moveActorByDirection START dir=(${nx},${ny}) durationMs=${durationMs} speedSource=${clip|actor}`。

### 4.2 update
```js
update(ctx, clip, state, localMs, dtMs) {
    if (state.invalid) return false;
    const actor = state.actor;
    const dtSec = dtMs / 1000;
    const effectiveSpeed = state.useClipSpeed
        ? state.clipSpeed
        : (typeof actor.getEffectiveSpeed === "function" ? actor.getEffectiveSpeed() : 0);
    actor.root.position.x += state.nx * effectiveSpeed * dtSec;
    actor.root.position.y += state.ny * effectiveSpeed * dtSec;
    if (typeof actor.setMoveIntent === "function") {
        actor.setMoveIntent({ x: state.nx, y: state.ny });
    }
    return true; // 持续 active 直到 endMs
}
```

**关键点**：
- 每帧用 `dtMs` 累加位移，**不依赖 `localMs`**（避免大 dtMs 时一次跳到位）；与 `CharacterBase._applyMovement` 的 `stateSpeed` 分支同构。
- `getEffectiveSpeed()` 每帧重算，buff/`moveSpeedBonus` 变化自动生效（除非 `clip.speed` override）。
- `moveIntent` 写归一化方向，**仅驱动 walk 动画**，不参与位移计算（位移由 clip 自己写 position，符合 sequencer 单一写入源约定）。
- 返回 `true` 直到 `endMs` 自然触发 `end`。

### 4.3 end
1. 清 `actor.setMoveIntent({ x: 0, y: 0 })`（停止 walk 动画信号）。
2. 设 `actor.controlledBySequence = false`（仅 `"controlledBySequence" in actor` 时）。
3. 日志：`[TimelineSeq] moveActorByDirection END finalPos=(${x},${y})`。
4. **不切回 idle 状态**：动画状态切换由编排者负责（同 `moveActorTo` 约定，见 sequencer 文档 §5.2）。

## 5. 与现有约定的兼容性核对

| 现有机制 | 复用情况 | 备注 |
|---------|---------|------|
| `controlledBySequence` 标记 4 处早退（`_applyMovement` / `BaseController.applyToCharacter` / `_consumeTransition` / `ExploreCollisionSystem.resolveMovement`） | ✓ 完全复用 | 与 `moveActorTo` 一致，无新增早退点 |
| `TimelineSequencer._resetControlledActors()` 兜底清标记 | ✓ 自动生效 | `stop` / `_onComplete` / `_onLoop` 三路径已覆盖 |
| `_validateTimeline` 同 `binding+channel` 重叠校验 | ✓ 自动生效 | channel 建议用 `"movement"`（与 `moveActorTo` 一致） |
| `command: "walk"` clip 用于 Npc/Prop 动画 | ✓ 编排者按需配 | CombatCharacter 自动驱动 walk，无需额外 command clip |
| `_resolveActor` binding 解析链路 | ✓ 完全复用 | `hero` / `enemy` / entityPool 查找逻辑不变 |

**新增改动面**（最小）：
- `scripts/Systems/TimelineSequencer.js`：`ACTION_HANDLERS` 表新增一个 `moveActorByDirection` 条目，约 35 行。
- `docs/TimelineSequencer User Guide.md`：§5 新增 §5.13 `moveActorByDirection`，§6 channel 表加注。
- `plans/INDEX.md` Update Log 补一行。
- `PROJECT_CONTEXT.md` §9.2/`快速参考` 中"12 种 clip 类型"改为"13 种"（可选）。

**零改动**：
- `CharacterBase` / `CombatCharacter` / `NpcCharacter` / `PropEntity` / `ExploreCollisionSystem` / `BaseController` / `ExploreMode` 全部不动。

## 6. 与 moveActorTo 的对比

| 维度 | moveActorTo | moveActorByDirection |
|------|------------|---------------------|
| 输入 | `(x, y)` 绝对目标点 + `durationMs` | `dir` 归一化方向 + `durationMs` |
| 位置写入 | `start → target` 线性插值 | `pos += dir × speed × dt` 累加 |
| 距离决定 | 几何距离（与速度无关） | `speed × duration`（受 buff / `moveSpeedBonus` 影响，除非 override） |
| 速度来源 | 隐式（距离/时长），无 speed override | 默认 `getEffectiveSpeed()`，可 `clip.speed` override |
| `startPos` override | 支持（修补 fetch 空窗 clamp） | 不支持（无目标点，起点即当前位置） |
| `easing` | 字段预留但仅 `linear` 实现 | 不预留 |
| 碰撞 | 不走（设 `controlledBySequence`） | 不走（同上） |
| `moveIntent` | 写归一化方向（驱动动画） | 同 |
| `controlledBySequence` | ✓ | ✓ |
| 兜底清标记（stop/complete/loop） | ✓ | ✓ |

## 7. 示例

### 7.1 CombatCharacter（hero 自动驱动 walk 动画）

```jsonc
{
  "id": "hero_walk_right_2s",
  "durationMs": 2500,
  "tracks": [
    {
      "id": "hero.walk",
      "kind": "actor",
      "binding": { "actorId": "hero" },
      "channel": "movement",
      "clips": [
        { "type": "moveActorByDirection", "startMs": 0, "durationMs": 2000, "dir": [1, 0] }
      ]
    }
  ]
}
```

### 7.2 NpcCharacter / PropEntity（需额外配 walk command）

```jsonc
{
  "id": "companion_walk_left_2s",
  "durationMs": 2500,
  "tracks": [
    {
      "id": "companion.cmd",
      "kind": "actor",
      "binding": { "actorId": "companion" },
      "clips": [
        { "type": "command", "atMs": 0, "command": "walk" }
      ]
    },
    {
      "id": "companion.walk",
      "kind": "actor",
      "binding": { "actorId": "companion" },
      "channel": "movement",
      "clips": [
        { "type": "moveActorByDirection", "startMs": 0, "durationMs": 2000, "dir": [-1, 0] }
      ]
    }
  ]
}
```

### 7.3 速度 override（精确控制距离）

```jsonc
{ "type": "moveActorByDirection", "startMs": 500, "durationMs": 1500, "dir": [0.707, 0.707], "speed": 3.0 }
```

距离 = `3.0 × 1.5 = 4.5` 世界单位（沿 45° 方向）。

### 7.4 与 moveActorTo 混用（moveActorByDirection 起步 → moveActorTo 收尾）

```jsonc
{
  "id": "hero_walk_then_lock",
  "durationMs": 4000,
  "tracks": [
    {
      "id": "hero.walk",
      "kind": "actor",
      "binding": { "actorId": "hero" },
      "channel": "movement",
      "clips": [
        { "type": "moveActorByDirection", "startMs": 0,    "durationMs": 2000, "dir": [1, 0] },
        { "type": "moveActorTo",           "startMs": 2000, "durationMs": 1500, "x": 5, "y": 0 }
      ]
    }
  ]
}
```

## 8. 已知边界与限制

1. **不走碰撞**：会穿 `staticBlockers`、超出 `walkArea` 不 clamp（与 `moveActorTo` 一致）。如需碰撞，参考后续 B2 方案（引入 `sequenceMoveIntentLocked` 标志位，改动 `BaseController` / `CharacterBase` / `ExploreCollisionSystem` 三处早退条件），暂不实施。
2. **`clip.speed` override 时距离精确**：`distance = clip.speed × durationMs / 1000`。默认用 `getEffectiveSpeed()` 时距离**不可预测**（buff / 速度模式影响），编排者需自行评估或改用 override。
3. **不切回 idle**：`end` 仅清 `moveIntent` 与标记，不调 `enterState("idle")`。如需切回，编排者额外配 `command: "idle"` event clip（同 `moveActorTo` 约定）。
4. **大 `dtMs` 时位移仍正确**：用 `dtMs × speed` 累加，不用 `localMs / durationMs` 插值，不存在"一次跳到位"问题。但若 `dtMs` 异常大（如 tab 切走 1 秒），会一次走 1 秒距离——这是固定步 `fixedUpdate` 的固有行为，无需特殊处理。
5. **`dir` 必须非零**：`dir = [0, 0]` 会在 `start` 阶段 warn 并置 invalid，`update` 直接 return false，actor 不动。
6. **不支持 `startPos` override**：与 `moveActorTo` 不同，无目标点概念，起点即当前 `root.position`。若 sequencer 启动 fetch 空窗期需要锁起点，改用 `moveActorTo` + `startPos`。

## 9. 实施步骤（可验证）

每步带验证点，可独立 loop。

### Step 1：新增 handler
- 改 `scripts/Systems/TimelineSequencer.js` `ACTION_HANDLERS` 表，加 `moveActorByDirection` 条目（`start` / `update` / `end` 三函数）。
- **验证**：浏览到 `ACTION_HANDLERS`，确认新条目存在；`_getHandler("moveActorByDirection")` 返回非 null。

### Step 2：联调验证
- 在某 sequence JSON 加一段 §7.1 的示例 clip（或临时 console 注入）。
- 启动 `py -m http.server 9000`，访问 `babylon_demo.html`，触发该 sequence。
- **验证**：
  - 控制台出现 `[TimelineSeq] INTERVAL START ... type=moveActorByDirection`。
  - 角色按方向匀速移动 `durationMs` 后停止。
  - `[TimelineSeq] moveActorByDirection END finalPos=(...)` 日志出现。
  - 移动结束后角色可正常被玩家控制（`controlledBySequence` 已清）。
  - CombatCharacter 移动期间播放 walk 动画（`moveIntent` 驱动 transition）。

### Step 3：文档同步
- `docs/TimelineSequencer User Guide.md` §5 新增 §5.13 `moveActorByDirection`（字段表 + 行为说明 + 示例）。
- §9.2 常见问题表补一行（如 `moveActorByDirection 不动` → 检查 `dir` 是否为零向量）。
- `plans/INDEX.md` Update Log 补本次新增。
- **验证**：文档 §5 出现 §5.13 小节，§12 clip 类型表（若存在）含 `moveActorByDirection`。

### Step 4（可选）：clip 类型计数同步
- `PROJECT_CONTEXT.md` §快速参考 "12 种 clip 类型" 改为 "13 种"。
- **验证**：grep `12 种 clip` 无残留。

## 10. 不在本次范围

- 碰撞支持（B2 方案，需引入 `sequenceMoveIntentLocked` 新字段，改动 3 处早退条件）
- easing（ease-in / ease-out）
- z 轴方向（当前为 2D 横版，无需求）
- 加速度 / 减速度曲线
- 路径点序列（多个 waypoint 串联）
- 与 `moveActorTo` 互转的便捷 clip（如 `moveActorByDirectionThenLockTo`）