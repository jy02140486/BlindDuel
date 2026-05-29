# ExploreMode 数据索引与碰撞交互实施计划

## 目标
- 为探索模式建立稳定的数据组织方式。
- 先完成“实体注册 + 索引分组”的基础骨架。
- 再在该骨架上接入：
  - 探索移动
  - AABB 碰撞
  - walkArea 限制
  - NPC/对象交互
  - y 排序渲染

## 总体结论
- 这项工作应分成两大块，顺序不要反：
  1. 先把数据和索引建立好
  2. 再做碰撞、移动限制、交互和排序

原因：
- 如果没有统一实体池和模式索引，后面每加一个 NPC、障碍物或可交互物件，逻辑都要重复补分支。
- 先搭骨架，后续功能都能沿着同一套路接入。

## 第一块：数据与索引层

### 1.1 Scene 负责“总实体池”
- `Scene` 不直接做探索碰撞逻辑。
- `Scene` 只维护一个总实体池，作为统一注册入口。

建议形式：

```js
scene.entities = [];
```

或：

```js
scene.entityRegistry = new Map();
```

作用：
- 注册主角
- 注册 NPC
- 注册静态障碍物
- 注册将来可见物件

### 1.2 ExploreMode 负责“探索态索引”
- 探索模式不直接依赖“几个分散变量”。
- 进入 `ExploreMode` 时，从总实体池筛出探索态需要的索引。

建议至少维护这些列表：

```js
exploreMode.dynamicActors = [];
exploreMode.staticBlockers = [];
exploreMode.interactables = [];
exploreMode.renderables = [];
```

说明：
- `dynamicActors`
  - 当前会移动或可能被脚本驱动移动的实体
  - 例如：主角、被 sequencer 驱动的 NPC
- `staticBlockers`
  - 阻挡移动但通常不动的对象
  - 例如：静态障碍物、当前不动的 NPC
- `interactables`
  - 可对话、可触发、可交换的对象
- `renderables`
  - 参与探索态 y 排序和渲染顺序汇总的对象

### 1.3 最小数据约定
- 不要求所有对象继承同一个基类。
- 但建议遵守统一字段约定。

#### Actor 约定

```js
{
  id,
  kind,              // "player" | "npc" | "obstacle" | "prop"
  root,              // Babylon root node or logical root
  blocksMovement,    // true / false
  interactable,      // true / false
  visible            // true / false
}
```

#### Blocker 约定

```js
{
  id,
  blocksMovement: true,
  getAabb()
}
```

#### Interactable 约定

```js
{
  id,
  interactable: true,
  getInteractionRange?.(),
  onInteract?.()
}
```

#### Renderable 约定
- `renderable` 更适合作为接口约定，而不是基类。
- 任何对象只要提供以下字段/方法，就可以参与渲染汇总：

```js
{
  id,
  visible,
  sortY,
  renderNode
}
```

### 1.4 静态 / 动态分层
- 探索模式里通常只有主角在移动。
- 因此碰撞相关对象可以先分静态和动态。

目的：
- 减少每帧无意义检测
- 为将来 sequencer 驱动 NPC 移动预留空间

建议规则：
- 主角默认在 `dynamicActors`
- 静止 NPC 默认进 `staticBlockers`
- 若某 NPC 被脚本驱动移动，则临时进入 `dynamicActors`

### 1.5 renderables 总表怎么来
- `renderables` 不建议作为唯一真源长期手工维护。
- 更建议作为“探索态渲染视图”，由多个注册表汇总得到。

推荐做法：

```js
renderables.length = 0;
pushVisible(dynamicActors);
pushVisible(staticVisibleActors);
pushVisible(otherVisibleProps);
renderables.sort(bySortYThenTieBreak);
```

关键点：
- 碰撞分层可以静态/动态分开
- 但 y 排序必须把所有需要显示的对象一起排

## 第二块：行为与规则层

### 2.1 探索移动
- `ExploreMode` 负责读取玩家输入，计算主角意图移动。
- 然后把“尝试移动”交给探索碰撞系统处理。

