> **状态**: ✅ 已实施（2026-08-15）
> **范围**: FollowingBehavior 计算的目标点采样；不影响其它 NPC、不影响 resolveMovement 物理推开行为
> **依赖**: [archived/Companion 碰撞与避障设计.MD](archived/Companion%20碰撞与避障设计.MD)（Step 1-4 已落地）、[FollowingBehavior.js](file:///e:/se/BlindDuel/scripts/Systems/NpcBehaviors/FollowingBehavior.js)、[ExploreCollisionSystem.js](file:///e:/se/BlindDuel/scripts/Systems/ExploreCollisionSystem.js)
> **关联 backlog**: §10.3「Charlotte following 移动中被玩家挡」（player 未进 blockers，本设计不直接修，但在 sample 阶段把 player 当临时 blocker）
>
> ## 实施记录（2026-08-15）
> - 新建 `scripts/Systems/WalkAreaSampler.js`、改 `FollowingBehavior.js` + `ExploreMode.js`，§6 Step 1-4 全部落地
> - 实施期发现并修复震荡 bug：原 sample 推离时若某轴正负方向穿透距离并列（如 player 在 walkArea 右墙、rawTargetY = player.y 居中），代码固定推到一侧（dBottom 分支），会让 Charlotte 需穿越 player 走到 sampled target，与 Separation 软避让冲突导致原地在 Y 方向踏步。修复方式：sample 接受可选 `agentX/agentY` 参数，并列时按 agent 当前所在侧选推离方向（§4.1 算法第 2 步更新）。原 §4.1 代码示例未含此修复，以 `WalkAreaSampler.js` 实际代码为准
> - 验证：walkArea 右墙（Charlotte 在 player 上方/下方两个方向）、紧贴障碍物左侧、正常移动、sequencer 期间四个场景均正常
> - 遗留 §7.1 auto-braking（路径阻断卡死）、§7.2 双向跟随方向校验未做

# Companion 目标采样（WalkAreaSampler）设计

## 0. 设计立场

本游戏是 beat'em up 风格的 2.5D（XY 二维移动，Y 是远近不是跳跃，无跳跃机制，walkArea 通常狭长矩形）。Companion 寻路需求比 Unity NavMesh 简单两个数量级：
- walkArea 是单矩形（无凹多边形、无镂空）
- blocker 是 AABB 列表（无旋转角）
- Companion 只做 Seek（直线追目标，不需要绕障寻路）

因此对标 Unity `NavMesh.SamplePosition` 的功能可以极简化：**给定目标点 → walkArea clamp + blocker 推离 → 返回最近的可行走点**。

## 1. 背景与问题

### 1.1 问题现象

[Companion 碰撞与避障设计](archived/Companion%20碰撞与避障设计.MD) Step 1-4 落地后，发现两种「Companion 永远走不到目标」的场景：

**现象 1：目标落在障碍物 box 里**
玩家紧贴障碍物（prop/stageMask pushbox）左侧站立时，[FollowingBehavior.update:42-43](file:///e:/se/BlindDuel/scripts/Systems/NpcBehaviors/FollowingBehavior.js#L42-43) 算出的 raw target：
```javascript
const targetX = playerPos.x + this.options.targetOffsetX;  // = player.x + 1.0
const targetY = playerPos.y + this.options.targetOffsetY;
```
落在障碍物 AABB 内。Companion 走过去会被 [ExploreCollisionSystem.resolveMovement](file:///e:/se/BlindDuel/scripts/Systems/ExploreCollisionSystem.js#L8-50) 的 blocker 推开，于是 `absDx > followStop` 永远成立，walk 状态无法退出。

**现象 2：目标落在 walkArea 外**
玩家走到 walkArea 右端时，`playerPos.x + 1.0` 超过 `walkArea.maxX`。Companion 被 [WalkArea.clampPosition](file:///e:/se/BlindDuel/scripts/Enties/WalkArea.js#L55-61) 钳回边界，永远够不到那个虚拟的外部目标，同样 `absDx > followStop` 永真。

### 1.2 根因
**raw target 的可达性没有保证**。FollowingBehavior 把「玩家偏移点」直接当作「Companion 应该到达的点」，但这个点可能：
- 在 walkArea 外（被硬 clamp，永远到不了）
- 在 blocker 内（被推开，永远到不了）
- 与 player AABB 重叠（即使到达，也违反避让语义）

### 1.3 范围
- ✅ 新建 `WalkAreaSampler`，给定 raw target 返回采样后的可行走点
- ✅ FollowingBehavior 用 sampled target 计算 dx/dy
- ✅ sample 时把 player 当临时 blocker（**只在 sample 阶段，不进 staticBlockers**）
- ❌ 不引入 A* / 绕障寻路（若目标点可达但路径被阻断，本设计不解决，见 §7）
- ❌ 不改 resolveMovement（物理推开行为不变）
- ❌ 不改其它 NPC（sequence 驱动 NPC 不受影响）
- ❌ 不实现 §10.3「player 进 staticBlockers」（保持现有物理行为，仅在 sample 阶段软处理 player 避让）

## 2. 设计思路（对标 Unity NavMesh.SamplePosition）

### 2.1 Unity 做法
`NavMesh.SamplePosition(source, out hit, maxDistance, areaMask)`：给定目标点 + 半径，找最近的可行走 NavMesh 点。

### 2.2 本项目简化版
**可行走点** = walkArea 矩形内 ∧ 不与任何 blocker AABB（按 padding 扩张）重叠

算法分三步：
1. **walkArea clamp**：raw target 钳到矩形内（解决现象 2）
2. **blocker push-out**：若点落在某个 blocker（按 padding 扩张）内部，沿最短穿透方向推到外缘（解决现象 1）。多个 blocker 叠加时迭代若干次收敛
3. **二次 walkArea clamp**：推离后可能越过 walkArea 边界，再 clamp 一次

**padding = companion 自身 AABB 半宽**：保证 companion「中心到达 target」时其 AABB 不与 blocker 重叠，resolveMovement 不会再推她。

### 2.3 为什么 player 不进 staticBlockers，只在 sample 时当 blocker

这是两个不同层次的概念，不能混：

| 层次 | 作用 | player 是否参与 |
|------|------|----------------|
| `resolveMovement`（硬推开） | 每帧物理修正，companion 撞 player 会被推开 | ❌ 不参与（§10.3 未实现） |
| `WalkAreaSampler.sample`（目标修正） | 算 target 时把 player 当障碍，避免 target 落在 player 身上 | ✅ 参与 |

理由：
- 把 player 加进 `staticBlockers` 会改变 §10.3 状态——companion 移动中会被 player 硬推开，影响面大，违反「companion 可以贴近 player 交互」语义
- 只在 sample 时临时把 player 当 blocker，是**软处理 target**，不改变移动期碰撞行为。companion 仍可靠近 player（受 Separation 软避让约束），只是不会主动把 target 设到 player 身上

### 2.4 与现有 Separation 的分工

| 机制 | 类型 | 处理阶段 | 解决的问题 |
|------|------|---------|-----------|
| `WalkAreaSampler` | 硬约束（target 位置） | 算 target 时 | target 不落在 player/walkArea 外/blocker 里 |
| `FollowingBehavior.Separation` | 软约束（steering 力） | companion 移动中 | companion 靠近 player 时 Y 方向避让，防贴脸 |

两者互补：sample 保证 target 可达，Separation 保证移动过程不贴脸。sample 上线后 Separation 仍需要（处理 companion 移动中 player 突然转向相向而行的场景）。

## 3. 数据流
FollowingBehavior.update(dtMs, npc, context)
├─ 读 context.walkArea / context.blockers / context.player
├─ 算 raw target = player.pos + offset
├─ 构造 sample blockers = staticBlockers + [player]   // player 临时进
├─ 算 padding = max(npc.aabb.halfW, npc.aabb.halfH)
├─ sampled = WalkAreaSampler.sample(raw.x, raw.y, walkArea, sampleBlockers, { padding })
└─ 用 sampled.x / sampled.y 算 dx/dy → 后续逻辑不变
ExploreMode.fixedUpdate 把 `walkArea` 和 `staticBlockers` 塞进 controller context：controller.update(dtMs, npc, {
player, questManager, inventoryManager, dialogueBubble, sequencerBusy,
walkArea: this.context.walkArea,      // 新增
blockers: this.staticBlockers,        // 新增
})
## 4. 实现

### 4.1 新建 `scripts/Systems/WalkAreaSampler.js`

放在 `scripts/Systems/` 与 `ExploreCollisionSystem.js` 同目录（同属 explore 子系统工具）。纯静态方法，无实例状态。

```javascript
export class WalkAreaSampler {
    /**
     * 给定 raw target，返回最近的可行走点。
     * 可行走点 = walkArea 矩形内 ∧ 不与任何 blocker AABB（按 padding 扩张）重叠。
     *
     * @param {number} x - raw target X
     * @param {number} y - raw target Y
     * @param {WalkArea|null} walkArea - 行走区域，null 时跳过 clamp
     * @param {Array} blockers - blocker 列表，元素需有 getBlockerAabb() 方法
     * @param {Object} options
     * @param {number} options.padding - blocker AABB 扩张量（通常取 agent 自身半宽）
     * @param {number} options.maxIter - blocker 推离迭代次数，默认 4
     * @returns {{x: number, y: number, changed: boolean}}
     */
    static sample(x, y, walkArea, blockers, options = {}) {
        const padding = options.padding ?? 0;
        const maxIter = options.maxIter ?? 4;

        let tx = x;
        let ty = y;

        // Step 1: clamp 到 walkArea（硬边界，优先满足）
        if (walkArea) {
            if (tx < walkArea.minX) tx = walkArea.minX;
            else if (tx > walkArea.maxX) tx = walkArea.maxX;
            if (ty < walkArea.minY) ty = walkArea.minY;
            else if (ty > walkArea.maxY) ty = walkArea.maxY;
        }

        // Step 2: 迭代推离 blocker（含 padding 扩张）
        for (let iter = 0; iter < maxIter; iter++) {
            let pushed = false;
            for (const blocker of blockers ?? []) {
                if (typeof blocker.isBlockingNow === "function" && !blocker.isBlockingNow()) continue;
                const b = blocker.getBlockerAabb?.();
                if (!b) continue;

                const minX = b.minX - padding;
                const maxX = b.maxX + padding;
                const minY = b.minY - padding;
                const maxY = b.maxY + padding;
                if (tx <= minX || tx >= maxX || ty <= minY || ty >= maxY) continue;

                const dLeft = tx - minX;
                const dRight = maxX - tx;
                const dBottom = ty - minY;
                const dTop = maxY - ty;
                const minD = Math.min(dLeft, dRight, dBottom, dTop);

                if (minD === dLeft) tx = minX;
                else if (minD === dRight) tx = maxX;
                else if (minD === dBottom) ty = minY;
                else ty = maxY;
                pushed = true;
            }
            if (!pushed) break;
        }

        // Step 3: 推离后再 clamp 一次 walkArea（防止推开时越过边界）
        if (walkArea) {
            if (tx < walkArea.minX) tx = walkArea.minX;
            else if (tx > walkArea.maxX) tx = walkArea.maxX;
            if (ty < walkArea.minY) ty = walkArea.minY;
            else if (ty > walkArea.maxY) ty = walkArea.maxY;
        }

        return { x: tx, y: ty, changed: (tx !== x || ty !== y) };
    }
}
```

**关键点**：
- **静态方法**：无状态，纯函数式，易测试
- **复用 isBlockingNow() 接口**：与 resolveMovement 一致地跳过「不挡」的 blocker（companion 自己在 following 时 isBlockingNow=false，自动跳过，避免自己挡自己 target）
- **maxIter=4**：4 次迭代足够收敛典型场景（最多 2-3 个 blocker 叠加）。若极端场景出现不收敛，可调高
- **Step 3 二次 clamp**：理论可能在 blocker 跨越 walkArea 边界时让点回到 blocker 内（退化路径），但本项目 stageMask pushbox 不会跨 walkArea 边界（场景设计上 walkArea 应包住所有 pushbox），可接受

### 4.2 修改 `FollowingBehavior.update`

[FollowingBehavior.js:42-46](file:///e:/se/BlindDuel/scripts/Systems/NpcBehaviors/FollowingBehavior.js#L42-46) 在算 `dx/dy` 之前插入 sample：

```javascript
import { WalkAreaSampler } from "../WalkAreaSampler.js";

// ... 在 update 里
const rawTargetX = playerPos.x + this.options.targetOffsetX;
const rawTargetY = playerPos.y + this.options.targetOffsetY;

const walkArea = context.walkArea ?? null;
// 临时把 player 也当 blocker 参与 sample（不进 staticBlockers，仅 target 计算）
const sampleBlockers = [...(context.blockers ?? [])];
if (typeof player.getBlockerAabb === "function") {
    sampleBlockers.push(player);
}
const npcAabb = npc.getBlockerAabb?.();
const padX = npcAabb ? (npcAabb.maxX - npcAabb.minX) * 0.5 : 0;
const padY = npcAabb ? (npcAabb.maxY - npcAabb.minY) * 0.5 : 0;
const padding = Math.max(padX, padY);

const sampled = WalkAreaSampler.sample(rawTargetX, rawTargetY, walkArea, sampleBlockers, { padding });
const targetX = sampled.x;
const targetY = sampled.y;

const dx = targetX - npcPos.x;
const dy = targetY - npcPos.y;
// ... 后续 movingX/movingY 判断与原逻辑一致
```

**注意**：player 的 `getBlockerAabb()` 由 [CombatCharacter.getBlockerAabb](file:///e:/se/BlindDuel/scripts/Enties/CombatCharacter.js#L52-61) 提供（player 是 CombatCharacter 子类），返回固定半宽 AABB（halfW=20px, halfH=12px → 0.4×0.24 world unit）。CharacterBase 基类返回 null，需 `typeof === "function"` 守卫（理论上 player 一定是 CombatCharacter 子类，但守卫更稳）。

### 4.3 修改 `ExploreMode.fixedUpdate`

[ExploreMode.js:74-81](file:///e:/se/BlindDuel/scripts/Systems/Modes/ExploreMode.js#L74-81) 的 `controller.update(...)` context 加两个字段：

```javascript
controller.update(dtMs, npc, {
    player: character,
    questManager: this.context.questManager,
    inventoryManager: this.context.inventoryManager,
    dialogueBubble: this.context.dialogueBubble,
    sequencerBusy,
    walkArea: this.context.walkArea,   // 新增
    blockers: this.staticBlockers,     // 新增
});
```

## 5. 边界情况分析

### 5.1 player 紧贴 walkArea 边界
- raw target 落在 walkArea 外 → Step 1 clamp 回边界 → Step 2 检查是否与 player AABB（含 padding）重叠 → 若重叠推离 → Step 3 再 clamp
- 结果：companion 停在 player 身侧的 walkArea 边界处，absDx ≤ followStop，正常停

### 5.2 player 紧贴障碍物
- raw target 落在障碍物 AABB 内 → Step 1 不动（在 walkArea 内）→ Step 2 推离到障碍物外缘（含 padding）→ 结果 target 在 player 与障碍物之间或 player 另一侧
- **方向反转风险**：若 `targetOffsetX` 是正数（跟在右侧）但 sample 后 target 落在 player 左侧，companion 会跑到玩家「错误的一侧」。这是合理退化：边界处无路可走时优先「可达」而非「方向正确」
- 当前 `targetOffsetX=1.0`（正数），player 紧贴障碍物左侧时 sample 会把 target 推到 player 右侧（障碍物外），方向正确；player 紧贴 walkArea 右墙时 sample 把 target 推到 player 左侧（墙内），方向反转，但 absDx 已 ≤ followStop，companion 停下，可接受

### 5.3 companion 自己也是 blocker
- companion 在 `staticBlockers` 里（双重身份，见 [Companion 碰撞与避障设计 §4.3](archived/Companion%20碰撞与避障设计.MD)）
- 但 `_isFollowing=true` 时 `isBlockingNow()` 返回 false → sample 的 blocker 循环跳过她，**不会自己挡自己 target** ✅
- 这正是 §2.3 「软处理 player」思路的延伸：companion 自己也用 isBlockingNow 软处理

### 5.4 sequencer 期间
- sequencer 期间 NpcController.update 不调（[ExploreMode.fixedUpdate:72-82](file:///e:/se/BlindDuel/scripts/Systems/Modes/ExploreMode.js#L72-82) 的 sequencer 门控已覆盖 controller 调用？需确认）
- 实际：controller.update 在 interactables 循环里，**不受 sequencerBusy 门控**，但 FollowingBehavior 只在 `state === "following"` 时被调，sequencer 期间 state 不会是 following（intro 期间是 idle/observe）
- 兜底：即使误调，sample 也是幂等的，不会污染状态

### 5.5 padding=0（npcAabb 为 null）
- 理论上 NpcCharacter 一定有 occupancy，getBlockerAabb 不会返回 null
- 但守卫写法 `npcAabb ? ... : 0` 保证退化时 sample 仍能工作（只是 target 会贴 blocker 边缘，可能 resolveMovement 时被推）

## 6. 实施步骤

### Step 1：新建 WalkAreaSampler
- [ ] 创建 `scripts/Systems/WalkAreaSampler.js`（见 §4.1 完整代码）

### Step 2：ExploreMode 传 context
- [ ] [ExploreMode.fixedUpdate](file:///e:/se/BlindDuel/scripts/Systems/Modes/ExploreMode.js#L74-81) controller.update context 加 `walkArea` 和 `blockers` 字段

### Step 3：FollowingBehavior 接入 sample
- [ ] [FollowingBehavior.js](file:///e:/se/BlindDuel/scripts/Systems/NpcBehaviors/FollowingBehavior.js) 顶部 import WalkAreaSampler
- [ ] [FollowingBehavior.update:42-46](file:///e:/se/BlindDuel/scripts/Systems/NpcBehaviors/FollowingBehavior.js#L42-46) 插入 sample 逻辑（见 §4.2）

### Step 4：验证
- [ ] 玩家紧贴障碍物左侧站立，Charlotte 能正常停下（不卡 walk 状态）
- [ ] 玩家走到 walkArea 右端，Charlotte 能正常停下（不卡 walk 状态）
- [ ] 玩家正常移动，Charlotte 跟随行为与改造前一致（无回归）
- [ ] sequencer 期间 Charlotte 位置仍由 moveActorTo 控制（无干扰）

## 7. 遗留与后续

### 7.1 路径阻断（sample 无法解决）
Sample 只能解决「目标点不可达」。若目标点可达但路径被 blocker 阻断（如玩家和 companion 之间隔着一堵墙，sample 后 target 在墙另一侧，companion 直线走过去被墙挡住），需要：
- **方案 A（auto-braking，推荐）**：FollowingBehavior 加「卡住检测」——记录上一帧 NPC 位置，若 moving=true 但本帧位移 < 阈值，累计 N 帧后强制 idle。这是 Unity NavMeshAgent.autoBraking 的思路
- **方案 B（绕路）**：A* 或 Potential Field，对 2D beat'em up 过度设计

**决策**：本次先做 sample，跑起来观察。若还有「卡死」现象再加 auto-braking。

### 7.2 方向反转处理
§5.2 提到的「sample 后 target 在 player 非预期侧」edge case，当前 `targetOffsetX=1.0`（正数）不触发。若未来要做双向跟随（companion 可配负 offset 跟在左侧），可在 sample 后加方向校验：若 sampled target 在 player 非预期侧则放弃跟随转 idle。本次不做。

### 7.3 命名重构
`WalkAreaSampler` 命名对标 Unity `NavMesh.SamplePosition`，语义清晰。未来若扩展为支持多个 walkArea（凹多边形）或带旋转角的 OBB blocker，接口不变，仅 sample 内部算法升级。

## 8. 文件清单

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `scripts/Systems/WalkAreaSampler.js` | 🆕 新建 | 静态采样工具，§4.1 |
| `scripts/Systems/NpcBehaviors/FollowingBehavior.js` | ✏️ 修改 | update 顶部插入 sample，§4.2 |
| `scripts/Systems/Modes/ExploreMode.js` | ✏️ 修改 | controller context 加 walkArea/blockers，§4.3 |

## 9. 与现有约束的一致性核对

| 约束（project_memory） | 本设计是否违反 |
|----------------------|---------------|
| companion 同时进 dynamicActors + staticBlockers | ✅ 不动该结构，仅 sample 时临时把 player 加入 sampleBlockers（不持久化） |
| isBlockingNow 基于 _isFollowing | ✅ sample 复用同一接口，following 时跳过 companion 自身 |
| resolveMovement self-exclusion | ✅ 不改 resolveMovement，sample 是独立路径 |
| FollowingBehavior 双轴 + Separation | ✅ Separation 保留，sample 只改 target 计算 |
| controlledBySequence 标记 | ✅ 不动 sequencer 路径 |
| sequencer 期间 ExploreMode 门控 | ✅ controller.update 仍在 interactables 循环，但 sequencer 期间 state 非 following，FollowingBehavior 不会被调 |