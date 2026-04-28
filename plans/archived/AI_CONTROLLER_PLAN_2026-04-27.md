# AIController 实施计划

更新时间：2026-04-28
状态：已完成 ✅（已归档）

## 1. 背景与目标

### 已完成的前置工作
- TestController 已实现并验证通过
- 碰撞检测系统已修复（详见 `plans/archived/OBB_COLLISION_FIX_2026-04-27.md`）

### 本计划目标（全部完成）
实现基础 AIController，使 AI 角色能够：
1. ✅ 自动分析自身招式的性能数据（范围、速度、时间）
2. ✅ 基于距离做出战术决策（接近、保持距离、攻击）
3. ✅ 与玩家完成基础对抗回合
4. ✅ 全局冷却（GCD）系统控制战斗节奏

---

## 2. 技术决策记录

### 2.1 AIKnowledgeBase 设计

**归属**：全局 System（`scripts/Systems/AIKnowledgeRegistry.js`）

**原因**：
- 无位置/视觉表现
- 不需要每帧 update
- 管理全局 AI 知识缓存
- 生命周期跟随整个游戏

**数据来源**：

| 信息 | 来源 | 获取方式 |
|-----|------|---------|
| 时间（前摇/持续/后摇） | atlas JSON duration + collider 帧数据 | 扫描每帧 duration，找第一個/最后一个 weaponbox 帧 |
| 位移（突进/后退） | stateGraph frameSpeeds + atlas duration | `Σ(frameSpeeds[i] * duration[i] / 1000)` |
| 攻击范围 | collider JSON weaponbox | 取所有 weaponbox 的最右端 `(cx + w/2 - anchor.cx) * pxToWorld` |
| 武器等级 | collider JSON subtype | `strong_blade` / `weak_blade` |
| 移动速度 | Character.baseWalkSpeed | 运行时从 character 读取 |

**多 weaponbox 处理**：
- 同一帧可能有多个 weaponbox（如 strong_blade + weak_blade）
- 计算整体攻击范围时取所有 weaponbox 的最右端
- 保留每个 weaponbox 的 subtype 信息用于拼刀判断

---

## 3. 阶段划分

### 阶段A：AIKnowledgeBase（已完成）

目标：实现自动扫描角色数据的系统。

范围：
- 创建 `AIKnowledgeRegistry` 全局缓存
- 扫描所有攻击招式的时间、距离、位移、武器等级
- 提供查询接口给 AIController

验收标准：
1. 能正确扫描 thrust/quart 等招式的性能数据
2. 计算出的范围与视觉 weaponbox 一致
3. 缓存机制有效，重复获取不重新扫描

交付物：
- `scripts/Systems/AIKnowledgeRegistry.js` ✅
- 扫描结果数据结构定义 ✅

### 阶段B：基础 AIController（已完成）

前置条件：阶段A完成 ✅

目标：实现基于距离的简单决策。

范围（初版）：
- ✅ 基于距离的简单决策分段（远/中/近）
- ✅ 攻击触发冷却机制（AI 侧）
- ✅ 最小随机扰动避免机械行为
- ✅ 场景设定：玩家永远在左，AI 永远在右，AI 始终面向左
- ✅ Debug 可视化（三色距离圈：蓝/绿/红）

验收标准：
1. ✅ AI 可持续运行且行为稳定
2. ✅ 不破坏已通过的 TestController 验证链路
3. ✅ 可与玩家控制角色完成基础对抗回合

交付物：
- `scripts/Systems/AIController.js` ✅
- 基础决策逻辑（接近 → 攻击 → 后退）
- Debug 可视化（三色距离圈）

---

## 4. 数据结构

### AttackProfile
```js
{
  stateName: "thrust",
  timing: {
    startupMs: 0,      // 第一個 weaponbox 出现前
    activeMs: 700,     // 有 weaponbox 的总时长
    recoveryMs: 0,     // 最后一个 weaponbox 结束后
    totalMs: 700
  },
  range: {
    minReach: 0.5,     // 最近 weaponbox 左端
    maxReach: 4.24,    // 最远 weaponbox 右端
    maxReachBoxId: "weaponbox_weak_blade_2"  // 哪个 box 达到最远距离
  },
  displacement: 0.06,  // 招式自带位移（世界单位）
  weaponBoxes: [
    { subtype: "strong_blade", maxReach: 3.2 },
    { subtype: "weak_blade", maxReach: 4.24 }
  ],
  frameSpeeds: [-0.2, 0, 0.2]  // 原始配置，用于调试
}
```