建议不要让 `GameModeManager` 或 `Scene` 自己做几何检测。

### 2.2 探索碰撞系统
- 新增一个专门系统，例如：
  - `ExploreCollisionSystem`

职责：
- AABB 检测
- 移动修正
- walkArea 限制
- 空间查询（范围内对象、overlap 对象）

建议接口：

```js
resolveMovement(entity, desiredPos, blockers, walkArea)
queryNearby(entity, interactables, radius)
queryOverlaps(aabb, entities)
```

### 2.3 NPC 与障碍物的碰撞统一
- 第一版里，NPC 和静态障碍物可以统一按 `AABB blocker` 处理。
- 也就是说底层阻挡逻辑是一样的。

但不要丢掉语义区分：

```js
{
  id: "npc_01",
  kind: "npc",
  blocksMovement: true,
  interactable: true
}
```

```js
{
  id: "crate_01",
  kind: "obstacle",
  blocksMovement: true,
  interactable: false
}
```

结论：
- 阻挡逻辑可统一
- 交互语义不能混掉

### 2.4 walkArea 限制
- 主角最终位置要经过 `walkArea` clamp。
- 后续如引入坡区或局部限制，也在这一层扩展。

### 2.5 interaction 与碰撞的关系
- interaction 依赖空间关系，但不等于阻挡碰撞。
- 建议明确分成两类查询：

#### movement collision
- 判断能不能走过去
- 使用 blocker AABB

#### interaction query
- 判断是否在触发范围内
- 判断是否 overlap
- 判断是否最近 / 是否正前方

第一版建议：
- NPC 既有 `blockerAabb`
- 也有 `interactionRange`
- 玩家按交互键时，在 `interactables` 中做范围查询

### 2.6 y 排序渲染
- 排序要统一作用于所有探索态可见对象，不只是动态角色。
- 这包括：
  - 主角
  - NPC
  - 可见静态物件
  - 前景遮挡元素（若也参与排序）

建议：
- 每帧或 dirty 时重建/重排 `renderables`
- 按 `sortY` 排序，再写入对应的渲染顺序字段

## 实施顺序

### Phase 1：总实体池
- 在 `Scene` 里建立统一实体注册结构。
- 先把主角和已有可见角色接进去。

### Phase 2：ExploreMode 索引
- 在 `ExploreMode` 中建立：
  - `dynamicActors`
  - `staticBlockers`
  - `interactables`
  - `renderables`
- 实现从总实体池筛选生成这些索引。

### Phase 3：AABB blocker 接入
- 给障碍物与 NPC 提供统一 blocker 读取方式。
- NPC 第一版直接使用 root motion occupancy AABB。

### Phase 4：ExploreCollisionSystem
- 接入：
  - 移动修正
  - 阻挡检测
  - walkArea clamp

### Phase 5：interaction 查询
- 增加范围查询 / overlap 查询。
- 先完成 NPC 近距离交互。

### Phase 6：renderables 汇总与 y 排序
- 从探索态对象中汇总 `renderables`
- 实现统一排序

## 对免费 AI 的实现要求
- 先做数据结构，不要一上来就直接写碰撞逻辑。
- 不要继续沿用“hero / rabble / npc1 三四个变量到处 if”的方式。
- `Scene` 只持有总实体池，不直接承担探索碰撞职责。
- `ExploreMode` 持有探索态索引。
- 新增探索碰撞系统，而不是把几何检测硬塞进 `GameModeManager`。
- 第一版 NPC 与障碍物统一按 AABB blocker 处理。
- 但要保留 `kind`、`interactable`、`blocksMovement` 等语义字段。

## 最小验收标准
- 主角、NPC、障碍物都能进入统一实体池
- `ExploreMode` 能构建自己的索引列表
- 主角移动时能与 blocker AABB 正常阻挡
- NPC 可同时具备“阻挡”和“可交互”属性
- interaction 查询不依赖战斗碰撞系统
- 所有探索态可见对象都能进入统一 y 排序流程
