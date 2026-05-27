# Character 解耦与 NPC 轻量化概要设计

## 1. 背景与目标
当前 `Character` 承担了战斗与非战斗的混合职责。进入 NPC/任务/交换开发前，需要先把战斗能力从通用角色能力中拆开。

目标：
- 让 NPC 只依赖 `动画 + 移动 (+交互)` 即可运行。
- 战斗能力改为可选模块，不再是角色默认能力。
- 不破坏现有 `Explore -> Battle` 主流程。

## 2. 设计原则
- 逻辑平面继续使用统一 `x/y`。
- 基础角色能力默认可复用；战斗能力按需挂载。
- 先做“最小解耦”，避免一次性大重构。

## 3. 能力分层

### 3.1 基础层（所有角色可用）
- `Transform/Move`: 位置、速度、朝向、移动约束。
- `Animation`: 统一动画能力接口，但允许不同 driver 实现。
- `Interaction`: 对话、任务触发、物品交换入口。

### 3.2 战斗层（仅战斗单位）
- `CombatComponent`（建议新建）
  - 攻击/受击状态
  - 命中判定数据
  - 生命值/硬直/无敌
  - 战斗输入命令处理（如 guard/thrust）

### 3.3 NPC 层（仅 NPC）
- `NpcBehaviorComponent`（可后续）
  - 巡逻/待机/朝向玩家
  - 对话条件与任务节点
  - 交换规则入口

## 4. 动画驱动分层
- `Animation` 是统一能力，不强制所有实体共用同一套动画状态机。
- 对外接口保持统一，例如：

```js
entity.animation.setState("idle");
entity.animation.update(dtMs);
entity.animation.getState?.();
```

- 战斗角色使用 `CombatAnimationDriver`
  - 保留现有复杂动画逻辑
  - 处理攻击、受击、切招、状态衔接
- NPC 使用 `NpcAnimationDriver`
  - 每个状态对应 spritesheet 中固定一帧
  - 状态内持续显示该帧，不播放复杂序列
  - 只有外部事件通知时才切状态，例如 `idle -> talk -> idle`
- 这样 `Character` 只关心“实体有动画能力”，不关心内部动画控制复杂度。

## 5. 目标结构（概念）
- `Character` 只负责基础生命周期与组件容器。
- `CombatSystem` 只处理挂了 `CombatComponent` 的实体。
- `InteractionSystem` 处理可交互实体（NPC、物件、可触发器）。

## 6. 运行时装配策略
- 玩家（战斗角色）：`Move + Animation(CombatAnimationDriver) + Combat + Interaction(可选)`
- NPC（非战斗）：`Move + Animation(NpcAnimationDriver) + Interaction`
- 物件（可交互但不移动）：`Interaction`

## 7. NPC 资源与碰撞约束
- NPC 不需要战斗碰撞资源。
- NPC 资源第一版只包含：
  - 动画帧 / spritesheet
  - root motion 数据
- NPC 不接入 `CollisionMask`、`PushBox`、战斗 hit/hurt box 等战斗相关资源。
- NPC 的基础碰撞使用以 root 点为中心、固定尺寸的外接矩形（AABB），尺寸由 `scripts/tools/extract_rootmotion_occupancy.ps1` 输出。
- 这样可以复用现有简单移动/阻挡检查，不额外引入战斗碰撞体系。

## 8. 兼容与迁移策略（最小改动）

### Phase A：抽离接口，不改行为
- 在 `Character` 内部把战斗相关字段集中到 `combat` 子对象（或独立组件占位）。
- 保留原有外部调用路径，避免立即改全局。

### Phase B：系统按能力过滤
- `CombatSystem` 改为仅处理具备 `CombatComponent` 的实体。
- `PlayerController` 在战斗输入分支前增加能力检查。

### Phase C：引入 NPC 原型
- 新建 NPC 实体工厂分支：不挂战斗组件。
- 先验证移动与动画链路，再接入交互。
- NPC 动画使用轻量状态帧驱动，不接入战斗角色复杂状态机。
- NPC 碰撞使用 root motion 圆的外接矩形，不接入战斗碰撞数据。

### Phase D：清理耦合入口
- 去除 `Character` 中直接战斗状态机逻辑（迁到 Combat 组件/系统）。
- 将任务/交换逻辑放入 Interaction/NPC 相关组件。

## 9. 接口草案

```js
// 仅示意
entity.has("combat")
entity.get("combat")

entity.has("interaction")
entity.get("interaction")
```

```js
// animation 统一接口示意
entity.animation.setState("idle")
entity.animation.update(dtMs)
```

```js
// CombatSystem update 示例
for (const e of entities) {
  if (!e.has("combat")) continue;
  updateCombat(e);
}
```

## 10. 风险与规避
- 风险：老代码默认“所有角色可战斗”。
  - 规避：过渡期保留默认装配给玩家与现有敌人；NPC 明确走新工厂。
- 风险：控制器直接读写 `Character` 战斗字段。
  - 规避：先做适配层（getter/setter），后续再替换调用点。
- 风险：动画系统默认“所有角色共用同一套复杂状态机”。
  - 规避：统一接口，分离 driver；NPC 只实现轻量状态帧切换。
- 风险：NPC 误接入战斗碰撞资源，导致资源和逻辑都变重。
  - 规避：NPC 第一版只读取动画帧与 root motion，碰撞统一退化为以 root 点为中心的固定尺寸 AABB。
- 风险：战斗回归。
  - 规避：每阶段后跑 `Explore -> Battle -> Explore` 冒烟回归。

## 11. 验收标准
- NPC 可在探索态正常移动、播放动画、触发交互。
- NPC 不参与 `CombatSystem` 更新与命中判定。
- NPC 可使用“单帧状态动画”而不依赖战斗状态机。
- NPC 仅依赖动画帧与 root motion 资源即可工作。
- NPC 基础碰撞可由 root motion 圆的外接矩形完成。
- 玩家与现有战斗单位行为不回归。
- 任务/交换功能可在不接触战斗模块的情况下接入。

## 12. 本轮建议先做
- 先完成 Phase A + Phase B。
- Phase C 只做一个最小 NPC（待机+移动+对话触发）。
- 通过后再做任务和交换扩展。

## 13. Phase 编号映射（Overview ↔ Tasklist）

| Overview | Tasklist | 内容 |
|----------|----------|------|
| Phase A | Phase 1 + 2 | 抽离接口（能力开关 + 战斗数据收口） |
| Phase B | Phase 3 + 4 | 系统按能力过滤（CombatSystem 过滤 + 控制器防护） |
| Phase C | Phase 5 + 6 | 引入 NPC 原型（装配分流 + 最小验证） |
| Phase D | Phase 7 + 8 | 清理耦合入口（Interaction 预留 + Character 清理） |

> 注：Tasklist Phase 4（控制器防护）已标记为跳过，异常直接暴露。Phase B 仅 Phase 3 有效。
