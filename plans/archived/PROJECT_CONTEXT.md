# 项目上下文（GemeniPrototype-BlindBattle）

## 1. 项目概述
这是一个基于 Babylon.js 的 2D 格斗游戏原型，当前专注于实现角色动画、碰撞系统和状态机。

## 2. 技术栈
- **引擎**: Babylon.js
- **语言**: JavaScript (ES6+ modules)
- **动画**: 基于 spritesheet 的逐帧动画
- **碰撞**: 自定义碰撞盒系统
- **状态机**: JSON 定义的状态图

## 3. 当前资源结构
- 动画资源：
  - `Art/Sprite/longswordman_idle.png` + `Art/Sprite/longswordman_idle.json`
  - `Art/Sprite/longswordman_move.png` + `Art/Sprite/longswordman_move.json`
  - `Art/Sprite/longswordman_thrust.png` + `Art/Sprite/longswordman_thrust.json`
- 碰撞资源：
  - `Data/CollisionMask/longswordman_idle.png` + `Data/CollisionMask/longswordman_idle.json`
  - `Data/CollisionMask/longswordman_thrust.png` + `Data/CollisionMask/longswordman_thrust.json`
- 碰撞扫描输出：
  - `Data/CollisionMask/longswordman_idle.collider.json`
  - `Data/CollisionMask/longswordman_thrust.collider.json`

离线工具：
- 碰撞扫描脚本（离线）：`scripts/tools/extract_collision_boxes.ps1`
- 说明：旧路径 `scripts/extract_collision_boxes.ps1` 目前仍存在（文件锁导致删除失败），后续可再清理

## 4. 已完成事项（最新）
1. 已实现 `Character` 组合结构：动画组件 + 碰撞组件。
2. 已实现基于 atlas `duration` 的逐帧推进与循环播放。
3. 已实现根据 `.collider.json` 在 Babylon 中生成并更新碰撞盒。
4. 已实现碰撞盒 debug 可视化（`StandardMaterial` + `diffuse + alpha`）。
5. 已支持运行时开关碰撞显示（`C` 键）。
6. 已确认需要通过本地服务器访问，`file://` 会触发模块/CORS 问题。
7. 已新增 `idle` 动画资源与对应 collision mask 资源。
8. 已生成 `longswordman_idle.collider.json`，当前 `idle` 与 `thrust` 都具备动画图集、collision mask 图集、collider 扫描输出三件套。
9. 已新增最小状态图定义：当前仅保留 `idle` 与 `thrust` 两个状态，输入命令为 `thrust`，`thrust` 播放完自动回 `idle`。
10. 已统一碰撞术语：当前项目约定使用 `hitbox / weaponbox / pushbox`，其中 `hitbox` 表示角色被打到的范围，`weaponbox` 表示用来打别人的范围，`pushbox` 表示占位/挤压范围。

## 5. 当前状态
- 角色动画系统已基本实现
- 碰撞系统已实现并可视化
- 状态机系统已初步搭建
- 输入系统已实现键盘和手柄支持

## 6. 下一步计划
- 实现更多角色状态和动画
- 完善移动系统
- 添加战斗系统
- 优化性能和使用体验