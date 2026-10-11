# AI 系统说明

> 更新：2026-10-08 — 投掷物防御系统（reactive cut + preemptive cut）
> 
> 三合一：设计说明 + 配置指南 + 快速索引。下次设计 aiProfile 或调参时直接查。

---

## 1. 整体架构

四层分离（核心设计原则）：

| 层 | 频率 | 职责 | 不做 | 配置/代码位置 |
|---|---|---|---|---|
| **Memory** | 事件驱动 + 每帧 tick | 纯历史记录（outcomes, commits, pressure）| 不修改任何分数 | `AI/CombatMemory.js` · `_pressureDecayBase` |
| **Situation** | 200ms 决策时构建 | 当前快变量感知（oppPhase/distance/oppVuln...）+ throw_windup 预测（predictedTTI/Cuttable/Distance/throwRemainingMs）+ in-flight projectile threats[] | 不记录历史 | `AIController.#buildSituation` · 硬编码 |
| **Posture** | 500ms tick | 慢变量姿态 → multipliers（1.0=neutral）| 不做 distanceHunger（快变量）| `AI/CombatPosture.js` · `DEFAULT_POSTURE_TUNING` + `aiProfile` 角色级 override |
| **Utility** | 200ms | 哪个动作现在最合适（scoreAttack/Defense/Positioning）| 不做 "想不想打"（Posture 管）| `AIController.#scoreAttack/Defense/Positioning` · `Data/AITuning.js` 系统级默认 + `aiProfile.attackPreferences/repetitionCostRate` 角色级 override |

```
Memory → Situation+Posture → Utility → Action → Outcome → Memory
```

---

## 2. 文件结构

```
scripts/Systems/AI/
├── AIController.js        # 主决策：fixedUpdate→makeDecision→executeCommitted
│   #scoreAttack / #scoreDefense / #scorePositioning
│   #evaluateProjectileDefense / #findBestSlashForProjectile / #scoreCutForProjectile
│   #scoreDodgeForProjectile / #computeTimingAlignment
├── AIKnowledgeRegistry.js # 武器 knowledge：#getMaxReach() / #getClosestMinReach() + throw state cross-reference
├── CombatMemory.js        # Layer 0: 纯数据。onOutcome() / getAdaptation() / tick()
└── CombatPosture.js       # Layer 1: 慢变量。attackMult/defenseMult/advanceMult/retreatMult

Data/AITuning.js          # 系统级默认 tuning（含 projectileDefense: {cutBase, dodgeBase, cutTooSlowSpan}）
Data/ProjectileDefs.js    # 投掷物静态定义（speed, cuttable, damage）

scripts/CombatSystem.js → 产出 outcome + projectile events，喂 AIController.onCombatResult()
```

---

## 3. Layer 0: CombatMemory

### 核心字段

| 字段 | 含义 |
|------|------|
| `outcomes[]` | 最近 20 条 outcome，5 秒过期 |
| `#perStateOutcomes` | Map<stateName, []> — 每个 attack/guard state 的最近 8 条（getAdaptation 用）|
| `commits[]` | 最近 6 次 COMMIT |
| `pressure` | 0~3 被击压力：hit→+1.0, success defense→×0.6, opp miss→×0.7, time→×0.995^(dt/500) |
| `consecutiveMisses` | 连续 attack miss 计数 |

### Outcome 枚举

`attack:hit` | `attack:miss` | `attack:parried` | `self:hit` | `guard:success` | `guard:broken` | `dodge:success` | `dodge:fail`

### 关键 API

- `onOutcome(outcome, stateName?)` — 同时 push 到 per-state tracking
- `onOppOutcome("miss")` — opp miss observer 喂
- `getAdaptation(stateName)` → `{ consecutiveFail, consecutiveSuccess }`

---

## 4. Layer 1: CombatPosture

### Multiplier 语义

**1.0-centered**：1.0=neutral（不改变 Utility 原始分），>1=鼓励，<1=抑制。比 0~1 bias 干净。

### Target 公式

