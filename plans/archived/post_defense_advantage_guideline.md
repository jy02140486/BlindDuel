# Guideline: 将 `parryBonus` 重构为 Character Trait

## 1. 目的

将当前状态图中的 `parryBonus` 能力从隐含的 `hasTag` 条件，重构为正式的 `characterTraits` 配置。

目标不是单纯改 JSON 格式，而是明确职责边界：

- **Character Trait**：描述“这个角色拥有什么通用战斗能力”。
- **Combat Result / Defense Result**：描述“这一次防御事件产生了什么结果”。
- **State Machine**：描述“当前动作如何根据 command / temporary combat context 转移”。
- 不应继续把角色固有能力以 `hasTag: "parryBonus"` 的形式隐藏在某个具体状态里。

---

## 2. 当前旧实现

当前 `guard` 状态中存在类似：

```json
"guard": {
  "clip": "guard",
  "allowMoveInput": false,
  "guardActive": true,
  "guardType": "guard",
  "loop": false,
  "transitions": [
    {
      "to": "idle",
      "when": [
        { "time": "normalized", "op": ">=", "value": 1.0 }
      ]
    },
    {
      "to": "zornhut",
      "when": [
        { "command": "zornhut" },
        { "hasTag": "parryBonus" }
      ]
    },
    {
      "to": "quart",
      "when": [
        { "command": "quart" },
        { "hasTag": "parryBonus" }
      ]
    }
  ]
}
```

这里的问题是：

`parryBonus` 实际描述的是**角色在成功防御后获得短暂进攻优势的能力**，但它被表达成了状态机里的一个隐含 tag。

这会导致：

1. 角色能力与具体状态耦合。
2. 很难看出哪些角色拥有该能力。
3. 将来增加更多防御后效果时，容易继续向 state graph 塞 `hasTag` 特例。
4. AI 修改状态图时容易只做局部修补，而没有意识到这是角色级能力。

---

## 3. 推荐的目标模型

优先使用正式的 Character Trait 表达该能力，例如：

```json
"characterTraits": {
  "postDefenseAdvantage": {
    "enabled": true,
    "triggers": [
      "guard_block",
      "parry",
      "dodge"
    ],
    "durationMs": 500,
    "speedMultiplier": 1.5
  }
}
```

注意：字段应以项目现有 Trait 系统的实际 schema 为准，不要为了照搬此 guideline 而新增一套平行机制。

核心语义是：

> Character 拥有 `postDefenseAdvantage`，当指定的防御事件发生后，在一个有限时间窗口内获得优势。

---

## 4. `parryBonus` 不建议直接一对一改名

不要简单做：

```text
parryBonus -> characterTraits.parryBonus
```

因为旧名称只描述了最初的一个用途，而当前机制实际已经包含更广泛的语义：

- 防御成功后的短时优势
- 更快的移动 / 出招响应
- 特定 command 可以在该窗口内提前进入攻击状态
- 将来可能扩展到其他防御结果

因此建议采用描述机制语义的名字，例如：

```text
postDefenseAdvantage
```

或者项目已有命名体系下等价的名称。

不要引入多个同义 Trait，例如：

```text
parryBonus
postDefenseBonus
postGuardBonus
counterWindow
```

如果这些实际上都描述同一机制，应统一成一个 trait，并通过配置表达差异。

---

## 5. 状态机应该如何变化

### 原则

State Machine 不应再通过：

```json
{ "hasTag": "parryBonus" }
```

直接识别角色是否具备该能力。

状态机应该关注的是当前是否满足**运行时优势条件**，而不是角色配置从哪里产生了这个条件。

例如可以保留类似：

```json
{
  "command": "zornhut",
  "hasTag": "defenseBonus"
}
```

前提是 `defenseBonus` 是运行时 temporary combat state / tag，而不是角色永久配置里的能力名称。

更推荐的逻辑分层：

```text
Character Trait
      |
      v
Defense event
      |
      v
Temporary advantage / combat context
      |
      v
State Machine transition
```

即：

```text
postDefenseAdvantage
       ↓
产生短期运行时状态
       ↓
state graph 判断当前是否处于该窗口
```

这样 State Machine 不需要知道优势窗口究竟来自：

- guard block
- parry
- dodge
- 其他未来防御结果

---

## 6. 不要让 Trait 直接依赖具体动画 State 名称

避免把：

```json
"allowedStates": ["zornhut", "quart"]
```

作为 Trait 的核心 schema。

原因：

`zornhut` / `quart` 属于角色的动作状态图，是 presentation / action layer 的具体实现；Trait 描述的是角色能力。

Trait 应更接近：

```text
“防御后获得短时优势”
```

而不是：

```text
“防御后允许进入 zornhut 和 quart”
```

如果必须限制哪些 command 可以利用该优势，应优先让 command / state system 查询统一的 runtime capability，而不是让 Trait 直接管理 animation state name。

---

## 7. 与现有 `postDefenseMobility` 的关系

项目目前已有类似：

```json
"postDefenseMobility": {
  "enabled": true,
  "triggers": ["guard_block", "parry", "dodge"],
  "durationMs": 500,
  "speedMultiplier": 1.5
}
```

不要因为本次迁移就盲目把所有字段重新设计。

本次首先要确认的是：

> `parryBonus` 是否实际上已经属于 `postDefenseMobility` 的同一能力范畴。

如果是同一机制，应优先考虑统一语义，而不是形成：

```text
postDefenseMobility
postDefenseAdvantage
parryBonus
```

三个彼此重叠的系统。

可以采用以下两种方案之一：

### 方案 A：保留单一 Trait

如果当前项目已经能够用 `postDefenseMobility` 完整表达：

- 防御触发
- 时间窗口
- 速度倍率
- 防御后提前出招资格

