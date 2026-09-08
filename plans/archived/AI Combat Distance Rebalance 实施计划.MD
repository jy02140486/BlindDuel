# AI Combat Distance Rebalance 实施计划

## 1. 概述

### 1.1 问题

当前 AI 战斗决策系统（`AIController.js`，Phase 1 Utility AI）存在两个观察到的行为问题：

1. **后闪频率过高**：面对玩家的斩击（slash）也大量选择 dodge，而非 guard。
2. **逼近后长时间站定**：距离进入攻击范围附近后，AI 原地 hold 不动长达数百毫秒。

### 1.2 根因摘要

| 问题 | 根因 | 代码位置 |
|------|------|----------|
| dodge 偏好 | dodge 评分基数天生比 guard 高 +0.1，且永远不触发 `evaluateInteraction` 扣分；guard 遇到 thrust 被 -0.5 | `#scoreDefense()` L340-351、L333-336 |
| 站定 | positioning hold 区上边界 `maxReach + 0.5`（boost 时 +1.0）与 attack 有效阈值 `range + 0.3` 不对齐，中间有 gap；800ms 冷却期所有动作评分归零后 fallback 到 hold | `#executePositioning()` L380-393、`#scoreAttack()` L255/L260 |

### 1.3 设计依据

本计划遵循：
- 项目三层分离架构（Knowledge = 角色能力、Rules = ContactResolver 规则、Decision = AI 评分）
- `plans/AI_Combat_Distance_Guideline.md` 提出的"以战斗距离为核心评价轴"设计
- 保守迭代原则：先修距离模型，不引入新 trait、不改 cooldown、不做动态 dodge

### 1.4 目标

实施后 AI 应表现出：

```text
远 → 压近（不再因为宽 hold 区提前停下）
近 → 寻找攻击机会（不再因为 range gap 站定）
遭到攻击 → 优先 guard（因为保持距离 = 更接近 preferred range）
确实需要拉开 → 选 dodge（如果当前距离偏近且 dodge 能回到 preferred range）
```





---

## 2. 设计约束

以下约束不可违反：

1. **Knowledge / Rules / Decision 三层不得混**：
   - Decision 层（`#scoreAttack` / `#scoreDefense` / `#executePositioning`）不得复制 `ContactResolver.evaluateInteraction()` 的克制规则
   - Decision 层不得硬编码角色专属偏移量（如 "Rabble Stick 应该 guard +0.2"），如需差异化应走 trait 数据层
2. **Action Commitment 保持不变**：防御/攻击动作一旦选定，完整执行后才重决策，不引入 event-driven 打断
3. **现有 trait 不动**：`postDefenseMobility` 保持原样，本计划不新增 `postDefenseAttackBoost`
4. **displacement 符号约定**：项目 AI 永远在右侧朝左，`displacement > 0` 总是代表远离对手，可直接用于 `predictedDistanceAfterAction = currentDistance + displacement`

---

## 3. 参数锚定（实现前必须钉死）

以下公式在实施中统一使用，所有位置引用同一个值，不再各算各的。

### 3.1 核心概念

```text
preferredCombatRange = #getMaxReach()     // 当前角色所有攻击中最大的 maxReach
统一 rangeBuffer = 0.2                     // 攻击有效 & hold 区边界共用

attack 有效阈值    = preferredCombatRange + rangeBuffer
positioning hold 上边界 = preferredCombatRange + rangeBuffer
positioning hold 下边界 = #getMinReach()   // 不变，过近才 retreat

mobility boost 时：
  rangeBuffer 保持 0.2                    // 不扩大！boost 让 AI 冲得更近，不是停得更远
  retreatThreatThreshold 保持 0.8          // 保留原来的 boost 调整（更敢于贴近）
```





### 3.2 防御评分基数拉平

```text
active  阶段：dodge = guard = 0.85   （原 dodge 0.9, guard 0.8）
startup 阶段：dodge = guard = 0.65   （原 dodge 0.7, guard 0.6）
parry 额外奖励 +0.2                   （保留，作为 guard 的差异化优势）
```





### 3.3 距离后果评价公式

```text
predictedDistanceAfterAction = currentDistance + action.displacement

distanceErrorNow   = |currentDistance - preferredCombatRange|
distanceErrorAfter = |predictedDistanceAfterAction - preferredCombatRange|

distanceConsequenceDelta = distanceErrorAfter - distanceErrorNow
  // 如果为正 → 执行这个动作会让距离远离 preferred range → 扣分
  // 如果为负 → 执行这个动作会让距离回归 preferred range → 加分

防御评分调整量 = clamp(distanceConsequenceDelta * -0.3, -0.25, +0.25)
  // 系数 0.3，限幅 ±0.25，避免距离后果盖过威胁评分
```





---

## 4. 实施步骤

所有改动集中在 `scripts/Systems/AIController.js`，不引入新文件，不改其他模块。

---

### Step 1：提取范围常量，消除 range gap

**目标**：让 attack 有效范围、positioning hold 边界、mobility boost 三者使用同一套语义。

