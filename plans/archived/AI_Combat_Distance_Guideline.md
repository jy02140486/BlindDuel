# AI Combat Distance Guideline

## 1. Purpose

本 guideline 用于指导当前 2D 战斗游戏 AI 决策系统下一阶段的调整。

当前 AI 已完成：

- Knowledge Registry：读取角色攻击、防御、闪避、位移等能力数据
- CombatResolver：统一处理攻击 / Guard / Dodge / Parry 的战斗结果
- Utility AI：根据当前局面给行动评分
- Action Commitment：避免每个 tick 反复改动作
- Character Traits：例如 `postDefenseMobility`，防守成功后获得短时移动加速

当前观察到的主要问题：

1. AI 过度使用后闪（Dodge），面对斩击也经常优先后退。
2. AI 逼近到攻击距离附近后容易长时间站定，显得被动。
3. 当前设计目标不是单纯“提高 AI 反应正确率”，而是让 AI **主动控制战斗距离、积极争夺主动权，并形成连续的攻防往返**。

本 guideline 的核心原则是：

> **将“战斗距离”提升为 AI 的核心评价轴，而不是继续通过大量动作特判修补 Dodge、Approach、Attack 的局部行为。**

---

## 2. 核心设计目标

最终希望 AI 的战斗行为表现为：

```text
观察局面
  ↓
判断当前距离是否有利
  ↓
主动压近 / 保持 / 调整
  ↓
寻找进攻机会
  ↓
对手行动时选择代价最小的防御方式
  ↓
防守成功后继续争夺主动权
  ↓
重新进入有利战斗距离
```

而不是：

```text
对方攻击 → Dodge
距离远 → Approach
能攻击 → Attack
否则 → Idle
```

尤其需要避免这种行为：

```text
Dodge
  ↓
退远
  ↓
Dodge
  ↓
更远
  ↓
站定等待
```

以及：

```text
Approach
  ↓
到达一个宽泛的 hold 区
  ↓
Attack Utility 暂时不足
  ↓
停止不动
```

---

# 3. 第一原则：区分“角色能力”和“局面评价”

继续保持以下架构边界：

### Knowledge：角色是什么

由角色数据描述：

- 攻击的有效距离
- 攻击 timing
- Guard / Dodge 能力
- 防御位移
- Character Traits
- 其它角色固有能力

### Combat Rules：动作产生什么结果

由 `ContactResolver` / CombatSystem 统一决定：

- Guard 是否挡住某类攻击
- Dodge 是否成功
- Parry 是否成立
- Clash / Hit / Block 等结果
- `defenseSuccess` 等战斗事实事件

Decision 层不得自行复制这些规则。

### Decision：现在应该做什么

由 AI 根据当前局面评价：

- 当前距离
- 有利战斗距离
- 威胁
- 对手状态
- 自己状态
- 攻击机会
- 防御代价
- 防御后对距离的影响

核心原则：

> **数据定义能力，代码定义如何根据局面推导行为。**

---

# 4. 将“战斗距离”提升为核心评价轴

当前系统已经读取了：

```js
attack.maxReach
attack.range
movement.stateDisplacements

dodge.displacement
guard.displacement
```

过去这些数据主要作为知识保存，Decision 层没有充分消费。

下一阶段应该建立一个统一的距离评价概念：

```text
Current Distance
        ↓
Desired / Preferred Combat Range
        ↓
Distance Error
        ↓
影响 Attack / Approach / Guard / Dodge 的 Utility
```

---

## 5. Preferred Combat Range

第一版不需要建立复杂的 `distanceIntent` 状态机，也不需要为每个敌人手工写大量距离规则。

建议首先建立一个统一概念：

```text
preferredCombatRange
```

它表示：

> **当前角色最希望与对手保持的战斗距离。**

第一版可以主要由角色可用攻击的有效距离推导，而不是完全手工指定固定数值。

例如：

```text
max effective attack reach
        ↓
preferred combat range
        ↓
留出适当安全 margin
```

具体公式可以根据现有项目数据决定，重点是保证：

1. `preferredCombatRange` 与实际攻击有效距离逻辑一致。
2. Positioning 的 hold 区不要宽于 Attack 真正能够有效出招的区域。
3. 不要再出现：

```text
Positioning: “已经够近了”
Attack:      “还打不到”
```

