# 战斗规则细化计划

## 背景与目标

基于当前原型（`ContactResolver + CombatSystem + Character`）和已归档计划中的设计，补充两条新的战斗规则：

1. **Longswordman 的 thrust 攻击判定帧限制**：thrust 虽然全三帧都有 weaponbox，但只有最后一帧（frame 2）才产生攻击判定；前两帧碰到对手 hitbox 不会命中，但碰到对手 weaponbox 仍可正常拼刀/拦截。
2. **Rabble stick 的 dodge 无敌帧**：dodge 期间不被 hitbox 命中。

---

## 规则 1：Thrust 仅最后一帧有攻击判定

### 当前现状

`longswordman_thrust.collider.json` 三帧都有 `weaponbox_strong_blade` + `weaponbox_weak_blade`：

| 帧 | weaponbox 存在 | 当前行为 |
|---|---------------|---------|
| 0 | ✅ | 产生 `attackInstanceId`，碰到 hitbox 即命中 |
| 1 | ✅ | 同上 |
| 2 | ✅ | 同上 |

### 期望行为

| 帧 | weaponbox 存在 | 碰到对手 hitbox | 碰到对手 weaponbox |
|---|---------------|----------------|-------------------|
| 0 | ✅ | 不命中（无伤害/无击退） | 正常拼刀/拦截 |
| 1 | ✅ | 不命中 | 正常拼刀/拦截 |
| 2 | ✅ | 正常命中 | 正常拼刀/拦截 |

### 实现方案（已采用方案 C）

**选项 A：数据驱动**

在 `.collider.json` 的 box 级别增加 `activeFrame` 或 `hitActive` 标记，但当前扫描脚本不支持，且改动面大。

**选项 B：状态图事件驱动（已废弃）**

原 `LongSwordMan.json` 的 `thrust`/`quart` 状态有 `events` 字段（`hitbox_on`/`hitbox_off`），但这些事件仅做日志/调试，未参与战斗逻辑。后因语义混淆（与未来的音效/特效事件系统冲突），已删除。

**选项 C：状态图增加 `attackActiveFrames` 字段（已采用）**

在状态定义中增加显式字段：

```json
"thrust": {
    "attackActive": true,
    "attackActiveFrames": [2]
}
```

`getCombatSnapshot()` 中检查当前帧是否在 `attackActiveFrames` 数组内。

**修改点**：

1. **`Character.getCombatSnapshot()`**：
   - `attackInstanceId` 始终基于 `stateEntrySerial` 生成（进入攻击状态时即生成，跨帧一致）
   - `weaponRole` 根据当前帧是否在 `attackActiveFrames` 内决定：`"offense"`（激活帧）或 `"guard"`（非激活帧）

2. **`ContactResolver` Phase 2**：
   - `weapon vs hitbox` 命中检查时，增加 `weaponRole === "offense"` 条件，确保只有激活攻击帧才能真正命中

3. **`LongSwordMan.json` 更新**：
   ```json
   "thrust": {
       "attackActive": true,
       "attackActiveFrames": [2]
   },
   "quart": {
       "attackActive": true,
       "attackActiveFrames": [3]
   }
   ```

### 与现有规则的冲突

| 冲突点 | 说明 | 解决 |
|-------|------|------|
| `guard weaponbox` 语义 | 非 `attackActive` 状态的 weaponbox 标记为 `guard`，用于拦截但不主动攻击 | 规则 1 的 thrust 前两帧仍属于 `attackActive === true` 的状态，但 `weaponRole` 为 `"guard"`，这与现有 `guard` 语义一致 ✅ |
| 拼刀逻辑 | `ContactResolver` 中 `weapon vs weapon` 不依赖 `weaponRole`，只看 `weaponbox` 类型和 subtype | 前两帧仍可正常拼刀 ✅ |
| AIKnowledgeRegistry | 扫描攻击时间时以 `attackActive` 状态和有 weaponbox 的帧为准 | 已更新扫描逻辑，优先使用 `attackActiveFrames` 过滤有效攻击帧 ✅ |

---

## 规则 2：Dodge 无敌帧

### 当前现状

`RabbleStick.json` 的 `dodge` 状态：

