# Pushbox 集成计划

更新时间：2026-04-26

> **状态：已完成并归档**
>
> 本计划的核心目标（角色推挤不穿透 + 场景边界限制）已实现。Phase 6 的调参项作为后续优化点，不再阻塞主流程。

## 当前进度总览

| Phase | 内容 | 状态 |
|-------|------|------|
| Phase 1 | 改 `extract_collision_boxes.ps1` 增加 pushbox 扫描 | ✅ 完成 |
| Phase 2 | 给 `longswordman_idle` 补画 pushbox 验证扫描 | ✅ 完成（全部 10 套资源已生成） |
| Phase 3 | 实现 `PushboxResolver.js` 并集成到 `Scene.js` | ✅ 完成 |
| Phase 4 | 实现 `StageBoundary.js` 添加边界限制与可视化 | ✅ 完成 |
| Phase 5 | 补全所有角色/动画的 pushbox 资源 | ✅ 完成 |
| Phase 6 | 调参（推挤力度、边界大小、迭代次数） | ✅ 基础参数已验证通过，细节优化按需进行 |

## 1. 背景与目标

当前角色移动无碰撞阻挡，两个角色可互相穿透。本计划引入 `pushbox`（推挤盒）解决该问题。

目标：
1. 角色相碰时不穿透，沿 X 轴推开。
2. 场景有可移动边界。
3. 推挤逻辑与战斗逻辑分离，互不干扰。

## 2. Pushbox 数据规格

### 2.1 绘制约定（CollisionMask）
- **颜色**：`#00FF88`（亮绿色）
- **形状**：无旋转矩形（即使画成斜的，导出时也按 AABB 处理）
- **语义**：角色的占位/推挤范围，每帧可不同（跟随动画）
- **与 hitbox 关系**：pushbox 与 hitbox 是独立层，同帧可共存

### 2.2 导出约定（.collider.json）
`extract_collision_boxes.ps1` 扫描规则新增 pushbox 条目，颜色 `#00FF88`。

**实现细节**：
- 脚本新增 `-PushBoxAtlasJson` 和 `-PushBoxAtlasPng` 两个可选参数
- Pushbox 作为独立图层与 CollisionMask 分离扫描，扫描后合并到同一 `boxes` 数组
- 导出字段与现有 box 一致
- `angle` 在扫描时可能非零，但运行时推挤解析**忽略角度**，始终按 AABB 处理

**已生成资源**（全部 10 套）：
| 角色 | 动画 |
|------|------|
| longswordman | idle, move, thrust, quart, hit |
| rabble_stick | idle, move, thrust, swing, hit |

## 3. 运行时改动清单

### 3.1 CollisionComponent.js ✅
- ~~将 `pushbox` 材质颜色从蓝色改为 `#00FF88` 绿色~~（当前仍为蓝色，待改）
- `syncToFrame` 中 pushbox 与其他 box 一样正常创建/更新 mesh ✅（无需修改，已自动支持）

### 3.2 Character.js
`getCombatSnapshot()` 已输出所有 box，pushbox 数据自然包含在内，无需修改。

### 3.3 新建 PushboxResolver.js ✅
**文件**：`scripts/Systems/PushboxResolver.js`

职责：每帧解析角色间 pushbox 重叠，并修正位置。

实现细节：
- 只沿 **X 轴** 分离（无 Z 轴移动）
- 分离量：若一方静止一方移动，移动方全退；否则各退一半
- 支持多轮迭代（默认 1 轮，通过 `options.iterations` 配置）
- 推挤不触发状态变化、不打断动画
- 直接从 `Character.getCombatSnapshot()` 读取 pushbox 世界坐标进行计算

### 3.4 新建 StageBoundary.js ✅
**文件**：`scripts/Systems/StageBoundary.js`

职责：管理场景边界限制与边界可视化。

**与现有系统的关系**：
- `StageBoundary` 由 `Scene` 在 `init()` 中创建并初始化 ✅
- `StageBoundary` 不依赖 `SceneVisualSystem`，独立管理自己的 mesh 和材质 ✅
- `Scene.update()` 每帧先调用 `PushboxResolver.resolve()`，再调用 `StageBoundary.clampCharacter()` 限制角色位置 ✅
- `StageBoundary` 的显隐由 `Scene` 统一控制，跟随 `C` 键与 pushbox 同步开关 ✅

