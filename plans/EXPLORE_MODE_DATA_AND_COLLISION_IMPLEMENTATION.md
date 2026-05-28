# ExploreMode 数据索引与碰撞交互 — 实施文档

> 设计基准：[EXPLORE_MODE_DATA_AND_COLLISION_PLAN.md](EXPLORE_MODE_DATA_AND_COLLISION_PLAN.md)
> 状态：未开始
> 创建：2026-05-28

---

## 核心决策（已拍板）

1. **实体池作为纯注册表，不替换现有访问路径**
   - `Scene.entityPool` 新增，`sharedContext.entityPool` 引用它
   - `sharedContext.character` / `rabbleStick` / `npc` 等旧字段全部保留
   - BattleMode / SceneSequencer 不受影响

2. **所有新增系统不放进 `sharedContext`**
   - `ExploreCollisionSystem` 作为 `ExploreMode` 私有成员
   - 只向 `ExploreMode` 内部暴露

3. **索引在 `ExploreMode.enter()` 时构建一次**
   - 不做 dirty 标记，不做每帧重建
   - 等后续有动态增删需求时再加 `rebuildIndices()`

4. **WalkArea 复用，不重写**
   - `ExploreCollisionSystem` 内部调用 `walkArea.clampPosition()`

5. **y-sort 迁移到 Phase 6**
   - Phase 1-5 保留 `Scene.updateRender` 里的硬编码

6. **交互键（Phase 5）在碰撞/渲染体系稳定后做**

---

## Phase 1：总实体池

### 目标
`Scene` 持有统一实体注册表，现有访问路径不变。

### 改动文件

| 文件 | 改动 |
|------|------|
| `scripts/Enties/CharacterBase.js` | 构造器新增 `this.kind`、`this.blocksMovement`、`this.interactable`，默认值从 config 读取 |
| `scripts/Scene.js` | 新增 `this.entityPool = []`；实体创建后 push 入池；`sharedContext` 加 `entityPool` 引用；`dispose()` 加实体池清空 |

### CharacterBase 新增字段及默认值

```js
this.kind = config.kind ?? "unknown";
this.blocksMovement = config.blocksMovement ?? false;
this.interactable = config.interactable ?? false;
```

### Scene.init() 注册顺序

| 实体 | kind | blocksMovement | interactable |
|------|------|----------------|--------------|
| hero | `"player"` | `false` | `false` |
| rabbleStick | `"enemy"` | `false` | `false` |
| npc | `"npc"` | `true` | `true` |

配置在 `CharacterFactory` 调用时传入，不动工厂接口签名。

### sharedContext 追加

```js
sharedContext.entityPool = this.entityPool;
```

### 验收
- `scene.entityPool.length === 3`
- `sharedContext.entityPool` 同引用
- `sharedContext.character` 等旧字段仍可正常访问
- 运行 `babylon_demo.html`，探索模式和战斗模式无回归

---

## Phase 2：ExploreMode 索引构建

### 目标
`ExploreMode` 在 `enter()` 时从实体池构建四张索引表。

### 改动文件

| 文件 | 改动 |
|------|------|
| `scripts/Systems/Modes/ExploreMode.js` | `enter()` 中构建索引；新增 `_buildIndices()` 方法；保存 `this.dynamicActors` / `this.staticBlockers` / `this.interactables` / `this.renderables` |

### _buildIndices() 筛选规则

```
遍历 entityPool:
  if entity.kind === "player"  → dynamicActors
  if entity.kind === "npc" && entity.blocksMovement → staticBlockers
  if entity.kind === "npc" && entity.interactable   → interactables
  if entity is visible                               → renderables
```

> rabbleStick（kind: "enemy"）暂不进入任何索引。

### 验收
- 进入探索模式后 `exploreMode.dynamicActors` 含 hero
- `exploreMode.staticBlockers` 含 npc
- `exploreMode.interactables` 含 npc
- `exploreMode.renderables` 含 hero + npc
- 探索移动无回归

---

## Phase 3：AABB blocker 接入

### 目标
NPC 能提供世界坐标 AABB，与未来障碍物使用统一接口。

### 改动文件

| 文件 | 改动 |
|------|------|
| `scripts/Enties/NpcCharacter.js` | 新增 `getBlockerAabb()` — 从 `occupancy` 数据计算世界坐标 AABB |
| `scripts/Enties/CharacterBase.js` | 基类加空实现 `getBlockerAabb() { return null; }` |

