# AI Combat Decision Guidelines

## 1. 目标

当前 AI 已经具备基于 Character Knowledge Base 和对手距离进行随机选招的基础能力。

下一阶段目标不是简单增加更多随机条件，而是让 AI 能够根据当前战斗局面进行有意义的战术决策，从而产生可感知的博弈。

AI 应逐步从：

```text
Knowledge Base
    +
Distance
    ↓
Random Action
```

演进为：

```text
Perception
    ↓
Combat Situation
    ↓
Tactical Evaluation
    ↓
Action Utility
    ↓
Action Selection
    ↓
Action Commitment
```

---

# 2. 系统职责划分

必须保持以下三个层次的职责分离。

## 2.1 Combat Rules：战斗规则的唯一真相来源

Combat System / Resolver 负责定义实际战斗结果。

例如：

- Guard 是否能够防御某种攻击
- Dodge 是否能够避开某种攻击
- Attack 与 Defense 的相性
- Hit / Clash / Guard / Dodge 的结算
- 两阶段结算规则
- 最终伤害、受击、位移等结果

AI 不应复制或重新实现这些规则。

### 核心约束

> AI 不能自行决定“某动作实际上能不能防御/命中”。

AI 只能查询或读取 Combat Rules 提供的结果或能力描述。

这样可以避免：

```text
AI 判断：Guard 可以防 Thrust
Combat Resolver 判断：Guard 不能防 Thrust
```

这种规则不一致。

Combat Resolver 必须是最终 authoritative source。

---

# 3. Knowledge Base：描述“我具有什么能力”

Knowledge Base 表示一个 Character 当前拥有的动作、属性以及这些动作的基础战斗性质。

它回答的问题是：

> “这个角色能做什么？这些行为本身具有什么性质？”

而不是：

> “当前局面应该做什么？”

---

## 3.1 Attack Knowledge

例如：

```json
{
  "stateName": "thrust",
  "timing": {
    "startupMs": 320,
    "activeMs": 150,
    "recoveryMs": 200,
    "totalMs": 670
  },
  "range": {
    "maxReach": 2.565
  }
}
```

这些数据属于 Knowledge，因为它们描述攻击自身的能力：

- startup
- active
- recovery
- reach
- displacement
- weapon box
- damage/type 等

如果某些战斗性质属于攻击能力本身，也可以由 Knowledge 表达，例如：

```text
damageType
attackType
guardInteraction
tracking
mobility
commitment
```

但不得在 Knowledge 中直接表达“当前应该使用它”。

---

# 4. Defense Knowledge

Guard 和 Dodge 的防御能力同样属于 Character Knowledge。

例如：

```json
{
  "stateName": "guard",
  "defense": {
    "blocks": ["swing"],
    "failsAgainst": ["thrust"]
  }
}
```

以及：

```json
{
  "stateName": "dodge",
  "defense": {
    "avoids": ["thrust", "light_slash"],
    "failsAgainst": ["heavy_slash"]
  }
}
```

这里的含义是：

> Guard 本身具有怎样的防御能力。

> Dodge 本身具有怎样的规避能力。

这些规则属于“能力描述”，因此可以进入 Knowledge Base。

---

# 5. 当前项目的重要战斗规则

当前 AI 必须能够获得以下规则信息：

```text
Guard does NOT defend against Thrust.

Dodge does NOT defend against Heavy Slash.
```

这两个事实属于战斗规则/角色能力。

因此：

```text
Knowledge:
    guard.failsAgainst(thrust) = true
    dodge.failsAgainst(heavySlash) = true
```

但不要写成：

```text
if playerState == thrust:
    don't use guard
```

也不要写成：

```text
if playerState == heavySlash:
    don't use dodge
```

后者属于 Decision Making。

---

# 6. Decision Making：描述“当前局面应该做什么”

Decision Layer 负责根据当前 Combat Situation 评估行动价值。

它回答的问题是：

> “基于当前局面，我现在最应该做什么？”

例如玩家当前正在使用 Thrust：

```text
Player:
    state = thrust
    phase = startup
```

