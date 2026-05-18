# TimeControl 重构说明（Character / Component / System）

## 1. 目标与背景

当前问题本质：`hitstop` 是“外部时间控制事件”，不应与 `Character` 状态机推进逻辑深度耦合。  
重构目标是把“时间控制”抽离为通用层，避免 `guard -> hit -> clash` 这类由时序耦合导致的误判。

---

## 2. 核心设计原则

1. 时间与语义分离  
- `TimeControl` 只负责“时间怎么流动”。  
- `Character/Combat` 只负责“规则怎么判定、状态怎么转移”。

2. 组件存数据，系统执行业务  
- `TimeControlComponent` 只存可序列化状态。  
- `TimeControlSystem` 负责每帧结算与输出有效时间。

3. 先角色内落地，再逐步泛化  
- 第一阶段先给 `Character` 使用。  
- 结构保持可复用，后续可给投射物、特效、AI Agent 等挂载。

---

## 3. 职责划分

## 3.1 Character（玩法语义层）

负责：
- 状态机推进（idle/guard/hit/clash/attack...）。
- 指令缓冲、招式派生、窗口判定（如 `clash -> zornhut`）。
- 读取“有效时间”推进自身逻辑（而不是直接看 raw delta）。

不负责：
- 计算 hitstop 倒计时。
- 决定冻结/慢放叠加规则。

---

## 3.2 TimeControlComponent（时间数据层）

建议只存“时间控制事实”：
- `timeScale`（默认 1.0）
- `freezeFrames`（或 `stopFrames`）
- `modifiers[]`（可选，支持优先级/来源）
- `lastReason` / `lastSourceId`（可选调试字段）

可选输出缓存：
- `effectiveScale`
- `effectiveDelta`
- `isFrozen`

不应存：
- 招式派生规则
- 状态跳转条件
- 指令语义

---

## 3.3 TimeControlSystem（时间结算层）

负责：
- 每逻辑帧更新 `freezeFrames`/modifier 生命周期。
- 按规则计算 `effectiveScale`。
- 产出并回写 `effectiveDelta/effectiveTicks`（供 Character/Animation/TimedTag 使用）。
- 对外提供 API（例如 `applyHitstop(entity, frames, reason, source)`）。

不负责：
- 直接改角色状态（如强制切到 clash/hit）。
- 判定招式命中关系。

---

## 4. 交互流程（推荐）

1. `CombatSystem` 命中/格挡/拼刀判定成功。  
2. `CombatSystem` 只发时间控制请求：  
   - `TimeControlSystem.applyHitstop(attacker, x, "hit")`  
   - `TimeControlSystem.applyHitstop(defender, y, "guard")`
3. `TimeControlSystem` 在固定帧更新时结算有效时间。  
4. `Character.update(effectiveDelta)` 用有效时间推进状态机与派生窗口。  
5. `TimedTags`（如派生窗口）按配置决定是否在冻结中倒计时。

要点：`Character` 不再直接维护 hitstop 计数，统一由时间系统提供时钟。

---

## 5. 命名建议

- 机制层：`TimeControl`（更通用）  
- 具体效果：`Hitstop`（`timeScale = 0` 持续 N 帧）  

这样未来扩展不会冲突：
- `SlowMotion`（`timeScale = 0.2`）
- `SuperFreeze`（高优先级全局/局部冻结）

---

## 6. 一般性（通用性）如何保证

1. 规则无角色特化字段  
- 组件字段避免 `guardOnly/parryOnly` 这类玩法语义。

2. API 用“请求”而非“状态写死”  
- 例如 `applyHitstop(entityId, frames, reason, priority)`，而不是 `setCharacterGuardFreeze(...)`。

3. 统一时间入口  
- 所有需要受时间影响的模块都读 `effectiveDelta`，避免各模块私算冻结逻辑。

4. 可扩展优先级策略  
- 新请求到来时支持 `override/add/max` 策略，避免硬编码。

5. 调试上下文与玩法语义解耦  
- 可记录 `reason/sourceAttackId`，但仅用于观测或条件分流，不承载派生规则。

---

## 7. 与招式派生（clash -> zornhut）的关系

建议做法：
- 派生窗口仍由 `Character/Combat` 或 `TimedTags` 管理。  
- `TimeControl` 仅提供“窗口是否消耗时间”的统一时钟。  

例如：
- clash 时同时触发：  
  - `applyHitstop(...)`  
  - `addTimedTag("clash_zornhut_window", duration, pauseOnFreeze=true)`

这能确保冻结期间窗口不被错误消耗，同时避免派生逻辑散落到时间系统。

---

## 8. 分阶段落地建议

1. 第一步（最小改造）  
- 新增 `TimeControlComponent` 与 `TimeControlSystem`。  
- 把现有 hitstop 计数从 `Character`/`Combat` 挪到系统。

2. 第二步（时钟统一）  
- `Character`、动画组件、TimedTags 改为统一读取 `effectiveDelta`。

3. 第三步（规则收敛）  
- Combat 仅发 `applyHitstop` 请求，不再直接操作冻结字段。  
- 验证 `guard -> hit -> clash` 误入问题是否消失。

4. 第四步（可选增强）  
- 增加 `timeScale` 非 1/0 支持。  
- 增加策略（叠加/取最大/覆盖）和调试可视化。

---

## 9. 一句话结论

`TimeControl` 应该是“通用时钟控制层”，`Character` 应该是“玩法语义层”；  
两者通过 `effectiveDelta` 与事件请求耦合，而不是互相持有对方规则。

---

## 10. 当前进度（2026-05）

1. 已完成第一步（搬家不改行为）
- 新增 `TimeControlComponent` 与 `TimeControlSystem`。
- 将 hitstop / impact / blockstun / hitstun 数据与结算迁入 TimeControl。

2. 已完成第二步（统一时间入口）
- `Character.fixedUpdate` 改为消费 `TimeControlSystem.tick()` 返回的帧结果（含 `effectiveDeltaMs`）。
- 动画推进、状态推进、TimedTags 倒计时统一按时间控制结果执行。

3. 已完成第三步（规则收敛）
- `CombatSystem` 不再直接判断 `target.impactContext`，只通过接口请求时间控制。
- hitstop 在 impact 期间是否生效，由 `TimeControlSystem` 内部决定。

4. 已完成补丁（生命周期守卫）
- `ImpactContext` 增加 `expectedStateAtResolve`、`stateEntrySerialAtCreate`、`startTick`。
- `impact` 到期时仅在状态守卫通过时才执行 `nextState`，否则跳过并记录 `skip stale impact transition`。

5. 已完成补丁（同一攻击实例唯一结果）
- `ContactResolver` 增加短路规则：同一 `attackInstanceId -> targetId` 一旦已有 `hit`，后续 guard/parry 不再覆盖结果。
- 规则注释已写入代码，便于后续维护和测试对齐。