**改动点**：`AIController.js`

#### 1a. 构造函数中新增常量字段

```javascript
// 统一范围模型（Step 1 新增）
this.rangeBuffer = options.rangeBuffer ?? 0.2;
```





#### 1b. `#scoreAttack()` 距离阈值改为引用 `rangeBuffer`

原 L255：
```javascript
if (sit.distance > range + 0.3) return 0;
```

改为：
```javascript
const effectiveRange = range + this.rangeBuffer;
if (sit.distance > effectiveRange) return 0;
```





原 L296（接近 range 上限微加分）同步调整：
```javascript
if (sit.distance >= range && sit.distance <= effectiveRange) score += 0.05;
```





#### 1c. `#executePositioning()` 消除 `approachReachMargin`

原 L380-381：
```javascript
const retreatThreatThreshold = hasBoost ? 0.8 : 0.6;
const approachReachMargin = hasBoost ? 1.0 : 0.5;
```

改为：
```javascript
const retreatThreatThreshold = hasBoost ? 0.8 : 0.6;
// rangeBuffer 统一来自构造函数，不再单独定义 approachReachMargin
```





原 L384 / L390 / L393 所有引用 `approachReachMargin` 的地方，替换为 `this.rangeBuffer`：

```javascript
// 原: jitteredDistance <= maxReach + approachReachMargin
// 现: jitteredDistance <= maxReach + this.rangeBuffer

// 原: jitteredDistance > maxReach + approachReachMargin
// 现: jitteredDistance > maxReach + this.rangeBuffer

// 原: jitteredDistance > minReach && jitteredDistance <= maxReach + approachReachMargin
// 现: jitteredDistance > minReach && jitteredDistance <= maxReach + this.rangeBuffer
```





**为什么这就消除了 gap？**

改动后 positioning hold 上边界 = `maxReach + rangeBuffer`，attack 有效阈值 = `range + rangeBuffer`。两者使用同一个 rangeBuffer 常量（0.2），不再各算各的。mobility boost 也不再扩大 rangeBuffer，反效果消除。

---

### Step 2：在 `#buildSituation()` 中注入距离模型

**目标**：在 situation 对象中加入 `preferredCombatRange`、`distanceError`，供后续评分函数消费。

**改动点**：`AIController.js` 的 `#buildSituation()` 方法（L145-221）

#### 2a. 计算 preferredCombatRange 和 distanceError

在现有 `selfMaxReach` 赋值（L195）之后，插入：

```javascript
// Step 2 新增：统一距离模型
const preferredCombatRange = selfMaxReach;
const distanceError = distance - preferredCombatRange;
// distanceError > 0 表示当前偏远（应该 approach）
// distanceError ≈ 0 表示已在攻击边缘
// distanceError < 0 表示过近（可能需要 retreat）
```





#### 2b. 把新字段塞进返回的 situation 对象

```javascript
return {
    distance,
    // ... 现有字段保持不变 ...
    selfMaxReach,
    // Step 2 新增：
    preferredCombatRange,
    distanceError,
    // ...
};
```





---

### Step 3：拉平防御评分基数

**目标**：消除 dodge 天生 +0.1 的结构性优势。

**改动点**：`AIController.js` 的 `#scoreDefense()` 方法（L340-351）

原：
```javascript
if (sit.opp.phase === "active") {
    score += kind === "dodge" ? 0.9 : 0.8;
} else if (sit.opp.phase === "startup") {
    const myStartupMs = defenseAction.timing?.totalMs ?? 200;
    if (myStartupMs <= sit.opp.remainingMs) {
        score += kind === "dodge" ? 0.7 : 0.6;
    } else {
        score += 0.3;
    }
}
```

改为：
```javascript
if (sit.opp.phase === "active") {
    // Step 3 改动：拉平 dodge 和 guard 基数
    score += 0.85;
} else if (sit.opp.phase === "startup") {
    const myStartupMs = defenseAction.timing?.totalMs ?? 200;
    if (myStartupMs <= sit.opp.remainingMs) {
        // Step 3 改动：拉平 dodge 和 guard 基数
        score += 0.65;
    } else {
        score += 0.3;
    }
}
```

parry +0.2 奖励（L329-331）和 thrust guard -0.5 扣分（L333-336）保持原样不动。

---

### Step 4：将 Distance Consequence 纳入防御评分

**目标**：让 dodge 和 guard 的选择不再只取决于"哪个更安全"，还取决于"哪个更符合当前距离目标"。

**改动点**：`AIController.js` 的 `#scoreDefense()` 方法（Step 3 改动之后）

在现有评分逻辑末尾、return 之前，插入距离后果评价：

