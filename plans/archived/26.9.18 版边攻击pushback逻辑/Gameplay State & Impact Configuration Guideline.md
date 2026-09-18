# Gameplay State & Impact Configuration Guideline

## 1. 目标

当前项目中的 `StateGraph` 最初承担类似 Animator State Machine 的动画状态控制，但随着战斗系统的发展，State 已经同时包含：

* 动画表现
* 输入 / 移动控制
* 战斗语义
* 状态转移条件

这是当前项目允许并继续采用的架构方向。

后续不要强制把 StateGraph 限制为“纯动画配置”。

本阶段需要进一步明确：

> **StateGraph 描述一个角色行为（Behavior）的完整声明；各专门系统负责执行该行为。**

因此，攻击、格挡、投掷、盾击等行为可以在对应 State 中声明其 gameplay 属性，包括接触后的 impact 参数。

---

## 2. StateGraph 的定位

一个 State 表示角色当前正在执行的一个完整行为，而不仅仅是一段动画。

典型结构：

```json
{
  "clip": "swing",
  "allowMoveInput": false,

  "attack": {
    ...
  },

  "impact": {
    ...
  },

  "transitions": [
    ...
  ]
}
```

可以包含以下类别：

```text
State
 ├── Animation
 ├── Control
 ├── Combat
 ├── Impact
 └── Transitions
```

其中：

### Animation

描述表现：

```json
{
  "clip": "swing",
  "loop": false
}
```

### Control

描述行为期间的角色控制：

```json
{
  "allowMoveInput": false
}
```

### Combat

描述攻击 / 防御行为的战斗语义：

```json
{
  "attack": {
    "attackWeight": "heavy",
    "trajectory": "slash",
    "active": [3, 4]
  }
}
```

### Impact

描述该行为在产生有效接触后，对接触结果产生的影响。

例如：

```json
{
  "impact": {
    "knockback": 0.12,
    "hitstopFrames": 8
  }
}
```

---

# 3. Impact 的职责

`impact` 表示：

> **这个行为在发生有效接触时，希望产生什么 impact effect。**

它不是最终结果。

例如：

```json
"impact": {
  "knockback": 0.12,
  "hitstopFrames": 8
}
```

表示该攻击正常命中时：

* 产生一定程度的 knockback
* 产生指定 hitstop

但最终实际移动多少、是否受到边界影响、是否发生 block / clash 等，由 `ContactResolver` 等战斗系统决定。

---

# 4. 不要在 State 中实现接触结果逻辑

StateGraph 只负责声明数据，不负责根据当前场景实时计算最终接触结果。

不要在 State 中写：

```text
if targetNearBoundary
    attackerMoveBackward()
```

也不要增加：

```json
{
  "boundaryKnockback": ...
}
```

之类把具体边界规则写进每一个招式的配置。

原因：

> **Boundary 是接触环境的规则，而不是招式本身的属性。**

招式只需要声明正常情况下产生的 impact。

---

# 5. Boundary Knockback

当前项目新增的边界击退逻辑：

正常情况下：

```text
Attacker  ---->  Defender

Defender receives knockback
Attacker remains approximately stationary
```

当 Defender 接近边界，无法继续向后移动：

```text
Attacker  ---->  Defender | Boundary
```

Defender 可用的后退空间不足时：

1. 计算原本应产生的 knockback displacement
2. 计算 Defender 实际还能向后移动多少
3. 将剩余 displacement 转移给 Attacker

例如：

```text
requested knockback = 0.12
available defender displacement = 0.03

defender displacement = 0.03
remaining displacement = 0.09

attacker receives 0.09 displacement in opposite direction
```

最终形成：

```text
Attacker  <----  Defender | Boundary
```

这个逻辑属于接触解析阶段，而不是单独某个 State 的 gameplay 逻辑。

---

# 6. Boundary Logic 的职责归属

建议保持以下职责：

```text
StateGraph
    │
    │ declares
    ▼
Behavior / Attack / Impact Data
    │
    │ consumed by
    ▼
ContactResolver
    │
    ├── attack / guard / clash resolution
    ├── hitstop resolution
    ├── knockback resolution
    └── boundary displacement compensation
    │
    ▼
Character / Movement
    │
    └── applies final displacement
```

因此：

### StateGraph

回答：

> 这个行为是什么？

以及：

> 如果产生有效接触，它具有什么 impact 参数？

### ContactResolver

回答：

> 这一次接触最终产生什么结果？

包括：

* hit
* block
* clash
* dodge immunity
* knockback
* hitstop
* boundary compensation

### Character / Movement

负责：

> 将解析后的最终位移真正应用到角色。

---

# 7. 推荐的配置形式

攻击：

```json
"swing": {
  "clip": "swing",
  "allowMoveInput": false,

  "attack": {
    "attackWeight": "heavy",
    "trajectory": "slash",
    "active": [3, 4]
  },

  "impact": {
    "knockback": 0.12,
    "hitstopFrames": 8
  },

  "transitions": [
    ...
  ]
}
```

轻攻击可以拥有不同 impact：

```json
"light_slash": {
  "clip": "light_slash",

  "attack": {
    "attackWeight": "light",
    "trajectory": "slash",
    "active": [3, 4]
  },

  "impact": {
    "knockback": 0.06,
    "hitstopFrames": 5
  }
}
```

