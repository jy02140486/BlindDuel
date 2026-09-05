# AI 战斗决策强化计划

> 目标：把 AI 从「距离分段 + 随机选招」升级为「感知局面 → 评估行动价值 → 选择最佳动作」
> 相关文档：`plans/AI Combat Decision Guidelines.md`（设计原则）、`PROJECT_CONTEXT.md`（项目概况）

---

## 1. 当前状态

### 已具备
- 每个角色的攻击/闪避/格挡知识档案（AIKnowledgeRegistry 扫描状态图和碰撞数据自动生成）
- 攻击 timing（startup / active / recovery）、range、displacement
- 状态图暴露 currentStateName / stateEnterTick / normalizedTime / frameIndex
- ContactResolver 作为唯一战斗规则权威（guard 克制矩阵、dodge 全免疫、clash 规则）
- AIController 持有 opponent 引用，每 100ms 决策一次

### 缺失
- AI 不读取 opponent 的知识档案
- AI 不感知 opponent 当前状态和攻击阶段
- AI 不评估行动 utility，只按距离分段 + 随机
- AI 不区分 self vulnerability / opponent vulnerability
- AI 没有动作 commitment 机制

---

## 2. 核心架构原则

### 2.1 三层分离
```
Knowledge（知识库）  → 描述"角色能做什么"
Rules（战斗规则）    → 定义"动作交互实际产生什么结果"
Decision（决策层）   → 决定"当前局面应该做什么"
```
### 2.2 Knowledge 只存属性，不存规则
- Knowledge Base 存 `guardType: "guard" | "shield"`、`dodgeActive: true`、攻击 trajectory/weight/timing/range 等属性
- 规则判定（"guard 能不能防 thrust"）**不**存在 KB 里，由 ContactResolver 唯一持有
- AI 通过 CombatSystem 提供的查询接口获取规则判定结果，不自己重实现

### 2.3 Combat Situation 是决策唯一输入
AI 不直接遍历或硬编码规则表，而是先构造当前 Combat Situation，再基于 Situation 计算每个可选动作的 utility。

---

## 3. 模块职责

### 3.1 AIKnowledgeRegistry（已具备，已扩展 dodges/guards）
输出：每个角色的知识档案
- attacks[]：每个攻击的 timing / range / displacement / trajectory / weight / frameSpeeds
- dodges[]：每个闪避的 timing.totalMs / displacement / invincible
- guards[]：每个格挡的 timing.totalMs / guardType / canParry / displacement

### 3.2 CombatSystem 查询接口（新增）
为 AI 提供规则查询，确保和 ContactResolver 判定一致。

AI 需要**双向查询**：
- 我的攻击对他怎么样？（我的 thrust → 他的 guard 防不防）
- 他的攻击对我怎么样？（他的 swing → 我的 dodge 闪不闪）

建议接口形态：
```
queryInteraction(offenseSummary, defenseSummary) → InteractionResult
```
`offenseSummary` 包含攻击的 trajectory / weight / stateName；`defenseSummary` 包含 defense 方的 guardType / dodgeActive / canParry。由 ContactResolver 的规则逻辑直接判定。

**关键：API 不局限于"防御查询"这一单一场景，而是泛化为动作交互评估。规则逻辑只在 ContactResolver 里写一份，查询接口是它的薄包装。**

### 3.3 AIPerception（AIController 内部模块）
构造 Combat Situation，每轮决策前采集一次。

采集内容：
- self 当前状态、normalizedTime、是否在执行攻击/防御动作、是否有 command 在队列
- self KB profile（attacks / dodges / guards）
- opponent 当前状态、normalizedTime
- opponent KB profile
- self→opponent 距离
- self hp / opponent hp（后续）

### 3.4 Combat Situation 构造
从感知数据和 KB 计算以下**派生量**：

- opponent 攻击阶段（startup / active / recovery / none）—— 从 stateEnterTick + normalizedTime + KB timing 算出
- **opponent threat** —— 不是固定映射，而是以下因素的综合函数：
  - attack phase（active 时威胁最高，startup 时可反制，recovery 时威胁降为零）
  - geometric reach（attack.maxReach vs 当前距离，距离 > reach 即使 active 也无威胁）
  - remaining time（active 剩余时间越少、startup 剩余时间越多，威胁维度不同）
  - self 当前状态（self 正在 recovery/startup 不可响应时 threat 被放大）
  - facing（方向对不对）
- **self vulnerability** —— 不是"idle = vulnerable"这种二元判断，而是综合评估：
  - 是否处于 opponent 有效威胁覆盖范围（几何 + reach）
  - 是否已有防御动作生效（guardActive / dodgeActive）
  - 是否有足够时间进入防御（对手攻击 remainingMs vs 我动作 startupMs）
  - 是否处于自身 recovery / startup 等不可响应窗口