```javascript
// Step 4 新增：Distance Consequence — 防御动作后的距离后果
const currentDistance    = sit.distance;
const preferredRange     = sit.preferredCombatRange;
const actionDisplacement = defenseAction.displacement ?? 0;

// 预测动作后的距离
const predictedDistance = currentDistance + actionDisplacement;

// 计算距离偏差的变化（执行后 vs 执行前）
const errorNow         = Math.abs(currentDistance - preferredRange);
const errorAfter       = Math.abs(predictedDistance - preferredRange);
const consequenceDelta = errorAfter - errorNow;

// 把偏差变化转换成评分调整量
// consequenceDelta > 0 → 动作让距离变糟（远离 preferred range）→ 扣分
// consequenceDelta < 0 → 动作让距离变好（回归 preferred range）→ 加分
const consequenceAdjustment = Math.max(-0.25, Math.min(0.25, -consequenceDelta * 0.3));
score += consequenceAdjustment;
```





**效果示例**：

Rabble Stick，preferredCombatRange = 3.0，dodge displacement ≈ 0.6（frameSpeeds [1,0.4] × duration），guard displacement = 0：

| 当前距离 | 动作 | predictedDistance | errorNow | errorAfter | consequenceDelta | 评分调整 |
|---|---|---|---|---|---|---|
| 3.5（略远） | guard | 3.5 | 0.5 | 0.5 | 0 | 0 |
| 3.5（略远） | dodge | 4.1 | 0.5 | 1.1 | +0.6 | **-0.18** |
| 2.5（偏近） | guard | 2.5 | 0.5 | 0.5 | 0 | 0 |
| 2.5（偏近） | dodge | 3.1 | 0.5 | 0.1 | -0.4 | **+0.12** |
| 3.0（完美距离） | guard | 3.0 | 0 | 0 | 0 | 0 |
| 3.0（完美距离） | dodge | 3.6 | 0 | 0.6 | +0.6 | **-0.18** |

所以：AI 在完美攻击距离附近会优先 guard（dodge 被 -0.18）；AI 贴脸太近时会优先 dodge（dodge 被 +0.12，刚好拉回 preferred range）。

---

## 5. 实施后验证

### 5.1 代码级检查项

| 检查项 | 方法 |
|--------|------|
| rangeBuffer 在三处一致 | `#scoreAttack`、`#executePositioning`、构造函数 `this.rangeBuffer` 都引用同一个值 |
| mobility boost 不再扩大 rangeBuffer | 代码中删除 `approachReachMargin` 变量 |
| 所有 range + 硬编码数字消失 | 全局搜索 `0\.3|0\.5|1\.0` 应无 range 相关硬编码（除了 `rangeBuffer = 0.2` 常量本身和 retreatThreatThreshold） |
| distanceConsequence 对所有防御动作都生效 | displacement 为 0 的 guard 自然得到 consequenceDelta = 0，不加不减 |

### 5.2 行为级观察项

对照 GPT guideline §18 的成功标准：

| 成功表现 | 失败表现 |
|----------|----------|
| 玩家攻击 → Rabble Guard → 成功防御 → postDefenseMobility → 主动逼近 → 进入攻击距离 → 主动攻击 | 玩家攻击 → Rabble Dodge → 越来越远 → 继续 Dodge → 站着等 |
| Rabble Approach → 进入 range 附近 → 立刻能攻击（无 gap） | Rabble Approach → 进入 positioning hold → 攻击仍然打不到 → 站定 |
| AI 贴脸太近时（distance < minReach）优先 dodge 拉开 | AI 在完美攻击距离附近仍大量选择 dodge |

### 5.3 Debug 辅助

建议在 `#makeDecision()` 的选招逻辑后临时加一条 debug log（可被 X 键 debugVisible 控制），打印前 3 名的 `kind + action.stateName + score + 各分项（phase分/交互分/距离后果分）`，方便观察评分来源。验证完清除。

---

## 6. 后续观察与可能的第二轮

如果本计划实施后 AI 仍然出现"攻击后短暂发呆"，再单独考虑：

- **attackCooldownMs 800ms 是否过长**（GPT guideline §13 建议先不动，看距离修正后是否自然改善）
- **多攻击 reach 差异**：如果 Rabble 的 thrust reach 和 swing reach 差太大，preferredCombatRange 取 maxReach 可能导致 swing 永远打不到。需 playtest 确认。
- **Distance Consequence 系数调参**：当前 0.3 的敏感度和 ±0.25 的限幅是直觉值，可能需要微调。

以上不进入本计划范围。

---

## 7. 非目标

本计划不做：

- 不新增 `postDefenseAttackBoost` 等 trait
- 不改 `attackCooldownMs`（800ms 先保留）
- 不做动态 dodge 位移（根据边界缩短 displacement）
- 不引入高层 `distanceIntent` 状态机（approach/hold/retreat 仍由 positioning 函数隐式表达）
- 不改 Action Commitment 机制
- 不改 `ContactResolver` 或任何战斗规则

---

## 8. 改动文件清单（仅一个）

| 文件 | 改动类型 | 改动位置 |
|------|----------|----------|
| `scripts/Systems/AIController.js` | 修改 | 构造函数（加常量）、`#buildSituation()`（加距离字段）、`#scoreAttack()`（改 range 阈值）、`#scoreDefense()`（拉平基数 + 加距离后果）、`#executePositioning()`（删 approachReachMargin） |