```
tAttack  = baseAggression                          [1.0]
         - min(1, pressure/3) * cautionFromDamage [0.15] — 被打降
         - min(1, consecMiss/3) * cautionFromMisses [0.10] — miss 降
         + (oppVuln>0.5 ? punishDesire : 0)         [0.10] — opp 脆弱想惩罚
         - smoothstep(oppIdleMs, 800, 2000) * idleCaution [0.12] — opp idle 降攻击

tDefense = baseDefense                             [1.0]
         + min(1, pressure/3) * defenseFromDamage  [0.12] — 被打想防
         + smoothstep(oppIdleMs, 800, 2000) * readinessFromIdle [0.10] — opp idle 待命
         + (oppPhase==="startup" ? startupDefenseBonus : 0) [0.15]

tAdvance = clamp(tAttack * distanceAppetite, 0.7, 1.3)   [0.7]
tRetreat = clamp(tDefense * retreatDesire, 0.7, 1.3)     [0.6]
```

方括号里是 DEFAULT_POSTURE_TUNING 默认值。

### Low-pass Smoothing

```
alpha = decayAlpha [0.15]
current += alpha * (target - current)
// → current 追 target 约 2-3 秒，避免人格跳变
```

### 标签判定

```
attackMult > 1.1  → "AGGRESSIVE"
defenseMult > 1.1 → "DEFENSIVE"
attackMult < 0.9  → "CAUTIOUS"
else              → "NEUTRAL"
```

### Multiplier 边界

attackMult ∈ [0.6, 1.4]，defenseMult ∈ [0.7, 1.3]，advance/retreat ∈ [0.7, 1.3]

---

## 5. Layer 2: Utility Scoring

### 候选 pool

| 函数 | 候选数 | multiplier 乘入 | 核心输入 |
|------|--------|-----------------|----------|
| `#scoreAttack` | N attacks | `attackMultiplier` + `attackPreferences[stateName]` | distance, oppPhase, oppThreat, oppVuln, adaptation, startupFactor |
| `#scoreDefense` | N guards/dodges | `defenseMultiplier` | oppThreat, oppPhase, defensiveReadiness(opp idle) |
| `#scorePositioning` | 3（approach, hold, retreat）| approach×`advanceMult`, retreat×`retreatMult` | distance vs maxEffReach, closestMinReach. **throw_windup 时 approach ×0.1 + hold 保底 0.05**（抑制靠近，等 projectile 出来再反应）| 
| `#evaluateProjectileDefense` | up to 2（dodge + cut）| 各自 base × defense/attackMult | **reactive**: activeProjectileThreats[].estTTI/distance/cuttable. **preemptive**: predictedProjectileTTI + 5 层 gate |

所有分数进 pool → 排序 → **最高分 > 0 就执行**（无 threshold 硬门控）。

### projectile defense 物理模型

两条路径共享同一个评分函数，5 层 gate 决定 preemptive 要不要跳：

```
preemptive gate 5 层门控：
  ① opp.phase === "throw_windup"
  ② predictedProjectileTTI != null
  ③ predictedProjectileCuttable === true
  ④ flightMs ≤ 820ms（距离 ≤ 4.92m，物理上能 preemptive cut）
  ⑤ throwRemainingMs ≤ 570ms（opp 在 weaponbox 结束前 release，避免挥空）
```

### timingAlignment 物理语义（二元判断）

```
tti < activeStart → timingAlignment = 0   // weaponbox 还没激活 projectile 就到了 → 物理不可能命中
tti ≥ activeStart → timingAlignment = 1.0 // weaponbox 能先激活，distanceAlignment 管 reach 覆盖
```

物理语义：projectile 是恒速直线飞行物体，不存在 "too late"——weaponbox 激活后 projectile 继续飞，只要在 reach 内就能斩到。cutScore = cutBase(0.65) × timingAlignment × distanceAlignment × attackMult。

### #scoreAttack 完整链路

```
base = 0.4 (AITuning.attack.baseWeight)
  × rangeFactor (distance 在 [effectiveRange, effectiveRange*1.3] 窗口内衰减)
  + oppPhase 分支 (startup preemptive, active threat penalty, recovery punish)
  + vulnReward × oppVulnerable
  + rangeEdgeBonus (边缘命中微加分)
  - feedbackFailPenalty × consecutiveFail (第1次×0.5，第2次起满罚)
  + feedbackSuccessBonus × min(consecutiveSuccess, 3)
  + continuityBonus (上一招成功 + 本次 adaptation 不反对)
  - repetitionCostRate × (连续使用count-1)，封顶 repetitionCostMax
  + startupFactor (快招在 opp recovery 加分 / 慢招在 opp active 扣分)

硬门控：distance < minReach → return 0
        distance > effectiveRange*(1+distanceStartupSmooth) → return 0

baseAttackScore ×= posture.attackMultiplier × attackPreferences[stateName]
```