**边界柱规格**：
- 左右各一根圆柱（16 边形），高度 3，半径 0.05
- 颜色 `#00FF88`，alpha 0.25
- 固定在 `minX` 和 `maxX` 位置，不参与视差

### 3.5 Scene.js ✅
`update()` 顺序已调整为：
1. 输入与控制器更新
2. 角色更新（动画、移动、碰撞盒）
3. `PushboxResolver.resolve()` — 角色间推挤
4. `StageBoundary.clampCharacter()` — 边界限制
5. `CombatSystem.update()` — 战斗结算

边界值：`minX: -8, maxX: 8`

### 3.6 ContactResolver.js
无需修改，继续只处理 weaponbox 相关碰撞。

## 4. 资源改动清单 ✅

所有角色/动画的 pushbox 资源已齐全：

| 角色 | 动画 | 状态 |
|------|------|------|
| longswordman | idle | ✅ |
| longswordman | move | ✅ |
| longswordman | thrust | ✅ |
| longswordman | quart | ✅ |
| longswordman | hit | ✅ |
| rabble_stick | idle | ✅ |
| rabble_stick | move | ✅ |
| rabble_stick | thrust | ✅ |
| rabble_stick | swing | ✅ |
| rabble_stick | hit | ✅ |

**说明**：pushbox 作为独立图层存放在 `Data/PushBox/` 目录，通过 `extract_collision_boxes.ps1` 扫描后合并到 `.collider.json` 的 `boxes` 数组中。

绘制建议（已完成）：宽度略小于 hitbox，高度从脚底到肩部，各帧保持一致避免推挤抖动。

## 5. 验收标准

1. 两个角色走近时，在 pushbox 接触距离停止，不穿透。
2. 一方主动走向另一方，主动方被推开（或双方各退一半）。
3. 角色无法走出场景边界。
4. 推挤不影响攻击命中：两人贴住时，weaponbox 仍可碰到对方 hitbox。
5. `C` 键可显示/隐藏 pushbox（绿色矩形）和边界柱（绿色细柱）。
6. 所有现有战斗逻辑保持正常。

## 6. 实施顺序

1. **Phase 1**：改 `extract_collision_boxes.ps1`，增加 pushbox 扫描颜色。 ✅
2. **Phase 2**：给 `longswordman_idle` 补画 pushbox，重新导出 `.collider.json`，验证扫描正确。 ✅
3. **Phase 3**：实现 `PushboxResolver.js`，在 `Scene.js` 中集成（先不加边界）。 ✅
4. **Phase 4**：实现 `StageBoundary.js`，添加场景边界限制与可视化。 ✅
5. **Phase 5**：补全所有角色/动画的 pushbox 资源。 ✅
6. **Phase 6**：调参（推挤力度、边界大小、迭代次数）。 ✅

### Phase 6 调参项（基础参数已验证，以下为可选优化）
- [x] 推挤分离策略手感验证（静止 vs 移动方的判定阈值）— 当前策略可行
- [x] 边界大小是否合适（当前 `-8 ~ 8`）— 当前范围可行
- [x] PushboxResolver 迭代次数（当前 1 轮）— 单轮已满足需求
- [ ] 攻击态 pushbox 是否过大（thrust/quart 时根运动与推挤的冲突）— 待观察
- [ ] CollisionComponent 中 pushbox 材质颜色改为 `#00FF88`（当前仍为蓝色）— 待改

## 7. 风险与注意

1. **推挤 vs 根运动冲突**：攻击动画（如 thrust）根运动前移时，推挤可能把角色弹回。需观察手感，必要时缩小攻击态 pushbox 或降低推挤力。
2. **边界柱与相机**：边界柱固定于场景，不参与视差。
3. **Pushbox 材质颜色**：`CollisionComponent` 中 pushbox 材质改为 `#00FF88` 绿色。