那么应扩展已有 Trait，而不是新增第二套 Trait。

### 方案 B：一个总能力 + 明确子能力

如果移动优势与提前出招已经是两个独立运行时效果，可以保持：

```text
postDefenseAdvantage
 ├─ mobility effect
 └─ offensive / command effect
```

或者由已有 trait 系统支持多个明确的 effect，但它们必须共享同一套防御事件来源。

禁止为了迁移旧代码而复制逻辑。

---

## 8. 防御结果与 Trait 触发条件要分开

需要明确：

```text
parry / guard_block / dodge
```

是**事件 / 结果**，不是 Trait 本身。

例如：

```text
Combat / Defense System
    ↓
result = guard_block
    ↓
Trait 查询 trigger
    ↓
postDefenseAdvantage 被激活
    ↓
runtime advantage active
```

这样未来如果增加：

```text
perfect_parry
imperfect_guard
rebound
```

可以只增加新的 defense result / trigger，而无需重新设计角色状态机。

---

## 9. 与即将增加的 Clash / Rebound 机制保持兼容

近期可能把当前统一的 `clash` 拆成：

```text
Clash
Rebound / Opened
```

其中：

- **Clash**：攻防双方没有明显优势，正常结束接触。
- **Rebound / Opened**：攻击者因为防御而进入短暂可被反击状态。

Trait 设计必须允许未来加入这些结果，而不能把当前 `parryBonus` 的逻辑硬编码成“只有 parry 才能触发”。

例如未来可以形成：

```text
Defense Result
   ├─ guard_block
   │    └─ postDefenseAdvantage
   ├─ parry
   │    └─ postDefenseAdvantage
   └─ dodge
        └─ postDefenseAdvantage
```

或者：

```text
Defense Result
   ├─ clash
   └─ rebound
          ↓
    counter opportunity
```

这两套系统可以共存，但职责必须清楚：

- `Defense Result`：发生了什么。
- `Trait`：这个角色从这个结果获得什么能力。
- `State Machine`：角色接下来可以执行什么动作。

---

## 10. 迁移步骤

### Step 1：确认现有实现

先搜索并列出所有 `parryBonus` 的来源与消费者，包括：

- character config
- state graph
- combat system
- tag generation / removal
- transition evaluator
- tests / debug tools

不要直接修改第一处搜索结果。

### Step 2：确认实际语义

确认 `parryBonus` 当前实际提供了哪些效果：

- 哪些 defense event 会触发
- 持续多久
- 是否影响移动速度
- 是否影响出招速度
- 哪些 command / state 使用它
- 是否有角色例外

### Step 3：映射到现有 Trait 系统

优先复用已经存在的 `characterTraits` 基础设施。

不要新建一个仅为 `parryBonus` 服务的平行配置系统。

### Step 4：建立 runtime advantage

Trait 触发后，应形成统一的 temporary combat state / context。

State Machine 只读取这一运行时结果。

### Step 5：删除旧 `hasTag: parryBonus`

迁移完成后，项目中不应再依赖旧的 `parryBonus` permanent tag。

除非搜索结果证明存在无法迁移的特殊用途，否则不要保留旧系统作为隐藏 fallback。

### Step 6：验证行为完全不变

本次重构的首要目标是**结构重构而非 gameplay 调整**。

迁移后至少验证：

1. 原本拥有该能力的角色仍然拥有。
2. 原本没有该能力的角色不会突然获得。
3. 防御触发时机不变。
4. 500ms 等持续时间不被意外改变。
5. speedMultiplier 等效果不变。
6. `zornhut` / `quart` 等原有提前出招行为保持一致。
7. 正常 guard 完成后仍可回到 idle。

---

## 11. AI 修改代码时的约束

### 必须先查上下文，再改局部

遇到：

```text
parryBonus
hasTag
postDefenseMobility
postDefenseAdvantage
```

时，不要只根据单个状态图局部修复。

应先搜索：

```text
定义在哪里？
谁生成？
谁消费？
生命周期在哪里结束？
是否已有 Trait 可以表达？
```

### 不要为了兼容旧代码长期保留两套来源

禁止形成：

```text
Trait → runtime bonus
Tag   → runtime bonus
```

两个系统同时生效却没有明确优先级。

迁移期间可以临时兼容，但迁移完成后应删除旧路径。

### 不要扩大本次重构范围

本次目标是：

```text
parryBonus
    ↓
Character Trait / runtime capability
```

不要顺便重写整个 State Machine、CombatSystem、AI 或 animation pipeline。

只有在现有架构已经明确存在冲突时才扩展重构范围。

---

## 12. 最终架构原则

以后遇到类似问题，可以用下面这个判断：

### 如果描述的是“这个角色天生具有什么能力”

放到：

```text
characterTraits
```

### 如果描述的是“刚才发生了一件什么战斗事件”

放到：

```text
combat / defense result
```

### 如果描述的是“这个事件让角色暂时获得什么状态”

放到：

```text
runtime combat context / temporary tag
```

### 如果描述的是“当前动画状态能不能转过去”

放到：

```text
state graph / transition condition
```

不要混淆这四层。

---

## 13. 推荐的最终数据流

```text
                Character Config
                       │
                       ▼
              characterTraits
                       │
                       │ defines capability
                       ▼
Combat Event ──► Defense Result
                       │
                       │ trigger matched
                       ▼
             Runtime Advantage
                       │
              ┌────────┴────────┐
              ▼                 ▼
        Movement/Speed      State Transition
                                │
                                ▼
                          Attack State
```

核心思想：

> **Trait 定义能力，Combat Result 描述事件，Runtime State 表示临时效果，State Graph 决定动作转移。**

`parryBonus` 应从“状态图中的隐式特例”升级为上述架构中的正式能力。
