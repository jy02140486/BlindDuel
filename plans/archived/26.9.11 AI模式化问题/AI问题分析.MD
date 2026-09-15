# AI 决策模式化问题 — 讨论稿

## 背景

在为 RabbleStick 加入 dash（冲刺）招式、调试 AI 选择逻辑的过程中，发现当前 Utility-based 决策机制存在系统性模式化倾向。主要观察：

1. AI 从远处逼近时总是先出 swing（reach 最大），贴脸时才会用 dash
2. 玩家持续远距离 parry swing，AI 不会因连续被 parry 而换招，继续 swing 直到冷却
3. 多个攻击距离评分接近时，每次决策独立随机，没有行为惯性
4. 攻击启动速度（startupMs）只在对手 startup 阶段用于 preemptiveBonus，日常对决不参与评分

---

## 核心问题：三个设计缺口

### 缺口 1：距离二元门控（影响最大）

```javascript
// AIController.js:305
if (sit.distance > effectiveRange) return 0;  // 硬门槛，一刀切
let score = this.tuning.attack.baseWeight;    // 达标瞬间拿满分
```
- 距离刚好差 0.01 world unit，分数从 0 跳到 0.4 → **112.5 倍分差**
- AI 有极端清晰的"到达点"触发行为，不是渐进决策
- effectiveRange = maxReach(weaponbox) + fwdBoost(frameSpeeds) + rangeBuffer(0.2)
- 当前角色 reach 排序固定：swing(2.67) > thrust(2.56) > dash(1.81)，加 fwdBoost 后差距缩小但 swing 仍始终第一个达标

### 缺口 2：无记忆随机扰动 + 无粘性

```javascript
// AIController.js:158-159
for (const entry of scored) {
    entry.score *= (1 + (Math.random() - 0.5) * this.reactionVariance); // ±7.5%
}
```
- 每次 100ms 决策独立随机，没有"上招用了 XX"的状态粘性
- 评分差 < 0.1 时完全靠运气，玩家无法建立行为预期
- committed=true 跳过决策，所以实际选了就执行，但**选哪招**还是随机

### 缺口 3：无反馈闭环（最严重）

AI 没有任何行为历史追踪。搜遍 AIController.js：

- 没有 `history[]`、没有 `lastResult`、没有 `consecutiveParryCount`
- `interaction.parryable` 只评估"玩家当前 guard 能不能 parry"，不追踪"我上一招刚被 parry 了"
- 被连续 parry/miss/guard_block 后不吸取教训，继续同样的招

应该发生的：

| 场景 | 预期行为 | 当前行为 |
|---|---|---|
| 连续被 parry 2 次 | 换 dash 缩短距离换节奏 | 继续 swing |
| 连续 guard_block 3 次 | thrust（guard 防不住 thrust） | 继续 swing |
| 连续 miss（玩家躲开） | dash 贴脸 | 继续原距离 swing |
| 连续命中 2 次 | 保持节奏 | 冷却后随机换招 |

---

## 当前评分公式（简化版）

```javascript
score = baseWeight (0.4)
  - cooldownPenalty (0.5)           // 冷却中
  - interaction:
      ├ missPenalty (0.6)          // 被 guard 挡住
      ├ parryRiskPenalty (0.9)     // 可被 parry（更危险）
      └ guardLeakBonus (0.25)      // guard 防不住（抓漏洞）
  + vulnReward (0.4 × oppVuln)      // 对手 recovery/punish 窗口
  - threatPenalty (0.3 × oppThreat) // 对手 active + 在我 reach 内
  + preemptiveBonus (0.2)           // 仅 oppPhase=startup 时，我的 startup ≤ 对手剩余
  + rangeEdgeBonus (0.05)           // dist ≈ effR 时微加分
  // 无 slowStartupPenalty
  // 无 feedback 相关加减分
  // 无 continuityBonus（粘性）

score *= (1 + rand * 0.15)           // ±7.5% 随机扰动

if (score > 0.15) 执行；否则 fallback positioning
```
---

## 修复方向（按推荐顺序）

### L1 — 反馈闭环（根因修复）

