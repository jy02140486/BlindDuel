# 攻击 Active Window 精细化方案

> 改造对象：`scripts/Enties/CombatCharacter.js` 的 `getCombatSnapshot()` 中 `isActiveAttackFrame` 的计算逻辑
> 目标：把"整帧激活"改成"基于时间窗口激活"
> 改动范围：~20 行，Resolver 零改动，去重集合零改动

---

## 一、现状分析

### 1.1 现有机制

StateGraphDef 里用 `attackActiveFrames: [3, 4]` 声明哪些动画帧具有战斗判定：

```json
{ "thrust": { "attackActive": true, "attackActiveFrames": [2], "attackWeight": "light", "attackTrajectory": "thrust" } }
```

`CombatCharacter.getCombatSnapshot()`（`CombatCharacter.js:237-239`）的计算：

```javascript
const attackActiveFrames = this.currentStateDef?.attackActiveFrames; const isActiveAttackFrame = isAttackState && hasWeapon && (attackActiveFrames === undefined || attackActiveFrames.includes(frameIndex));
```
`isActiveAttackFrame` 决定 `boxRole` 是不是 `"attack"`，进而决定 Resolver Phase 1/2 里武器是否参与战斗判定。

### 1.2 为什么要改

| 问题 | 说明 |
|---|---|
| 窗口粒度太粗 | `attackActiveFrames: [3, 4]` 意味着"帧 3 的 100ms + 帧 4 的 100ms 全都是 active"，你没法表达"帧 3 是蓄力，帧 3 的最后 30ms + 帧 4 的前 30ms 才是真正的判定窗口" |
| 概念模糊 | "第 3 帧是攻击帧"这句话混了视觉和判定——帧 3 可能是蓄力的最后一张图，但攻击判定其实只有帧 3 快要结束的那一小段 |
| 无法做帧内窗口 | 你不能说"从进入攻击状态后 700ms 开始，持续 60ms"，只能说"第 N 帧到第 M 帧" |

### 1.3 GPT 方案的亮点与修正

GPT 提出的"Animation Frame（视觉）vs Attack Active Window（判定）概念分离"非常好，要保留。

但 GPT 方案里有几个点需要修正：

| GPT 说法 | 实际情况 |
|---|---|
| "创建 AttackInstance 类" | **不需要**。现有 `attackInstanceId`（`${characterId}:${stateName}:${stateEntrySerial}`）已经是稳定唯一的攻击实例标识，`invalidatedAttacks` / `hitDedupe` / `guardDedupe` / `clashDedupe` 全都在用它，不需要新建类 |
| "用 tick 作为时间单位" | **建议用 ms**。原因见下文 |
| "让 Resolver 加一个 isActiveAt 判断" | **不需要**。只要 `boxRole === "attack"` 的计算逻辑改对了，Resolver 现有的 `boxRole !== "attack"` 过滤自然会跳过非 active 时刻，Resolver 本身零改动 |

---

## 二、设计决策

### 2.1 时间基准：用 ms，不用 tick

| 基准 | 优点 | 缺点 |
|---|---|---|
| tick（60Hz 全局帧计数） | 和 Resolver 的帧节奏一致 | hitstop 期间 tick 照常递增 → active window 在后台溜走 → 玩家无法理解 |
| ms（绑定 animation 的 elapsedInClipMs） | hitstop 期间 animation.timeScale=0 → elapsedMs 冻结 → active window 自然冻结 | 无 |

**选择 ms**，理由：
- 动画帧本身就是 ms 精度（每帧 `durationMs`）
- hitstop 已经把 `animation.timeScale` 设成 0，`animation.fixedUpdate` 不推进 → 在 `CombatCharacter.fixedUpdate` 里 `animation.fixedUpdate` 先跑，再跑 Resolver → 只要 active window 的时间跟 animation 走，hitstop 期间它自然冻结
- 设计师调参时看帧 durationMs 直接对 active startMs，不用 tick↔ms 换算

### 2.2 旧数据兼容

保留 `attackActiveFrames` 作为 fallback：如果 StateGraphDef 里没定义 `attackActiveStartMs`，就用旧的 frame-based 逻辑。这样老数据不用改，新数据逐步迁移。

### 2.3 两个新字段

StateGraphDef 的攻击状态里增加：

