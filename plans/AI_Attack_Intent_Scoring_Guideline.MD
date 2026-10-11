# AI 攻击意图评分拆分 Guideline

> 状态：架构评审提案，尚未批准实施  
> 背景：BlindDuel AI Phase 5 — `predictedOpponentEvents[]` 通用预测层接入 Utility 评分  
> 目的：交由项目 AI 对照当前代码审查方案可行性、识别已有实现与方案的差异，并提出最小实施计划。  
> **评审阶段请先分析，不要直接修改代码或 tuning 数值。**

---

## 1. 当前问题

Phase 5 将预测层扩展到普通攻击后，主动进攻与预测截击进入同一个候选池竞争。这个总方向仍然合理，但在实际调试中暴露出一个问题：

- 主动进攻（Proactive Attack）与预测截击（Preemptive Intercept）最终都执行同一个攻击状态。
- 两条路径目前共用 `#scoreAttack` 的评分链路、攻击基础分，以及最终的 `posture.attackMultiplier` 等修正。
- 预测截击主要通过 `preemptiveBonus` 提高攻击候选分数；但关闭 bonus 不等于关闭预测截击相关的其他评分贡献。
- 降低共用的 `baseWeight` 虽然会压低普通主动攻击，也可能同步压低预测截击，甚至让攻击输给 `positioning hold`，造成 AI 原地不动。
- 当一次攻击同时满足多种条件时，仅看最终分数或普通 Attack 日志，无法判断究竟是哪一种战术意图驱动了决策。

因此，目前很难仅靠调参得到可靠的“主动进攻隔离测试”与“预测截击隔离测试”。这不是简单寻找更合适的 `baseWeight` / `preemptiveBonus` 数值就能保证解决的问题。

### 当前设计中需要核对的具体风险

现有系统说明中，`#scoreAttack` 已包含 `oppPhase` 分支、对手脆弱奖励、反馈/连续性奖励、重复攻击成本、`startupFactor` 等评分项。Phase 5 又加入基于预测事件的截击判断。必须对照当前实际代码，确认是否出现：

1. 旧的 `oppPhase === "startup"` 评分分支仍在给攻击加分；
2. 新的预测事件路径又对相同攻击候选增加 `preemptiveBonus`；
3. 关闭 `preemptiveBonus` 后，旧分支或其他评分项仍然让 AI 在对手 startup 时攻击；
4. `posture.attackMultiplier` 或其他共享因子使主动进攻和预测截击无法独立调节；
5. 恢复阶段的惩罚攻击被错误归类为预测截击，或错误地继承 startup 阶段的 cooldown 豁免。

以上均为需要核实的风险点，不应仅凭文档推断当前代码一定存在这些问题。

---

## 2. 设计目标

1. **保留同池竞争。** Attack、Defense、Positioning 仍然在统一 Utility pool 中竞争，由最终分数决定执行哪个动作。
2. **分离战术意图与执行动作。** “为什么选择攻击”与“最终使用哪一个攻击状态”是不同维度。
3. **让评分可解释。** 日志应能解释一次攻击中主动进攻、预测截击、惩罚攻击等意图分别贡献了什么。
4. **让意图可隔离。** Debug/test 模式应能真正排除某一意图的全部评分贡献，而不只是关闭一个 bonus。
5. **支持角色级侧重。** 不同 AI Profile 可以偏向主动进攻、预测截击或惩罚攻击，而不需要为每种敌人建立独立决策分支。
6. **最小化改造。** 先重构攻击评分的表达与诊断；暂不急于创建完整通用 Intent 框架。
7. **保持战斗机制不变。** 本次只讨论 AI Utility 的评分与可观测性，不改变 CombatSystem 的命中/硬直规则、攻击状态、Action Commitment 或预测事件的物理时间计算。

---

## 3. 核心设计判断

### 3.1 同池竞争不是问题本身