```json
"dodge": {
    "clip": "dodge",
    "loop": false,
    "frameSpeeds": [1, 0.4]
}
```

`Dodge.collider.json` 两帧都有 `hitbox`：

| 帧 | hitbox 存在 | 当前行为 |
|---|------------|---------|
| 0 | ✅ | 可被对手 weaponbox 命中，进入 hit |
| 1 | ✅ | 同上 |

### 期望行为

dodge 全期间（frame 0 ~ frame 1）不被任何 weaponbox 命中。

### 实现方案

**选项 A：状态图增加 `invincible` 标记（推荐）**

在 `RabbleStick.json` 的 `dodge` 状态增加：

```json
"dodge": {
    "clip": "dodge",
    "invincible": true
}
```

**修改点**：

1. **`Character.getCombatSnapshot()`**：
   - 当 `currentStateDef?.invincible === true` 时，不输出 `hitbox` 类型的 box
   - 或输出但标记为 `inactive`，让 `ContactResolver` 忽略

2. **`ContactResolver.#collectFrameContacts()`**：
   - 收集 `weaponVsHitbox` 时，跳过目标方 `invincible` 的 hitbox
   - 更简洁的做法：`getCombatSnapshot()` 直接不输出 hitbox

**选项 B：hitbox 增加 `guard` 语义扩展**

把 dodge 的 hitbox 视为一种 `guard_hitbox`，但当前系统没有这种类型，改动面大。

**选项 C：数据层移除 dodge 的 hitbox**

直接修改 `Dodge.collider.json`，把两帧的 `hitbox` 删除，只保留 `pushbox`。但这样失去了"非无敌状态下 dodge 仍应有 hitbox"的灵活性，且数据层与逻辑层耦合。

### 与现有规则的冲突

| 冲突点 | 说明 | 解决 |
|-------|------|------|
| `hit` 状态转移 | `RabbleStick.json` 中 `hit` 通过 `command: "hit"` 触发，而 `takeDamage()` 内强制进入 `hit` | dodge 期间 `invincible` 为 true，`ContactResolver` 不会产生命中效果，`takeDamage` 不会被调用，因此不会打断 dodge ✅ |
| `guard weaponbox` 语义 | 当前 `guard` 仅用于 weaponbox，不用于 hitbox | `invincible` 是独立的 hitbox 层级概念，与 `guard` 不冲突 ✅ |
| 推挤逻辑 | `PushboxResolver` 使用 `pushbox`，与 `hitbox` 无关 | dodge 期间 pushbox 仍存在，角色间仍可推挤 ✅ |
| 拼刀逻辑 | dodge 没有 weaponbox，不参与拼刀 | 无冲突 ✅ |

---

## 与归档计划中历史想法的冲突

### 1. `guard weaponbox` 语义（RABBLE_STICK_HIT_INTEGRATION_PLAN.md）

历史设计：
> `state.attackActive !== true` 的 `weaponbox` 标记为 `guard`，用于拦截，不作为主动攻击实例。

冲突：规则 1 的 thrust 前两帧属于 `attackActive === true` 的状态，但不应产生攻击实例。如果直接不生成 `attackInstanceId`，则 weaponbox 会被标记为 `guard`，这恰好与历史 `guard` 语义一致，**无冲突**。

### 2. 攻击实例生命周期（RABBLE_STICK_HIT_INTEGRATION_PLAN.md）

历史设计：
> 当前"攻击结束"采用隐式判定：当某 `attackInstanceId` 不再出现在 `activeAttackIds` 集合中，即视为结束并释放去重记录。

冲突：规则 1 的 thrust 中，`attackInstanceId` 只在 frame 2 出现，frame 0-1 不出现。这意味着同一招 thrust 的 `attackInstanceId` 会"时有时无"，隐式生命周期判定可能过早释放去重记录，导致 frame 2 的命中无法被正确去重（如果对手在 frame 0-1 已经被"预命中"过）。

**解决**：需要把 `attackInstanceId` 的生成逻辑与"是否命中"解耦。`attackInstanceId` 应在进入攻击状态时即生成（基于 `stateEntrySerial`），但"是否可命中"由帧级标记控制。或者，改为显式生命周期：`enterState` 时生成 `attackInstanceId`，`exitState`/`animationEnd` 时释放。

