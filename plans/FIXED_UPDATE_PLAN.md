# Fixed Update 与格斗游戏核心机制改造计划

> 目标：将当前变帧率更新改造为固定 60fps 逻辑帧，实现输入缓冲、Just Guard 精确时机判定、hitstop 等格斗游戏标准机制。

---

## 背景与问题

当前项目采用变帧率 `update(dtMs)`，每帧间隔不固定（16ms ~ 33ms+）。这导致：

1. **判定不稳定**：同样的输入时机，在不同帧率下结果不同
2. **Just Guard 难以实现**：没有时间基准，无法定义"命中前 N 帧"
3. **输入手感差**：按键响应延迟不固定，玩家难以掌握时机
4. **网络同步困难**：变帧率难以做回滚/预测

---

## 目标

1. **Fixed Update**：逻辑更新固定 60fps（16.67ms/tick）
2. **输入缓冲**：接受 3-5 帧的预输入，降低操作精度要求
3. **Just Guard**：guard 在攻击命中前 2-3 帧内按下才触发 parry
4. **Hitstop**：命中/防御瞬间双方暂停 8-24 帧
5. **Blockstun/Hitstun**：防御/受击后硬直冻结，不能立即行动

---

## 参考游戏机制

| 游戏 | 机制 | 参数 |
|------|------|------|
| Guilty Gear | Instant Block | 命中前 8 帧内防御 |
| Street Fighter 3 | Parry | 命中前 6-10 帧内输入 |
| For Honor | Superior Block | 命中瞬间防御 |
| Skullgirls | Hitstop | 轻攻击 8 帧，重攻击 16 帧 |
| 通用格斗游戏 | Input Buffer | 3-5 帧预输入窗口 |

---

## 实施阶段

### 阶段 1：Fixed Update 基础改造

**目标**：逻辑更新固定 60fps，渲染与逻辑分离。

#### 1.1 Scene.js 改造

```javascript
const FIXED_DT = 1000 / 60; // 16.67ms

class Scene {
    constructor() {
        this.accumulator = 0;
        this.tickCount = 0;
    }
    
    update(dtMs) {
        this.accumulator += dtMs;
        
        // 限制最大累积，避免卡顿后突然大量更新
        if (this.accumulator > 100) this.accumulator = 100;
        
        while (this.accumulator >= FIXED_DT) {
            this.tickCount++;
            this.fixedUpdate(FIXED_DT);
            this.accumulator -= FIXED_DT;
        }
    }
    
    fixedUpdate(dtMs) {
        this.inputSystem.fixedUpdate();      // 收集输入
        this.playerController.fixedUpdate(dtMs);
        this.rabbleController.fixedUpdate(dtMs);
        this.character.fixedUpdate(dtMs, this.tickCount);
        this.rabbleStick.fixedUpdate(dtMs, this.tickCount);
        this.pushboxResolver.resolve([...]);
        this.stageBoundary.clampCharacter(...);
        this.combatSystem.fixedUpdate([...]);
    }
}
```

#### 1.2 Character.js 改造

```javascript
// 新增 fixedUpdate，替代 update 作为逻辑更新入口
fixedUpdate(dtMs, tickCount) {
    // ... 原有 update 逻辑 ...
    this.tickCount = tickCount;
}

enterState(stateName) {
    // ...
    this.stateEnterTick = this.tickCount;  // 记录进入时的逻辑帧号
    this.stateEnterTime = performance.now(); // 保留时间戳备用
}

getCombatSnapshot() {
    return {
        // ...
        stateEnterTick: this.stateEnterTick,
        stateEnterTime: this.stateEnterTime,
    };
}
```

#### 1.3 FrameAnimationComponent.js 改造

```javascript
// update 改为 fixedUpdate
fixedUpdate(dtMs) {
    const scaledDt = dtMs * this.timeScale;
    // ... 原有逻辑 ...
}
```

#### 1.4 CombatSystem.js / ContactResolver.js 改造

```javascript
// update 改为 fixedUpdate
fixedUpdate(characters) {
    const result = this.resolver.resolve(characters);
    // ... 原有逻辑 ...
}
```

**验证**：
- [ ] 游戏运行正常，动画播放正常
- [ ] 不同刷新率显示器（60Hz / 144Hz）下逻辑帧率一致
- [ ] `tickCount` 每帧稳定 +1

---

### 阶段 2：输入缓冲（Input Buffering）

**目标**：降低操作精度要求，允许 3-5 帧的预输入。

#### 2.1 InputSystem.js 改造