### getBlockerAabb() 计算

```
输入: this.occupancy (每帧的 occupancy.aabb in px)
      this.pxToWorld
      this.root.position (世界坐标)

取当前帧 occupancy:
  occ = this.occupancy.frames[currentFrameIndex].occupancy
  halfW = (occ.w / 2) * pxToWorld
  halfH = (occ.h / 2) * pxToWorld

返回:
  minX = root.position.x - halfW
  maxX = root.position.x + halfW
  minY = root.position.y - halfH
  maxY = root.position.y + halfH
```

> occupancy AABB 中心与 root anchor 同坐标，不需要额外偏移。

### 验收
- `npc.getBlockerAabb()` 返回 `{ minX, maxX, minY, maxY }`
- 值在合理范围内（约 ±0.4 world unit）
- 探索模式无回归

---

## Phase 4：ExploreCollisionSystem

### 目标
新增探索碰撞系统，处理 AABB 阻挡 + walkArea clamp，替换当前 ExploreMode 中直接的 walkArea 调用。

### 改动文件

| 文件 | 改动 |
|------|------|
| `scripts/Systems/ExploreCollisionSystem.js` | **新建**，实现 `resolveMovement(entity, blockers, walkArea)` |
| `scripts/Systems/Modes/ExploreMode.js` | 持有 `ExploreCollisionSystem` 实例；`fixedUpdate` 中用新系统替代直接 clamp 调用 |

### ExploreCollisionSystem 接口

```js
class ExploreCollisionSystem {
    resolveMovement(entity, desiredX, desiredY, blockers, walkArea)
}
```

### resolveMovement 流程

```
1. 计算 desiredPos = { x: desiredX, y: desiredY }
2. 对每个 blocker:
    获取 blocker.getBlockerAabb()
    如果 entity 的 root 位置与 blocker AABB 重叠:
      将 desiredPos 推出 blocker AABB（最小推移量）
3. walkArea.clampPosition(desiredPos)
4. 将 entity.root.position 设为 desiredPos
```

### ExploreMode.fixedUpdate 改动

```diff
- const { walkArea } = this.context;
- if (walkArea && character?.root) {
-     walkArea.clampPosition(character.root.position);
- }
+ this._collisionSystem.resolveMovement(
+     character,
+     character.root.position.x + moveX,
+     character.root.position.y + moveY,
+     this.staticBlockers,
+     this.context.walkArea
+ );
```

> 原来的 walkArea clamp 在角色位置已更新后执行，新系统需要拿到"意图移动后的位置"做碰撞检测，然后再写入。需要调整 ExploreMode.fixedUpdate 中位置更新的顺序。

### 验收
- hero 仍然被 walkArea 限制
- hero 无法穿过 NPC（站在 NPC 旁边会被阻挡）
- `C` 键切换 walkArea 和碰撞可视化正常
- 探索模式无回归

---

## Phase 5：interaction 查询

### 目标
玩家按交互键时，查询附近 interactable 对象，触发交互。

### 改动文件

| 文件 | 改动 |
|------|------|
| `scripts/Systems/InputSystem.js` | 绑定交互键（E），发射 `"interact"` action |
| `scripts/Systems/PlayerController.js` | 消费 `"interact"` action，产出交互意图 |
| `scripts/Systems/Modes/ExploreMode.js` | `fixedUpdate` 检测交互意图，调用 `ExploreCollisionSystem.queryNearby()` |
| `scripts/Systems/ExploreCollisionSystem.js` | 新增 `queryNearby(entity, interactables, radius)` |

### queryNearby 逻辑

```
遍历 interactables:
  计算 entity root 到 target root 的距离
  如果距离 < radius:
    加入结果列表
按距离排序
返回最近的一个（或 null）
```

### 交互响应（最小版）

交互成功时：
1. 如果目标是 NPC，调用 `npcController.onInteract()`
2. NPC 进入 greeting 状态（已有逻辑）

### 验收
- 站在 NPC 附近按 E 键，NPC 切换到 greeting 状态
- 远离 NPC 按 E 键，无反应
- 战斗模式和探索模式切换无回归

---

## Phase 6：renderables 汇总与 y 排序

### 目标
将 y-sort 从 `Scene.updateRender` 迁移到 `ExploreMode.updateRender`，通过 `renderables` 统一排序。

