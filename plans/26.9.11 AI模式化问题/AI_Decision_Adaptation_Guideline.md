# AI Decision Adaptation Guideline

## 目的

当前 AI 已具备：

- Knowledge Registry
- CombatResolver 规则查询
- Situation Perception
- Utility 评分
- Action Commitment
- Character Traits / Post-Defense Mobility

近期测试暴露的新问题不是“AI 完全不会决策”，而是：

1. 距离权重过强，导致远距离时长期偏向 reach 最大的招式。
2. 连续被玩家利用同一种招式后，AI 没有行为反馈闭环，仍持续重复。
3. 相近评分时使用独立随机扰动，缺乏行为惯性。
4. startupMs 主要只在 preemptive 场景生效，日常动作选择中没有充分体现。
5. AI 的“模式化”本身具有教学和可预测性价值，不应被简单视为 bug。

本阶段目标不是让 AI “每次都选择最优且不同的招式”，而是建立：

> **可预测的行为惯性 → 玩家可以利用 → AI 根据结果逐渐调整。**

这比纯随机变化更符合本项目的战斗设计。

---

## 1. 核心原则：模式化不是缺陷，而是行为惯性

不要以“减少重复”为目标。

AI 可以连续使用同一招，这在以下情况下是合理的：

- 当前策略有效。
- 当前距离明显适合该招。
- 玩家尚未针对该策略形成有效应对。
- 角色本身应该具有较强的战术惯性。
- 教学战斗需要玩家建立明确预期。

真正需要解决的是：

> **重复行为经过多次失败以后，仍然完全不发生变化。**

因此 AI 应区分：

```text
Behavior Inertia
    = 倾向于延续已有行为

Adaptation
    = 根据最近结果降低/提高某种行为的价值
```

最终目标：

```text
成功 → 保持
失败 → 逐渐修正
```

而不是：

```text
每次 → 随机换招
```

---

## 2. 第一优先级：加入最小反馈闭环

当前 AI 决策链已经有：

```text
Perception
  ↓
Situation
  ↓
Utility
  ↓
Action
  ↓
Commitment
```

需要补上：

```text
Action
  ↓
Combat Result
  ↓
Recent Tactical Memory
  ↓
Utility adjustment
  ↓
Next Action
```

形成：

```text
Decision → Action → Result → Memory → Decision
```

### 2.1 只记录“战术有意义”的近期结果

不需要建立通用的完整行为日志系统。

第一阶段只需要保存最近少量 combat outcomes，例如：

```js
{
    actionState: "swing",
    result: "parried"
}
```

可考虑的 result：

- hit
- parried
- guard_block
- miss / dodged
- clash

建议只保留最近 5～10 次相关结果，并在 CombatSystem / CombatResolver 已有结果通知链上接入 AIController。

### 2.2 Feedback 不应直接执行动作

不要：

```text
连续被 parry 2 次
→ 强制改成 thrust
```

而应该：

```text
连续被 parry
→ 当前 swing 的 Utility 下降
→ 重新比较 swing / thrust / dash / positioning
→ Utility 自己决定下一步
```

Feedback 是**输入到评分系统的信息**，不是一个新的脚本状态机。

### 2.3 反馈强度应该体现“逐渐适应”

不要一开始就设计复杂的学习系统。

可以采用简单的连续累积或衰减，例如：

```text
parryCounter:
    0 → 无影响
    1 → 轻微影响
    2 → 明显影响
    3+ → 强烈影响
```

具体数值由 AITuning 后续调节。

同一种结果连续发生时影响增加；成功时可以衰减失败计数或恢复当前行为偏好。

---

## 3. 第二优先级：取消攻击距离的二元门控

当前逻辑：

```js
if (distance > effectiveRange) return 0;
```

这会形成极强的行为跳变：

```text
distance = effectiveRange + 0.01
→ score = 0

distance = effectiveRange - 0.01
→ score ≈ baseWeight
```

这也是“AI 一到某个点突然出最长招”的重要原因。

### 3.1 攻击可行性与攻击价值分离

不要完全取消 range feasibility。