### #scoreDefense 完整链路

```
oppThreat < activationThreshold → return 0
  oppPhase==="active"   → activeBase × oppThreat [× guardLeakBonus if oppVuln high]
  oppPhase==="startup"  → startupCanActBase 或 startupTooLateBase (看 reflexMaxMs)
  oppPhase==="none"     → 0.08 × smoothstep(oppIdleMs,800,2000) × defenseMult [defensiveReadiness, Phase 1]
  oppPhase==="recovery" → 0

score ×= posture.defenseMultiplier
```

### #scorePositioning

```
// ⚠️ 边界必须和 attack effectiveRange 对齐
const maxFwdBoost = max(0, ...attacks.map(a => -a.activeDisplacement))
const maxEffReach = maxAttack.maxReach + maxFwdBoost + rangeBuffer

approach: distance > maxEffReach ? 0.35 × advanceMult × distanceHungerBoost : 0
hold:     distance ∈ (closestMinReach, maxEffReach] ? 0.15 [+ cooldown 0.08] : 0
retreat:  distance ≤ closestMinReach+0.3 ? 0.5×retreatMult : oppThreat>threshold ? 0.3 : 0
```

positioning 基础分 **低于 attack.baseWeight(0.4)**，保证 attack 正常赢 positioning。hold 保底 0.15 防止 AI 原地不动。

---

## 6. Phase 4: aiProfile 配置指南

### 放置位置

角色 `StateGraphDef/*.json` 的 `characterTraits` 同级加 `aiProfile` 字段。

### 7 个 knob

| 字段 | 默认 | 含义 | 覆盖场景 |
|------|------|------|----------|
| `baseAggression` | 1.0 | 基础攻击 multiplier | 假人=0.0, 精英=1.2, Boss=1.3 |
| `baseDefense` | 1.0 | 基础防御 multiplier | 假人=1.4, 精英=0.9 |
| `decayAlpha` | 0.15 | low-pass 系数（越小越慢变）| 教学=0.06, 精英=0.25, Boss=0.20 |
| `distanceAppetite` | 0.7 | advanceMultiplier 派生系数 | 假人=0.05, 精英=0.8 |
| `retreatDesire` | 0.6 | retreatMultiplier 派生系数 | 假人=0.05, 精英=0.5 |
| `repetitionCostRate` | 0.06 | 连续用同一 attack 成本 | 教学=0.02, 精英=0.10, Boss=0.08 |
| `attackPreferences` | `{}` | per-attack 分数乘数（默认 1.0）| 教学={swing:1.6,thrust:0.4} |

### 三种敌人配置示例

```json
// 教学敌人 — 稳定 swing，少许防御，变招慢
{ "aiProfile": {
  "baseAggression":0.9, "baseDefense":0.85, "decayAlpha":0.06,
  "distanceAppetite":0.5, "retreatDesire":0.3, "repetitionCostRate":0.02,
  "attackPreferences": {"swing":1.6, "thrust":0.4, "dash":0.3}
}}

// 防御假人 — baseAggression=0 → attackMult 永远 0 → 只会 guard
{ "aiProfile": {
  "baseAggression":0.0, "baseDefense":1.4, "decayAlpha":0.10,
  "distanceAppetite":0.05, "retreatDesire":0.05, "repetitionCostRate":0.06
}}

// 精英敌人 — 主动调动，变招变距离，人格切换快
{ "aiProfile": {
  "baseAggression":1.2, "baseDefense":1.0, "decayAlpha":0.25,
  "distanceAppetite":0.8, "retreatDesire":0.5, "repetitionCostRate":0.10
}}
```

### Phase 5：三种性格 AI（角色固定 Rabble）

以下配置基于 Phase 5 统一预测层，三种性格的区别在于**意图权重**（PROACTIVE/PREEMPTIVE/PUNISH 三路径的相对比例）+ **基础偏好**。attackIntentMode 是 debug 字段，正常游戏用 `"normal"`。

#### 1. 均衡型（默认，Phase 4 Rabble 草案）

三条意图路径自然竞争，events 消费已全部接线。如果已有 Rabble 草案就用那份，这里不重复。

#### 2. 被动反应型 — 预测前时代的行为

特点：base 驱动弱，主要靠 opp 出招后的 counter-attack 和 defense。看起来反应慢、容易被压、偶尔 opp recovery 时蹭一刀。