### 3. 受击锁定机制（RABBLE_STICK_HIT_INTEGRATION_PLAN.md）

历史设计：
> 暂不做受击锁定机制：`hit` 动画期间不配攻击/受击碰撞盒即可避免重复交互。

冲突：规则 2 的 dodge `invincible` 是一种更通用的"受击锁定"，但作用于 hitbox 层级而非状态层级。这与历史设计方向一致（都是避免受击），只是实现层级不同，**无冲突**。

### 4. 任意状态进入 hit（RABBLE_STICK_HIT_INTEGRATION_PLAN.md）

历史设计：
> 需要支持"任意状态进入 hit"。

冲突：规则 2 的 dodge 期间不应进入 hit。如果 `takeDamage` 内强制切状态，需要增加 `invincible` 判断：

```javascript
takeDamage(ctx) {
    if (this.currentStateDef?.invincible) return false;
    // ... 原有逻辑
}
```

这与"任意状态进入 hit"不冲突，只是增加了例外条件。

---

## 推荐实施顺序

### 阶段 1：规则 2（Dodge 无敌）—— 改动面小，先落地

1. 修改 `RabbleStick.json`，`dodge` 状态增加 `"invincible": true`
2. 修改 `Character.getCombatSnapshot()`，`invincible` 状态不输出 `hitbox`
3. 验证：dodge 期间被 thrust 击中不进入 hit

### 阶段 2：规则 1（Thrust 帧级攻击判定）—— 需要调整攻击实例生命周期

1. 选择实现方案（推荐选项 B：扩展 `events` 语义，或选项 C：增加 `attackActiveFrames`）
2. 修改 `LongSwordMan.json` 的 `thrust` 状态，标记有效攻击帧
3. 修改 `Character.getCombatSnapshot()`，增加帧级攻击判定
4. **关键**：同步调整 `attackInstanceId` 生成逻辑，确保同一招的 `attackInstanceId` 跨帧一致（基于 `stateEntrySerial` 而非"当前帧是否有攻击判定"）
5. 验证：thrust frame 0-1 碰到 hitbox 不命中，frame 2 正常命中；frame 0-1 碰到 weaponbox 正常拼刀

### 阶段 3：回归验证

1. `hero` 可正常移动、thrust、quart
2. `rabble_stick` 的 TestController 脚本正常运行
3. `rabble_stick` dodge 期间不被命中
4. `longswordman` thrust 仅最后一帧命中
5. 拼刀逻辑不受影响
6. `C` 键碰撞显示正常

---

## 文件改动清单

| 文件 | 改动内容 |
|------|---------|
| `Data/StateGraphDef/RabbleStick.json` | `dodge` 状态增加 `"invincible": true` |
| `Data/StateGraphDef/LongSwordMan.json` | `thrust` 状态增加攻击帧标记（`events` 或 `attackActiveFrames`） |
| `scripts/Enties/Character.js` | `getCombatSnapshot()` 增加 `invincible` 和帧级攻击判定逻辑；`takeDamage()` 增加 `invincible` 防御 |
| `scripts/Systems/ContactResolver.js` | 可能不需要改动（如果 `getCombatSnapshot` 已过滤） |
| `scripts/Systems/AIKnowledgeRegistry.js` | 扫描逻辑适配新的攻击帧标记 |

---

---

## 规则 3：格挡（Guard）与重击（Heavy Attack）

### 背景

在现有轻击（thrust）、中击（quart）基础上，引入：
- **格挡状态**：专门动画，2-4 帧，可拦截对手攻击并触发派生
- **重击**：明显前后摇的高风险高回报攻击
- **格挡派生机制**：格挡成功后可减免前摇地派生重击或中击

### 格挡机制

#### 状态定义

```json
"guard": {
    "clip": "guard",
    "guardActive": true,
    "loop": false,
    "events": [
        { "atFrame": 0, "name": "guardbox_on" },
        { "atFrame": 3, "name": "guardbox_off" }
    ],
    "transitions": [
        {
            "to": "idle",
            "when": [
                { "time": "normalized", "op": ">=", "value": 1.0 }
            ]
        },
        {
            "to": "heavy",
            "when": [
                { "command": "heavy" },
                { "hasTag": "parryBonus" }
            ]
        },
        {
            "to": "quart",
            "when": [
                { "command": "quart" },
                { "hasTag": "parryBonus" }
            ]
        }
    ]
}
```

