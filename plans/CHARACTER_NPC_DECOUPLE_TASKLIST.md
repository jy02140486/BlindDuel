# Character 解耦与 NPC 轻量化任务清单

## 目标
- 将 `Character` 从“默认战斗角色”调整为“可组合基础实体”。
- 让 NPC 只依赖 `移动 + 动画 + 交互` 即可工作。
- 保持现有玩家/敌人的战斗链路不回归。

## 实施原则
- 先做最小解耦，不一次性重写全部系统。
- 优先保留现有外部调用路径，减少连锁修改。
- 每一阶段完成后都做 `Explore -> Battle -> Explore` 冒烟回归。
- `Animation` 只要求统一对外接口，不要求 NPC 与战斗角色共用同一套内部状态机。
- NPC 第一版不接入战斗碰撞资源。

## 动画补充约束
- 战斗角色继续使用现有复杂动画逻辑。
- NPC 使用轻量动画 driver：
  - 每个状态对应 spritesheet 中固定一帧
  - 状态内持续显示该帧
  - 仅在外部事件通知时切换状态
- 建议统一接口：

```js
entity.animation.setState("idle");
entity.animation.update(dtMs);
entity.animation.getState?.();
```

- 推荐实现拆分：
  - `CombatAnimationDriver`
  - `NpcAnimationDriver`

## NPC 资源与碰撞约束
- NPC 只提供：
  - 动画帧 / spritesheet
  - root motion 数据
- NPC 不需要：
  - `CollisionMask`
  - `PushBox`
  - hitbox / hurtbox
  - 其他战斗碰撞资源
- NPC 的基础碰撞直接使用 root motion 圆形占位的外接矩形（AABB）。
- 如果当前系统里没有现成“圆”，可以直接把 root motion 对应的站位半径写成 `radius`，再推导 AABB。

## Phase 1：建立能力开关
- 给实体增加统一能力判断接口。
- 目标接口：

```js
entity.has("combat");
entity.has("interaction");
entity.get("combat");
entity.get("interaction");
```

- 若当前项目还没有通用组件容器，可先用最小兼容做法：

```js
entity.capabilities = {
  combat: true,
  interaction: false
};
```

- 验收：
  - 玩家和现有敌人默认 `combat=true`
  - 不改现有行为，仅补能力读取入口

## Phase 2：战斗数据收口
- 把 `Character` 内战斗相关字段集中到 `combat` 子对象，或 `CombatComponent` 占位对象。
- 第一阶段不要急着删旧字段，可以保留兼容映射。
- 需要收口的典型内容：
  - 攻击/受击状态
  - 命中判定数据
  - 生命值/硬直/无敌
  - 战斗命令缓存

- 推荐过渡写法：

```js
entity.combat = {
  hp: ...,
  hurtState: ...,
  hitboxes: ...,
  hurtboxes: ...
};
```

- 验收：
  - 现有战斗角色仍能正常攻击、受击、切状态
  - 外部逻辑即使还在读旧字段，也不会立刻崩

## Phase 3：CombatSystem 按能力过滤
- 修改 `CombatSystem`，只处理具备 `combat` 能力的实体。
- 命中检测、受击更新、战斗状态推进都要加过滤。

```js
for (const entity of entities) {
  if (!entity.has("combat")) continue;
  updateCombat(entity, dtMs);
}
```

- 验收：
  - NPC/非战斗实体不会进入战斗更新
  - 玩家与现有敌人的战斗行为保持原样

## Phase 4：控制器加防护
- 修改 `PlayerController`、`AIController`、其他会发战斗命令的入口。
- 在发送或执行战斗命令前检查 `has("combat")`。
- 非战斗实体遇到战斗命令时应直接跳过，而不是报错。

- 验收：
  - 非战斗实体不会因为缺少战斗字段而异常
  - 玩家和敌人控制器不受影响

## Phase 5：实体装配分流
- 保留现有玩家/敌人工厂逻辑，但显式挂 `combat`。
- 新增 NPC 装配路径，不挂 `combat`，只挂：
  - `move`
  - `animation`（使用 `NpcAnimationDriver`）
  - `interaction`
- NPC 碰撞数据不要走战斗资源读取。
- NPC 直接配置一个 root motion 站位半径，或从 root motion 数据中推导 AABB。

- 推荐结果：

```js
// player / enemy
capabilities = { combat: true, interaction: maybe }

// npc
capabilities = { combat: false, interaction: true }
```

- 验收：
  - 可以创建一个不带战斗能力的 NPC 实体
  - 该 NPC 仍能正常显示、移动、播放动画
  - 该 NPC 的动画不依赖战斗状态机
  - 该 NPC 的阻挡检查可由 AABB 完成

## Phase 6：最小 NPC 验证
- 做一个最小 NPC 样例：
  - 待机动画
  - 简单移动或原地朝向
  - 基础交互触发
  - 至少 1 次外部事件驱动的状态切换（例如 `idle -> talk -> idle`）
- 可额外验证你当前想做的 greeting 逻辑：
  - 默认 `idle`
  - 玩家靠近时切到 `greeting`
  - `2s` 后回到 `idle`

- 本阶段不做复杂任务树，只做“能被识别并交互”的最小闭环。

- 验收：
  - NPC 出现在探索态
  - 不被 `CombatSystem` 命中或驱动
  - 可触发一次简单交互
  - 可通过外部事件切换到另一张单帧状态并保持
  - 使用 root motion AABB 参与简单阻挡检查

## Phase 7：Interaction 能力预留
- 如果当前还没有完整 `InteractionSystem`，先预留最小接口：

```js
entity.interaction = {
  type: "npc",
  prompt: "Talk",
  onInteract: ...
};
```