```json
{ "aiProfile": {
  "baseAggression": 0.5,       // 主动进攻 multiplier 降低
  "baseDefense": 1.1,          // 防御意愿偏高
  "decayAlpha": 0.12,          // 人格切换慢（不容易突然 aggressive）
  "distanceAppetite": 0.5,     // 靠近欲望低
  "retreatDesire": 0.7,        // 想拉开距离
  "repetitionCostRate": 0.05,  // 变招慢
  "attackPreferences": {"thrust": 1.3, "swing": 0.8, "dash": 0.6}
}}
```

系统级 tuning 覆盖（或直接改 `AITuning.js` 默认值）：
```javascript
attack: {
  baseWeight: 0.25,      // 基础攻击分降低 → 进攻更保守
  preemptiveBonus: 0.08, // 抢先截断奖励极低（几乎不主动 PREEMPTIVE）
  vulnReward: 0.5,       // opp recovery 时的 PUNISH 奖励保留
},
projectileDefense: {
  cutBase: 0.35,         // 斩落 projectile 的意愿降低
  dodgeBase: 0.55,       // 更倾向 dodge（被动防御）
},
// 意图权重硬编码在 #scoreAttack 内，
// 被动反应型不需要改 intentWeights——
// 低 baseWeight + 低 preemptiveBonus 已经自然让 events 驱动的攻击意图不显著
```

**预期行为**：
- opp idle 时 AI 保持距离（distanceAppetite 低 → approach 欲望弱）
- opp startup 时 AI 主要靠 defense 层（guard/dodge），PREEMPTIVE bonus 几乎不触发
- opp recovery 时 vulnReward 生效 → PUNISH 路径能打出一刀
- 投掷物优先 dodge 而非 cut

#### 3. 预测驱动型 — events 主导的等反制专家

特点：base 驱动极弱，找到舒适距离后基本 hold，主要靠 opp 出招后的 MOVEMENT BUFF 或 opp 后摇反制。Events 层是主决策器。

```json
{ "aiProfile": {
  "baseAggression": 0.3,       // 基础攻击意愿极低
  "baseDefense": 0.9,          // 防御中等（防御层主要靠 events timing）
  "decayAlpha": 0.18,          // 人格切换中等
  "distanceAppetite": 0.4,     // 不主动追
  "retreatDesire": 0.4,        // 也不太想退（找到舒适距离就 hold）
  "repetitionCostRate": 0.08,  // 变招速度中等
  "attackPreferences": {"thrust": 1.5, "swing": 0.5, "dash": 0.8}
}}
```

系统级 tuning 覆盖：
```javascript
attack: {
  baseWeight: 0.15,      // 基础攻击分极低 → PROACTIVE 几乎不触发
  preemptiveBonus: 0.30, // 抢先截断奖励极高（events timing 精准时触发）
  vulnReward: 0.55,      // opp recovery 反制奖励保留
},
projectileDefense: {
  cutBase: 0.75,         // 斩落 projectile 意愿高（events timing 支撑 reactive/preemptive cut）
  dodgeBase: 0.35,       // 不太想 dodge（更倾向 cut 或 hold）
},
// Positioning tuning：
// 无额外改动，events 驱动的 positioningPlan 会自然找到舒适距离
// PREEMPTIVE bonus 0.30 + positioning approach 加成 0.12
// → opp startup 且 AI 在 edge 时会主动压进 range
```

**关键机制**：

预测驱动型**不是纯 PREEMPTIVE-only**——它的 PROACTIVE/PUNISH/DEFENSE 路径仍然参与同池竞争，只是 base 权重极低导致 PROACTIVE 很少赢。真正的驱动源是：

```
opp startup → events 产 opp_attack_active_window(startMs=380ms)
  → preemptiveBonus=0.30（极高）+ positioning approach 加成=0.12
  → 即使 baseWeight 只有 0.15，PREEMPTIVE bonus 也能让 attack 赢

opp idle → 无 events
  → baseWeight=0.15 极轻，distanceAppetite=0.4
  → hold 舒适（distanceHunger 在舒适距离附近≈0）→ 原地等

opp recovery → events 为空
  → vulnReward=0.55 + baseWeight=0.15 → PUNISH 路径能打出一刀
  → 但不强行挤进去（retreatDesire=0.4 不会逼得太远）
```

