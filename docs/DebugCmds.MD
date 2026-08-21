# 调试控制台命令 (window.debug)

## 概述

在浏览器 DevTools Console 中输入 `debug.xxx()` 即可直接操控 NPC behavior、位置、参数等。

入口：`Game._setupDebugConsole()`（bootstrap 末尾自动注册到 `globalThis.debug`）。

## 前置条件

1. 游戏已进入场景（`Game.init()` 完成）
2. 场景中存在目标 NPC（可通过 `debug.listNpcs()` 确认）

---

## API 清单

### 1. `debug.listNpcs()`

列出当前场景所有 NPC，以表格形式展示关键状态。

```javascript
debug.listNpcs()
// → 输出表格：name, id, state, behavior, x, y, isCompanion, blocksMovement, isBlocking, fx, fy, ix, iy, speed, dx, dy
```

### 2. `debug.getNpc(name)`

按名称查找 NPC 实体，返回实体对象引用。

- `name`：NPC 名称（`root.name` 或 `entity.id`，如 `"companion"`、`"merchant"`、`"npc"`）

```javascript
const charlotte = debug.getNpc("companion");
// charlotte.root.position.x  → 实时位置
// charlotte.npcController     → NpcController 实例
```

### 3. `debug.setBehavior(name, behavior)`

切换 NPC 的 behavior state。

- `name`：NPC 名称
- `behavior`：`"idle"` 或 `"following"`

```javascript
// 让 Charlotte 开始跟随玩家
debug.setBehavior("companion", "following");

// 让 Charlotte 回到原地待机
debug.setBehavior("companion", "idle");
```

> 切换到 `following` 时会自动将 NPC teleport 到 hero 旁（基于 `targetOffsetX`），避免从远处走过来。

### 4. `debug.forceGreeting(name)`

强制触发 NPC 的 greeting 对话气泡（跳过 greeting 范围检测）。

- `name`：NPC 名称

```javascript
debug.forceGreeting("merchant");
```

### 5. `debug.teleport(name, x, y)`

将 NPC 传送到指定世界坐标。

- `name`：NPC 名称
- `x`：目标 X（世界单位）
- `y`：目标 Y（世界单位，正值=远，负值=近）

```javascript
// 把 Charlotte 传到 walkArea 右墙附近
debug.teleport("companion", 9, -0.69);
```

### 6. `debug.tuneParams(name, params)`

实时调整 FollowingBehavior 参数，无需重启游戏。

- `name`：NPC 名称（必须处于 following 状态）
- `params`：参数对象，参见下方可调参数列表

```javascript
// 调整跟随偏移到玩家左侧
debug.tuneParams("companion", { targetOffsetX: -2.0 });

// 同时调整多个参数
debug.tuneParams("companion", {
    targetOffsetX: 1.5,
    targetOffsetY: 0.3,
    followGain: 3.0,
    followWeight: 1.2
});
```

#### 可调参数列表

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `targetOffsetX` | `2.0` | 玩家右侧跟随的 X 偏移（世界单位） |
| `targetOffsetY` | `0` | Y 偏移；正值=远，负值=近 |
| `followStart` | `0.4` | 达到此距离时全速移动 |
| `followStop` | `0.1` | 低于此距离时停止移动（dead-zone） |
| `followGain` | `5.0` | 跟随误差→力的增益；越大跟踪越紧 |
| `speedMin` | `0.77` | 最小移动速度（世界单位/秒） |
| `speedMax` | `1.87` | 最大移动速度（世界单位/秒） |
| `followWeight` | `1.0` | 跟随力权重 |
| `separationWeight` | `1.0` | 分离力权重 |
| `separationEnterRadius` | `0.6` | 进入 Y 分离的距离阈值 |
| `separationReleaseRadius` | `0.72` | 释放 Y 分离的距离阈值 |
| `separationStrength` | `1.4` | 分离力强度倍率 |

### 7. `debug.resample(name)`

清除 following 行为的目标采样缓存和分离方向滞后，强制下一帧重新采样。

```javascript
// Charlotte 卡住时使用
debug.resample("companion");
```

### 8. `debug.dumpStates()`

导出当前所有 NPC 的完整状态（含 force debug data）为 JSON 字符串。

```javascript
const json = debug.dumpStates();
console.log(json);
```

---

## NPC 头顶力面板字段说明

当 NPC（如 Charlotte）处于 following 状态且 debug 可视化开启（按 X 键）时，NPC 头顶会显示一个实时力面板，格式如下：