- **opponent vulnerability** —— opponent 是否处于可被 punish 的窗口：
  - recovery 阶段剩余时间 × 可攻击距离 × 我能否及时进入攻击
- self 在当前距离下哪些 attack 在 range 内

### 3.5 Utility 评估
对每个可选动作（self 的 attacks + dodges + guards）计算一个 0~1 分数。

Utility 取决于（非穷举，实现阶段细化权重）：
- 距离 → attack range 是否可达，dodge/guard 不需要距离条件
- CombatSystem.queryInteraction → 我的动作对 opponent 当前状态的命中概率；opponent 动作对我当前防御的防护概率
- opponent threat + self vulnerability → 防御动作的收益；opponent vulnerability → 攻击动作的收益
- 时间可行性（多维度，不能简化为 startupMs ≤ remainingMs）：
  - attack range / facing / 距离 → 能不能到位
  - startupMs vs opponent remainingMs → 有没有窗口
  - attack active window 够不够覆盖到接触发生
  - 自身当前状态能不能在 opponent hit 前完成动作
- displacement / frameSpeeds → 位移对距离调整的影响

### 3.6 Action Selection
utility 最高者当选。加轻微随机扰动（继承当前 reactionVariance 设计）避免完全可预测。

### 3.7 Action Commitment
AI 选定动作后，进入 commitment：在动作执行期间（self 当前状态 !== idle/move）跳过决策循环。

Commitment **第一版只被以下硬中断打破**：
- Hit（被击中）
- Clash（拼刀）
- Death
- 状态图强制 transition

动作执行完毕自动回到 idle / move 后，下一次决策触发周期（100ms 后）正常 re-evaluate。

**明确不做：** opponent 状态变化（例如从 startup 进入 recovery）不强制打破 commitment，否则 AI 容易每 100ms 重新评分、行为跳变。反击窗口由下一次正常决策发现。

---

## 4. 数据流总览
```
每 100ms（决策触发）
  ↓
AIPerception 采集 self + opponent 状态
  ↓
读取双方 KB Profile
  ↓
构造 Combat Situation
  ↓
遍历 self 的所有 attacks + dodges + guards
  ↓
对每个动作：调用 CombatSystem.queryInteraction（规则查询）+ 距离/时机/可行性评估
  ↓
得到 Utility[]
  ↓
选最高分动作（+ 轻微扰动）
  ↓
commit: queueCommand(stateName) + 跳过后续决策直到动作结束
```
---

## 5. 阶段划分（从简单到复杂）

### Phase 1：基础局面感知 + Utility 选招
- 读取 opponent KB profile
- 感知 opponent 当前状态 + 攻击阶段
- Utility 评分替代纯随机
- Action commitment

Phase 1 完成后 AI 能：
- 识别对手在起手 → 选 dodge 或 guard 或抢先攻击
- 识别对手在 recovery → 选 punish 攻击
- 识别对手在 active → 选 dodge 或 guard
- 根据距离选在 range 内的攻击

### Phase 2：规则查询接口 + 克制关系利用
- CombatSystem 暴露 queryInteraction 接口，支持双向查询
- Utility 中考虑"我的 thrust 会不会被他的 guard 防住"（attack utility 加权）
- Utility 中考虑"他的 thrust 我的 dodge 能不能闪"（defense utility 加权）
- canParry 收益权重（guard + parryBonus 反击 window）

Phase 2 完成后 AI 会：
- 对手是 guardType="guard" 时更倾向出 thrust（防不住）
- 对手是 guardType="shield" 时避开 heavy slash（能防）
- 自己有 canParry 的 guard 时，guard 有预命中收益

### Phase 3：血量 + 风险容忍
- 纳入双方 hp
- 低血量时提高防御 utility、降低冒险攻击 utility
- 对手残血时提高攻击 utility

### Phase 4（可选）：更复杂的 Intent 分层
- Situation → Intent（Attack / Defend / Punish / Disengage / Wait）→ Action
- 避免大量 if/else，让 Intent 层做粗分类、Action 层做精细选择

---

## 6. 非目标（本阶段不做）

- 学习玩家历史行为 / 习惯模式
- 多人对战 / 非一对一场景
- 修改 ContactResolver 里已有的任何战斗规则
- 改变状态图定义或 animation clip
- 引入新的动作类型（当前已有 attack / dodge / guard 足够）

---

## 7. 关键约束

1. **永远不**在 Decision 层硬编码具体克制规则，所有规则判定走 CombatSystem 查询接口
2. **永远不**让 AI 每帧重决策——commitment 必须保持至少一个动作生命周期
3. Knowledge 扩展（dodges / guards 字段刚加上）必须保持向后兼容，已有的 attacks 字段结构不变
4. 新增文件优先，但核心改动集中在 AIController 和 CombatSystem 查询接口两处