```json
{ "thrust": { "attackActive": true, "attackActiveStartMs": 450, "attackActiveDurationMs": 60, "attackWeight": "light", "attackTrajectory": "thrust" } }
```
| 字段 | 类型 | 含义 |
|---|---|---|
| `attackActiveStartMs` | number | 进入攻击状态后，经过多少 ms 开始 active |
| `attackActiveDurationMs` | number | active window 持续多少 ms |

两个都不填 → fallback 到 `attackActiveFrames`。

### 2.4 时间线示意
以 `thrust` 动画为例（假设总时长 ≈ 610ms）：

时间轴（ms） 0 100 350 500 610 |-----------|-----------|-----------|-----------| 动画帧 frame 0 frame 1 frame 2 frame 3 frame 4 视觉姿态 idle-like windup windup attack recovery │ │ │ ├─ activeStartMs = 450 │ ├─ activeDurationMs = 60 │ │ │ ├── ACTIVE WINDOW ──┤ │ │ (450~510ms) │





**视觉**：帧 2 还是蓄力姿态，帧 3 是打击姿态。两张图完全正常显示。
**判定**：只有 `450~510ms` 这 60ms 内 `boxRole === "attack"`。帧 3 即使持续 150ms（500~650ms），也只有前 10ms（500~510ms）有判定。

关键区别：
- **旧方案**：`attackActiveFrames: [3]` → 帧 3 整个 150ms 全都是 attack
- **新方案**：`attackActiveStartMs: 450, attackActiveDurationMs: 60`


## 三、改动点（共 3 处）

### 改动 1：FrameAnimationComponent 加 elapsedInClipMs getter

**文件**：`scripts/Components/FrameAnimationComponent.js`

在 `get normalizedTime()` 之后加：

```javascript
get elapsedInClipMs() { if (this.frames.length === 0) return 0; let total = 0; for (let i = 0; i < this.currentFrameIndex; i++) { total += this.frames[i]?.durationMs ?? 0; } return total + this.timeInFrameMs; }
```
这个 getter 在 hitstop 期间自动冻结（因为 `animation.timeScale=0` → `timeInFrameMs` 不增加 → `currentFrameIndex` 不推进 → 累计值不变）。

### 改动 2：CombatCharacter.getCombatSnapshot 换 isActiveAttackFrame 计算

**文件**：`scripts/Enties/CombatCharacter.js`，第 237-239 行

**原来**：
```javascript
const attackActiveFrames = this.currentStateDef?.attackActiveFrames; const isActiveAttackFrame = isAttackState && hasWeapon && (attackActiveFrames === undefined || attackActiveFrames.includes(frameIndex));
```
**改成**：
```javascript
let isActiveAttackFrame = false; if (isAttackState && hasWeapon) { const startMs = this.currentStateDef?.attackActiveStartMs; const durationMs = this.currentStateDef?.attackActiveDurationMs; if (startMs != null) { const elapsedMs = this.animation.elapsedInClipMs; const endMs = startMs + (durationMs ?? 1000); isActiveAttackFrame = elapsedMs >= startMs && elapsedMs < endMs; } else { // fallback: 旧的 attackActiveFrames 逻辑 const attackActiveFrames = this.currentStateDef?.attackActiveFrames; isActiveAttackFrame = attackActiveFrames === undefined || attackActiveFrames.includes(frameIndex); } }
```
就这一处，其他全部不动。`boxRole` 计算、`attackInstanceId` 生成、Resolver Phase 1/2 的过滤逻辑，全都是原来的样子。

### 改动 3（可选）：StateGraphDef 数据迁移

**文件**：`Data/StateGraphDef/*.json`

逐步把每个攻击状态的 `attackActiveFrames: [3, 4]` 换成：

```json
"attackActiveStartMs": 780, "attackActiveDurationMs": 60
```

startMs 的计算方式：动画前几帧 durationMs 之和 + 你想要的提前量。

例如 `LongSwordMan.json` 里的 `thrust`：
```json
{ "thrust": { "clip": "thrust", "attackActive": true, "attackWeight": "light", "attackTrajectory": "thrust", "attackActiveFrames": [2], // ↓ 迁移后改成 // "attackActiveStartMs": 250, // 帧 0(100ms) + 帧 1(150ms) + 0ms 提前 = 250ms // "attackActiveDurationMs": 80, // 约 5 帧 × 16ms "loop": false } }
```
---

## 四、hitstop 冻结语义验证