AI 应该查询：

```text
Can Guard defend against Thrust?
Can Dodge avoid Thrust?
Is the AI itself currently in danger?
Can AI attack before player's attack becomes active?
Can AI punish the player's recovery?
```

然后形成行动评价。

例如：

```text
guard    → low utility
dodge    → medium/high utility
counter  → medium/high utility
retreat  → medium utility
```

这里的“low / medium / high”才属于 Decision Layer。

---

# 7. 不要把“克制关系”写成 AI 特判

禁止逐渐形成类似：

```js
if (playerState === "thrust") {
    chooseDodge();
}
```

或者：

```js
if (playerState === "heavySlash") {
    chooseGuard();
}
```

这种 implementation。

原因：

1. 它把 Combat Rules 和 AI Decision 混合。
2. 很容易导致大量特殊情况。
3. 后续增加新攻击/新防御能力时扩展困难。
4. 不同 Character 无法自然拥有不同能力。
5. AI 会越来越像 hard-coded state machine。

应该采用：

```text
Player Action
    ↓
Query combat interaction
    ↓
Evaluate consequence
    ↓
Score available actions
```

---

# 8. Knowledge 应该尽量描述 Action Properties，而不是 Action Preferences

推荐：

```text
Thrust:
    startup = 320ms
    active = 150ms
    reach = 2.565
    ...

Guard:
    blocks = Swing
    failsAgainst = Thrust

Dodge:
    avoids = ...
    failsAgainst = Heavy Slash
    invincible = true
```

不推荐：

```text
Thrust:
    preferredAgainstGuard = true

Guard:
    useWhenPlayerUsesSwing = true
```

后者已经开始描述 AI preference，而不是角色能力。

Preference 应由 AI 根据局面计算。

---

# 9. AI 应该关注“局面”，而不是只关注距离

当前系统已经可以利用距离随机选择动作。

下一阶段应该增加 Combat Situation。

最低限度建议考虑：

```text
self state
opponent state
opponent attack phase
distance
self threat status
opponent vulnerability
action range
action startup
action recovery
```

例如：

```text
distance = 1.8
playerState = thrust
playerPhase = startup
playerAttackRemainingMs = 100
selfState = idle
```

这比：

```text
distance = 1.8
```

提供的决策信息高得多。

---

# 10. Attack Phase 对决策非常重要

对攻击至少区分：

```text
startup
active
recovery
```

因为同一个攻击在不同阶段具有完全不同的战术意义。

例如：

### Startup

```text
player is preparing an attack
```

AI 可以考虑：

```text
counter
dodge
guard
```

### Active

```text
player attack is currently threatening
```

AI 更应该关注：

```text
defend
evade
```

### Recovery

```text
player attack has ended its threat window
```

AI 可以考虑：

```text
punish
counter attack
approach
```

因此不要只向 AI 暴露：

```text
playerState = thrust
```

最好还能够查询：

```text
attackPhase
remainingMs
```

---

# 11. Action Selection 推荐采用 Utility / Score 思路

当前 Knowledge Base 已经天然提供了大量 Action 数据，因此推荐逐渐采用：

```text
For each available action:
    calculate utility
Choose action with highest utility
```

例如：

```text
thrust  = 0.72
swing   = 0.51
guard   = 0.18
dodge   = 0.44
```

但 Utility 的输入应该来自当前局面：

```text
distance
threat
vulnerability
opponent phase
range
commitment
defensive capability
```

而不是简单：

```text
random attack
```

---

# 12. Tactical Intent 和 Action Selection 可以分层

随着系统发展，可以将：

```text
Situation
```

和：

```text
Action
```

之间增加 Tactical Intent。

例如：

```text
Situation
    ↓
Intent
    ↓
Action
```

Intent 可以包括：

```text
Approach
Attack
Punish
Defend
Evade
Disengage
Wait
```

例如：

```text
Player is attacking during startup
    ↓
Intent = Counter
    ↓
Choose thrust
```

或者：