- `AIController` 新增 `#history[]`（最近 5-10 条 `{stateName, result}`）
- `result` 由 CombatSystem 通过事件/回调传回（hit / parry / guard_block / miss）
- `#scoreAttack` 里根据历史调整：
  - 连续 2+ 次被 parry → **重罚** -0.3（"别再送分了"）
  - 连续 2+ 次 guard_block → 提示换 trajectory（slash→thrust 有 guardLeakBonus）
  - 连续 2+ 次命中 → **连续性加分** +0.1（强化成功行为）

### L2 — 距离平滑衰减

把硬门槛替换为平滑函数：

```javascript
// 替代 if (dist > effR) return 0;
const distFactor = Math.max(0, 1 - Math.max(0, dist - effR + 0.3) / 0.3);
score *= distFactor;
// 距离 ≥ effR+0.3 时归零；effR-0.3 到 effR+0.3 之间平滑
```
效果：AI 会"差不多到了就准备出招"，不是硬等到某一步才突然触发。

### L3 — 粘性 + 减少随机

- 上次选的 `stateName` 加 `continuityBonus: +0.05`
- `reactionVariance` 从 0.15 降到 0.08

效果：减少抖动，让评分主导选择，同时保留足够多样性。

---

---

## 模式化的价值（重要修正）

**模式化本身不是 bug，是可调节的设计旋钮。**

之前的"三个缺口"在特定场景下反而是优点：

| 缺口 | 在教学场景下（新角色登场 / 训练假人） | 在普通敌人场景下 |
|---|---|---|
| 距离硬门槛 | ✅ **保留** → 清晰触发点，让玩家学会预判 | ❌ 改平滑 |
| 无反馈闭环 | ✅ **保留** → 固定节奏让玩家反复练习 parry | ❌ 加反馈 |
| 无粘性随机 | ✅ 几乎固定 → 好教学，玩家能建立明确预期 | ❌ 加粘性 + 适度随机 |

问题只是**所有战斗共用同一套默认参数**，没有按场景/角色差异化。

---

## 修正后的设计方向：AI Personality Profile（模式化程度可调）

挂在角色 StateGraph JSON 上，AIController 构造时读取合并到 tuning。

```json
// RabbleStick.json 顶层
{
  "aiProfile": {
    "mode": "normal",
    "attackOverrides": { "swing": { "scoreBonus": 0.05 } }
  }
}
```

### 四档 mode 参数表

| 参数 | tutorial | normal | elite | boss |
|---|---|---|---|---|
| feedbackLoop | **OFF** | LIGHT（2次parry触发换招） | MEDIUM（2次，带惩罚） | HEAVY（每次都调整） |
| distanceSmoothWindow | **0（硬门槛）** | 0.3 | 0.5 | 0.8 |
| reactionVariance | **0.02**（几乎固定） | 0.08 | 0.15 | 0.25 |
| continuityBonus | **+0.15**（强化节奏） | +0.05 | 0 | **-0.08**（主动求变） |

### 每档设计意图

| mode | 谁用 | 期望体验 |
|---|---|---|
| **tutorial** | 新角色首次登场、训练假人 | 出招固定、触发点清晰、不会突然变招。让玩家学会"这个距离→这招→这样防" |
| **normal** | 普通小兵 | 有基本反馈（被 parry 几次后换招）、中等随机。玩家能摸清规律但不会太无聊 |
| **elite** | 精英敌人 | 距离平滑窗口大→会提前预判出招、反馈灵敏、随机较高。给玩家压力，不能硬套固定节奏 |
| **boss** | Boss | 高随机 + 粘性为负（反而主动求变）。永远不按套路出牌，持续施压 |

### 实现路径

1. StateGraph JSON 加 `aiProfile: { mode, attackOverrides? }`
2. AIController 构造时读取 mode → 查参数表 → 合并到 tuning
3. L1/L2/L3 三个改进**仅在 mode ≠ tutorial 时生效**
4. `attackOverrides` 允许角色级微调（比如 Rabble 的 swing +0.05 鼓励用 swing）

---

## 待讨论

- feedback 结果怎么从 CombatSystem 传给 AIController？目前没有现成事件机制
- 启动速度（startupMs）是否应该进入评分？"快招对慢招"的节奏差应该在 AI 决策里体现吗？
- distance smoothstep 的窗口宽度用 world unit 还是 character 为单位？
- tutorial 模式的节奏是否需要额外固定（比如强制前 N 招用 swing，引导玩家练习 parry）？
- attackOverrides 是否需要支持 trajectory 偏好（比如"这个角色偏好 thrust 而非 slash"）？