# Timed Tags 机制计划

> 目标：实现带有效期的状态标记（Timed Tags），用于 `parryBonus` 等限时效果，并为后续 FTG/ACT 机制打下基础。

---

## 背景

当前 `parryBonus` 等标记使用无差别的 `Set` 存储（`stateTags`），`enterState()` 时一刀切 `clearTags()`。这导致：
- Just Guard 成功后进入 `clash` 状态，`parryBonus` 被意外清除
- 无法支持"格挡动画剩余时间 + 2-3 帧缓冲"的设计意图

---

## 目标

1. 标记可设置过期逻辑帧（`expireTick`）
2. 过期自动清除，不依赖 `enterState`
3. `clearTags()` 只清除无过期时间的普通标记，保留未到期的 Timed Tags
4. 为后续所有限时效果提供统一机制

---

## 设计

### 数据结构

```javascript
// Character.js
this.stateTags = new Set();           // 普通标记（立即生效，手动清除）
this.timedTags = new Map();           // 定时标记 tag -> expireTick
```

### API

```javascript
// 添加普通标记（现有）
addTag(tag) {
    this.stateTags.add(tag);
}

// 添加定时标记（新增）
addTimedTag(tag, durationFrames) {
    this.stateTags.add(tag);
    this.timedTags.set(tag, this.tickCount + durationFrames);
}

// 检查标记（现有，不变）
hasTag(tag) {
    return this.stateTags.has(tag);
}

// 清除普通标记（修改：不清除 timedTags）
clearTags() {
    // 只清除不在 timedTags 中的标记
    for (const tag of this.stateTags) {
        if (!this.timedTags.has(tag)) {
            this.stateTags.delete(tag);
        }
    }
}

// 强制清除所有（包括定时标记）
clearAllTags() {
    this.stateTags.clear();
    this.timedTags.clear();
}

removeTag(tag) {
    this.stateTags.delete(tag);
    this.timedTags.delete(tag);
}
```

### 过期检查

```javascript
fixedUpdate(dtMs, tickCount) {
    // 清理过期标记
    for (const [tag, expireTick] of this.timedTags) {
        if (tickCount >= expireTick) {
            this.stateTags.delete(tag);
            this.timedTags.delete(tag);
            console.log(`[TimedTag] ${this.id}: ${tag} expired at tick ${tickCount}`);
        }
    }
    // ... 原有逻辑
}
```

---

## 应用到 parryBonus

### ContactResolver.js

```javascript
if (canParry) {
    // 计算 guard 动画剩余帧数 + 缓冲
    const guardClip = guardSnapshot?.clipName; // 需要 snapshot 扩展
    // 简化：直接给固定有效期，后续可精确计算
    effects.push({
        type: "parryBonus",
        targetId: guardCharacterId,
        context: { durationFrames: 15 } // guard 2帧(约12tick) + 3缓冲
    });
}
```

### CombatSystem.js

```javascript
if (effect.type === "parryBonus") {
    const duration = effect.context?.durationFrames ?? 15;
    if (typeof target.addTimedTag === "function") {
        target.addTimedTag("parryBonus", duration);
    }
    continue;
}
```

### 效果

- Just Guard 成功 -> `parryBonus` 打上，有效期 15 帧
- 进入 `clash` -> `clearTags()` 不清除 `parryBonus`（因为它在 `timedTags` 中）
- 玩家在 15 帧内按 `zornhut` -> `hasTag("parryBonus")` 为 `true` -> 成功派生
- 15 帧后 -> `fixedUpdate` 自动清除 -> 派生窗口关闭

---

## 后续可复用场景

| 特性 | 标记 | 有效期示例 |
|------|------|-----------|
| 连击窗口 | `comboWindow` | 30 帧 |
| 闪避无敌 | `dodgeInvincible` | dodge 动画帧数 |
| 霸体 | `superArmor` | 招式 active 帧数 |
| 属性附魔 | `fireEnchant` | 300 帧（5秒） |
| 完美闪避 | `perfectDodge` | 10 帧 |
| 眩晕 | `stunned` | 60 帧 |

---

## 文件改动

| 文件 | 改动 |
|------|------|
| `scripts/Enties/Character.js` | 新增 `timedTags`，`addTimedTag()`，修改 `clearTags()`，`fixedUpdate` 增加过期检查 |
| `scripts/Systems/CombatSystem.js` | `parryBonus` effect 改用 `addTimedTag` |
| `scripts/Systems/ContactResolver.js` | `parryBonus` effect 增加 `durationFrames` context |

---

## 风险

1. **内存泄漏**：如果 `timedTags` 只增不删（比如 `fixedUpdate` 没执行），可能累积。需确保过期检查每帧运行。
2. **与 `clearAllTags` 混淆**：某些场景（如角色死亡重置）需要强制清除所有标记，应使用 `clearAllTags()` 而非 `clearTags()`。
3. **tickCount 来源**：`addTimedTag` 必须在 `fixedUpdate` 的 `tickCount` 有效后调用，否则计算过期帧可能不准。