#### 运行时行为

| 情况 | 结果 |
|-----|------|
| 强剑身（strong_blade）碰对手任意 weaponbox | 给自身打 `parryBonus: "heavy"` 标记 |
| 弱剑身（weak_blade）碰对手任意 weaponbox | 给自身打 `parryBonus: "medium"` 标记 |
| 格挡状态下被对手 weaponbox 命中 | 进入弹刀状态（暂复用 `hit`，之后换专门动画） |

#### 实现要点

1. **`Character.js` 新增状态标记系统**：
   ```javascript
   this.stateTags = new Map(); // tag -> { value, expiresAt }
   
   #cleanupTags() {
       const now = performance.now();
       for (const [tag, data] of this.stateTags) {
           if (data.expiresAt && now > data.expiresAt) {
               this.stateTags.delete(tag);
           }
       }
   }
   ```

2. **`getCombatSnapshot()` 扩展**：
   - `guardActive === true` 的 weaponbox → `weaponRole: "guard"`, `canParry: true`

3. **`ContactResolver` 扩展**：
   - `offense vs guard` 且 `canParry === true` 时：
     - 攻击方失效（同现有 guard 逻辑）
     - 给防守方打 `parryBonus` 标记（有效期 = 格挡动画剩余时间 + 2-3 帧缓冲）

4. **状态图条件扩展**：
   - 支持 `hasTag` 条件检查
   - 支持 `tagValue` 精确匹配

### 重击机制

#### 状态定义

```json
"heavy": {
    "clip": "heavy",
    "attackActive": true,
    "loop": false,
    "events": [
        { "atFrame": 2, "name": "hitbox_on" },
        { "atFrame": 3, "name": "hitbox_off" }
    ],
    "timeScale": 1.0,
    "parryTimeScale": 1.75,
    "transitions": [
        {
            "to": "idle",
            "when": [
                { "time": "normalized", "op": ">=", "value": 1.0 }
            ]
        }
    ]
}
```

#### 减免前摇

- 普通重击：`timeScale = 1.0`（正常播放）
- 格挡派生重击：`timeScale = 1.75`（前摇减半左右）
- 格挡派生中击：`timeScale = 1.5`

`Character.enterState()` 时检查：
```javascript
const timeScale = this.stateTags.has("parryBonus") 
    ? (stateDef.parryTimeScale ?? stateDef.timeScale ?? 1.0)
    : (stateDef.timeScale ?? 1.0);
this.animation.setTimeScale(timeScale);
```

#### `FrameAnimationComponent` 扩展

```javascript
setTimeScale(scale) {
    this.timeScale = scale ?? 1.0;
}

update(dtMs) {
    const effectiveDt = dtMs * (this.timeScale ?? 1.0);
    this.accumulatedTime += effectiveDt;
    // ... 原有逻辑
}
```

### 与现有规则的联动

| 机制 | 规则1 (thrust帧判定) | 规则2 (dodge无敌) | 规则3 (格挡+重击) |
|-----|---------------------|------------------|-------------------|
| 帧级攻击判定 | ✅ thrust 用 `events` | — | ✅ 重击用 `events` |
| 状态标记 | — | `invincible` | `parryBonus` |
| 动画速度控制 | — | — | `timeScale` |
| 状态图扩展 | — | — | `guard` 状态 + `hasTag` 条件 |

### 与现有规则的冲突

| 冲突点 | 说明 | 解决 |
|-------|------|------|
| `guard weaponbox` 语义 | 现有 `guard` 是被动标记，新格挡是主动状态 | 格挡状态的 `guardActive` 是显式声明，weaponbox 带 `canParry` 属性，与被动 `guard` 共存 ✅ |
| 弹刀状态 | 暂复用 `hit`，之后换专门动画 | `hit` 期间无 hitbox，不能继续被打 ✅ |
| 攻击实例生命周期 | 重击也需要帧级判定 | 与规则1共用同一套 `events` / `attackActiveFrames` 机制 ✅ |