```javascript
class InputSystem {
    constructor() {
        this.bufferedInputs = [];  // [{ key, tick, consumed }]
        this.BUFFER_WINDOW = 5;    // 5 帧缓冲窗口
    }
    
    onKeyDown(key) {
        this.bufferedInputs.push({
            key,
            tick: this.currentTick,
            consumed: false
        });
    }
    
    fixedUpdate(tickCount) {
        this.currentTick = tickCount;
        
        // 清理过期的输入
        this.bufferedInputs = this.bufferedInputs.filter(
            input => tickCount - input.tick <= this.BUFFER_WINDOW
        );
    }
    
    // 查询某 tick 是否有未消费的输入
    hasInput(key, tick) {
        return this.bufferedInputs.some(
            input => input.key === key && !input.consumed && tick - input.tick <= this.BUFFER_WINDOW
        );
    }
    
    consumeInput(key, tick) {
        const input = this.bufferedInputs.find(
            input => input.key === key && !input.consumed && tick - input.tick <= this.BUFFER_WINDOW
        );
        if (input) {
            input.consumed = true;
            return true;
        }
        return false;
    }
}
```

#### 2.2 PlayerController.js 改造

```javascript
// 从 InputSystem 消费缓冲输入，而不是直接读取当前按键
fixedUpdate(dtMs) {
    if (this.inputSystem.consumeInput('zornhut', this.tickCount)) {
        this.character.pushCommand('zornhut');
    }
    if (this.inputSystem.consumeInput('guard', this.tickCount)) {
        this.character.pushCommand('guard');
    }
    // ...
}
```

**验证**：
- [ ] 提前 3-5 帧输入指令，角色能在可行动时立即执行
- [ ] 输入不会重复消费
- [ ] 过期输入自动清理

---

### 阶段 3：Just Guard 时机判定

**目标**：guard 必须在攻击命中前按下，或命中瞬间极短窗口内按下，才触发 parry。

#### 3.1 设计参数

| 参数 | 值 | 说明 |
|------|-----|------|
| Pre-emptive Guard | 无限 | 攻击开始前按 guard，可以 parry |
| Just Guard 窗口 | 0 ~ +2 帧 | 攻击 active 后 0-2 帧内按 guard，可以 parry |
| Late Guard | > +2 帧 | 攻击 active 后超过 2 帧才 guard，只能普通防御 |

#### 3.2 ContactResolver.js 改造

```javascript
// Phase 1: offense vs guard
if (aOffense !== bOffense) {
    const offenseSnapshot = snapshotById.get(offenseCharacterId);
    const guardSnapshot = snapshotById.get(guardCharacterId);
    
    const offenseEnterTick = offenseSnapshot.stateEnterTick;
    const guardEnterTick = guardSnapshot.stateEnterTick;
    const tickDiff = guardEnterTick - offenseEnterTick;
    
    // guard 必须在攻击开始前，或攻击开始后 2 帧内
    const canParry = guardBox.canParry && tickDiff <= 2;
    
    if (this.#weaponLevelRank(guardLevel) >= this.#weaponLevelRank(offenseLevel)) {
        invalidatedAttacks.add(offenseAttackId);
        
        if (canParry) {
            effects.push({ type: "parryBonus", targetId: guardCharacterId });
            effects.push({ type: "hitstop", targetId: offenseCharacterId, durationFrames: 8 });
            effects.push({ type: "hitstop", targetId: guardCharacterId, durationFrames: 8 });
        } else {
            // 普通防御，无 parryBonus，无 hitstop 或短 hitstop
            effects.push({ type: "hitstop", targetId: offenseCharacterId, durationFrames: 4 });
            effects.push({ type: "hitstop", targetId: guardCharacterId, durationFrames: 4 });
        }
    }
}
```

**验证**：
- [ ] 提前按 guard → 可以 parry
- [ ] 攻击 active 瞬间按 guard → 可以 parry
- [ ] 攻击 active 后 3 帧以上才 guard → 只能普通防御

---

### 阶段 4：Hitstop（卡帧）

**目标**：命中/防御瞬间双方动画暂停，让玩家看到反馈。

#### 4.1 Character.js 改造

```javascript
class Character {
    constructor() {
        // ...
        this.hitstopFrames = 0;
    }
    
    applyHitstop(frames) {
        this.hitstopFrames = frames;
        this.animation.setTimeScale(0);
    }
    
    fixedUpdate(dtMs, tickCount) {
        if (this.hitstopFrames > 0) {
            this.hitstopFrames--;
            if (this.hitstopFrames <= 0) {
                this.animation.setTimeScale(1); // 或恢复状态定义的速度
            }
            // hitstop 期间：不推进动画，不移动，不检查转移
            return;
        }
        
        // ... 原有逻辑 ...
    }
}
```

#### 4.2 CombatSystem.js 改造