- 目标不是本轮做完整任务系统，而是为后续任务/交换保留稳定入口。

- 验收：
  - 交互逻辑不依赖 `combat`
  - 后续可在不修改 `CombatSystem` 的情况下扩展任务与交换

## Phase 8：清理 Character 直连战斗逻辑
- 当以上阶段稳定后，再逐步移除 `Character` 里直接耦合的战斗实现。
- 清理方向：
  - `Character` 不再默认假设自己可战斗
  - 战斗字段访问尽量改为 `entity.get("combat")`
  - 任务/交换逻辑不进入 `Character` 战斗分支

- 验收：
  - `Character` 更接近“基础实体容器”
  - 战斗与非战斗扩展边界清晰

## 建议优先关注的文件
- `scripts/Enties/CharacterBase.js`
- `scripts/Enties/CombatCharacter.js`
- `scripts/Enties/NpcCharacter.js`
- `scripts/CharacterFactory.js`
- `scripts/Components/NpcFrameComponent.js`
- `scripts/Systems/CombatSystem.js`
- `scripts/Systems/NpcController.js`
- `scripts/Systems/PlayerController.js`
- `scripts/Systems/AIController.js`
- `scripts/Systems/GameModeManager.js`
- `scripts/Systems/Modes/ExploreMode.js`
- `scripts/Systems/Modes/BattleMode.js`

---

## 当前进度（2026-05-27）

### Phase 1：能力开关 ✅
- `CharacterBase` 含有 `capabilities = { combat, interaction }`，通过 `config.capabilities` 注入。

### Phase 2：战斗数据收口 ✅
- 原 `Character` 拆为 `CharacterBase`（基础实体）+ `CombatCharacter`（战斗角色）+ `NpcCharacter`（NPC 实体）。
- `CombatCharacter` 持有 `this.combat` 子对象（globalCooldown、lastActionTime 等）。

### Phase 3：CombatSystem 按能力过滤 ✅
- `CombatSystem` 仅处理 `capabilities.combat === true` 的实体。

### Phase 4：控制器防护 ⏭️（跳过）
- 决定不添加，让异常直接暴露。

### Phase 5：实体装配分流 ✅
- `CharacterFactory` 提供三条装配路径：
  - `createHeroCharacter` → `CombatCharacter`
  - `createRabbleStickCharacter` → `CombatCharacter`
  - `createNpcCharacter` → `NpcCharacter`（capabilities: combat=false, interaction=true）

### Phase 6：最小 NPC 验证 ✅
- NPC 创建并接入 `Scene` / `ExploreMode`：
  - `idle` / `greeting` 两态状态图
  - `NpcController` 实现玩家接近→ greeting（2s）→ 回到 idle
  - `NpcFrameComponent` 实现单帧状态动画（非战斗帧动画）
  - NPC 不接入 `CollisionComponent`（collision=null）
  - NPC 使用 rootMotion 数据计算锚点

### 已完成文件清单

| 操作 | 文件 |
|------|------|
| 新建 | `scripts/Enties/CharacterBase.js` |
| 新建 | `scripts/Enties/CombatCharacter.js`（原 Character.js 改名） |
| 删除 | `scripts/Enties/Character.js` |
| 新建 | `scripts/Enties/NpcCharacter.js` |
| 新建 | `scripts/Components/NpcFrameComponent.js` |
| 新建 | `scripts/Systems/NpcController.js` |
| 修改 | `scripts/CharacterFactory.js` |
| 修改 | `scripts/AssetManifest.js` |
| 修改 | `scripts/Scene.js` |
| 修改 | `scripts/Systems/CombatSystem.js` |
| 修改 | `scripts/Systems/Modes/ExploreMode.js` |
| 修改 | 外部 import `Character` → `CombatCharacter` 的所有文件 |

### 已知问题
- `NpcCharacter._getCurrentRootAnchor` 默认返回帧中心（`cx: w/2, cy: h`），与 hero 锚点（collider 定义的 cy≈117/128，近底部）不在同一约定。导致 Y-sort 时若直接用 `root.position.y` 会出现视觉脚底排序偏差。临时方案：`Scene.updateRender` 中通过 `getVisualBottomY()` 统一计算真实脚底位置做排序。
- NPC 正常装配后状态机默认需要资源更新（spritesheet、atlas、rootMotion），当前资源目录已就位。

## 对免费 AI 的实现约束
- 不要一次性重写 `Character`
- 先加能力判断与兼容层，再迁移系统过滤
- 不要破坏现有 `Explore -> Battle -> Explore` 流程
- NPC 第一版不要接入战斗字段
- NPC 第一版不要接入战斗角色复杂动画状态机
- 动画只统一外部接口，不强求统一内部实现
- NPC 第一版只使用动画帧和 root motion 资源
- NPC 基础碰撞直接使用 root motion 圆的外接矩形（AABB）
- 若发现控制器或系统默认“所有角色都能战斗”，优先加守卫，不要硬删旧逻辑

## 每阶段回归检查
- 玩家可进入战斗、攻击、受击、退出战斗
- 现有敌人行为无明显回归
- NPC 不参与战斗判定
- NPC 可在探索态正常播放动画和移动
- NPC 可通过外部事件稳定切换单帧状态
- NPC 的 AABB 阻挡检查正常

## 本轮最小交付目标
- 完成 `Phase 1` 到 `Phase 5`
- 至少造出 1 个不带战斗能力的 NPC 实体
- NPC 资源只依赖动画帧和 root motion
- NPC 碰撞可由 root motion 外接矩形支撑
- 不要求本轮完成完整任务系统或交易系统
