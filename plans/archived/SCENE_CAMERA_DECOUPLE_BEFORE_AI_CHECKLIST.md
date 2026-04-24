# Scene/Camera 重构短版 Checklist（AI 前置）

更新时间：2026-04-24（第五轮）

使用方式：每做完一轮改动，对照打勾；全通过再继续 AI。

## A. 功能没回归
- [ ] `hero` 仍可移动与出招。
- [ ] `rabble_stick` 仍按 `TestController` 脚本循环。
- [ ] 命中后能进入 `hit` 并回到 `idle`，不卡状态。
- [ ] `C` 键仍可切换碰撞显示。

## B. 结构在变好
- [x] `character_demo.js` 只做启动（Engine + loop + scene 启停），不再塞大量装配细节。
- [x] 场景搭建（scene/light/ground）已从入口抽离。
- [x] 数据加载（json 路径与 loadJson）已从入口抽离。
- [x] 角色创建（clips/stateGraph 装配）已从入口抽离。

## C. Camera 达标
- [ ] `debug` 模式可用（等价当前 ArcRotate 调试体验）。
- [x] `battle` 模式可用（基础侧视跟随，不抖）。
- [x] 可确认当前 camera mode（日志或简单 UI 任一即可）。

## D. AI 开始前最后确认
- [x] Scene / Data / Camera 已分层，主循环仍稳定。
- [ ] `TestController` 回归通过（至少跑一次完整对照）。
- [x] 当前复杂度可控：入口文件不再是“资源路径大杂烩”。

---

备注：你们是小团队，这份清单就够了。每轮改动只要把上面逐项过一遍即可。

## 附录：Scene/Camera 设计（保留版）

### 1. Scene 职责边界
- `character_demo.js`：只保留启动职责（Engine、render loop、scene 生命周期）。
- `DemoScene`：负责场景内编排（light/ground、角色、控制器、战斗系统、输入事件绑定）。
- `Character`：保留角色自身动画/状态/碰撞，不承担场景装配职责。

### 2. 数据解耦建议
- 增加 `AssetManifest`：统一管理 atlas/collider/stateGraph/testScript 路径。
- 增加 `DataLoader`：统一 `loadJson` 和并发加载，输出结构化数据对象。
- 增加 `CharacterFactory`：`scene + blueprint + assets -> Character`，避免入口硬编码 clip 装配。

### 3. Camera 设计建议
- 统一 CameraRig 接口：
- `init(scene, canvas)`
- `update(dtMs, context)`
- `dispose()`
- `DebugCameraRig`：保持当前 ArcRotate 参数和可交互体验（等价迁移）。
- `BattleCameraRig`（基础版）：
- 跟随双方角色中点。
- 根据双方距离做缩放/半径限制（含上下限钳制）。
- 以稳定为先，不引入明显抖动或频繁跳变。

### 4. 推荐落地顺序
1. 先抽 Scene（行为不变）。
2. 再抽数据（manifest/loader/factory）。
3. 最后接 Camera 双模式（debug/battle）。

### 4.1 下一步（当前轮）
- [x] 目标：把“数据加载”从 `scripts/Scene.js` 再解耦到独立模块，Scene 只消费结构化结果。
- [x] `scripts/AssetManifest.js`：集中定义资源路径（atlas/collider/stateGraph/testScript）。
- [x] `scripts/DataLoader.js`：提供 `loadJson` 与基于 manifest 的并发加载，输出 `assets` 对象。
- [x] Scene 侧改造：`init()` 内不再维护大段路径数组，只调用 loader 获取数据。
- [x] 验收：行为不变（本轮通过）。

### 4.2 下一步（建议）
- [x] 抽 `CharacterFactory`：把 `new Character(... clips ...)` 组装从 `Scene.js` 挪出。
- [x] `Scene` 只保留“调用工厂 + 放置角色 + 接线 controller/system”。
- [x] 验收：`Scene.js` 不再包含大段 `clips` 配置对象。

### 4.3 下一步（建议）
- [x] 接入 `DuelCameraRig`：基础侧视跟随 + 距离缩放 + 平滑更新。
- [x] Scene 通过统一接口管理 camera（`init/update/dispose`），不把镜头细节写回 `Scene.js`。
- [ ] 补 `DebugCameraRig` 并支持模式切换（debug/duel）。

### 5. AI 接入前约束
- 先保证 `TestController` 回归稳定，再开始 `AIController`。
- AI 接入只新增控制器，不反向污染 Scene/Data/Camera 分层。