应区分：

```text
Range Feasibility
    = 当前动作是否有机会命中

Range Utility
    = 当前距离下，该动作有多合适
```

攻击可以使用连续的距离因子：

```text
score *= distanceFactor
```

但仍然需要在明显无法命中的情况下归零。

### 3.2 平滑窗口是 tuning，不是算法常量

例如：

```text
distanceSmoothWindow = 0.3
```

只是第一组实验值，不应写死成算法定义。

建议进入 AITuning。

同时避免不同模块各自维护：

```text
attack range buffer
positioning hold margin
approach margin
```

当前阶段尽量使用统一的 `rangeBuffer`，避免再次产生 range dead zone。

---

## 4. 第三优先级：startupMs 应成为一般性 Utility 输入

当前 startupMs 主要用于：

```text
opponent startup
→ preemptiveBonus
```

这不足以表达动作之间的时间差异。

例如：

```text
Swing:
    reach 2.67
    startup 420ms

Thrust:
    reach 2.56
    startup 320ms
```

如果仅按 reach 评价，则 swing 很容易长期统治 thrust。

实际上：

> 更短的 startup 本身就是战术资产。

### 4.1 startup 不应该变成简单的“越快分越高”

应作为 context-sensitive factor：

```text
startup value
    × current distance
    × opponent vulnerability
    × opponent threat
    × expected interaction
```

例如：

```text
opponent recovery
→ short startup 的价值上升

opponent active attack
→ startup 长的攻击风险更高

opponent far outside range
→ startup 差异的重要性下降
```

目标不是简单奖励快招，而是让 AI 理解：

> **在当前局面下，花多少时间才能把这次机会转换成攻击。**

---

## 5. 防御动作也必须考虑距离后果

Dodge 的 Combat Rule 可以永远成功，但在 Utility 层不能意味着：

> Dodge 永远是高价值防御。

Dodge 通常带有后退位移，因此存在隐性成本：

```text
成功化解攻击
        ↓
距离被拉开
        ↓
攻击机会下降
        ↓
需要再次接近
```

因此防御评分应考虑：

```text
Defense Utility
    = Threat Response
    + Safety
    + Distance Consequence
    + Counter Opportunity
```

### 5.1 第一阶段不要修改 Dodge 的实际位移

不要立即加入：

- 根据战斗边界动态缩短 dodge
- 根据双方距离动态修改 displacement
- 特殊 dodge movement script

先解决：

> **AI 是否应该选择 Dodge。**

也就是在 Decision 层给 Dodge 的距离后果合理的 Utility 代价。

等决策层正确后，再判断 dodge displacement 本身是否需要调整。

---

## 6. 不建议现在建立四档 tutorial / normal / elite / boss AI 模式

模式差异最终可能是有价值的，但当前阶段不应先建立完整四档 profile。

原因：

- 当前反馈闭环还未建立。
- 当前距离模型还在修正。
- startup utility 还没有加入。
- 现在建立四档容易用 profile 掩盖算法问题。

第一阶段应优先让**同一套算法**表现正确。

### 6.1 教学战斗如何保留模式化

教学敌人的目标不是：

```text
feedback = OFF
```

而应该是：

```text
behavior inertia ↑
adaptation rate ↓
```

也就是说：

```text
第一次被 parry
→ 几乎不变

第二次被 parry
→ 轻微变化

多次被 parry
→ 最终才明显改变策略
```

这样玩家仍然能看到规律：

```text
距离 → Swing → Parry
```

但不会出现无限重复的木桩行为。

---

## 7. 随机扰动应弱化，并尽量只用于接近的候选

当前：

```js
score *= (1 + randomVariance)
```

会导致不同决策 tick 都重新掷骰子。

这不利于形成可预测行为。

第一阶段建议：

- 降低 `reactionVariance`。
- 让明显更优的 action 基本稳定胜出。
- 只有评分非常接近时才允许随机打破平局。

理想行为：

```text
Swing 0.80
Thrust 0.60
Dash 0.55
→ 基本稳定选 Swing
```

而：

