# 拾取 & 对话 分步实施计划

> 状态：方案评审中 | 创建：2026-06-15

## 0. 设计要点

- **拾取物**：一个独立精灵，不继承 CharacterBase，由 SceneDef 中 entity 定义
- **拾取表现**：hero 播放 eat/drink/pocket 动画，动画帧带有锚点数据（类似 RootMotion），告诉系统把物品精灵画在哪个位置（手边、嘴边、背上等）
- **物品分类**：
  - **吃喝型**：拾取即消耗，直接加 buff（回血、减CD），不进背包
  - **背包型**：拾取后进背包。可能是任务物品（交给 NPC）或投掷物（战斗中消耗产生 projectile）
- **背包 UI**：不做传统道具栏。屏幕侧面排列道具精灵图标即可
- **NPC 对话**：气泡形式，没有文字，只有物品精灵 + unicode 图标（✅❌💰⚔️等）

---

## Play 1：拾取物精灵 + 拾取交互

### 目标
地上出现一个物品精灵，hero 走近按交互键，物品消失。

### 改动

| 文件 | 改动 |
|------|------|
| `scripts/Enties/PickableEntity.js` | **新增**。轻量实体：sprite plane + 固定纹理 + `pickup()` 方法。不继承 CharacterBase |
| `scripts/CharacterFactory.js` | **新增** `createPickable(scene, assets, entityDef)`，根据 def 的 texture 字段创建 PickableEntity |
| `scripts/SceneDefs.js` | `ARCHETYPE_FACTORY` 加 `"pickable"`；`OUTDOOR_VILLAGE.entities` 加一个 pickable 条目：`{ archetype: "pickable", id: "herb_01", pos: [-8, 1.5], texture: "...", itemDef: { id: "herb", name: "药草", consumeType: "eat" } }` |
| `scripts/Data/ItemDefs.js` | **新增**。最小物品定义表：`{ id, name, consumeType: "eat"|"drink"|"pocket" }` |
| `scripts/Systems/Modes/ExploreMode.js` | `_buildIndices()` 中新增 `pickables` 列表。`#checkInteraction()` 中：遍历 pickables → 距离判断 → 调用 `pickup()` |

### 不需要
- 动画锚点、背包 UI、对话、WorldState

### 验收
- 户外场景地上出现一个物品精灵
- hero 靠近按 E/J，物品消失，控制台打印 `[Pickup] 药草 (eat)`

---

## Play 2：拾取动画 + 锚点

### 目标
拾取时 hero 播放 eat/drink/pocket 动画，物品精灵跟随动画锚点移动到 hero 身上。

### 所需资源
- **动画帧**：hero 的 eat、drink、pocket 三种动画（需要制作）
- **锚点数据**：类似 RootMotion JSON，每帧记录锚点位置（相对于 hero root 的偏移）。格式：
  ```json
  {
    "frames": [
      { "anchor": { "x": 4.2, "y": 6.8 } },
      { "anchor": { "x": 4.0, "y": 6.5 } },
      ...
    ]
  }
  ```

### 细节：物品精灵的 Y 偏移

物品的实际逻辑位置在地面（root.position），但精灵 plane 渲染时上移一个 `visualYOffset`，让物品视觉上接近 hero 的手/腰高度，而不是画在脚底。

- `PickableEntity` 构造时读 `entityDef.visualYOffset`（默认约 1.5），sprite plane 的 `position.y` = `visualYOffset`
- 锚点 JSON 中的坐标是相对于物品 root 的偏移，不需要额外处理——物品 root 已经在地面，锚点指向 hero 的手部位置即可

### 改动

| 文件 | 改动 |
|------|------|
| `scripts/Enties/PickableEntity.js` | 新增 `attachTo(transformNode)` — 将 sprite plane parent 设为 hero root，跟随锚点位移。sprite plane 的 `position.y` 加 `visualYOffset` 让物品始终显示在合适高度 |
| `scripts/Components/PickupAnchorComponent.js` | **新增**。类似 FrameAnimationComponent，读取锚点 JSON，每帧输出当前锚点偏移 |
| `scripts/Systems/Modes/ExploreMode.js` | `#checkInteraction()` 拾取时：锁定 hero 输入 → 播放对应动画 → 物品 attach + 跟随锚点 → 动画结束 → dispose 物品 |
| `scripts/SceneSequencer.js` 或 ExploreMode | 编排"锁定输入 → 播动画 → 等待完成 → 恢复"的流程 |

### 验收
- 地上物品精灵显示在比脚底高的位置（接近手的高度）
- 靠近可吃喝物品按交互键 → hero 播放 eat 动画 → 物品精灵飞到 hero 手边 → 动画结束物品消失
- 靠近背包型物品 → hero 播放 pocket 动画 → 物品精灵飞到 hero 背后/腰间

---

## Play 3：物品进背包 + 侧面图标显示

### 目标
- 吃喝型：拾取后直接消耗，不显示在背包
- 背包型：拾取后显示为屏幕左侧的精灵图标

### 改动

| 文件 | 改动 |
|------|------|
| `scripts/Systems/InventoryManager.js` | **新增**。`addItem(itemDef)` / `removeItem(itemId)` / `hasItem(itemId)` / `items[]` |
| `scripts/UI/InventoryBar.js` | **新增**。屏幕左侧竖排显示背包物品精灵。监听 InventoryManager 变化，增删 DOM 元素。每个物品就是一个小 img/png |
| `scripts/Systems/Modes/ExploreMode.js` | 拾取 pocket 型物品 → `inventoryManager.addItem()` → 动画结束 dispose 地上的精灵 |
| `scripts/Scene.js` | `sharedContext` 加 `inventoryManager`、`inventoryBar` |
| `scripts/SceneDefs.js` | pickable entity 的 `itemDef.consumeType` 决定走哪条路径 |
| `index.html` | 加 `<div id="inventory-bar">` 容器 |