```javascript
fixedUpdate(characters) {
    const result = this.resolver.resolve(characters);
    
    for (const effect of result.effects) {
        const target = characters.find(c => c?.id === effect.targetId);
        if (!target) continue;
        
        switch (effect.type) {
            case "parryBonus":
                target.addTag("parryBonus");
                break;
            case "hitstop":
                target.applyHitstop(effect.durationFrames);
                break;
            case "damage":
                target.takeDamage(effect.context);
                break;
        }
    }
}
```

**验证**：
- [ ] 拼刀成功 → 双方暂停 8 帧
- [ ] 普通命中 → 双方暂停 12 帧
- [ ] hitstop 期间角色不能移动、不能输入
- [ ] hitstop 结束后恢复正常

---

### 阶段 5：Blockstun / Hitstun 硬直

**目标**：防御/受击后不能立即行动，有硬直冻结。

#### 5.1 设计

| 情况 | 硬直帧数 | 说明 |
|------|---------|------|
| Just Guard | 0 帧 | 完美防御，无硬直，可立即派生 |
| 普通防御 | 8-12 帧 | 有硬直，不能行动 |
| 轻攻击命中 | 12-16 帧 | 受击硬直 |
| 重攻击命中 | 20-30 帧 | 受击硬直 |

#### 5.2 实现

```javascript
// Character.js
applyBlockstun(frames) {
    this.blockstunFrames = frames;
    // 进入防御硬直状态，或当前状态加标记
}

applyHitstun(frames) {
    this.hitstunFrames = frames;
    // 进入受击硬直状态
}

fixedUpdate(dtMs, tickCount) {
    if (this.hitstopFrames > 0) return; // hitstop 优先
    
    if (this.blockstunFrames > 0 || this.hitstunFrames > 0) {
        this.blockstunFrames = Math.max(0, this.blockstunFrames - 1);
        this.hitstunFrames = Math.max(0, this.hitstunFrames - 1);
        // 硬直期间：不检查转移（或只检查特定转移）
        return;
    }
    
    // ... 正常逻辑 ...
}
```

**验证**：
- [ ] Just Guard → 无硬直，可立即派生
- [ ] 普通防御 → 硬直 8 帧，期间不能行动
- [ ] 受击 → 硬直 12+ 帧，期间不能行动

---

## 文件改动清单

| 文件 | 改动内容 |
|------|---------|
| `scripts/Scene.js` | 加 `accumulator`，拆分 `update` / `fixedUpdate`，传递 `tickCount` |
| `scripts/Enties/Character.js` | `update` → `fixedUpdate(dtMs, tickCount)`，加 `stateEnterTick`，加 `hitstopFrames` / `blockstunFrames` |
| `scripts/Components/FrameAnimationComponent.js` | `update` → `fixedUpdate` |
| `scripts/Systems/CombatSystem.js` | `update` → `fixedUpdate`，处理 `hitstop` 效果 |
| `scripts/Systems/ContactResolver.js` | 加 `tickDiff` 判定，`canParry` 依赖时机 |
| `scripts/Systems/InputSystem.js` | 加输入缓冲：`bufferedInputs`、`BUFFER_WINDOW`、`consumeInput` |
| `scripts/Systems/PlayerController.js` | 从 `InputSystem` 消费缓冲输入 |
| `Data/StateGraphDef/LongSwordMan.json` | 可能加 `blockstunFrames` / `hitstunFrames` 字段 |

---

## 与现有机制的兼容

| 现有机制 | 影响 | 解决 |
|---------|------|------|
| `timeScale` | hitstop 时设为 0，结束后恢复 | 保存恢复值 |
| `stateTags` | 进入新状态时清除 | 不变 |
| `parryBonus` | Just Guard 成功时添加 | 加时机判定 |
| `guardActiveFrames` | 可用 `tickDiff` 替代或共存 | 优先 `tickDiff` |
| 动画 `durationMs` | fixed update 下仍可用 | 不变 |

---

## 风险与注意

1. **累积误差**：`accumulator` 可能产生微小时钟漂移，需定期同步。
2. **性能**：极端卡顿下（`dtMs > 100ms`），限制最大更新次数避免死循环。
3. **输入延迟**：fixed update 天然有 0-16ms 延迟，输入缓冲可缓解。
4. **网络同步**：fixed update 是回滚/预测的基础，后续联机需在此基础上扩展。
5. **动画流畅度**：fixed update 16.67ms，但渲染 144fps，需确保动画插值或至少不卡顿。

---

## 参考实现

- **Unity**: `MonoBehaviour.FixedUpdate()` 默认 50fps（0.02s）
- **Godot**: `_physics_process(delta)` 固定帧率
- **Skullgirls**: 60fps 逻辑，输入缓冲 5 帧，hitstop 8-24 帧
- **Street Fighter**: 60fps 逻辑，Just Frame 窗口 1-3 帧