---

## 更新后的推荐实施顺序

### ✅ 阶段 1：规则 2（Dodge 无敌）—— 已完成

1. ✅ 修改 `RabbleStick.json`，`dodge` 状态增加 `"invincible": true`
2. ✅ 修改 `Character.getCombatSnapshot()`，`invincible` 状态不输出 `hitbox`
3. ✅ 修改 `Character.takeDamage()`，`invincible` 状态直接返回 `false`
4. ⏳ 验证：dodge 期间被 thrust 击中不进入 hit

### ✅ 阶段 2：规则 1（Thrust 帧级攻击判定）—— 已完成

1. ✅ 选择实现方案 C（`attackActiveFrames` 字段）
2. ✅ 修改 `LongSwordMan.json`：删除 `events`，新增 `attackActiveFrames`（thrust: [2], quart: [3]）
3. ✅ 修改 `Character.getCombatSnapshot()`：`attackInstanceId` 始终生成，`weaponRole` 根据 `attackActiveFrames` 决定
4. ✅ 修改 `ContactResolver`：Phase 2 增加 `weaponRole === "offense"` 检查
5. ✅ 修改 `AIKnowledgeRegistry`：扫描逻辑适配 `attackActiveFrames`
6. ⏳ 验证：thrust frame 0-1 碰到 hitbox 不命中，frame 2 正常命中

### 🔄 阶段 3：规则 3 基础设施（状态标记 + 动画速度）—— 当前重点

1. `Character.js` 新增 `stateTags` 系统
2. `FrameAnimationComponent.js` 新增 `timeScale` 支持
3. 状态图条件扩展 `hasTag` / `tagValue`
4. 验证：基础机制可用

### ⏳ 阶段 4：规则 3 格挡与重击

1. 新增 `parry` 状态（状态图定义，动画资源后续补，暂用占位动画）
2. 新增 `hellish_quart` 状态（状态图定义，动画资源后续补，暂用占位动画）
3. `ContactResolver` 扩展 `canParry` 逻辑，打 `parryBonus` 标记
4. 输入绑定（parry / hellish_quart 按键）
5. 验证：格挡 → 派生重击/中击流程跑通

---

## 更新后的文件改动清单

| 文件 | 改动内容 |
|------|---------|
| `Data/StateGraphDef/RabbleStick.json` | `dodge` 状态增加 `"invincible": true` |
| `Data/StateGraphDef/LongSwordMan.json` | `thrust` 状态增加攻击帧标记；新增 `guard` / `heavy` 状态 |
| `scripts/Enties/Character.js` | `getCombatSnapshot()` 增加 `invincible`、帧级攻击判定、`guardActive`、`canParry`；新增 `stateTags` 系统；`takeDamage()` 增加 `invincible` 防御 |
| `scripts/Components/FrameAnimationComponent.js` | 新增 `timeScale` 支持 |
| `scripts/Systems/ContactResolver.js` | 扩展 `guard` 逻辑，支持 `canParry` 和 `parryBonus` 标记 |
| `scripts/Systems/AIKnowledgeRegistry.js` | 扫描逻辑适配新的攻击帧标记 |

---

## 风险与注意

1. **攻击实例生命周期**：规则 1 最大的风险是 `attackInstanceId` 的生成时机。如果改为"进入状态即生成"，需要确保 `ContactResolver` 的 `hitDedupe` 和 `clashDedupe` 在攻击未激活的帧不提前消费。
2. **事件系统扩展**：如果选择选项 B（`events` 语义），需要明确 `hitbox_on`/`hitbox_off` 的规范，避免与未来的"真正 hitbox 开关"混淆。
3. **AI 扫描**：`AIKnowledgeRegistry` 当前扫描攻击时间时，以有 weaponbox 的帧为准。规则 1 落地后，需要改为以 `attackInstanceId` 实际存在的帧为准，否则 AI 会误判 thrust 的攻击前摇和持续帧。
4. **格挡派生窗口**：`parryBonus` 标记的有效期需要仔细调试，太长会过于强势，太短会难以触发。
5. **动画资源依赖**：`guard` 和 `heavy` 的动画资源尚未就绪，阶段 4 需要等资源到位后才能完整验证。