这是方案最关键的正确性保证，走一遍完整链路：
tick N：CombatCharacter.fixedUpdate(dtMs=16.67) ├── TimeControlSystem.tick() → mode: "none"（没冻结） ├── animation.fixedUpdate(16.67) ← timeScale=1，正常推进 │ timeInFrameMs += 16.67 → 可能推进到下一个 frameIndex ├── getCombatSnapshot() │ elapsedInClipMs = 前 i 帧 durationMs 之和 + timeInFrameMs │ isActiveAttackFrame = (elapsed >= 450 && elapsed < 510) └── 后续流程正常

tick N+1：Resolver 产出 hitstop effect └── CombatSystem 派发 effect → attacker.applyHitstop(8) → animation.timeScale = 0

tick N+2：CombatCharacter.fixedUpdate(dtMs=16.67) ├── TimeControlSystem.tick() → mode: "hitstop", shouldAdvanceAnimation=false │ 直接 return，后面的代码不跑了 ├── animation.fixedUpdate 根本不调 ← timeScale=0 没用上 └── getCombatSnapshot 也不调

tick N+3 ~ N+9：同上，hitstop 持续 8 帧 └── animation 不推进 → elapsedInClipMs 不变 → active window 停在原处

tick N+10：hitstopFrames 耗尽 ├── animation.timeScale 恢复 ├── TimeControlSystem.tick() → mode: "none" ├── animation.fixedUpdate 恢复推进 └── elapsedInClipMs 从上次冻结的值继续累加
**结论**：hitstop 期间 active window 冻结，恢复后继续推进，不会出现"hitstop 完了攻击也过期了"这种玩家无法理解的情况。

---

## 五、为什么 Resolver 零改动

Resolver 里和攻击相关的所有过滤都已经基于 `boxRole === "attack"`：
Phase 1 attack vs shield: if ((isAAttack && isBShield) || ...) Phase 1 attack vs attack: if (!isAAttack || !isBAttack) continue Phase 2 Wp vs HBox: contact.weapon.boxRole !== "attack" ? skip


而 `boxRole` 是在 `getCombatSnapshot` 里由 `isActiveAttackFrame` 计算出来的。只要 `isActiveAttackFrame` 的计算逻辑对了，非 active 时刻的武器 box 自然 `boxRole = null`，Resolver 自然跳过。Resolver 完全不需要知道"active window"这个概念。

---

## 六、为什么不需要新建 AttackInstance

现有架构里攻击实例已经是一等公民：

```javascript
attackInstanceId = ${this.id}:${this.currentStateName}:${this.stateEntrySerial}
```

- 每次 `enterState` → `stateEntrySerial += 1` → 新的 attackInstanceId
- `attackInstanceId` 在**整个攻击状态期间**都存在（不依赖 active window）
- Resolver 里的四个去重集合全靠它 key
- `invalidatedAttacks` 靠它让被挡/拼输的攻击在剩余 active 期间持续失效

active window 做的只是：**在攻击实例内部，决定"哪些时间片段 boxRole 是 attack"**。这和 attackInstanceId 的生命周期正交。

如果现在新建 AttackInstance 类来持有 active window 状态，反而要把现有四个去重集合的 key 逻辑迁过去，纯属增加复杂度。

---

## 七、迁移路线

| 阶段 | 内容 |
|---|---|
| **Phase 1**（本方案） | 加 `elapsedInClipMs` getter + 换 `isActiveAttackFrame` 计算 + 旧数据 fallback 保留。代码层完成，数据层不动 |
| **Phase 2** | 逐个 StateGraphDef 把 `attackActiveFrames` 换成 `attackActiveStartMs` / `attackActiveDurationMs`，边换边在游戏里验证手感 |
| **Phase 3**（可选） | 所有数据迁完后，删掉 `attackActiveFrames` fallback 逻辑 |

Phase 1 完成后，**现有所有攻击的行为和现在完全一样**（因为 fallback），只是代码结构变了。Phase 2 才开始改变手感。

---

## 八、改动清单速查

| 文件 | 改动 | 行数 |
|---|---|---|
| `scripts/Components/FrameAnimationComponent.js` | 加 `elapsedInClipMs` getter | ~8 行 |
| `scripts/Enties/CombatCharacter.js` | 换 `isActiveAttackFrame` 计算，保留 fallback | ~12 行 |
| `scripts/Systems/ContactResolver.js` | **不改** | 0 |
| `scripts/Systems/CombatSystem.js` | **不改** | 0 |
| `Data/StateGraphDef/*.json` | Phase 2 逐步迁移 | 每个状态 ~2 行改 |

**总量 ≈ 20 行代码 + 数据层逐步迁移。**