这样的逻辑 gap。

---

# 6. Distance Error

定义：

```text
Distance Error = Current Distance - Preferred Combat Range
```

语义：

```text
Distance Error > 0
→ 当前距离偏远
→ AI 应更倾向主动接近

Distance Error ≈ 0
→ 处于有利战斗距离
→ AI 应更倾向寻找攻击机会

Distance Error < 0
→ 当前距离过近
→ AI 应考虑重新整理距离
```

注意：这不是一个要求 AI 每帧都强制纠正的硬约束，而是 Utility 的重要输入。

---

# 7. Distance Utility 应该影响多个动作，而不是只影响 Approach

当前最重要的结构调整：

**距离评价不能只用于 `Approach`。**

它应该同时影响：

```text
Attack
Approach
Guard
Dodge
```

### 7.1 Attack

距离接近 preferred range 时，Attack Utility 应明显上升。

如果当前距离已经适合某个攻击，不应该因为一个较宽的 positioning hold 区而进入 idle。

### 7.2 Approach

当前距离明显偏远时，Approach Utility 应上升。

目标不是：

> “进入某个 hold 区就停止。”

而是：

> “接近到足以形成有效攻击威胁的位置。”

### 7.3 Guard

Guard 通常不改变距离，因此它的主要优势是：

> **化解威胁的同时，不主动破坏当前战斗距离。**

因此在 AI 当前希望保持或压近距离时，Guard 可以天然具有比大幅后撤的 Dodge 更好的距离后果。

### 7.4 Dodge

Dodge 不应因为“成功率高”就天然占据评分优势。

Dodge 的一个真实成本是：

> **它可能把 AI 推离自己的 preferred combat range。**

因此第一版应在 Decision Utility 中考虑：

```text
如果执行 Dodge 后预计距离明显超过 preferredCombatRange
→ Dodge Utility 下降
```

这不是修改 ContactResolver 的 Dodge 规则，而是评价 Dodge 的战术代价。

---

# 8. 不要先通过“降低 Dodge 基础分”解决所有问题

当前观察到 Dodge 比 Guard 频率高。

可以适当拉平两者基础评分，例如：

```text
active:
    guard ≈ dodge

startup:
    guard ≈ dodge
```

并继续保留 Parry 的额外价值。

但是，这只应作为修正项，不应成为主要解决方案。

主要原则应该是：

> **Guard / Dodge 的选择不仅取决于“哪个更安全”，还取决于“哪个更符合当前距离目标”。**

否则即使把：

```text
dodge 0.9
guard 0.8
```

调成：

```text
dodge 0.85
guard 0.85
```

AI 仍然可能因为 Dodge 的成功率优势而持续后撤。

---

# 9. 不要现在引入复杂的 distanceIntent 状态机

`approach / hold / retreat` 作为概念是合理的，但当前阶段不建议先把它设计成一个复杂的高层 Intent 系统。

第一阶段优先验证：

```text
preferredCombatRange
+
Distance Error
+
Distance Consequence
```

是否已经能够自然产生：

```text
远 → 压近
近 → 攻击
遭到攻击 → 选择不破坏距离优势的防御
防御成功 → 继续争夺距离
```

只有当这套评价轴仍然无法表达某类战术时，再考虑显式的高层 `distanceIntent`。

---

# 10. 防御动作应该考虑“动作后的距离后果”

Knowledge Registry 当前已经知道：

```js
Dodge.displacement
guard.displacement
```

这个数据值得进入 Utility，但不要简单地做成：

```js
if (displacement < 0) +0.2
```

而应该考虑动作之后的结果：

```text
Current Distance
        ↓
预测执行 Defense 后的距离
        ↓
与 Preferred Combat Range 比较
        ↓
得到 Distance Consequence
```

即：

```text
predictedDistanceAfterAction
```

然后评价：

```text
abs(predictedDistanceAfterAction - preferredCombatRange)
```

这样同一个 Dodge，在不同当前距离下可以得到不同的 Utility。

例如：

```text
当前已经很远
+ Dodge 后更远
→ 很差

当前略近
+ Dodge 后回到 preferred range
→ 可能非常好
```

这比硬编码 `dodge -0.2` 更符合 Utility AI 的思想。

---

# 11. Post-Defense Mobility 的角色定位

已经加入的：

```text
postDefenseMobility
500ms
1.5x
```