同池竞争有价值：普通 AI 可以同时考虑主动攻击、预测截击、防御和走位，而无需先切换到互斥的“进攻模式 / 防御模式”。不同意图可以共同参与同一次决策。

需要区分：

- **统一候选池**：保留。
- **所有攻击候选必须共享同一套战术评分公式**：不要求。
- **所有攻击候选必须共享同一组意图权重**：不要求。
- **主动进攻和预测截击必须作为两个独立执行动作 kind**：当前没有必要。

### 3.2 意图不等于动作类别

建议先保留攻击状态作为 Action Candidate，例如 `swing`、`thrust`、重击等。评分内部再记录该候选满足哪些意图、各意图给它带来多少评分贡献。

概念结构：

```text
Utility Candidate Pool
├── Attack candidate: swing
│   ├── common attack score
│   ├── PROACTIVE contribution
│   ├── PREEMPTIVE contribution
│   └── PUNISH contribution (如当前 recovery 奖励适合归入此语义)
├── Attack candidate: thrust
│   └── 同样的评分结构
├── Defense candidates
└── Positioning candidates

最终候选分数 → 同池排序 → 执行最高分且分数 > 0 的候选
```

这里的 Intent 是评分理由/贡献来源，不是新的可执行战斗状态。

### 3.3 先拆评分分项，不急于创建通用 Intent 层

当前只有少量进攻动机需要明确区分。首选方案是在 `#scoreAttack` 内形成清晰的评分分项与汇总规则，不要先创建复杂的通用 Intent 注册表、状态机或另一套执行管线。

等未来多种意图需要独立的目标选择、风险预算、行动承诺或不同动作提案时，再评估是否有必要抽象出通用 Intent evaluator。

---

## 4. 建议的评分结构

建议先把攻击候选的评分概念拆成两部分：

### 4.1 Common Attack Score

表达攻击动作本身与通用环境因素的价值，例如（具体归属需根据当前实现核对）：

- 距离与可达性 / range factor；
- 攻击状态偏好 `attackPreferences[stateName]`；
- 攻击重复成本；
- 近期成功/失败反馈；
- 连续性奖励；
- 通用的动作成本或与攻击状态有关的因素。

`AITuning.attack.baseWeight` 应继续作为**通用攻击评分基准**理解，而不是拿来充当“主动进攻专属权重”。不要再依赖降低该值来压制主动进攻、同时保留预测截击。

### 4.2 Attack Intent Contributions

至少在代码语义与日志上区分以下意图：

| Intent | 语义 | 典型触发情形 | 本阶段要求 |
|---|---|---|---|
| `PROACTIVE` | 对手没有提供明确预测截击窗口时，主动寻找攻击机会 | 中立 / idle 等场景下，攻击在距离和其他条件上可行 | 必须能独立识别、调节和关闭 |
| `PREEMPTIVE` | 根据预测事件，判断是否能在对手攻击激活或投掷物 release 前抢先命中/打断 | 对手 attack startup；可被打断的 throw windup | 必须能独立识别、调节和关闭 |
| `PUNISH` | 利用对手 recovery 等已知机会攻击 | 对手处于 recovery 或其他明确的可惩罚窗口 | 可先作为评分语义分类；若当前逻辑与其他 intent 无法合理区分，则先记录现状，不必在第一轮强行重构 |

`PROACTIVE`、`PREEMPTIVE` 和 `PUNISH` 是推荐的意图标签，不要求立即引入独立对象或独立候选 kind。

### 4.3 汇总规则必须显式，避免重复奖励

不要只把多个新 bonus 不加区分地堆到现有总分上。首先核实哪些既有评分项已经表达了某一意图，例如 startup 分支、recovery 奖励以及 Phase 5 的 `preemptiveBonus`。

随后明确：

- 一个既有评分项属于通用评分还是某个意图；
- 同一攻击同时满足多个意图时，是否允许各意图贡献叠加；
- 如果允许叠加，如何避免同一战术优势被重复奖励；
- 如果不允许叠加，是择优取最高意图分、选择主导意图，还是采用其他明确规则。