**预期行为**：
- opp idle 时 AI 在舒适距离 hold 住（positioningPlan recommend=hold，events 为空时退化到静态阈值）
- opp startup 时 AI 计算 PREEMPTIVE 可行性：赶得上 → 压进 range 抢先截断；赶不上 → hold 等 active 结束
- opp recovery 时 AI 不主动进，但 vulnReward 能驱动 PUNISH 反制
- 投掷物优先 cut（events timing 精确支撑 reactive/preemptive 双路径）

**与被动反应型的本质区别**：

| 维度 | 被动反应型 | 预测驱动型 |
|------|-----------|-----------|
| baseWeight | 0.25（低） | 0.15（极低） |
| preemptiveBonus | 0.08（几乎没有） | 0.30（极高） |
| events 的角色 | 辅助信息（events 有但不显著驱动决策） | 核心驱动（events timing 决定 PREEMPTIVE/PUNISH 是否触发） |
| opp idle 时 | 有点想靠近（distanceAppetite 0.5） | hold 舒适（distanceAppetite 0.4 + baseWeight 0.15 → hold 赢） |
| opp startup 时 | 主要靠 defense guard/dodge | PREEMPTIVE 截断（events 计算 timing 可行性后压进 range） |
| 节奏感 | 慢、稳定、防御姿态 | 等待、精准、一击反制 |

---

## 7. 调参索引（按目标反查）

### 想让 AI 更 aggressive

| 目标 | 改什么 | 位置 |
|------|--------|------|
| 全局更想打 | `baseAggression` ↑（如 1.2）| aiProfile |
| 被打后更快恢复 | `decayAlpha` ↑ | aiProfile |
| pressure 掉得更快 | `_pressureDecayBase` ↑（当前 0.995 per 500ms）| CombatMemory.js |
| opp idle 时更快忍不住打 | `idleCaution` ↓ | DEFAULT_POSTURE_TUNING |
| 对同一招更有执念 | `repetitionCostRate` ↓ | AITuning / aiProfile |
| 想靠近的欲望更强 | `distanceAppetite` ↑ | aiProfile |

### 想让 AI 更 defensive

| 目标 | 改什么 | 位置 |
|------|--------|------|
| opp idle 更快进入待命 | `readinessFromIdle` ↑ / `idleCaution` ↑ | DEFAULT_POSTURE_TUNING |
| opp startup 更想防 | `startupDefenseBonus` ↑ | DEFAULT_POSTURE_TUNING |
| guard 分数普遍更高 | `defense.activeBase` ↑ | AITuning.js |
| opp phase 容易触发防御 | `defense.activationThreshold` ↑ | AITuning.js |
| 被打后防御意愿持续更久 | `defenseFromDamage` ↑ / `decayAlpha` ↓ | DEFAULT_POSTURE_TUNING |

### 想让 AI 变招更勤

| 目标 | 改什么 | 位置 |
|------|--------|------|
| 连续用同一 attack 成本更高 | `repetitionCostRate` ↑ | AITuning / aiProfile |
| 每次失败扣更狠 | `attack.feedbackFailPenalty` ↑ | AITuning.js |
| 成功也不奖励惯性 | `attack.continuityBonus` ↓ 或 0 | AITuning.js |

### 想让 AI 人格切换更慢/更快

只改 **`decayAlpha`**（DEFAULT=0.15）。这是唯一控制人格切换速度的旋钮。

```
alpha=0.05 → 追 target 需要 ~6s（很稳，教学敌人）
alpha=0.15 → 追 target 需要 ~2-3s（默认）
alpha=0.25 → 追 target 需要 ~1s（灵敏，精英/Boss）
```

---

## 8. 常用日志 grep

| 搜索 | 含义 |
|------|------|
| `[AI-Diag] best=` | 每次决策第一名 |
| `top3=` | 前三名分数分布 |
| `POS:` | approach/hold/retreat 分数 |
| `[AI-Diag] oppThrow=` | opp 抬手时的预测链输出（predictedTTI / throwRemaining / predictedFlight / predDist）| 
| `[AI-Diag] preemptive_gate:` | preemptive 门控结果（VIABLE / SKIP / DEFER → reactive）| 
| `[AI-Diag] preemptive_cut:` | preemptive cut 候选详情（timingAlignment / score）| 
| `[AI-Diag] activeProjectileThreats=` | projectile 发射后 in-flight threat 列表 | 
| `[Phase0] oppIdleMs=` | Memory pressure + Posture target/current + label |
| `pressure=` | 被击压力值 |
| `→ DEFENSIVE/CAUTIOUS/AGGRESSIVE` | Posture 标签变化 |
| `ReferenceError` / `EXCEPTION` | JS 运行时错误 |

