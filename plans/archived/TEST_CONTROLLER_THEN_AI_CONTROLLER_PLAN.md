# TestController 与 AIController 实施计划

更新时间：2026-04-23

## 1. 背景与目标
- 当前阶段先保障动作资源与状态逻辑配置正确，再进入 AI 行为开发。
- 本计划采用两阶段推进：
1. 先实现 `TestController` 作为可复现测试驱动。
2. 在测试链路稳定后，再实现 `AIController`。

## 2. 阶段划分

### 阶段A：TestController（先做）
目标：提供“固定动作/动作序列”驱动能力，用于验证角色资源、状态转换与战斗触发是否生效。

范围：
- 支持固定动作触发（如单次 `attack`/`thrust`）。
- 支持动作序列脚本（`wait -> command -> wait -> command`）。
- 支持循环与重复次数（`loop`/`repeat`）。
- 支持固定移动意图（可选），便于复现场景距离。

验收标准：
1. 可稳定驱动 `rabble_stick` 触发新增攻击动作。
2. 状态可正确进入攻击并回到待机，不出现卡状态。
3. 攻击命令触发节奏稳定，无明显漏触发/连发异常。
4. 战斗结果（命中/拼刀/受击）与预期帧段一致。

交付物：
- `TestController` 设计与实现。
- 一套可复用的 `rabble_stick` 测试脚本配置（固定动作或序列）。
- 简短使用说明（如何在 demo 中切换到测试控制）。

当前进度（2026-04-23）：
1. 已完成 `TestController`：`scripts/Systems/TestController.js`
2. 已完成测试脚本目录与首个脚本：
   - `Data/TestScripts/rabble_stick_basic_sequence.json`
3. 已在 demo 接入 `TestController` 控制 `rabble_stick`：
   - `character_demo.js`
4. 已补齐 demo 中 `rabble_stick` 的 `move/thrust/swing` 资源加载与 clip 注册，确保测试序列可直接运行。

阶段A剩余：
1. 增加 demo 内控制器切换开关（`Player/Test/Dummy`）与简短操作说明。
2. 根据测试结果微调脚本节奏参数（`waitMs`、`moveIntent`）。
3. 如需更稳定复现，补充 1-2 套对照脚本（例如“纯 thrust 循环”“先接近后 swing”）。

### 阶段B：AIController（后做）
前置条件：阶段A验收通过。

目标：在已验证资源与逻辑正确的前提下，实现基础 AI 决策行为（接近、保持距离、触发攻击等）。

范围（初版）：
- 基于距离的简单决策分段。
- 攻击触发冷却机制。
- 最小随机扰动避免机械行为。

验收标准：
1. AI 可持续运行且行为稳定。
2. 不破坏已通过的 TestController 验证链路。
3. 可与玩家控制角色完成基础对抗回合。

当前状态：
- 暂未开始实现，符合“两阶段推进”决策。

## 3. 当前执行决策
1. 本轮优先进入阶段A：`TestController`。
2. `AIController` 暂不实现，待阶段A验证完成后再开始。

## 4. 说明
- `TestController` 直接继承 `BaseController`，不继承 `DummyController`。
- `DummyController` 继续保留为最简固定行为实现，不承担测试序列调度职责。