可以评估如下概念模型，但不能不经检查就把它视为指定实现：

```text
finalAttackScore = commonScore + aggregate(intentContributions)
```

其中 `aggregate` 的规则需要结合现有分数范围、`#scoreDefense` / `#scorePositioning` 的量级和当前调参验证后确定。**不要在本次改造中未经基线测试就随意换成 `max` 或简单累加。**

`posture.attackMultiplier` 可继续作为整体攻击倾向修正；如果角色需要在“主动进攻意愿低、截击意愿高”之间做差异化，则需要另行提供意图级控制，不能靠共享乘数实现。

---

## 5. 配置与 Debug 隔离要求

### 5.1 区分三种配置职责

1. **系统级默认参数**：继续放在 `Data/AITuning.js`。
2. **角色级战术偏好**：可在 `aiProfile` 中增加意图级参数，例如概念上的 `attackIntentPreferences` / `attackIntentWeights`。字段名称、使用乘数还是加法权重，须由代码审查后决定。
3. **Debug / test 开关**：只用于测试隔离，不应和正式战斗规则混为一谈。

角色级配置的目标是表达：“这个敌人更主动”或“这个敌人更擅长截击”，而不是让角色 Profile 直接依赖临时 debug 标志。

### 5.2 意图开关必须关闭完整意图，不只是关闭 bonus

单独把 `preemptiveBonus` 设为 0 不是可靠的“关闭预测截击”方式，因为相同攻击仍可能从旧的 startup 评分分支或其他规则中得到分数。

Debug 层可考虑提供以下模式：

```js
// 概念示例，命名与结构不要求照抄
attackIntentMode: "all"
// "proactive_only"
// "preemptive_only"
// 如有必要，未来扩展为明确的 intent allowlist
```

隔离规则：

- `proactive_only`：保留主动进攻意图；排除预测截击意图的全部评分贡献，以及测试中需要排除的其他攻击意图。
- `preemptive_only`：保留预测截击意图；排除主动进攻意图的专属评分贡献，以及测试中需要排除的其他攻击意图。
- `all`：正常混合决策。

注意：“纯预测截击”不意味着对手没有满足预测条件时 AI 也必须攻击。条件不成立时，AI 选择防御或走位可以是正确结果。

必须定义旧的 `oppPhase` 分支如何归类。若 startup 分支实质上已在表达预测截击，就不能在 `preemptive_only` 模式中因旧代码仍然生效而绕过隔离；若它表达的是不同的通用机会价值，则应明确保留理由并在日志中标出。

### 5.3 不要把战术隔离与战斗规则开关混为一谈

本次 Debug 隔离不应改变：

- attack state 是否存在或是否可执行；
- 攻击 reach、startup、active window 等实际战斗属性；
- hitstun 是否打断 throw；
- Projectile 的飞行、碰撞与可切属性；
- Action Commitment 的规则。

测试开关只影响 AI 候选的评分来源。

---

## 6. 日志与可观测性要求

每次决策不一定需要倾倒全部内部变量，但当 Attack 候选进入 top candidates 时，应能看出：

- 候选攻击状态名；
- Common Attack Score 的主要组成；
- `PROACTIVE` 是否 eligible、主要条件是否通过、贡献分；
- `PREEMPTIVE` 是否 eligible、引用了哪个 predicted event、时间优势/窗口条件/距离条件是否通过、贡献分；
- `PUNISH`（若纳入）是否 eligible、触发窗口与贡献分；
- 汇总规则如何得出最终 Attack Score；
- 最终获胜候选，以及该攻击的主导意图或贡献来源。

日志至少应区分以下情况：

1. 主动进攻与预测截击都可行，但主动进攻分数更高；
2. 预测截击是决定胜出的主要因素；
3. 预测截击条件未成立，所以没有贡献分；
4. 预测截击成立并有贡献，但被 Defense / Positioning 或其他攻击候选击败；
5. 预测事件未生成或数据不完整，因此无法评估预测截击。

