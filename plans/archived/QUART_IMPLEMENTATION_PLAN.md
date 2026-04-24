# Quart招数实现计划

## 目标
为长剑角色添加quart招数，支持键盘I键和手柄Y按钮触发，并实现状态相关的速度倍率系数功能。

## 当前进度总结
**Quart招数已基本实现，功能正常可用！**

## 资源检查结果 ✅

**资源文件已完整：**
- ✅ `Art/Sprite/longswordman_quart.json` - 动画图集
- ✅ `Data/CollisionMask/longswordman_quart.json` - 碰撞遮罩图集  
- ✅ `Data/RootMotion/longswordman_quart.json` - 根运动数据
- ✅ `Data/StateGraphDef/LongSwordMan.json` - 状态定义已包含quart状态
- ✅ `Data/CollisionMask/longswordman_quart.collider.json` - 碰撞数据（已生成）

## 已完成修改 ✅

### 1. InputSystem.js - 输入映射已添加 ✅
- ✅ 键盘I键映射到quart命令
- ✅ 手柄Y按钮映射到quart命令
- ✅ 输入调试面板显示I键和Y按钮状态

### 2. LongSwordMan.json - 状态转换已添加 ✅
- ✅ idle状态中添加quart转换条件
- ✅ move状态中添加quart转换条件
- ✅ quart状态定义完整（包含hitbox事件和返回idle的转换）
- ✅ inputs.commands数组中声明quart命令

### 3. PlayerController.js - 命令处理已添加 ✅
- ✅ 在#handleActionPressed方法中添加quart命令处理
- ✅ 命令推送逻辑优化（避免状态机冲突）

### 4. character_demo.js - 动画配置已添加 ✅
- ✅ 加载quart动画数据（longswordman_quart.json）
- ✅ 加载quart碰撞数据（longswordman_quart.collider.json）
- ✅ Character的clips配置中添加quart动画剪辑

## 待完成任务 🔄

### Character.js - 状态速度倍率系数（可选）
- 🔄 在状态定义中添加speedMultiplier字段
- 🔄 在Character类中添加速度倍率控制机制

## 实施过程总结

### 关键问题与解决方案

1. **输入不响应问题**
   - 问题：添加quart命令后所有输入不响应
   - 原因：PlayerController的命令处理逻辑冲突
   - 解决：优化#flushCommandsToCharacter方法，避免状态机冲突

2. **动画剪辑未找到错误**
   - 问题："Unknown animation clip: quart"错误
   - 原因：character_demo.js中缺少quart动画配置
   - 解决：添加quart动画数据加载和剪辑配置

3. **碰撞数据文件缺失错误**
   - 问题："Failed to load JSON"错误
   - 原因：longswordman_quart.collider.json文件不存在
   - 解决：运行extract_collision_boxes.ps1脚本生成碰撞数据

### 功能测试结果 ✅
- ✅ 键盘I键可正常触发quart动画
- ✅ 手柄Y按钮可正常触发quart动画
- ✅ 状态机正确转换到quart状态
- ✅ quart动画正常播放并返回idle状态
- ✅ 其他输入功能正常不受影响

## 详细实施记录
```javascript
// 在keyboard对象中添加i键
keyboard: {
    w: false,
    a: false, 
    s: false,
    d: false,
    l: false,
    i: false  // 新增
}

// 在gamepad对象中添加Y按钮
gamepad: {
    // ... 现有属性
    y: false  // 新增
}

// 在按键处理中添加quart触发逻辑
if (!wasDown && isDown && key === "i") {
    this.#emitActionPressed("quart", {
        source: "keyboard", 
        key: "i"
    });
}
```

### 阶段2：修改LongSwordMan.json状态图
在idle和move状态的transitions数组中添加quart转换：
```json
{
    "to": "quart",
    "when": [
        { "command": "quart" }
    ]
}
```

### 阶段3：修改Character.js添加状态速度倍率系数

#### 3.1 在状态定义中添加speedMultiplier字段
```json
"move": {
    "clip": "move",
    "loop": true,
    "speedMultiplier": 1.0,  // 移动状态速度倍率
    "transitions": [...]
},
"thrust": {
    "clip": "thrust", 
    "loop": false,
    "speedMultiplier": 1.5,  // 刺击状态速度倍率
    "transitions": [...]
},
"quart": {
    "clip": "quart",
    "loop": false,
    "speedMultiplier": 2.0,  // quart状态速度倍率
    "transitions": [...]
}
```

#### 3.2 在Character类中添加速度倍率控制（可选）
```javascript
// 在构造函数中添加
this.currentSpeedMultiplier = 1.0;

// 修改#applyMovement方法，应用速度倍率
#applyMovement(dtMs) {
    if (this.currentStateName !== "move") {
        return;
    }
    
    // 应用状态相关的速度倍率
    const speedMultiplier = this.currentStateDef?.speedMultiplier ?? 1.0;
    // ... 现有移动逻辑乘以speedMultiplier
```
    
    const effectiveSpeed = this.walkSpeed * this.currentSpeedMultiplier;
    // ... 使用effectiveSpeed进行移动计算
}

// 在enterState方法中设置当前速度倍率
enterState(stateName) {
    const stateDef = this.stateGraph?.states?.[stateName];
    if (!stateDef) {
        throw new Error(`Unknown character state: ${stateName}`);
    }
    
    this.currentStateName = stateName;
    this.currentStateDef = stateDef;
    this.currentSpeedMultiplier = stateDef.speedMultiplier ?? 1.0;  // 设置速度倍率
    
    // ... 其他逻辑
}
```

### 阶段4：验证资源路径
确保以下文件存在：
- `Art/Sprite/longswordman_quart.png`
- `Data/CollisionMask/longswordman_quart.png` 
- `Data/CollisionMask/longswordman_quart.collider.json`

## 速度倍率系数设计

### 默认倍率值建议：
- **idle**: 0.0（不移动）
- **move**: 1.0（基础速度）
- **thrust**: 1.5（刺击时加速）
- **quart**: 2.0（quart招数时高速移动）

### 实现优势：
1. **灵活性**：每个状态可以有不同的移动速度
2. **可配置性**：通过JSON配置轻松调整
3. **向后兼容**：未设置speedMultiplier的状态默认为1.0
4. **状态驱动**：移动速度与动画状态完全同步

## 风险评估
- **低风险**：所有修改都是增量添加，不会影响现有功能
- **需要验证**：quart动画的碰撞箱数据和根运动数据是否正确
- **建议测试**：在实现后测试不同状态的速度倍率是否正确应用

## 实施顺序
1. ✅ InputSystem.js修改（已完成预览）
2. → LongSwordMan.json状态图修改
3. → Character.js速度倍率功能
4. → 资源验证和测试

## 验收标准
1. 键盘I键和手柄Y按钮能正确触发quart招数
2. 从idle和move状态都能正确转换到quart状态
3. 不同状态应用正确的速度倍率系数
4. quart动画播放正常，碰撞箱正确显示
5. 移动速度与状态定义的速度倍率一致