应该继续保留为 Character Trait。

它不是“成功防守以后必须冲刺”的脚本，而是：

> **成功防守以后，角色获得一个更容易重新夺回主动距离的能力窗口。**

因此：

```text
Defense Success
    ↓
postDefenseMobility active
    ↓
movement capability temporarily improves
    ↓
AI 根据新的距离局面重新评价
```

Trait 本身不应该直接指定：

```text
guard → approach
```

否则会把 Character Trait 和 Decision 逻辑重新耦合起来。

---

# 12. Defense Success 不应等于立即打断 Commitment

当前 Action Commitment 机制刚建立，不建议为了 `defenseSuccess` 立即推翻它。

第一阶段保持：

```text
Guard / Dodge / Attack commitment
```

仍然有效。

但可以为以后保留：

```text
Decision Opportunity
```

的概念。

理想结构是：

```text
100ms periodic decision
+
event-generated decision opportunity
```

但不是：

```text
每个 defenseSuccess
→ 立即打断当前动作
```

以后如果发现 500ms mobility window 经常因为 commitment 被浪费，可以考虑：

```text
DefenseSuccess
    ↓
mark decision opportunity
    ↓
当前 commitment 结束
    ↓
尽快重新 decision
```

这属于后续优化，不是当前第一优先级。

---

# 13. Attack Cooldown 不要作为第一轮主要修复手段

当前：

```text
attackCooldownMs = 800ms
```

攻击后短时间内 Attack Utility 被强烈压低。

这可能导致：

```text
Attack
 ↓
Cooldown
 ↓
Defense utility 又不足
 ↓
Positioning hold
 ↓
长时间 Idle
```

但当前不应立即把 800ms 大幅降低。

第一轮应该先修：

1. Positioning hold range 与 Attack effective range 的不一致。
2. Distance Error / Preferred Range。
3. Dodge 的距离代价。

然后再观察 800ms 是否仍导致明显的“攻击后发呆”。

如果距离逻辑正确后仍然出现：

```text
Attack
→ 原地停很久
→ 什么都没有价值
```

再单独测试 cooldown 数值。

---

# 14. 不要现在做动态 Dodge 距离

暂时不要加入：

```text
根据战斗边界
根据双方距离
动态缩短 Dodge displacement
```

这种机制虽然以后可能有价值，但它解决的是：

> **“Dodge 以后退多少？”**

当前更根本的问题是：

> **“为什么 AI 如此愿意 Dodge？”**

先解决 Action Selection，再解决 Action Execution 的位移优化。

正确的优先级是：

```text
第一层：是否应该 Dodge？
        ↓
第二层：如果 Dodge，应该退多少？
```

只有第一层正确之后，动态 Dodge 距离才值得加入。

---

# 15. Positioning 与 Attack Range 必须共享同一套语义

当前已出现：

```text
Positioning hold upper bound
    >
Attack effective range
```

导致：

```text
Positioning: 已经够近
Attack: 还打不到
```

这类问题以后应尽量避免。

建议建立统一概念：

```text
Attack effective range
        ↓
Combat range model
        ↓
Preferred combat range
        ↓
Positioning target
```

而不是：

```text
AttackSystem 自己计算 range
Positioning 自己计算 hold range
AI 自己又计算一个 margin
```

这样未来换武器、换敌人、增加攻击方式时，不容易出现新的 range gap。

---

# 16. 战斗边界应当是“第二阶段约束”，不是第一阶段核心目标

未来可以考虑：

```text
当前位置
+
Preferred Combat Range
+
Battle Boundary
```

共同决定：

- Dodge 是否值得
- Retreat 是否安全
- Approach 是否应该继续
- 是否应该尝试把对手压向边界

例如：

```text
AI 背后接近战斗边界
→ Dodge 的空间代价更大
```

或者：

```text
AI 已经有足够退空间
→ Dodge 可以正常发挥
```

但是这应该建立在“距离评价轴”已经稳定之后。

不要现在直接把：

```text
boundary distance
→ Dodge displacement
```

硬连起来，否则会把 Action Selection 和 Movement Execution 再次耦合。

---

# 17. 当前最小实现建议

下一轮建议只做以下几项：

### A. 修正 range gap

统一 Positioning 与 Attack 的有效距离语义。