```text
Swing 0.70
Thrust 0.69
Dash 0.68
→ 可以随机选择
```

如果需要，可以后续将随机扰动改为基于 score gap 的动态概率，而不是固定百分比。

---

## 8. Continuity 与 Adaptation 是两个不同概念

不要把“减少随机”简单实现为无限增加 `continuityBonus`。

应该区分：

```text
Continuity
    = 没有足够理由改变时，延续上一动作偏好

Adaptation
    = 最近结果证明当前策略效果不好，因此降低它的价值
```

例如：

```text
连续命中
→ continuity 可以提高

连续被 parry
→ adaptation 应该逐渐抵消 continuity
```

最终形成：

```text
惯性
  ↓
重复
  ↓
失败反馈
  ↓
惯性被抵消
  ↓
换招
```

这是比单纯随机换招更重要的行为模式。

---

## 9. AITuning 与算法代码的边界

### 建议进入 AITuning

这些参数描述“设计者希望 AI 多偏向什么”：

- attackCooldownMs
- decisionIntervalMs
- rangeBuffer
- distanceSmoothWindow
- reactionVariance
- continuity strength
- feedback strength
- startup weighting
- dodge distance penalty
- guard preference / dodge preference
- adaptation threshold

### 保持在算法代码

这些属于“系统如何计算”的结构：

- Utility 的计算顺序
- Situation 的数据流
- Candidate action 的生成方式
- 结果如何进入 memory
- score normalization / clamp 的算法结构
- commitment 的状态机逻辑

原则：

> **代码定义推导方法；AITuning 定义行为偏好。**

避免把 AIController 变成几十个可配置魔法数字，也避免把整个算法做成配置表。

---

## 10. 实现优先级

建议按以下顺序逐步落地，不要同时修改所有变量：

### Phase 1 — Feedback Memory

建立最小近期结果记忆：

```text
Action
→ Combat Result
→ Recent Tactical Memory
→ Attack Utility adjustment
```

先验证：

> 连续被 parry 后，AI 是否最终会主动寻找其他 action？

### Phase 2 — Continuous Range Utility

移除攻击范围的二元跳变：

```text
hard gate
→ continuous distance factor
```

并统一 `rangeBuffer`，消除 positioning / attack range dead zone。

### Phase 3 — Startup Utility

把 startupMs 从“特殊 preemptive 条件”升级为一般性时间价值。

验证：

> reach 稍短但 startup 更快的招式，是否能在合适局面击败 reach 更长的招式？

### Phase 4 — Defense Distance Consequence

让 Dodge / Guard 的评分考虑自身位移对战斗距离的影响。

验证：

> AI 是否减少无意义后闪，并在需要主动接近时更倾向于原地防御或继续压近？

### Phase 5 — Re-evaluate randomness / continuity

在前四阶段稳定以后，再调：

- reactionVariance
- continuity
- feedback strength
- adaptation threshold

不要在算法基础未稳定时同时调这些参数。

---

## 11. 暂不做

本阶段明确不做：

- 强制“第 N 招必须使用某招”的 tutorial script
- tutorial / normal / elite / boss 四档完整 AI 模式
- 完整 AI learning / long-term player modeling
- 根据战斗边界动态修改 dodge 位移
- 为每一种 combat result 建立独立行为树
- 重新设计 CombatResolver 的攻击/防御规则
- 用随机性制造“聪明感”

这些都属于后续验证后的可能扩展，不应作为当前问题的第一反应。

---

## 12. 最终设计目标

AI 不需要做到：

> 每一次都选择理论最优动作。

理想目标是：

```text
有明显倾向
    ↓
玩家可以观察并预测
    ↓
玩家开始利用该倾向
    ↓
AI 感知结果
    ↓
AI 逐渐修正
    ↓
玩家重新适应
```

因此最终的战斗体验应该是：

> **AI 有“性格”和惯性，但不是木偶；有规律，但不是脚本；会重复有效行为，也会在持续失败后改变策略。**

这比单纯提高随机性或追求每次决策不同，更符合本项目“玩家通过战斗逐渐掌握规则并与 AI 博弈”的目标。