```text
Player is attacking during active
    ↓
Intent = Defend
    ↓
Choose dodge
```

这样能够避免直接建立大量：

```text
if X then action Y
```

---

# 13. Action Commitment

AI 不应每帧重新选择动作。

例如禁止出现：

```text
frame 1  → thrust
frame 2  → dodge
frame 3  → thrust
frame 4  → guard
```

AI 选择一个动作后，应进入 commitment。

例如：

```text
Idle
  ↓
Decision
  ↓
Thrust
  ↓
Startup
  ↓
Active
  ↓
Recovery
  ↓
Decision
```

动作执行期间原则上不重新决策。

只有明确允许的事件可以打断：

```text
Hit
Clash
Death
Forced state transition
```

具体 interrupt policy 由 Combat / State Machine 定义。

---

# 14. AI 不应该复制 Combat Resolution

特别注意：

AI 可以预测：

```text
"Guard probably has low utility against current Thrust"
```

但 Combat Resolver 才负责最终确定：

```text
Guard vs Thrust = what actually happens
```

因此推荐：

```text
Combat Rules
       ↓
Knowledge / Query Interface
       ↓
AI Decision
```

而不是：

```text
Combat Rules
       ↓
AI reimplements the same rules
       ↓
Combat Resolver implements them again
```

后者非常容易产生 desync。

---

# 15. Extensibility Requirement

设计时应允许不同 Character 拥有不同能力。

例如未来可以出现：

```text
Enemy A:
    Guard blocks Swing
    Guard fails against Thrust

Enemy B:
    Guard blocks Swing + Thrust

Boss:
    Dodge can evade Heavy Slash

Player:
    Dodge cannot evade Heavy Slash
```

因此 AI 不应该假设：

```text
all guards behave identically
all dodges behave identically
```

AI 应始终从 Character Knowledge / Combat Rules 查询具体能力。

---

# 16. 推荐的数据流

最终推荐结构：

```text
Character Definition
        ↓
Knowledge Base
        ↓
Character Capabilities
        ↓
┌─────────────────────────┐
│       AI Perception     │
│                         │
│ self state              │
│ opponent state          │
│ distance                │
│ attack phase             │
│ remaining time           │
│ threat                   │
└────────────┬────────────┘
             ↓
      Combat Situation
             ↓
      Tactical Evaluation
             ↓
       Action Utility
             ↓
       Action Selection
             ↓
        Commitment
             ↓
       State Machine
             ↓
      Combat Resolver
```

其中 Combat Resolver 仍然是最终规则权威。

---

# 17. Implementation Principles

### Principle 1

**Knowledge describes what an action is capable of.**

### Principle 2

**Combat Rules define what actually happens when actions interact.**

### Principle 3

**Decision Making determines what is desirable in the current situation.**

### Principle 4

**Do not encode situational decisions as hard-coded counter rules.**

### Principle 5

**AI should query character capabilities rather than duplicate combat logic.**

### Principle 6

**Prefer generic utility evaluation over large collections of state-specific if/else rules.**

### Principle 7

**Actions should be committed for a meaningful period instead of being reconsidered every frame.**

### Principle 8

**Different characters must be allowed to have different defensive/offensive capabilities without changing the decision architecture.**

---

# 18. 当前阶段建议的最小实现范围

不要一次实现完整的“会学习玩家习惯”的复杂 AI。

第一阶段只需要加入：

```text
1. opponent current state
2. opponent attack phase
3. opponent attack remaining time
4. distance
5. own vulnerability
6. Guard / Dodge capability query
7. action utility scoring
8. action commitment
```

先让 AI 能够完成基本的：

```text
Player attacks
    ↓
AI recognizes threat
    ↓
AI chooses a valid defensive response

Player enters recovery
    ↓
AI recognizes vulnerability
    ↓
AI attempts punish

No immediate threat
    ↓
AI chooses attack / approach / wait
```

在此基础上，再考虑：

```text
player behavior history
player tendency
risk tolerance
aggression
character personality
```

这些属于后续层，不应成为第一阶段基础决策系统的前置依赖。