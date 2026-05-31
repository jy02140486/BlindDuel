---
name: post_battle_walkarea_expansion
overview: 在战斗结束后，通过 SceneSequencer callback 动态扩展 WalkArea，将 StageBoundary 区域（及右侧空间）纳入探索可行走范围。同时实现最小化的 Battle→Explore 退出 sequence。
todos:
  - id: walkarea-resize
    content: 给 WalkArea 添加 resize(bounds) 方法，更新边界值并同步调试 plane 的位置和缩放
    status: pending
  - id: battle-exit-detection
    content: 在 BattleMode 中实现战斗结束检测（rabbleStick 被击中计数达阈值或按 V 键）并定义 exit_battle sequence，包含 sheath 动画、相机 blend、walkArea resize callback 和切回 explore 模式
    status: pending
    dependencies:
      - walkarea-resize
  - id: explore-mode-reentry
    content: ExploreMode 添加 _battleCompleted 标志防止重复触发战斗，处理 rabbleStick 隐藏后的实体索引重建
    status: pending
    dependencies:
      - battle-exit-detection
---

## Product Overview

在战斗结束后动态扩展探索可行走区域（WalkArea），将战斗区域（StageBoundary 范围）纳入探索范围，使主角可以在战斗结束后继续向右探索。

## Core Features

- **WalkArea 运行时 resize**：WalkArea 支持动态修改边界，同步更新调试可视化 plane
- **战斗结束检测**：在 BattleMode 中检测战斗结束条件（临时方案：按键盘 V 键触发胜利，或 RabbleStick 被击中 N 次后自动触发）
- **Battle → Explore 退出序列**：执行 sheath 动画 → 相机 blend → 切换回 explore 模式
- **WalkArea 就地扩展**：退出序列中通过 callback 扩展 walkArea 的 maxX，将原战斗区域（x: -7 ~ 8）纳入可行走范围
- **ExploreMode 重入处理**：从战斗返回探索后，walkArea 已扩展，角色可继续向右移动

## Tech Stack

- 现有项目技术栈：HTML / CSS / JavaScript + Babylon.js (CDN)
- 无需引入新依赖

## Implementation Approach

采用方案 A（动态扩展现有 WalkArea），最小改动量实现目标。核心思路：

1. **WalkArea 新增 `resize(bounds)` 方法**：更新 `minX/maxX/minY/maxY`，同步重新定位和缩放调试 plane mesh。无需销毁重建，直接修改 mesh 的 `position` 和 `scaling`。
2. **BattleMode 添加战斗结束检测**：在 `fixedUpdate` 中监听临时触发条件。采用**击中计数方案**：在 BattleMode 中追踪 rabbleStick 被命中的次数，达到阈值（3 次）后启动退出序列。同时保留键盘 V 作为 debug 快捷触发。
3. **定义 exit_battle sequence**：利用现有 SceneSequencer 编排：

- `lockInput` → `sendCommand "exitBattle"` (触发 sheath 动画) → `waitUntil` (等待 sheath 完成) → `startCameraBlend to:"explore"` → `callback` (调用 `walkArea.resize()`) → `switchMode "explore"` → `unlockInput`

4. **RabbleStick 战败处理**：退出序列中隐藏 rabbleStick（`setEnabled(false)`），避免在探索阶段继续参与碰撞检测。
5. **ExploreMode 重入**：`enter()` 已有完整的重建逻辑（实体索引、碰撞网格）。由于 `_battleTriggerFired` 为 true，不会重复触发进入战斗。新增一个 `_battleCompleted` 标志，阻止战斗触发器再次激活。

### 关键设计决策

- **为什么用击中计数而非 HP 系统**：当前是原型阶段，无 HP 概念。`CombatSystem.fixedUpdate()` 返回 `result.effects`，其中 `type: "hit"` 的 effect 表示命中。在 BattleMode 中检查 effects 即可计数。后续升级到 HP 系统时只需替换判定条件。
- **为什么在 callback step 中 resize 而非在 ExploreMode.enter() 中**：让扩展时机可编排，与其他序列步骤精确协调。
- **WalkArea resize 后的范围**：`minX: -24, maxX: 12, minY: -1, maxY: 0.7`。maxX=12 比战斗区域右边界(8)多出 4 个单位，留出缓冲空间。

## Implementation Notes

- **性能**：WalkArea.resize 只修改 3 个数值属性 + 1 个 mesh position/scaling，开销可忽略。
- **blast radius**：不改变现有 Explore → Battle 流程。`_battleTriggerFired` 和新增的 `_battleCompleted` 确保流程单向。
- **向后兼容**：resize 方法是新增的，不影响现有构造函数行为。

## Architecture Design

```
战斗结束检测 (BattleMode.fixedUpdate)
        |
        v
  exit_battle sequence (SceneSequencer)
        |
        ├── lockInput
        ├── sendCommand "exitBattle" → sheath 动画
        ├── waitUntil sheath 完成
        ├── startCameraBlend → explore rig
        ├── callback → walkArea.resize({ maxX: 12 })
        ├── switchMode → "explore"
        └── unlockInput
        |
        v
  ExploreMode.enter()
        ├── 切换相机 rig
        ├── 重建实体索引（rabbleStick 已隐藏，不计入 blockers）
        └── 角色可移动范围已扩展到 maxX=12
```

## Directory Structure

```
e:/se/BlindDuel/
├── scripts/
│   ├── Enties/
│   │   └── WalkArea.js               # [MODIFY] 新增 resize(bounds) 方法，更新边界值 + 调试 plane 位置/缩放
│   └── Systems/
│       └── Modes/
│           ├── BattleMode.js          # [MODIFY] 新增战斗结束检测（击中计数 + V 键触发）+ exit_battle sequence 定义
│           └── ExploreMode.js         # [MODIFY] 新增 _battleCompleted 标志，防止战斗结束后再次触发战斗
```