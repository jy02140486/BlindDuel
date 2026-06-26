# 战斗判定规则重设计计划

## 背景

当前判定基于"剑身强弱"（`strong_blade`/`weak_blade`），由碰撞蒙版颜色决定。这在小招数环境下过于细碎，不适合原型阶段。

新设计将判定逻辑从"武器部位"转向"招式属性"，命中规则更清晰、更易调试。

---

## 1. 设计概要

### 1.1 碰撞蒙版颜色新约定

| 颜色 | 直觉含义 | 扫描导出 subtype | 运行时含义 |
|------|------|-------------|-----------|
| `#FF0000` | 大红色 = 强剑身 | `weak_blade`（扫描脚本命名反了） | **防御盒** — guard 状态或被动 shield |
| `#E37800` | 橙色 = 弱剑身 | `strong_blade`（扫描脚本命名反了） | **攻击盒** — 所有攻击招式的武器判定区 |
| `#FFFF00` | `hitbox` | 受击盒（不变） |
| `#7082C1` | `root` | 根锚点（不变） |

扫描脚本无需修改，`.collider.json` 输出的 `subtype` 字段不变。运行时在 `getCombatSnapshot()` 中重新解释。

### 1.2 招式属性（状态图 JSON 新增字段）

| 字段 | 类型 | 说明 |
|------|------|------|
| `attackWeight` | `"light"` \| `"heavy"` | 攻击轻重 |
| `attackTrajectory` | `"thrust"` \| `"slash"` | 攻击轨迹（刺/斩） |
| `guardType` | `"guard"` \| `"shield"` | 防御类型（仅防御状态有意义） |

### 1.3 判定矩阵

```
Attack vs Attack（仅看轻重）：
  heavy > light（无论刺/斩）
  light vs light → clash
  heavy vs heavy → clash

Attack vs Guard（看轨迹）：
  trajectory = thrust → 攻方赢（刺破防）
  trajectory = slash  → 防方赢（斩被防）

Attack vs Shield（看轨迹+轻重）：
  trajectory = slash + weight = heavy → 攻方赢（重斩破盾）
  其他所有情况 → 防方赢

Attack vs Dodge：
  全部 → dodge 方赢（invincible，不输出 hitbox）
```

### 1.4 角色招式分配

| 角色 | 招式 | weight | trajectory | 备注 |
|------|------|:--:|:--:|------|
| **longswordman** | thrust | light | thrust | 已有 |
| | quart | light | slash | 已有 |
| | zornhut | heavy | slash | 已有 |
| | (重刺) | heavy | thrust | 未做 |
| | guard | — | — | `guardType: "guard"`，已有 |
| **rabble_stick** | thrust | light | thrust | 已有 |
| | swing | light | slash | 已有 |
| | dodge | — | — | `invincible`，已有 |
| **manatarms_sword** | quart | light | slash | 新角色 |
| | reverse_quart | light | slash | 新角色 |
| | smash | heavy | slash | 新角色 |
| | shield | — | — | `guardType: "shield"`，被动常驻 |

### 1.5 Shield 特殊机制

- **不是状态**：manatarms 在 idle/move 的碰撞蒙版中带有强剑身色盒子，运行时解释为 shield 盒
- **被动常驻**：只要 manatarms 不在攻击状态（无弱剑身盒子），shield 就生效
- **连招加速**：quart → reverse_quart 比裸出 reverse_quart 更快（`chainTimeScale` 机制）

### 1.6 Dodge 规范

- 2 帧含硬直，动画播完直接回 idle
- `invincible: true`（不输出 hitbox）
- 只向后位移，牺牲距离

---

## 2. 实施步骤

### Step 0：ASE Mask 更新 + 扫描（用户操作，前置）

**操作**：逐一修改 ASE 源文件中的 CollisionMask 图层，按新颜色约定重绘，然后运行扫描脚本。

**改动范围**：