```
  Fx=0.794  Fy=-0.937
  S=0.000   Sy=0.000  dirY=0
  Ix=0.794  Iy=-0.937
  ix=0.573  iy=-0.819  v=1.87
  dx=0.300  dy=-0.450  d=0.540
```

### 字段含义

| 字段 | 含义 |
|------|------|
| **Fx/Fy** | follow force X/Y 分量（`followGain` 增益后的连续比例控制，范围 [-1, 1]） |
| **S** | separation force 幅值（Y 轴分离力强度，基于 `separationStrength` 和距离比例） |
| **Sy** | separation force Y 分量（`_sepDirY * sepForce`，正值=推远，负值=拉近） |
| **dirY** | `_sepDirY` 锁定方向（-1/0/+1）；0=未进入分离状态，±1=分离方向已锁定 |
| **Ix/Iy** | 合成原始力（未归一化）= `follow*followWeight + separation*separationWeight` |
| **ix/iy** | 最终归一化运动意图（单位向量，蓝色加粗显示）；NPC 实际朝此方向移动 |
| **v** | 速度（世界单位/秒），由 `max(absDx, absDy)` 映射到 `[speedMin, speedMax]` |
| **dx/dy** | follow 误差（target → npc 的 X/Y 差值，正值=NPC 在目标左侧/远端） |
| **d** | 分离距离（NPC 与玩家之间的欧几里得距离） |
| **FAIL** | WalkAreaSampler 采样失败标记；显示 `FAIL` 时说明目标点不可达（如被 blocker 卡住） |

### 字段关系速查

```
dx/dy (误差) → followGain → Fx/Fy (follow力)
sepDist → sepEnter/Release → _sepDirY → S/Sy (separation力)
Fx*followWeight + Sy*separationWeight → Ix/Iy (原始合成)
norm(Ix, Iy) → ix/iy (归一化移动意图)
max(absDx, absDy) → v (速度映射)
```

### 阅读指南

1. **NPC 不动**：`v=0` 且 `ix=0, iy=0` → 检查 `maxAbs` 是否 < `followStop`（在 dead-zone 内）
2. **NPC 只在 X 方向动，不动 Y**：`dirY=0` 且 `Sy=0` → 分离力未触发，正常
3. **NPC 在 Y 方向振荡**：`dirY` 频繁翻转（+1↔-1）→ 滞后失效，需调大 `separationEnterRadius`
4. **NPC 朝 blocker 方向走**：`FAIL` 标记出现 → `WalkAreaSampler` 找不到可行 target
5. **移动方向不符合预期**：检查 `ix/iy` 与 `Fx/Fy` 是否符号一致（不一致说明 separation 力主导了）

---

## 典型调试场景

### 场景 A：复现 Oscillation 问题

```javascript
// 1. 确保 Charlotte 在 following 状态
debug.setBehavior("companion", "following");

// 2. 把玩家和 Charlotte 传到已知的问题坐标
debug.teleport("companion", 9, -0.86);

// 3. 观察头上力面板（需开启 X 键 debug 可视化）
// 或每帧读取
debug.getNpc("companion").npcController._followingBehavior._debugData
```

### 场景 B：快速测试不同跟随参数

```javascript
// 测试大偏移
debug.tuneParams("companion", { targetOffsetX: 3.0 });

// 测试硬跟随（无延迟）
debug.tuneParams("companion", { followGain: 10.0, followStart: 0.2 });

// 恢复默认
debug.tuneParams("companion", {
    targetOffsetX: 2.0, targetOffsetY: 0,
    followGain: 5.0, followStart: 0.4, followStop: 0.1,
    speedMin: 0.77, speedMax: 1.87,
    followWeight: 1.0, separationWeight: 1.0,
    separationEnterRadius: 0.6, separationReleaseRadius: 0.72,
    separationStrength: 1.4
});
```

### 场景 C：检查 NPC 阻挡状态

```javascript
// 检查 companion 是否阻挡移动
debug.listNpcs();  // 看 isBlocking 列

// 切换到 following 后应自动不阻挡
debug.setBehavior("companion", "following");
debug.listNpcs();  // isBlocking 应为 false
```

---

## 注意事项

1. `setBehavior` 切换到 `following` 时会自动 teleport NPC 到 hero 旁，确保初始位置合理
2. `tuneParams` 仅在 following 状态下生效；切回 idle 再切回 following 后参数保留（存储在 behavior.options 中）
3. `resample` 可在 NPC 因玩家 idle 动画 AABB 抖动导致 target 反复跳变时手动重置
4. 以上命令仅在 `Game.bootstrap()` 完成后可用（即进入场景后）
5. 打开 X 键可切换 debug 可视化（包含 NPC 头顶力面板、AABB 线框等）