### 改动文件

| 文件 | 改动 |
|------|------|
| `scripts/Systems/Modes/ExploreMode.js` | `updateRender` 中汇总 `renderables`，按 `sortY` 排序后写 `alphaIndex` |
| `scripts/Systems/Modes/BattleMode.js` | `updateRender` 中处理战斗角色的 y-sort（替代 Scene 中的硬编码） |
| `scripts/Scene.js` | 移除 `updateRender` 中的三条硬编码 alphaIndex 赋值 |

### ExploreMode.updateRender 新增逻辑

```js
// 汇总 renderables
this.renderables.length = 0;
for (const actor of this.dynamicActors) {
    if (actor.spritePlane) this.renderables.push(actor);
}
for (const blocker of this.staticBlockers) {
    if (blocker.spritePlane) this.renderables.push(blocker);
}
// 按 root.position.y 排序（y 小的在前）
this.renderables.sort((a, b) => a.root.position.y - b.root.position.y);
for (let i = 0; i < this.renderables.length; i++) {
    this.renderables[i].spritePlane.alphaIndex = i;
}
```

### BattleMode.updateRender 新增逻辑

```js
// 替换 Scene 中对应的硬编码
if (character?.spritePlane && rabbleStick?.spritePlane) {
    if (character.root.position.y <= rabbleStick.root.position.y) {
        character.spritePlane.alphaIndex = 0;
        rabbleStick.spritePlane.alphaIndex = 1;
    } else {
        character.spritePlane.alphaIndex = 1;
        rabbleStick.spritePlane.alphaIndex = 0;
    }
}
```

### Scene.updateRender 改动

移除以下三行：
```js
if (this.character) this.character.spritePlane.alphaIndex = 100 - this.character.root.position.y;
if (this.rabbleStick) this.rabbleStick.spritePlane.alphaIndex = 100 - this.rabbleStick.root.position.y;
if (this.npc) this.npc.spritePlane.alphaIndex = 100 - this.npc.root.position.y;
```

### 验收
- 探索模式：hero 和 npc 按 y 坐标正确前后遮挡
- 战斗模式：两个角色按 y 坐标正确前后遮挡
- 切换模式无闪烁、无错位
- Scene.updateRender 中不再有硬编码的 alphaIndex 赋值

---

## 收尾

### 文档更新

每个 Phase 完成后：
1. 在本文件中标记 Phase 状态
2. 如果 `plans/INDEX.md` 需要更新，同步修改

### dispose 清理

Phase 4 完成后，`Scene.dispose()` 需追加：
- 清空 `this.entityPool`
- 不需要手动清理 `ExploreCollisionSystem`（由 `ExploreMode` 生命周期管理）

---

## Phase 状态

| Phase | 状态 | 完成日期 |
|-------|------|----------|
| 1     | ✅ 已完成 | 2026-05-28 |
| 2     | ✅ 已完成 | 2026-05-28 |
| 3     | ✅ 已完成 | 2026-05-28 |
| 4     | ✅ 已完成 | 2026-05-28 |
| 5     | ⬜ 未开始 | — |
| 6     | ⬜ 未开始 | — |
| 7     | ⬜ 未开始 | — |

---

## Phase 7：Scene 成员变量清理

### 目标
移除 `Scene` 中 `this.character` / `this.rabbleStick` / `this.npc` 等实体成员变量，统一从 entityPool 访问。

### 改动文件

| 文件 | 改动 |
|------|------|
| `scripts/Scene.js` | init() 中实体变量改为 const 局部变量；_onKeyDown 改为遍历 entityPool；删除成员变量声明；sharedContext 用局部变量填充 |

### 详细改动

1. **构造器**：删除 `this.character = null`、`this.rabbleStick = null`、`this.npc = null`
2. **init()**：`this.character = createHeroCharacter(...)` → `const character = ...`，同理 rabbleStick、npc
3. **sharedContext**：`character: this.character` → `character: character`（局部变量）
4. **_onKeyDown**：改遍历 entityPool 查找碰撞/切换可视化
5. **updateRender**：Phase 6 已移除三条硬编码，无需额外改动

### 验收
- `Scene` 实例上不存在 `character` / `rabbleStick` / `npc` 属性
- C 键 toggle 碰撞可视化仍正常
- sharedContext 中各字段仍可正常访问
- 探索/战斗模式无回归