| 角色 | 文件 | 改动 |
|------|------|------|
| longswordman | thrust/quart/zornhut 的 mask | 攻击区从 `#E37800` 改为 `#FF0000` |
| longswordman | guard 的 mask | 防御区保持 `#E37800` |
| rabble_stick | thrust/swing 的 mask | 攻击区从 `#E37800` 改为 `#FF0000` |
| rabble_stick | dodge 的 mask | 无需改动（仅 hitbox） |
| manatarms_sword | idle/move 的 mask | 盾区画 `#E37800`（防御盒） |
| manatarms_sword | quart/reverse_quart/smash 的 mask | 攻击区画 `#FF0000` |
| manatarms_sword | hit/knockdown 的 mask | 仅 hitbox |

**扫描命令**（参考 `COLLIDER_UPDATE_SKILL.md`）：

```powershell
# longswordman
powershell -ExecutionPolicy Bypass -File scripts/tools/extract_collision_boxes.ps1 `
  -CollisionAtlasJson "Data/CollisionMask/longswordman/longswordman_thrust.json" `
  -CollisionAtlasPng "Data/CollisionMask/longswordman/longswordman_thrust.png" `
  -RootAtlasJson "Data/RootMotion/longswordman/longswordman_thrust.json" `
  -RootAtlasPng "Data/RootMotion/longswordman/longswordman_thrust.png" `
  -OutJson "Data/CollisionMask/longswordman/longswordman_thrust.collider.json"