### MovementProfile
```js
{
  walkSpeed: 0.41,     // 从 character.baseWalkSpeed 获取
  stateDisplacements: {
    thrust: 0.06,
    quart: 0.24,
    hit: -0.15
  }
}
```

---

## 5. 健壮性与异常处理

### 5.1 信息缺失处理

扫描过程中所有异常都必须通过 `console.warn` 或 `console.error` 通知人类开发者。

| 异常情况 | 处理方式 | 通知方式 |
|---------|---------|---------|
| atlas JSON 缺少 duration | 使用默认值 100ms | `console.warn('[AI KB] Missing duration for frame X, using 100ms')` |
| collider 帧缺少 anchor | 使用帧中心作为默认 | `console.warn('[AI KB] Missing anchor for frame X, using center')` |
| weaponbox 缺少 subtype | 默认 weak_blade | `console.warn('[AI KB] Weaponbox X missing subtype, defaulting to weak_blade')` |
| atlas 和 collider 帧数不一致 | 以 collider 为准，缺失 duration 用平均值 | `console.warn('[AI KB] Frame count mismatch: atlas=N, collider=M')` |
| stateGraph 引用不存在的 clip | 跳过该 state | `console.error('[AI KB] State X references unknown clip Y')` |
| frameSpeeds 长度与帧数不匹配 | 多余截断，缺失补 0 | `console.warn('[AI KB] frameSpeeds length mismatch for X')` |

### 5.2 信息不一致时的优先级

| 冲突 | 优先级 | 原因 |
|-----|--------|------|
| atlas 帧数 > collider 帧数 | 以 collider 为准 | collider 决定实际判定 |
| atlas 帧数 < collider 帧数 | 报错/跳过 | 数据损坏，需要修复 |
| frameSpeeds 长度 > 帧数 | 截断 | 多余的忽略 |
| frameSpeeds 长度 < 帧数 | 补 0 | 缺失的视为无位移 |

### 5.3 警告汇总

扫描完成后，如果存在任何警告，统一输出：

```js
console.warn(`[AI KB] ${character.id} scan completed with ${warnings.length} warnings:`, warnings);
```

---

### 阶段C：全局冷却系统（已完成）

目标：引入传统 2D 格斗游戏的节奏控制机制。

范围：
- ✅ Character 层全局冷却（GCD）
- ✅ 动画结束后才开始计算 CD
- ✅ CD 期间禁止输入新指令
- ✅ Debug 面板显示剩余 CD

实现细节：
- `Character.pushCommand()`：CD 期间返回 false，不消费指令
- `Character.canAct()`：查询是否可以行动
- `Character.triggerCooldown()`：动画结束回到 idle 时触发
- `#matchesTransitionCondition()`：CD 期间不响应 command 类型的状态过渡

交付物：
- `scripts/Enties/Character.js`（GCD 逻辑）✅

---

## 6. 执行记录

| 阶段 | 状态 | 完成时间 |
|------|------|---------|
| 阶段A：AIKnowledgeRegistry | ✅ 已完成 | 2026-04-28 |
| 阶段B：基础 AIController | ✅ 已完成 | 2026-04-28 |
| 阶段C：全局冷却系统 | ✅ 已完成 | 2026-04-28 |
| 集成到 Scene.js | ✅ 已完成 | 2026-04-28 |

---

## 7. 归档说明

本计划所有目标已达成，标记为归档状态。后续 AI 优化建议：

1. **连招系统**：基于 AttackProfile 的 recovery 数据设计连段
2. **防御/闪避**：添加格挡、闪避状态，AI 在受击前做出反应
3. **距离微调**：根据具体招式范围选择最优攻击，而非随机选择
4. **行为树/状态机**：将简单 if-else 升级为更复杂的行为决策结构
5. **难度调节**：通过 reactionVariance、decisionIntervalMs 等参数调整 AI 强度

---

## 7. 说明
- `AIKnowledgeRegistry` 使用静态方法 + Map 缓存，避免重复扫描
- 缓存 key 为 `character.id`，版本号用 colliderData 生成时间戳的 hash
- 如果角色数据更新（重新导出 collider），自动重新扫描