# OBB 碰撞检测修复记录

更新时间：2026-04-27

## 问题描述

AABB（轴对齐包围盒）检测忽略旋转角度，导致：
- 竖直 hitbox（如 rabble_stick_idle 的 hitbox_1，angle=90）被错误计算为水平长方形
- 视觉上 hitbox 和实际判定范围不一致
- 攻击判定过早触发（剑尖还没碰到就命中）

## 根因分析

Collider 导出工具将竖直长方形记录为：
```json
{
  "w": 94,
  "h": 44,
  "angle": 90
}
```

这等价于一个宽 44、高 94 的竖直长方形，但 AABB 直接取 w=94, h=44，忽略了 angle。

## 解决方案

使用分离轴定理（SAT）实现完整 OBB（定向包围盒）检测。

### 改动文件

1. **scripts/Enties/Character.js**
   - `getCombatSnapshot()` 保留 `angle` 字段供 OBB 检测使用

2. **scripts/Systems/ContactResolver.js**
   - `#intersects()` 改为 `#obbIntersect2D()`
   - 新增 `#separatedOnAxis()` 实现 SAT 投影检测

### 算法说明

对于两个 OBB，可能存在分离的轴只有 4 条：
- Box A 的 2 条边法向量
- Box B 的 2 条边法向量

如果在任意一条轴上，两个 box 的投影不重叠，则它们不相交。

### 验证方式

1. 添加 AABB 调试线框（紫色=weaponbox，青色=hitbox）
2. 对比视觉碰撞框和 AABB 线框位置
3. 确认 OBB 检测后两者一致
4. 移除调试线框代码

## 影响范围

- 所有带角度的 hitbox/weaponbox 判定更精确
- 站立角色的竖直 hitbox 不再错误扩大判定范围
- 倾斜武器的攻击范围更符合视觉

## 后续优化

- 可考虑构建时预生成 OBB 顶点坐标，避免运行时三角函数计算
- 如需更高精度，可实现 OBB-OBB 的接触点计算（用于击退方向）