# ... 依此类推每个 action
```

**可测试性**：
- 检查 `.collider.json` 输出中 `boxes[].subtype` 是否正确
- 检查攻击招式只有 `weak_blade`，防御状态只有 `strong_blade`

---

### Step 1：状态图数据更新（纯数据，无代码依赖）

**依赖**：Step 0（collider 文件就绪）

#### 1a：更新 `Data/StateGraphDef/LongSwordMan.json`

为每个攻击/防御状态新增字段：

```jsonc
"thrust": {
    "attackWeight": "light",
    "attackTrajectory": "thrust"
    // ... 现有字段不变
},
"quart": {
    "attackWeight": "light",
    "attackTrajectory": "slash"
},
"zornhut": {
    "attackWeight": "heavy",
    "attackTrajectory": "slash"
},
"guard": {
    "guardType": "guard"
    // guardActive 保留
}
```

#### 1b：更新 `Data/StateGraphDef/RabbleStick.json`

```jsonc
"thrust": {
    "attackWeight": "light",
    "attackTrajectory": "thrust"
},
"swing": {
    "attackWeight": "light",
    "attackTrajectory": "slash"
}
// dodge 不变（invincible 已存在）
```

#### 1c：创建 `Data/StateGraphDef/ManatarmsSword.json`

新文件，状态图结构参考 `LongSwordMan.json`：

```jsonc
{
  "machine": "manatarms_sword",
  "initialState": "idle",
  "inputs": {
    "commands": ["quart", "reverse_quart", "smash"],
    "parameters": { "moveMagnitude": { "type": "number" } }
  },
  "states": {
    "idle": {
      "clip": "idle",
      "allowMoveInput": true,
      "loop": true,
      "transitions": [
        { "to": "move", "when": [{ "parameter": "moveMagnitude", "op": ">", "value": 0.2 }] },
        { "to": "quart", "when": [{ "command": "quart" }] },
        { "to": "reverse_quart", "when": [{ "command": "reverse_quart" }] },
        { "to": "smash", "when": [{ "command": "smash" }] },
        { "to": "hit", "when": [{ "command": "hit" }] }
      ]
    },
    "move": {
      "clip": "move",
      "allowMoveInput": true,
      "loop": true,
      "transitions": [
        { "to": "idle", "when": [{ "parameter": "moveMagnitude", "op": "<=", "value": 0.2 }] },
        { "to": "quart", "when": [{ "command": "quart" }] },
        { "to": "reverse_quart", "when": [{ "command": "reverse_quart" }] },
        { "to": "smash", "when": [{ "command": "smash" }] }
      ]
    },
    "quart": {
      "clip": "quart",
      "attackActive": true,
      "attackWeight": "light",
      "attackTrajectory": "slash",
      "attackActiveFrames": [2, 3],
      "allowMoveInput": false,
      "loop": false,
      "chainTimeScale": 1.5,
      "transitions": [
        { "to": "idle", "when": [{ "time": "normalized", "op": ">=", "value": 1.0 }] },
        { "to": "reverse_quart", "when": [{ "command": "reverse_quart" }] }
      ]
    },
    "reverse_quart": {
      "clip": "reverse_quart",
      "attackActive": true,
      "attackWeight": "light",
      "attackTrajectory": "slash",
      "attackActiveFrames": [2, 3],
      "allowMoveInput": false,
      "loop": false,
      "transitions": [
        { "to": "idle", "when": [{ "time": "normalized", "op": ">=", "value": 1.0 }] }
      ]
    },
    "smash": {
      "clip": "smash",
      "attackActive": true,
      "attackWeight": "heavy",
      "attackTrajectory": "slash",
      "attackActiveFrames": [3, 4],
      "allowMoveInput": false,
      "loop": false,
      "transitions": [
        { "to": "idle", "when": [{ "time": "normalized", "op": ">=", "value": 1.0 }] }
      ]
    },
    "hit": {
      "clip": "hit",
      "allowMoveInput": false,
      "loop": false,
      "transitions": [
        { "to": "idle", "when": [{ "time": "normalized", "op": ">=", "value": 1.0 }] }
      ]
    },
    "knockdown": {
      "clip": "knockdown",
      "allowMoveInput": false,
      "loop": false,
      "transitions": []
    },
    "defeated": {
      "clip": "knockdown",
      "allowMoveInput": false,
      "loop": false,
      "transitions": []
    }
  }
}
```

**可测试性**：
- JSON 语法校验通过
- 状态图字段在浏览器 console 中可读（`stateGraph.states.thrust.attackWeight`）

---

### Step 2：`getCombatSnapshot()` 改造（快照层）

**依赖**：Step 1（状态图字段已定义）

**文件**：`scripts/Enties/CombatCharacter.js`

**改动点**：

1. **新增 `boxRole` 字段**（替代直接使用 `subtype`）：
   ```javascript
   boxRole: box.type === "weaponbox"
       ? (box.subtype === "weak_blade" ? "shield" : "attack")
       : null
   ```
   > 注意：`weak_blade` (#FF0000) = 防御盒，`strong_blade` (#E37800) = 攻击盒（扫描脚本命名反了，运行时翻转）

2. **新增 `attackWeight` / `attackTrajectory`**（从 stateDef 读取）：
   ```javascript
   attackWeight: boxRole === "attack" ? (this.currentStateDef?.attackWeight ?? null) : null,
   attackTrajectory: boxRole === "attack" ? (this.currentStateDef?.attackTrajectory ?? null) : null,
   ```

3. **新增 `guardType`**（从 stateDef 或 config 读取）：
   ```javascript
   guardType: boxRole === "shield"
       ? (this.currentStateDef?.guardType ?? this.config.guardType ?? null)
       : null,
   ```
   优先级：stateDef（如 guard 状态） > config（如 manatarms 被动 shield） > null

4. **`weaponRole` 逻辑**：攻击盒在激活帧为 `"offense"`，否则为 `"guard"`。防御盒始终为 `"guard"`。

5. **`canParry` 逻辑**：仅 `boxRole === "shield" && guardType === "guard"` 时保留（longswordman guard 的 parryBonus）。

**可测试性**：
- 按 `C` 键开启碰撞显示，确认攻击时盒子颜色/行为正确
- console.log 快照内容，确认 `boxRole` / `attackWeight` / `attackTrajectory` / `guardType` 正确

---

### Step 3：ContactResolver 重写（判定层）

**依赖**：Step 2（快照格式已更新）

**文件**：`scripts/Systems/ContactResolver.js`

**改动点**：

1. **删除旧方法**：`#toWeaponLevel()`、`#weaponLevelRank()`

2. **Attack vs Attack（Phase 1 拼刀部分）**：
   ```javascript
   // 旧：比较 subtype strong/weak
   // 新：比较 attackWeight light/heavy
   const weightA = contact.boxA.attackWeight;
   const weightB = contact.boxB.attackWeight;

   if (!weightA || !weightB) continue; // 至少一方不是攻击盒

   if (weightA === weightB) {
       // 同级 clash
   } else if (weightA === "heavy") {
       // A 赢，B 失效
   } else {
       // B 赢，A 失效
   }
   ```