不要只输出最终 `best=` 和单一总分。否则无法判断问题发生在事件生成、意图 eligibility、分数计算还是最终候选竞争。

---

## 7. 现有职责与冷却语义的保护

### 7.1 Posture 维持慢变量职责

保持当前 `CombatPosture` 的定位：基于 pressure、miss、opponent vulnerability / idle 等慢变量形成整体 attack / defense / movement multiplier，并继续沿用现有平滑机制。

本次不引入互斥的 `AGGRESSIVE` / `DEFENSIVE` 意图状态机；也不要求 Posture 直接判断当前某次攻击是 `PROACTIVE` 还是 `PREEMPTIVE`。

### 7.2 冷却惩罚必须保留明确范围

已发现的 cooldown 语义问题必须作为回归检查：预测截击在对手 `startup` 阶段可以按现有设计豁免某些 cooldown penalty，但不能因为对手处于任意非 idle 阶段就豁免；特别是对手 `recovery` 时，不应意外沿用 startup 豁免并连续惩罚攻击。

如果 `PUNISH` 与 `PREEMPTIVE` 被分为不同意图，应分别定义冷却规则，不要为了抽象统一而把它们的豁免范围合并。

---

## 8. 建议实施顺序

### Step A — 代码审计与评分归因（不改决策行为）

核查当前分支中的：

- `scripts/Systems/AI/AIController.js`：`#scoreAttack`、预测事件消费、startup / recovery 分支、相关 debug logging；
- `Data/AITuning.js`：攻击基础权重、preemptive bonus、cooldown penalty 等实际配置；
- `scripts/Systems/AI/CombatPosture.js`：`attackMultiplier` 的实际使用位置；
- `AIKnowledgeRegistry.js` 及当前 Phase 5 预测事件生成路径；
- 当前 AI 系统说明与 Phase 5 计划。

输出审计结果：哪些评分项当前属于 Common、哪些实质上表达 `PROACTIVE` / `PREEMPTIVE` / `PUNISH`；是否有旧逻辑和新逻辑重复奖励；当前为何无法隔离两种路径。

这一阶段不要改 tuning，也不要重写评分函数。

### Step B — 加入分项诊断（尽量不改变总分）

让日志呈现各评分来源及总分的组装方式。优先做到可观测，再改变数学模型。

验收：对于至少一个主动攻击案例、一个普通攻击截击案例和一个 throw windup 案例，可以从日志说明分数来源。

### Step C — 分离意图控制与隔离开关

在审计确认各评分项归属后，将主动进攻与预测截击的评分贡献分离，并提供真正有效的隔离测试模式。尽量保留现有最终评分基线，不在同一改动中同时进行大范围调参。

验收：切换 debug 模式能排除相应意图的全部专属评分贡献，且日志可验证被排除的意图没有暗中从旧分支加分。

### Step D — 验证汇总规则和角色级调参

在三种模式下分别测试：主动进攻、预测截击、正常混合竞争。只有确认分项归属和隔离工作后，才调整基础权重及意图权重。

是否把意图评分提升为通用 Intent evaluator，留作本轮代码审查后的独立设计决策；不应作为 Step A 的前置要求。

---

## 9. 验收矩阵