投掷类行为以后也可以使用同一模型：

```json
"throw": {
  "clip": "throw",

  "attack": {
    ...
  },

  "impact": {
    "knockback": 0.30,
    "hitstopFrames": 10
  }
}
```

盾击等行为同样可以复用：

```json
"shield_bash": {
  "clip": "shield_bash",

  "impact": {
    "knockback": 0.18,
    "hitstopFrames": 6
  }
}
```

---

# 8. Knockback 不要在配置层绑定具体边界行为

推荐：

```json
"impact": {
  "knockback": 0.12
}
```

不推荐：

```json
"impact": {
  "normalKnockback": 0.12,
  "boundaryKnockback": 0.08
}
```

因为 boundary compensation 是环境 / 接触条件决定的。

同一个攻击：

```text
normal position
    → defender receives knockback

near boundary
    → defender receives available displacement
    → attacker receives residual displacement
```

因此攻击数据本身无需知道目标是否处于边界。

---

# 9. 不要过早把 Knockback 定义成“最终移动距离”

`knockback` 当前可以理解为：

> **该行为希望施加的水平 displacement / impact magnitude。**

实际结果可能受到以下因素影响：

* defender 当前速度
* defender 状态
* boundary
* collision constraint
* hit / block / clash 类型
* 未来其他 combat modifiers

因此不要让 StateGraph 或 Attack State 自己直接修改 transform。

错误：

```js
target.position.x += state.impact.knockback;
```

正确方向：

```text
StateGraph
    ↓
impact.knockback
    ↓
ContactResolver
    ↓
final displacement
    ↓
Character movement
```

---

# 10. 与现有 Guard / Defense State 的关系

当前 StateGraph 已经存在：

```json
"guard": {
  "clip": "guard",
  "allowMoveInput": false,
  "guardActive": true,
  "guardType": "guard",
  "loop": false,
  "transitions": [...]
}
```

这种结构继续保留即可。

不要为了让 StateGraph “看起来更像 Animator” 而强制移除：

* `guardActive`
* `guardType`
* post-defense tags / transition conditions
* 其他已经稳定工作的 gameplay state properties

这些数据属于 Behavior State 的声明。

需要注意的只是：

> StateGraph 声明 gameplay semantics；实际 gameplay resolution 不由 StateGraph 执行。

---

# 11. 新增 Impact 数据时的实现原则

实现新字段时：

### 允许

在 State 上增加：

```json
"impact": {
  "knockback": 0.12,
  "hitstopFrames": 8
}
```

然后由 Combat / ContactResolver 读取。

### 不允许

在 StateGraph 中加入：

* boundary detection
* opponent position query
* actual displacement
* collision resolution
* hit resolution branching
* transform mutation

这些属于运行时系统。

---

# 12. 当前阶段的最小实现目标

本阶段不要做大型架构重构。

目标只是完成：

```text
1. Attack State 支持 impact 配置
2. ContactResolver 获取对应 impact 数据
3. 正常 knockback 使用该配置
4. Boundary 情况下进行 displacement compensation
5. attacker / defender 的最终移动仍由现有 movement system 执行
```

保持现有 StateGraph / CombatSystem / ContactResolver 的整体结构不变。

不要为了引入 `impact` 而重新设计整个 StateGraph。

---

# 13. 判断标准

以后增加任何新的行为时，可以用以下规则判断：

如果描述的是：

> “这个行为是什么？”

放 StateGraph。

如果描述的是：

> “这个行为接触后产生什么基础效果？”

可以放 StateGraph 的 `impact` / `attack` 配置。

如果描述的是：

> “在当前场景、当前双方状态和当前碰撞条件下，这次接触最终产生什么结果？”

放 `ContactResolver` / CombatSystem。

如果描述的是：

> “最终如何修改角色的位置？”

放 Movement / Character。

核心原则：

> **StateGraph 定义行为，系统解析行为，Character 执行结果。**

## CombatTuning 与 State-level Impact 的关系

`CombatTuning` 与 State 中的 `impact` 不是累加关系，而是：

> CombatTuning 提供全局默认值，State-level impact 可以对具体行为进行 override。

例如：

```js
CombatTuning.hit.victimKnockbackX = 0.12;
```

而某个攻击：

"impact": {
    "knockback": 0.18
}

则该攻击实际使用 0.18。

未配置的字段继续 fallback 到 CombatTuning。

推荐解析顺序：

State impact override
        ↓
CombatTuning default
        ↓
system hard fallback（仅必要时）

不要将 State-level impact 与 CombatTuning 默认值直接相加，除非某个参数的语义明确要求 additive modifier。

同时，不要将所有 CombatTuning 参数暴露给 State。只有明确属于“行为自身差异”的参数才适合成为 State-level override；系统性的 combat rule 应继续保持在 CombatTuning / resolver 中。

尤其是你这个 **boundary knockback**，就更能体现这种层次：

```text
State:
    knockback = 0.18

CombatTuning:
    default knockback = 0.12

ContactResolver:
    根据实际 contact + boundary
    算最终 displacement

这里的 0.18 和 0.12 是配置层的替代关系，而 boundary compensation 才是运行时的计算关系。这两个概念最好不要混在一起。