**Debug 开关**：按 X 键切换 `_debugVisible`，所有 `[AI-Diag]` 受此门控。

---

## 9. 哪些东西不做（踩坑记录）

| 不做 | 为什么 |
|------|--------|
| 互斥 Intent 状态机（AGGRESSIVE/DEFENSIVE 四态切换）| low-pass smoothing 已实现连续变化 + 避免跳变 |
| AI 策略放进 StateGraph JSON | StateGraph 只记录能力，策略是性格 |
| 每帧 tick Posture | 浪费。500ms 足够（攻击节奏最快 400ms startup）|
| pressure 永久累积 | 必须 time decay，否则一次 hit 记仇整场 |
| positioning 分数和 attack 同量级 | positioning 是 attack 不够好时的备选，不应正面竞争 |
| Posture 里算 distanceHunger | distance 是快变量（每帧变），Posture 是慢变量（500ms tick），频率不匹配 |
| riskTolerance 整个乘 attack score | 这不是"风险偏好"，真要 risk 控制改 threatPenalty 权重 |
| outcome 枚举冲突（clash 算不算）| clash 跳过，不干扰连续计数 |

---

## 10. Backlog（已知表达缺口）

> 触发场景：设计 Rabble（精于防反、opp 出重击→伺机轻击截断、积极走位）
> 分析结论：现有 7 个 knob 能配出 ~70% 效果（更会防、偏好轻击、人格切换快）。投掷物防御系统落地后暴露了三个新缺口（B4-B6），且原有三个缺口（B1-B3）都需要统一预测层才能解决。
> 缺口分层：**Phase 4 先落地现有 7 个 knob**；Phase 5 补统一预测层（predictedOpponentEvents），一次性解决 B1/B4/B5；B2/B3 独立。
>
> **2026-10-12 更新**：Phase 5 核心 + B5 positioning 全部落地。详见 `plans/26.10.9 预测能力通用化计划.MD`。以下缺口状态以 ✅/⌛标记。

### Rabble 草案（现有 knob 最大化）

```json
{ "aiProfile": {
  "baseAggression":0.9, "baseDefense":1.2, "decayAlpha":0.25,
  "distanceAppetite":0.8, "retreatDesire":0.5, "repetitionCostRate":0.08,
  "attackPreferences": {"thrust":1.5, "swing":0.6, "dash":1.2}
}}
```

预期效果（可观察验证）：
- defenseMult 基准偏高 → opp 出招时更早进 guard 决策
- attackMult 基准稍低 → 不会猛攻，但 oppVulnerable>0.5 时 punishDesire 自动拉回
- alpha=0.25 → opp 一出招迅速切防御，一收招迅速切攻击
- attackPreferences → 优先出 thrust

### 缺口 B1：不区分 opp 出什么招 ✅ 已解决（Phase 5 Step 1-3a）

| 项 | 说明 |
|----|------|
| 解决方式 | `Situation.opp` 扩展为 `{phase, stateName, attackProfile, vulnerable, threat}`；`predictedOpponentEvents[]` 生成 `opp_attack_active_window` 事件带 trajectory 和 timing 属性；`#scoreAttack` preemptive bonus 根据 oppTrajectory（slash vs thrust）缩放 |
| 验收 | opp 出 swing（trajectory=slash）→ PREEMPTIVE full bonus；opp 出 thrust（trajectory=thrust）→ PREEMPTIVE mult=0.3 或 0（赶不上时）|

### 缺口 B2：没有 defensePreferences

| 项 | 说明 |
|----|------|
| 现状 | `aiProfile` 只有 `attackPreferences`（per-attack 乘数），没有 per-defense-state 偏好 |
| 想让 AI 做到 | Rabble 偏好 parry 而弱 guard（parry 成功后立即进攻）|
| 影响 | Rabble 的"精于防反"只能靠 `baseDefense` 拉整体防御意愿，无法让 parry 比 guard 分更高 |
| 未来补法 | `aiProfile.defensePreferences: {guard_low:1.0, guard_high:0.6, parry:1.8}` + `#scoreDefense` 末尾乘入（和 attackPreferences 对称） |

### 缺口 B4：近距离投掷无法拦截 throw ✅ 意外实现（Phase 5 Step 4）