| 场景 | 测试目的 | 预期结果 |
|---|---|---|
| 对手 idle / 中立，距离合适，`proactive_only` | 主动进攻能否独立工作 | 主动进攻可以正常竞争；其评分不依赖预测截击贡献 |
| 对手进入长 startup（如较慢 swing），自己有可达且能先激活的快招，`preemptive_only` | 预测截击能否独立工作 | 满足 timing / reach / interrupt 条件时可选择截击 |
| 对手进入短 startup（如较快 thrust），自己攻击无法先激活 | 避免错误截击 | 不应仅因为预测事件存在就获得有效截击优势；防御或走位可胜出 |
| 对手处于 startup，但距离超出自身有效 reach | 检查硬条件与评分语义 | 不应把不可达攻击包装成有效截击机会 |
| 近距离 throw windup，能在 release 前命中并打断 | B4 回归 | 可评估并选择打断 throw 的攻击 |
| throw windup，但时间不足或距离不满足 | 防止误判 | 不应错误地认为能在 release 前命中；其他有效候选正常竞争 |
| 远距离、cuttable projectile | 既有投掷物路径回归 | preemptive cut / release 后 reactive 路径继续按现有规则工作 |
| projectile 不可切 | 既有规则回归 | 不应产生无效 preemptive cut |
| 对手 recovery，AI 处于 cooldown | 冷却语义回归 | 不应意外套用仅适用于 startup 的 cooldown 豁免 |
| `all` 混合模式 | 验证同池竞争 | proactive / preemptive / defense / positioning 正常竞争，最终结果可由日志解释 |

具体时间、距离与状态名称应从项目中实际的 StateGraph / attack profile 获取，不要在测试计划中硬编码与真实资产不符的数值。

---

## 10. 本次不做的事

- 不把 `PREEMPTIVE` 直接升级为独立执行动作 kind，除非审计发现其确实需要独立目标、动作候选或 commit 语义。
- 不推翻同池 Utility 竞争模型。
- 不重建 Posture 状态机。
- 不同时改写预测事件的时间计算、Projectile 物理模型或 CombatSystem 规则。
- 不以降低 `attack.baseWeight` 的方式强行压制主动进攻。
- 不把 `preemptiveBonus = 0` 当成已关闭预测截击的证据。
- 不在缺少分数基线与日志归因时直接大幅调整 `baseWeight`、`preemptiveBonus` 或 positioning 分数。
- 不要求本轮完成通用 Intent 框架；先实现足够清楚的分项评分、配置与诊断。

---

## 11. 请项目 AI 先回答的评审问题

在开始改动前，请基于当前代码回答：

1. 当前 `#scoreAttack` 中哪些分项实际表达主动进攻、预测截击、惩罚攻击？哪些是通用因素？请按实际代码列出，而不是只按函数名猜测。
2. 旧 `oppPhase` startup 分支与 Phase 5 基于 `predictedOpponentEvents[]` 的 `preemptiveBonus` 是否存在重复或重叠奖励？关闭 bonus 后还有哪些分项能让攻击在 startup 时获分？
3. `posture.attackMultiplier`、`attackPreferences`、`baseWeight` 和 positioning 保底分目前如何共同影响候选竞争？能否用一组明确的现有数值展示 `baseWeight=0.12` 时为何出现不行动？
4. 在不改变最终决策结果的前提下，怎样以最小改动把评分拆分写入日志？
5. 要实现真正的 `proactive_only` / `preemptive_only`，哪些旧评分分支必须一并归类或屏蔽？是否需要包含 `PUNISH` 的独立控制？
6. 推荐采用意图分项直接汇总、择优取最大贡献，还是其他汇总规则？请结合当前评分尺度和重复奖励风险说明，不要仅凭抽象偏好选择。
7. 建议新增哪些系统级 tuning 与角色级 aiProfile 参数？分别采用加法权重还是乘数？默认值应如何在保留现有行为的前提下初始化？
8. 请给出最小实施步骤、受影响文件、回归测试清单和潜在风险。先提交分析与计划，等待确认后再改代码。

---

## 12. 当前阶段的推荐结论

**暂定方向：保留同池竞争；先将攻击评分拆成可观察、可独立控制的战术意图贡献；继续让最终攻击动作与 Defense / Positioning 在同一 Utility pool 竞争；暂不建立完整通用 Intent 框架。**

这是一份供评审的 guideline，不是已批准的代码实施计划。若当前代码结构与本文假设不一致，应先指出差异，再基于实际实现提出修订方案。