第一版可先使用统一的小 margin，例如约 `0.2`，而不是让 mobility boost 把 hold range 扩大到 1.0。

### B. 引入 Preferred Combat Range

优先从角色实际攻击能力推导。

### C. 引入 Distance Error

```text
currentDistance - preferredCombatRange
```

### D. 将 Distance Consequence 纳入 Action Utility

至少覆盖：

```text
Attack
Approach
Guard
Dodge
```

### E. Dodge 使用 predicted post-action distance

而不是单纯使用：

```text
“Dodge 很安全”
```

来给高分。

### F. 保留现有 postDefenseMobility

先不增加新的 `postDefenseAttackBoost` trait。

先观察：

```text
Defense Success
→ Mobility
→ AI 是否自然利用新的距离机会重新攻击
```

### G. 暂时不改 800ms cooldown

先修距离模型，再决定 cooldown 是否需要调整。

### H. 暂时不做动态 Dodge 位移

先解决“是否 Dodge”，再解决“退多少”。

---

# 18. 验证标准

不要只观察“攻击次数增加没有”。

重点观察以下行为链是否出现：

### 成功的短棍兵

```text
玩家攻击
 ↓
Rabble Guard / Dodge
 ↓
成功防御
 ↓
获得 postDefenseMobility
 ↓
主动重新逼近
 ↓
进入自己的有效攻击距离
 ↓
主动发动攻击
```

### 不成功的表现

```text
玩家攻击
 ↓
Rabble Dodge
 ↓
距离越来越远
 ↓
继续 Dodge
 ↓
站着等待
```

或者：

```text
Rabble Approach
 ↓
已经进入 positioning hold
 ↓
攻击仍然打不到
 ↓
站定
```

真正需要追求的是：

> **AI 不只是“知道什么时候该防御”，而是知道防御、移动和攻击都在服务于一个共同的战斗距离目标。**

---

# 19. 参数调整与代码机制的边界

以后遇到类似问题，使用下面的判断标准：

## 应该用数据解决

当问题是：

> “这个角色具有什么能力 / 偏好？”

例如：

```text
attack reach
attack timing
dodge displacement
postDefenseMobility duration
postDefenseMobility speedMultiplier
preferred range bias
risk tolerance
```

这些应该尽量数据化。

## 应该用代码解决

当问题是：

> “AI 如何从当前局面推导出应该做什么？”

例如：

```text
如何计算 distance error
如何预测 action 后的位置
如何评价 Dodge 的距离代价
如何比较 Attack 与 Approach
如何综合威胁与距离
```

这些属于 Decision / Utility 的通用逻辑。

核心原则：

> **不要用大量角色专属参数模拟一个尚不存在的通用评价维度。**

如果多个角色都开始需要“不要退太远”“接近以后继续压”“防守以后抢回主动权”，说明应该补通用 Decision 模型，而不是继续给每个角色增加特例。

---

# 20. 后续演进方向

如果上述模型稳定，下一阶段可以自然测试：

### 长柄武器

重点观察：

```text
更大的 attack reach
→ 不同 preferred combat range
→ AI 是否主动利用武器距离优势
```

### 剑盾兵

重点观察：

```text
Guard
Multiple Slash
Follow-up attack
Shield-like heavy action
```

能否形成：

```text
压进
→ 攻击
→ 追击
→ 防御
→ 再组织
```

### 战斗边界

再加入：

```text
space remaining
boundary pressure
retreat cost
```

验证 AI 是否能够主动控制场地空间。

### 更高层 Intent

只有当 Distance Error + Utility 仍无法自然表达明确战术目标时，再考虑：

```text
Attack
Defend
Punish
Disengage
Press
Hold Range
```

这样的高层 Intent。

---

# 21. 本阶段非目标

本阶段不要同时引入：

- 新 Buff System
- 完整 Threat/Intent State Machine
- 动态 Dodge 位移系统
- 即时打断 Commitment 的事件决策
- `postDefenseAttackBoost` 等更多特性
- 主角 `parryBonus` 的整体重构
- 大规模 Character 类重构

目标是用最小的通用 Decision 扩展，验证：

> **“以战斗距离为共同评价轴之后，AI 是否会自然表现出更主动、更连续的攻防。”**

如果答案是否定的，再根据实际表现决定下一层应该补 Perception、Utility、Intent 还是 Movement Execution。