### 验收
- 拾取 eat 型物品 → 不出现背包图标
- 拾取 pocket 型物品 → 屏幕左侧出现该物品的小精灵图标
- 重复拾取同类型 → 图标叠加（两个药草图标并排）

---

## Play 4：吃喝 buff 效果

### 目标
- eat → 回血
- drink → 减招式 CD

### 改动

| 文件 | 改动 |
|------|------|
| `scripts/Data/ItemDefs.js` | 扩展 itemDef：`{ id, name, consumeType, effect: { type: "heal", value: 10 } | { type: "cdReduce", value: 0.3 } }` |
| `scripts/Systems/BuffManager.js` | **新增**。`applyImmediate(character, effect)` — 立即型 buff：heal 直接改 HP，cdReduce 直接改 CD 计时器 |
| `scripts/Systems/Modes/ExploreMode.js` | 拾取 eat/drink → 动画结束 → `buffManager.applyImmediate(character, itemDef.effect)` |

### 验收
- 拾取 eat 物品 → hero HP 增加
- 拾取 drink 物品 → hero 招式 CD 缩短

---

## Play 5：NPC 气泡对话（精灵 + unicode 图标）

### 目标
NPC 交互不再只是播放 ask 动画，而是在 NPC 上方弹出气泡，显示物品精灵和/或 unicode 图标。

### 改动

| 文件 | 改动 |
|------|------|
| `scripts/UI/DialogueBubble.js` | **新增**。DOM 元素定位在 NPC 上方（世界坐标 → 屏幕坐标），内容支持：物品精灵 `<img>` + unicode `<span>`。支持多条消息按确认键推进 |
| `scripts/Data/DialogueDefs.js` | **新增**。对话数据格式：`{ id, lines: [{ items: ["herb"], icons: ["💰"] }, { icons: ["✅"] }] }` |
| `scripts/Systems/NpcController.js` | 重构。状态改为 `idle → talking`。`enterAsk()` 时读取 dialogueDef 的 lines，逐条显示气泡。最后一条关闭气泡，恢复 idle |
| `scripts/SceneDefs.js` | NPC entity 加 `dialogueId` 字段 |
| `scripts/Systems/Modes/ExploreMode.js` | `fixedUpdate` 中：确认键推进气泡到下一行 → 最后一行关闭气泡 → 恢复移动 |
| `scripts/Scene.js` | `sharedContext` 加 `dialogueBubble` |
| `index.html` | 加 `<div id="dialogue-bubble">` 容器 |

### 验收
- 靠近 NPC → 显示 greeting（可保持当前动画或改为气泡图标）
- 按交互键 → NPC 上方弹出气泡，显示物品图标 + ✅❌ 等
- 按确认键逐条推进，最后一条消失

---

## Play 6：投掷物记录（不实现投掷机制）

### 目标
背包型物品标记为 `throwable: true`，数据层面记录。战斗时 hero 有一个"持有该物品则可用的招式"的空位。

### 改动

| 文件 | 改动 |
|------|------|
| `scripts/Data/ItemDefs.js` | itemDef 加 `throwable: true` |
| `scripts/Systems/InventoryManager.js` | `getThrowables()` — 返回所有 throwable 物品列表 |
| `scripts/Systems/Modes/BattleMode.js` | 不实现投掷逻辑。仅预留：`if (inventory.hasThrowable()) { /* 允许触发 throw 招式 */ }` |
| `scripts/Scene.js` | sharedContext 加 `inventoryManager`（之前已加，确认 BattleMode 可访问） |

### 验收
- 控制台可查看 `inventoryManager.getThrowables()` 返回正确物品
- 数据通路预留完成，后续可直接扩展

---

## Play 7：任务物品交还 NPC

### 目标
NPC 对话气泡中显示"需要某物品"的图标，玩家背包有该物品时，交互自动扣除物品并推进对话。

### 改动

| 文件 | 改动 |
|------|------|
| `scripts/Data/DialogueDefs.js` | 对话条目加 `requireItem: "herb"` — 如果背包有，消耗并进入下一行；如果没有，显示 ❌ |
| `scripts/Systems/NpcController.js` | `enterAsk()` 时检查当前 line 的 `requireItem`：有则调用 `inventoryManager.removeItem()`，没有则显示另一条 line |
| `scripts/UI/DialogueBubble.js` | 支持显示"需要物品" vs "没有物品"两种气泡内容 |

### 验收
- 背包有任务物品 → 找 NPC 交互 → 气泡显示"给我"图标 → 确认 → 物品从背包消失 → NPC 显示"谢谢"图标
- 背包无任务物品 → 找 NPC 交互 → 气泡显示 ❌

---

## 实施路线图

```
Play 1：拾取精灵 + 交互（最简闭环）
  ↓
Play 2：拾取动画 + 锚点跟随（视觉表现）
  ↓
Play 3：物品进背包 + 侧面图标（背包 UI）
  ↓
Play 4：吃喝 buff 效果（增益系统）
  ↓
Play 5：NPC 气泡对话（图标对话）
  ↓
Play 6：投掷物记录（数据预留）
  ↓
Play 7：任务物品交还 NPC（任务最小闭环）
```

每个 Play 可独立验收，在游戏中能看到效果。

---

## 后续（不在此计划内）

- Play 8+：条件对话、WorldState 持久化、场景切换 → 待本计划完成后，基于实际情况再定方案
- 投掷 projectile 机制 → 独立计划