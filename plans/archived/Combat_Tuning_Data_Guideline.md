# Combat Tuning Data Guideline

## 1. 目的

当前战斗系统已经进入“机制和手感需要持续迭代”的阶段。下一步需要把经常参与战斗节奏、距离和 AI 行为调试的数值从代码中的分散常量中解耦出来。

本次工作的目标不是建立一个完整的配置/Buff框架，也不是把所有数字都数据化，而是建立一个明确的原则：

> **设计数值集中管理；代码负责规则与计算；角色/招式数据负责描述自身属性。**

这样后续调试时，可以区分：

- “这个数值不合适” → 调 tuning data
- “这个行为逻辑不正确” → 改算法/代码

避免通过修改代码常量来反复调战斗手感。

---

## 2. 三类数据的归属

### 2.1 Character / Attack Data：描述“这个东西是什么”

角色和招式本身具有的属性应继续留在角色/状态图/攻击 profile 等现有数据中。

例如：

```text
Attack Profile
├── startupMs
├── activeMs
├── recoveryMs
├── maxReach
├── displacement
└── frameSpeeds
```

角色特性例如：

```text
characterTraits
└── postDefenseMobility
    ├── triggers
    ├── durationMs
    └── speedMultiplier
```

这些数值描述的是“这个角色/招式本身具有什么性质”，不要为了集中管理而全部搬进全局 tuning 文件。

---

### 2.2 Combat Tuning：描述“战斗系统默认如何表现”

适合放入独立 JS 文件，例如：

```text
CombatTuning.js
```

这里集中存放经常需要为了调整战斗节奏而修改的系统级参数。

优先考虑：

```text
Hit / Reaction
├── hitstop
├── hit displacement
├── attacker displacement
├── defender displacement
└── blockstun / reaction timing

Defense / Counter
├── parry window
├── guard reaction timing
└── other global defensive tuning
```

这里的参数应该有明确的语义，不要使用无法判断用途的通用名字，例如：

```text
speed
margin
value
factor
```

应尽量使用：

```text
hitstopMs
attackRangeBuffer
approachReachMargin
blockstunMs
```

---

### 2.3 AI Tuning：描述“AI 如何评价已经存在的行为”

AI 相关参数可以先独立于 `CombatTuning`，如果当前项目规模尚小，也可以暂时放在同一 tuning 文件的 `ai` 区域。

例如：

```text
AI
├── attackCooldownMs
├── attackRangeBuffer
├── approachReachMargin
├── reactionVariance
├── utility weights
└── dodge distance penalty
```

这些参数不是战斗规则本身。

例如：

```text
“Thrust 无法被 Guard 防御”
```

属于 Combat Rule / ContactResolver。

而：

```text
“面对当前 Threat 时，AI 更偏好 Guard 还是 Dodge”
```

属于 AI Decision / Utility。

不要把二者混在 tuning data 中。

---

## 3. 推荐文件结构

第一阶段优先使用简单 JS module，而不是马上建立新的 JSON 配置系统。

例如：

```js
// CombatTuning.js

export const CombatTuning = {
    hit: {
        hitstopMs: 80,
        hitDisplacement: 0.14,
    },

    block: {
        hitstopMs: 50,
        blockstunMs: 180,
    },

    parry: {
        hitstopMs: 100,
        parryWindowMs: 16,
    },

    ai: {
        attackRangeBuffer: 0.2,
        approachReachMargin: 0.2,
        attackCooldownMs: 800,

        dodgeDistancePenalty: 0.2,
    },
};
```

具体字段必须结合项目当前实际代码确认，不应机械照搬示例数值。

原则是：

> **先建立单一权威来源，再决定最终配置文件的细分。**

---

## 4. 什么数值应该现在解耦

优先处理已经明显影响最近战斗体验、并且很可能反复调整的数值：

### 第一优先级

- hitstop 时间
- hit / attack / defender displacement
- blockstun 等命中反应时间
- AI attack cooldown
- AI attack range buffer
- AI approach / hold margin
- AI 与距离相关的 utility 权重或惩罚

这些参数已经直接影响当前观察到的两个问题：

1. AI Dodge 过多、后退过多
2. AI 逼近后停止不动

### 暂时不要为了形式完整而解耦

例如：

- 算法内部的迭代上限
- 临时局部变量
- 只出现一次且没有设计意义的常量
- 明显属于实现细节的数学 epsilon

“代码里有数字”不等于“这个数字就是设计参数”。

---

## 5. 特别注意：不要制造多个“真相”