3. **Attack vs 防御盒（Phase 1 offense vs guard 部分）**：
   ```javascript
   const offenseBox = ...;  // 攻击盒
   const defenseBox = ...;  // 防御盒（boxRole === "shield"）

   const trajectory = offenseBox.attackTrajectory;
   const guardType = defenseBox.guardType;
   const weight = offenseBox.attackWeight;

   if (guardType === "guard") {
       // 刺破防，斩被防
       if (trajectory === "thrust") {
           // 攻方赢：guard 被破，不拦截攻击
       } else {
           // 防方赢：guard 拦截成功
           // 现有 parryBonus 逻辑保留
       }
   } else if (guardType === "shield") {
       // 只有重斩破盾
       if (trajectory === "slash" && weight === "heavy") {
           // 攻方赢：破盾
       } else {
           // 防方赢：shield 拦截成功
       }
   }
   ```

4. **Phase 2（weapon vs hitbox）**：逻辑不变，仅过滤条件改为检查 `boxRole === "attack"` + `weaponRole === "offense"`

**可测试性**：
- 同屏两个角色，分别测试：
  - 轻击 vs 轻击 → clash
  - 重击 vs 轻击 → 重击赢
  - thrust vs guard → 攻方命中
  - quart vs guard → guard 拦截
  - smash vs shield → 攻方破盾
  - quart vs shield → shield 拦截
  - 任意攻击 vs dodge → dodge 避开

---

### Step 4：资源接线（AssetManifest + CharacterFactory）

**依赖**：Step 0（collider 文件就绪）+ Step 1（状态图就绪）

**文件**：`scripts/AssetManifest.js`、`scripts/CharacterFactory.js`

#### 4a：AssetManifest 新增 manatarms_sword 条目

```javascript
"manatarms_sword": {
    atlasDir: "Art/Sprite/manatarms_sword/",
    collisionDir: "Data/CollisionMask/manatarms_sword/",
    rootMotionDir: "Data/RootMotion/manatarms/",
    pushBoxDir: "Data/PushBox/manatarms_sword/",
    clips: ["idle", "move", "quart", "reverse_quart", "smash", "hit", "knockdown"]
}
```

#### 4b：CharacterFactory 新增 manatarms_sword 装配路径

```javascript
case "manatarms": {
    // 核心配置
    config.guardType = "shield";  // 被动盾
    // ... 其他配置
}
```

#### 4c：现有角色配置更新

- longswordman：无需额外配置（guardType 在 guard 状态中声明）
- rabble_stick：无需改动

**可测试性**：
- `DataLoader` 能正确加载 manatarms 资源
- `CharacterFactory` 能创建 manatarms 实例
- 动画播放正常

---

### Step 5：Controller + Scene 接线

**依赖**：Step 4（角色可创建）

**文件**：`scripts/Systems/PlayerController.js`、`scripts/Systems/AIController.js`、`scripts/Scene.js` 等

#### 5a：manatarms 控制器

初期使用 TestController 或 AIController，后续可单独配置。

#### 5b：Scene / GameMode 接入

在 `SceneDefs.js` 中添加 manatarms 实体定义，配置到场景中。

**可测试性**：
- manatarms 出现在场景中
- 能移动、攻击、被攻击
- shield 被动生效

---

### Step 6：Dodge 改造（向后位移）

**依赖**：Step 2（快照层已更新）

**文件**：`scripts/Enties/CombatCharacter.js`、`Data/StateGraphDef/RabbleStick.json`

**改动点**：

1. 状态图新增 `dodgeDirection` / `dodgeDistance`：
   ```jsonc
   "dodge": {
       "invincible": true,
       "dodgeDirection": "backward",
       "dodgeDistance": 0.5
   }
   ```

2. `enterState()` 中检测 dodge 状态，根据 `facing` 强制向后位移：
   ```javascript
   if (stateDef.dodgeDirection === "backward") {
       const dist = stateDef.dodgeDistance ?? 0.5;
       this.root.position.x -= this.facing * dist;
   }
   ```

**可测试性**：
- dodge 始终向角色背后方向位移
- 被攻击时不受伤（invincible 保持）
- 2 帧后回 idle

---

### Step 7：manatarms 连招加速（quart → reverse_quart）

**依赖**：Step 5（manatarms 可操作）

