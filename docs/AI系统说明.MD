# AI 系统说明

> 更新：2026-09-22 — CombatMemory → CombatPosture → AIController 完整链路
>
> 三合一：设计说明 + 配置指南 + 快速索引。下次设计 aiProfile 或调参时直接查。

---

## 1. 整体架构

四层分离（核心设计原则）：

| 层 | 频率 | 职责 | 不做 | 配置/代码位置 |
|---|---|---|---|---|
| **Memory** | 事件驱动 + 每帧 tick | 纯历史记录（outcomes, commits, pressure）| 不修改任何分数 | `AI/CombatMemory.js` · `_pressureDecayBase` |
| **Situation** | 200ms 决策时构建 | 当前快变量感知（oppPhase/distance/oppVuln...）| 不记录历史 | `AIController.#buildSituation` · 硬编码 |
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
├── AIKnowledgeRegistry.js # 武器 knowledge：#getMaxReach() / #getClosestMinReach()
├── CombatMemory.js        # Layer 0: 纯数据。onOutcome() / getAdaptation() / tick()
└── CombatPosture.js       # Layer 1: 慢变量。attackMult/defenseMult/advanceMult/retreatMult

scripts/CombatSystem.js → 产出 outcome，喂 AIController.onCombatResult()
Data/AITuning.js          # 系统级默认 tuning（全部 neutral baseline）
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
| `#scorePositioning` | 3（approach, hold, retreat）| approach×`advanceMult`, retreat×`retreatMult` | distance vs maxEffReach, closestMinReach |

所有分数进 pool → 排序 → **最高分 > 0 就执行**（无 threshold 硬门控）。

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
> 分析结论：现有 7 个 knob 能配出 ~70% 效果（更会防、偏好轻击、人格切换快），但三个核心特征表达不了。
> 优先级：Phase 4 先落地现有 7 个 knob，跑 Rabble 草案 profile 实际看效果；缺口留到 Phase 5 按需补。

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

### 缺口 B1：不区分 opp 出什么招

| 项 | 说明 |
|----|------|
| 现状 | `Situation` 只有 oppPhase（startup/active/recovery）+ oppVulnerable + oppThreat，没有 opp 当前 stateName / attackProfile |
| 想让 AI 做到 | opp 出 swing（重击 startup 长）→ 用 thrust 截断；opp 出 thrust（轻击 startup 短）→ 不抢先（自己赶不上）|
| 影响 | 无法针对 opp 招式类型差异化 preemptiveBonus |
| 未来补法 | 1) `#buildSituation` 里从 opp 的 committed state 查当前 attackProfile；2) `#scoreAttack` 的 startupFactor 改成和 opp startupMs 比，不是只和自己最快招比 |

### 缺口 B2：没有 defensePreferences

| 项 | 说明 |
|----|------|
| 现状 | `aiProfile` 只有 `attackPreferences`（per-attack 乘数），没有 per-defense-state 偏好 |
| 想让 AI 做到 | Rabble 偏好 parry 而弱 guard（parry 成功后立即进攻）|
| 影响 | Rabble 的"精于防反"只能靠 `baseDefense` 拉整体防御意愿，无法让 parry 比 guard 分更高 |
| 未来补法 | `aiProfile.defensePreferences: {guard_low:1.0, guard_high:0.6, parry:1.8}` + `#scoreDefense` 末尾乘入（和 attackPreferences 对称） |

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
2. **B1（opp 招式区分）** — 中等改动。需要 Situation 加字段 + scoreAttack 改 startupFactor 公式。如果发现"preemptive 对 opp 轻击也想抢"是个问题，再补
3. **B3（positioning 侧移）** — 大改，涉及 movement 系统。最后考虑