当前 AI 已经暴露出一个典型问题：不同系统分别计算自己的距离边界。

例如：

```text
Positioning
    maxReach + approachReachMargin

Attack
    range + attackRangeBuffer
```

最终造成：

```text
Positioning 认为“够近了”
Attack       认为“还打不到”
```

这类问题不能只靠把两个数字调成“碰巧合适”。

应该先明确概念的权威来源。

推荐方向：

```text
Attack Profile
      ↓
maxReach
      ↓
Combat / AI distance model
      ↓
preferred combat range
      ↓
Approach / Hold / Attack evaluation
```

也就是说：

> **一个概念应尽量只有一个权威来源，其余系统引用或派生，而不是各自硬编码一套。**

---

## 6. “数据”与“代码机制”的判断标准

以后新增一个参数时，可以用下面的判断：

### 应该数据化

如果修改这个值是在回答：

> “这个角色/招式应该表现得多强、多远、多快、多长时间？”

例如：

```text
maxReach
hitstopMs
blockstunMs
speedMultiplier
attackCooldownMs
```

### 应该留在代码

如果修改它是在回答：

> “系统应该怎样从当前局面推导出行为？”

例如：

```text
如何计算 distance utility
如何判断 Dodge 的距离代价
如何决定 Approach 是否优于 Attack
如何处理 commitment
如何从 defenseSuccess 推导 trait activation
```

不要为了避免硬编码而把算法本身变成配置表。

---

## 7. 与近期 AI 距离模型工作的关系

当前 AI 的设计目标是：

> **主动控制距离，而不是被动响应距离。**

因此，距离相关 tuning 应服务于统一的 combat-distance model，而不是继续为单个动作增加大量特例。

重点保持：

```text
preferred combat range
        ↓
current distance error
        ↓
Action Utility
        ↓
Approach / Attack / Guard / Dodge
```

尤其 Dodge 的位移需要被视为一种距离上的后果：

```text
Dodge
    ↓
current distance changes
    ↓
可能偏离 preferred range
    ↓
AI 应在 Utility 中承担这个代价
```

不要首先通过修改 dodge displacement 来掩盖 AI 为什么频繁选择 Dodge 的问题。

同样，`postDefenseMobility` 的作用是增强防守成功后的主动性，不应直接等价为“防守后必然冲刺”。

---

## 8. 关于动态调整击退距离

暂时不要因为“AI 后退太多”就立即加入：

```text
根据双方距离动态改变击退距离
根据战斗边界动态缩短 Dodge 位移
根据场地位置改变 hit displacement
```

这些机制以后可能有价值，但它们属于更高阶的 movement / action execution 层。

当前优先顺序应是：

```text
1. 正确评价“是否应该 Dodge”
2. 正确评价“希望处于什么距离”
3. 再优化“Dodge 后应该退多远”
```

否则容易用运动学补丁掩盖 Decision 层问题。

---

## 9. 关于 attackCooldownMs 等 AI 参数

`attackCooldownMs = 800` 这类参数目前可以数据化，但不要因为出现停顿就立刻确定“800 一定过长”。

建议按以下顺序验证：

```text
先修正 distance model
        ↓
确认 AI 到达有效攻击距离后确实想攻击
        ↓
观察 cooldown 是否仍制造明显空窗
        ↓
再调整 cooldown
```

否则可能把由距离模型造成的问题错误归因于 cooldown。

同样，`approachReachMargin` 应与攻击有效范围保持一致的概念关系；不要因为 mobility boost 而自动扩大 Hold 区，导致 AI 在更远处停止。

---

## 10. 第一阶段的目标

这次数据解耦完成后，应达到以下状态：

```text
角色/招式数据
    → 描述角色和动作自身属性

CombatTuning.js
    → 集中管理系统级战斗手感参数

AI Tuning
    → 集中管理 AI 的评价参数

Combat / AI Code
    → 负责规则、推导和行为逻辑
```

并且：

```text
同一个设计概念
    → 尽量只有一个权威数据来源
```

第一阶段不要求建立完整的配置编辑器、不要求把所有数字移出代码，也不要求重构已有 `parryBonus` 等成熟机制。

目标只是让接下来的战斗调参进入一个稳定的实验循环：

```text
观察行为
    ↓
判断是“数值问题”还是“逻辑问题”
    ↓
数值问题 → 改 tuning data
逻辑问题 → 改代码
    ↓
重新测试
```

这为后续继续测试 Rabble Stick、长柄武器敌人以及更多主动距离控制行为提供稳定基础。