**文件**：`scripts/Enties/CombatCharacter.js`、`Data/StateGraphDef/ManatarmsSword.json`

**改动点**：

1. 状态图：reverse_quart 从 quart 派生时读取 `chainTimeScale`：
   ```jsonc
   "quart": {
       "chainTimeScale": 1.5  // quart 后派生的招式加速 1.5x
   }
   ```

2. `enterState()` 中检查前一状态是否有 `chainTimeScale`：
   ```javascript
   const prevStateDef = this.stateGraph?.states?.[this.currentStateName];
   const chainScale = prevStateDef?.chainTimeScale;
   if (chainScale && this.pendingCommands.includes(newState)) {
       timeScale = (stateDef.timeScale ?? 1.0) * chainScale;
   }
   ```

**可测试性**：
- 裸出 reverse_quart → 正常速度
- quart → reverse_quart → 加速播放

---

### Step 8：回归验证

**依赖**：Step 1-7 全部完成

**验证清单**：

| # | 测试项 | 预期结果 |
|---|--------|---------|
| 1 | hero thrust vs rabble swing | clash（同级轻击） |
| 2 | hero zornhut vs rabble thrust | zornhut 赢（重>轻） |
| 3 | hero zornhut vs hero zornhut | clash（同级重击） |
| 4 | hero thrust vs rabble guard | thrust 命中（刺破防） |
| 5 | hero quart vs rabble guard | guard 拦截（斩被防） |
| 6 | hero zornhut vs manatarms shield | 破盾（重斩破盾） |
| 7 | hero quart vs manatarms shield | shield 拦截 |
| 8 | hero thrust vs rabble dodge | dodge 避开 + 向后位移 |
| 9 | guard parryBonus → 快速 zornhut | 正常触发 |
| 10 | manatarms quart → reverse_quart | 加速播放 |
| 11 | C 键碰撞显示 | 正常 |
| 12 | 探索模式交互 | 不受影响 |
| 13 | 场景切换 | 不受影响 |

---

## 3. 文件改动清单

| 阶段 | 文件 | 改动类型 |
|------|------|---------|
| 0 | ASE 源文件（多个） | 颜色重绘 |
| 0 | `Data/CollisionMask/**/*.collider.json` | 重新扫描 |
| 1 | `Data/StateGraphDef/LongSwordMan.json` | 新增字段 |
| 1 | `Data/StateGraphDef/RabbleStick.json` | 新增字段 |
| 1 | `Data/StateGraphDef/ManatarmsSword.json` | **新建** |
| 2 | `scripts/Enties/CombatCharacter.js` | `getCombatSnapshot()` 改造 |
| 3 | `scripts/Systems/ContactResolver.js` | 判定矩阵重写 |
| 4 | `scripts/AssetManifest.js` | 新增 manatarms 条目 |
| 4 | `scripts/CharacterFactory.js` | 新增 manatarms 装配路径 |
| 5 | `scripts/SceneDefs.js` | 新增 entity 定义 |
| 5 | `scripts/Scene.js` | 接入 manatarms |
| 5 | controller 相关文件 | manatarms 控制器 |
| 6 | `scripts/Enties/CombatCharacter.js` | dodge 向后位移 |
| 7 | `scripts/Enties/CombatCharacter.js` | chainTimeScale 支持 |

## 4. 风险与注意

1. **collider.json 扫描**：manatarms 的 RootMotion 目录在 `Data/RootMotion/manatarms/`（不带 `_sword` 后缀），扫描时注意路径。
2. **guardType 优先级**：stateDef 优先于 config，确保 longswordman 的 guard 状态能正确覆盖。
3. **shield 常驻**：manatarms 在 idle/move 中 shield 盒始终存在，确保 `getCombatSnapshot()` 在非攻击状态正确输出 `boxRole: "shield"`。
4. **旧 collider 兼容**：如果旧 collider 中仍有 `strong_blade` 出现在攻击招式中（mask 未改完），会被误判为 shield 盒。必须确保 Step 0 全部完成。
5. **AIKnowledgeRegistry**：当前扫描逻辑依赖 `attackActive` 和 `attackActiveFrames`，新增字段后可能需要更新扫描逻辑（TBD，视 AI 是否也需要理解新规则）。