| 项 | 说明 |
|----|------|
| 解决方式 | 未显式加 throw interrupt bonus。`attackIntentMode=preemptive_only` 下 commonW 在 opp committed state（含 throw_windup）时 = 1.0 → common 基分（0.4）> hold（0.15）→ AI commit attack → hitstun 打断投掷 |
| 验收 | preemptive_only 模式下近距离 reach 内 AI 主动 swing opp 打断投掷，远距离正常走 preemptive cut / reactive 路径 |

### 缺口 B5：preemptive dodge（throw_windup 期间提前侧移）✅ 已落地（Phase 5 B5 Step 1+2）

| 项 | 说明 |
|----|------|
| 注意 | 原设想是**strafe 侧移**（B3 才是侧移大改）。Phase 5 先落地**events 驱动的 positioning 评分加成** |
| 实现 | `#buildPositioningPlan(sit)` 遍历 predictedOpponentEvents，计算 moveSpeed=0.4 m/s 约束下（窗口内最多移动 ~15cm）的阈值跨越可行性 → `#scorePositioning` 根 plan.recommend 微调 approach/hold/retreat 三候选评分：retreat=+0.15（opp reach 边缘内避弹）、approach=+0.12（PREEMPTIVE 边缘压线）、hold=+0.08 + approach×0.5（都赶不上时明确 hold）|
| 约束 | moveIntent 只有方向（-1/0/1），无精确距离控制 → positioning 是方向控制系统，events 只微调相对优先级，不重写静态阈值 |
| 退化 | 无 events 时 posPlan=null → 完全跳过加成 → 零回归 |

### 缺口 B6：没有 predictionAccuracy 旋钮（个体预测能力差异）

| 项 | 说明 |
|----|------|
| 现状 | reactive 和 preemptive 是两条硬接的代码路径（5 层 gate + isPreemptive 守卫），没有单一旋钮控制 AI "能不能看到未来" |
| 想让 AI 做到 | predictionAccuracy=0.0 → 退化到老 AI（只看 opp attackPhase，无 projectile 预测）；predictionAccuracy=1.0 → 完美 preemptive；中间值 → 偶尔时机不准 |
| 未来补法 | 搭 `predictedOpponentEvents[]` 统一预测层，在生成时注入 predictionAccuracy 参数：oppActionIdentification（识别 throw=0.0）、timingPrecision（release 估计±400ms 噪声）、reactionDelayMs（抬手后多少 ms 才看到）| 

### 缺口 B3：positioning 只有一维推拉

| 项 | 说明 |
|----|------|
| 现状 | approach/hold/retreat 只改前后距离。没有 strafe（左右侧移）|
| 想让 AI 做到 | "积极走位获取机会"包括绕侧、拉角度、不站在 opp 正面打击线上 |
| 影响 | `distanceAppetite=0.8` 只能让 AI 前后推拉，不是"走位" |
| 未来补法 | 大改。两个方向：a) 加 `strafeLeft/strafeRight` 进候选池；b) 用更复杂的位置目标（如 opp 侧面 45° 扇区，`PositioningTarget = opp.position + 1.5m * 方向偏移`）。需要和 combat movement 系统对齐 |

### 实施原则

**不要为了一个角色一次加一堆 knob**。Phase 4 先落地现有 7 个 knob，跑 Rabble 草案 profile 实际看效果。三个缺口按以下顺序评估：

1. **B2（defensePreferences）** — 改动最小（加一个字段 + 一处乘法），和 attackPreferences 对称，性价比最高。如果 Rabble 跑完发现"让 parry 比 guard 分高"确实需要，先补这个
2. **B1/B4/B5（统一预测层核心）** — ✅ Phase 5 全部落地。共享根因 `predictedOpponentEvents[]` 已建，B1（opp 招式区分）、B4（拦截 throw 意外实现）、B5（events 驱动 positioning 评分加成）自然连通
3. **B6（predictionAccuracy 旋钮）** — ⌛ 仍在 backlog。events 层已稳定，随时可在生成时注入噪声参数（oppActionIdentification / timingPrecision / reactionDelayMs），属于 tuning 层改动，不阻塞任何现有功能
4. **B2（defensePreferences）** — ⌛ 仍在 backlog。改动极小（加字段 + 一处乘法），等角色 profile 需要时补
5. **B3（positioning 侧移）** — ⌛ 仍在 backlog。大改，涉及 movement 系统，最后考虑