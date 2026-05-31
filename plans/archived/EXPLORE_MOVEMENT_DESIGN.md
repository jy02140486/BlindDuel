> **状态**: ✅ 已完成（2026-05-30）

# 探索阶段移动与相机设计文档

## 1. 设计决策

### 1.1 坐标系约定
- **x 轴**：水平左右方向
- **y 轴**：垂直上下方向（画面深度/远近）
- **z 轴**：固定为 0，不参与角色移动

> 原因：SceneVisualSystem 使用 z 轴做层级排序（BG_FAR z=40, BG_MID z=30, STAGE z=10）。角色 z 保持 0 可避免与背景层冲突。

### 1.2 俯角方案
- **全局 base pitch 已放弃**
- 原因：俯角影响 SceneVisualSystem 的垂直构图，且清版游戏通常使用水平相机
- 相机在探索阶段保持水平看向目标点

### 1.3 StageBoundary 职责
- **仅用于战斗模式**
- 限制角色在战斗场景中的 x 方向移动范围
- 不涉及障碍物检测
- 不限制 y/z 方向

## 2. 探索阶段移动系统

### 2.1 可行走区域（WalkArea Entity）
```js
// scripts/Enties/WalkArea.js
class WalkArea {
    constructor(scene, options)
    clampPosition(position)  // 原地修改位置到边界内
    containsPoint(x, y)
    setVisible(value)        // 切换调试可视化
    dispose()
}
```

- 角色在探索阶段的移动被限制在 walkArea 内
- 超出边界时位置被 clamp 到边界内
- 第一版不包含障碍物 AABB
- 调试可视化：半透明绿色矩形平面，`C` 键切换显示
- `renderingGroupId = 3` 确保在所有背景层之上渲染

### 2.2 输入映射
- 键盘/手柄的 x 输入 → 角色 x 方向移动
- 键盘/手柄的 y 输入 → 角色 **y** 方向移动（映射到 world y）
- z 方向无输入响应，保持 0

> 注意：`SceneSequencer._updateMoveActorTo` 已同步改为操作 y 坐标（原先是 z）

### 2.3 移动速度
- 探索阶段基础移动速度需要调快
- 战斗阶段移动速度保持当前 tuning 不变

## 3. 探索阶段相机

### 3.1 相机行为
- 水平相机（无俯角）
- 跟随角色 x 和 y 位置
- 保持 z 方向固定距离

### 3.2 相机位置计算
```
camera.x = target.x
camera.y = target.y + followHeight
camera.z = target.z - followDistance
```

其中：
- `followHeight`：相机高于目标的高度（旧逻辑，恢复）
- `followDistance`：相机与目标的水平距离

### 3.3 与 SceneVisualSystem 的关系
- SceneVisualSystem 根据相机 x 位置做水平视差
- 相机 y 变化不影响背景层位置（背景层 y 固定）
- 角色在画面中上下移动，背景保持不动

## 4. 后续扩展

### 4.1 障碍物系统
- 在 walkArea 内增加 AABB 障碍物
- 角色移动时与障碍物做碰撞检测
- 第一版可跳过

### 4.2 战斗 -> 探索过渡
- 保持现有序列设计
- 相机 blend 从 duel rig 回到 explore rig
- 角色状态从战斗恢复到探索

## 5. 需要修改的文件

| 文件 | 修改内容 |
|------|----------|
| 文件 | 修改内容 | 状态 |
|------|----------|------|
| `scripts/Enties/WalkArea.js` | 新建 Entity，含边界限制+调试可视化 | ✅ |
| `scripts/Systems/CameraManager.js` | 移除 basePitch 相关代码，恢复水平相机 | ✅ |
| `scripts/ExploreCameraRig.js` | 恢复旧 compute 逻辑（followHeight） | ✅ |
| `scripts/DuelCameraRig.js` | 恢复旧 compute 逻辑（min/maxCameraHeight） | ✅ |
| `scripts/Systems/Modes/ExploreMode.js` | 加 walkArea 限制，调快速度 | ✅ |
| `scripts/Systems/SceneSequencer.js` | `moveActorTo` 改操作 y 坐标 | ✅ |
| `scripts/Enties/Character.js` | y 输入映射到 y 坐标 | ✅ |
| `scripts/Scene.js` | 初始化 walkArea，接入 C 键切换 | ✅ |

## 6. 验收标准

- [x] 角色 z 始终为 0，不被相机/移动逻辑修改
- [x] 角色可在 walkArea 内自由移动（x 和 y 方向）
- [x] 角色不能走出 walkArea 边界
- [x] 探索移动速度明显快于当前
- [x] 相机水平跟随角色，无俯角
- [x] SceneVisualSystem 背景层不受角色 y 移动影响
- [x] 战斗 -> 探索过渡正常
