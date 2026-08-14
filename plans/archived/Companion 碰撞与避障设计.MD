> **状态**: ✅ Step 1-4 已实施并验证通过（基本功能正常）
> **范围**: Companion（Charlotte）的碰撞与避障；其它 NPC 不受影响
> **依赖**: [CompanionNPC steering-collision guideline by GPT.MD](./CompanionNPC%20steering-collision%20guideline%20by%20GPT.MD)、[EXPLORE_MOVEMENT_DESIGN.md](./archived/EXPLORE_MOVEMENT_DESIGN.md)
>
> **实施记录**：
> - Step 1-4 已完成（2026-08-14）
> - 额外完成：debug mesh 跟随 entity（parent 挂载）、occupancy 工具诊断日志、occupancy h 从 24 调为 16
> - 修正：§4.2 `isBlockingNow()` 实际用 `_isFollowing` 标志而非 `currentBehavior` getter（§5.4 已删）
> - 修正：§10.5 X 键不切换 blocker AABB 框，另说明其真实作用
> - 遗留：§10.3「Charlotte following 移动中被玩家挡」未实现（player 未进 blockers），见 §11.5

# Companion 碰撞与避障设计

## 0. 设计立场

本游戏是 **beat'em up 风格的 2.5D**，不是 platformer：
- 移动空间是 XY 二维平面（Y 是远近移动，不是跳跃高度）
- 无跳跃机制
- walkArea 通常是狭长矩形，Y 方向空间远小于 X

因此 Companion 的避障需求与横版平台游戏不同，更接近《 Streets of Rage 》《Final Fight》中同伴 NPC 的行为：能在场景内自由移动、被环境阻挡、与玩家有自然的物理交互但不卡路。

## 1. 背景与范围

### 1.1 问题
当前 [ExploreMode._buildIndices](file:///e:/se/BlindDuel/scripts/Systems/Modes/ExploreMode.js#L488-L504) 把实体分成 7 个互不相关的扁平数组。其中：
- `dynamicActors`：目前只收 `kind === "player"`，是唯一会调用 [resolveMovement](file:///e:/se/BlindDuel/scripts/Systems/ExploreCollisionSystem.js#L6-L48) 解算的实体
- `staticBlockers`：收 `blocksMovement: true` 的 NPC/prop，作为阻挡方

Companion（Charlotte）当前配置 `blocksMovement: false`，结果是：**能移动、不挡路、不被挡**。她跟随玩家时会穿过墙、穿过玩家，缺乏物理存在感。

### 1.2 范围
- ✅ Charlotte 接入统一碰撞管线（既是 actor 又是 blocker）
- ✅ FollowingBehavior 增加 Y 轴跟随
- ✅ idle/following 状态下阻挡语义动态切换
- ❌ 不引入 A* / NavMesh（GPT guideline 第 13 条）
- ❌ 不做 NPC 间 crowd separation
- ❌ 不改其它 NPC（sequence 驱动的固定移动 NPC 保持原样）
- ❌ 不改命名 `staticBlockers → blockers`（延后到本设计跑通后）

### 1.3 不做的事（明确边界）
- **不做双向刚体推挤**：单向解算（entity 被 blocker 推开），与现有 [resolveMovement](file:///e:/se/BlindDuel/scripts/Systems/ExploreCollisionSystem.js#L6-L48) 一致
- **不做"主动/被动"判断**：第一阶段 player 和 companion 都每帧解算，先观察是否出现双退抖动
- **不引入 A***：Companion 当前只需 Seek（直线追目标），A* 是未来"绕障寻路"的 Navigation 层，不是移动系统基础

## 2. 当前管线现状（已有基础设施）

GPT guideline 要求的"统一 moveIntent → resolveMovement → position"管线，**70% 已存在**：

| GPT 要求 | 现状 | 位置 |
|---|---|---|
| Controller 不直接写 root.position | ✅ [FollowingBehavior.update](file:///e:/se/BlindDuel/scripts/Systems/NpcBehaviors/FollowingBehavior.js#L49-L62) 只调 `npc.setMoveIntent(...)` | 已符合 |
| moveIntent → root.position 单向流 | ✅ [CharacterBase._applyMovement](file:///e:/se/BlindDuel/scripts/Enties/CharacterBase.js#L341-L404) | 已符合 |
| NPC AABB 随实时 position 计算 | ✅ [NpcCharacter.getBlockerAabb](file:///e:/se/BlindDuel/scripts/Enties/NpcCharacter.js#L50-L68) 每帧重算 | 已符合（"static" 命名误导） |
| Collision 与 Steering 分离 | ✅ resolveMovement 只做 MTV 推开 + walkArea clamp | 已符合 |
| Companion 只做 Seek | ✅ 当前 FollowingBehavior 就是纯 Seek | 已符合 |
| NPC 既能是 actor 又能是 blocker | ⚠️ `_buildIndices` 用 `if`（非 else if），结构允许 | 需启用 |

**核心改动只有两处**：
1. `_buildIndices` 让 Charlotte 同时进 `dynamicActors` + `blockers`
2. `ExploreMode.fixedUpdate` 给 NPC 也调 `resolveMovement`

## 3. 目标架构

### 3.1 数据流（单帧）fixedUpdate(dtMs):

1. interactables 循环:
   npc.fixedUpdate(dtMs)      ← 写动画、读输入
   controller.update(dtMs, npc, context)
   └─ FollowingBehavior.update → npc.setMoveIntent({x, y})
   npc._applyMovement(dtMs)   ← moveIntent → root.position（CharacterBase 内部）
2. dynamicActors 循环（含 player + companion）:
   resolveMovement(actor, blockers, walkArea)
   ├─ 若 actor.controlledBySequence → return（sequencer 期间跳过）
   ├─ 对每个 blocker 做 MTV 推开
   └─ walkArea.clampPosition
### 3.2 解算顺序（必须固定）
**player → companion**，原因：
- companion 跟随的是 player 的"本帧最新位置"，所以 player 必须先解算
- player 解算时参考的 companion 位置是"上帧末"位置，避免同帧互相参考振荡

实现：`_buildIndices` 中 player 先 push 进 `dynamicActors`（player 在 entityPool 中通常靠前，且 `kind === "player"` 是第一个判断）。

## 4. 数据模型变更

### 4.1 Charlotte 配置调整（CharacterFactory.js）
[createCompanionNpc](file:///e:/se/BlindDuel/scripts/CharacterFactory.js#L432-L462) 当前：
```javascript
kind: "npc",
blocksMovement: false,
interactable: true,
```

改为：
```javascript
kind: "npc",
blocksMovement: true,              // 进 blockers，由 isBlockingNow() 动态控制
interactable: true,
// 新增动态阻挡接口（见 4.2）
```

### 4.2 动态阻挡接口 `isBlockingNow()`
`blocksMovement` 是 `_buildIndices` 时一次性读的静态配置，无法表达"idle 挡、following 不挡"。引入运行时方法：

**实际实现（NpcCharacter）**：
```javascript
// 构造里新增字段
this.isCompanion = !!config.isCompanion;
this._isFollowing = false;

setFollowing(value) {
    this._isFollowing = value;
}

isBlockingNow() {
    // 默认遵循静态配置
    if (!this.blocksMovement) return false;
    // companion 在 following 行为期间不挡玩家（可被穿过）
    if (this._isFollowing) return false;
    return true;
}
```

NpcController 在 `enterIdle` / `enterFollowing` 中同步设置标志：
```javascript
enterIdle(npc) {
    this._behavior = null;
    if (typeof npc.setFollowing === "function") npc.setFollowing(false);
    ...
}
enterFollowing(npc) {
    this._behavior = this._followingBehavior;
    if (typeof npc.setFollowing === "function") npc.setFollowing(true);
    ...
}
```

**ExploreCollisionSystem.resolveMovement 调整**（含自推防护）：
```javascript
for (const blocker of blockers) {
    if (blocker === entity) continue;  // 防止 entity 自推
    if (typeof blocker.isBlockingNow === "function" && !blocker.isBlockingNow()) {
        continue;
    }
    const blockerAabb = blocker.getBlockerAabb();
    ...
}
```

> **设计修正**：原方案用 `_controller?.currentBehavior instanceof FollowingBehavior`，但 NpcCharacter 没有 controller 引用。改为 NpcCharacter 自维护 `_isFollowing` 标志 + NpcController 同步设置，解耦更彻底，且 greeting 状态天然 `_isFollowing=false → isBlockingNow=true`（站定挡路），符合预期。

**语义**：
| Charlotte 状态 | blocksMovement | isBlockingNow() | 效果 |
|---|---|---|---|
| idle / observe | true | true | 挡玩家（路障感） |
| following（静止跟随） | true | false | 不挡玩家（不卡路） |
| following（移动中） | true | false | 不挡玩家，但被玩家挡（避让） |
| sequencer 控制中 | true | true | sequencer 期间不解算，无影响 |

### 4.3 _buildIndices 调整
当前 [ExploreMode.js:488-504](file:///e:/se/BlindDuel/scripts/Systems/Modes/ExploreMode.js#L488-L504)：
```javascript
for (const entity of entityPool) {
    if (entity.kind === "player") {
        this.dynamicActors.push(entity);
    }
    if (entity.kind === "enemy") {
        this.enemies.push(entity);
    }
    if ((entity.kind === "npc" || entity.kind === "prop")
        && entity.blocksMovement
        && typeof entity.getBlockerAabb === "function") {
        this.staticBlockers.push(entity);
    }
    if (entity.kind === "npc" && entity.interactable) {
        this.interactables.push(entity);
    }
    ...
}
```

改为（让 companion 同时进 dynamicActors）：
```javascript
for (const entity of entityPool) {
    if (entity.kind === "player") {
        this.dynamicActors.push(entity);
    }
    // 新增：companion 也作为 dynamic actor
    else if (entity.kind === "npc" && entity.isCompanion && entity.getBlockerAabb) {
        this.dynamicActors.push(entity);
    }
    if (entity.kind === "enemy") {
        this.enemies.push(entity);
    }
    if ((entity.kind === "npc" || entity.kind === "prop")
        && entity.blocksMovement
        && typeof entity.getBlockerAabb === "function") {
        this.staticBlockers.push(entity);
    }
    if (entity.kind === "npc" && entity.interactable) {
        this.interactables.push(entity);
    }
    ...
}
```

**关键点**：
- 用 `entity.isCompanion` 标志区分 companion 和普通 NPC（普通 NPC 仍只进 interactables/blockers，不进 dynamicActors）
- `isCompanion` 在 [createCompanionNpc](file:///e:/se/BlindDuel/scripts/CharacterFactory.js#L432-L462) 里设为 `true`
- Charlotte 同时进 `dynamicActors` + `staticBlockers` + `interactables` + `renderables`（4 个数组）

### 4.4 解算循环合并
当前 [ExploreMode.fixedUpdate](file:///e:/se/BlindDuel/scripts/Systems/Modes/ExploreMode.js#L62-L66)：
```javascript
character.fixedUpdate(dtMs);
if (!sequencerBusy) {
    this._collisionSystem.resolveMovement(character, this.staticBlockers, this.context.walkArea);
}
```

改为（player 合并进 dynamicActors 循环）：
```javascript
character.fixedUpdate(dtMs);
// interactables 循环已在前面调过 npc.fixedUpdate + controller.update

if (!sequencerBusy) {
    for (const actor of this.dynamicActors) {
        this._collisionSystem.resolveMovement(actor, this.staticBlockers, this.context.walkArea);
    }
}
```

**顺序保证**：player 在 dynamicActors[0]（_buildIndices 时先 push），companion 在其后。循环天然 player → companion。

## 5. 系统变更

### 5.1 ExploreMode.fixedUpdate 完整新流程
```javascript
fixedUpdate(dtMs) {
    const sequencerBusy = this.sceneSequencer?.isBusy() ?? false;
    const character = this.context.character;

    // 1. interactables：NPC 的 controller + animation
    for (const npc of this.interactables) {
        if (npc.fixedUpdate) npc.fixedUpdate(dtMs);
        this.npcController?.update(dtMs, npc, this.context);
        // controller.update 内部会调 _applyMovement（写 position）
    }

    // 2. player 的 controller + applyMovement
    character.fixedUpdate(dtMs);

    // 3. 统一碰撞解算（player 先，companion 后）
    if (!sequencerBusy) {
        for (const actor of this.dynamicActors) {
            this._collisionSystem.resolveMovement(
                actor, this.staticBlockers, this.context.walkArea
            );
        }
    }

    // 4. 其它系统（相机、气泡、debug）
    ...
}
```

### 5.2 sequencer 门控
Companion 的 resolveMovement 受 `!sequencerBusy` 门控（5.1 第 3 步）。

Companion 的 `_applyMovement` 受 `controlledBySequence` 门控（[CharacterBase.js:341-344](file:///e:/se/BlindDuel/scripts/Enties/CharacterBase.js#L341-L344) 已有）。

**双重门控一致性**：与 player 完全一致，符合 [project_memory](file:///c:/Users/LS/.trae-cn/memory/projects/-e-se-BlindDuel--p2-5ed766535a1506c04871/project_memory.md) 中"sequencer 驱动移动必须用 controlledBySequence flag"约束。

[TimelineSequencer.js:453/483/84](file:///e:/se/BlindDuel/scripts/Systems/TimelineSequencer.js#L453) 已确保 moveActorTo 期间 Charlotte 的 `controlledBySequence` 正确 set/reset。

### 5.3 FollowingBehavior Y 轴跟随
当前 [FollowingBehavior.update](file:///e:/se/BlindDuel/scripts/Systems/NpcBehaviors/FollowingBehavior.js#L25-L62) 只处理 X 轴。

#### 5.3.1 新增配置
```javascript
constructor(options = {}) {
    super({
        targetOffsetX: 1.0,
        targetOffsetY: 0,           // 新增：Y 目标偏移
        followStart: 0.4,           // X 启动阈值
        followStop: 0.1,            // X 停止阈值
        followDeadbandY: 0.15,      // 新增：Y 死区半宽
        followStopY: 0.05,          // 新增：Y 滞回停止阈值
        speedMin: 0.7,
        speedMax: 1.4,
        baseSpeed: 1.1,
        speedMapSpan: 1.5,
        speedMapAnchor: 1.0,
        ...options
    });
    this._moving = false;
    this._movingY = false;
}
```

#### 5.3.2 Y 轴判断逻辑（分轴 + 死区 + 滞回）
```javascript
update(dtMs, npc, context) {
    const player = context.player;
    if (!player) return;

    const playerPos = player.root.position;
    const npcPos = npc.root.position;

    // --- X 轴（保持原逻辑）---
    const targetX = playerPos.x + this.options.targetOffsetX;
    const dx = targetX - npcPos.x;
    const absDx = Math.abs(dx);
    const movingX = this._moving
        ? absDx > this.options.followStop
        : absDx > this.options.followStart;
    this._moving = movingX;

    // --- Y 轴（新增：死区 + 滞回）---
    const targetY = playerPos.y + this.options.targetOffsetY;
    const dy = targetY - npcPos.y;
    const absDy = Math.abs(dy);
    const deadband = this.options.followDeadbandY;
    const stopY = this.options.followStopY;
    let movingY;
    if (this._movingY) {
        movingY = absDy > stopY;
    } else {
        movingY = absDy > deadband;
    }
    this._movingY = movingY;

    // --- facing ---
    if (movingX) {
        npc.setFacing(dx >= 0 ? 1 : -1);
    } else {
        const playerDx = playerPos.x - npcPos.x;
        npc.setFacing(playerDx >= 0 ? 1 : -1);
    }

    // --- intent ---
    if (!movingX && !movingY) {
        npc.setMoveIntent({ x: 0, y: 0 });
        const idleClip = this.options.idleClip ?? "idle";
        if (npc.currentStateName !== idleClip && npc.hasState(idleClip)) {
            npc.enterState(idleClip);
        }
        return;
    }

    // 归一化 intent（斜向移动不偏快）
    let ix = movingX ? Math.sign(dx) : 0;
    let iy = movingY ? Math.sign(dy) : 0;
    const len = Math.hypot(ix, iy);
    if (len > 0) {
        ix /= len;
        iy /= len;
    }

    // 速度映射仍按 X 距离（X 是主轴）
    const o = this.options;
    const m = clamp(
        (absDx - o.speedMapAnchor) / o.speedMapSpan,
        o.speedMin, o.speedMax
    );
    npc.baseWalkSpeed = o.baseSpeed * m;

    npc.setMoveIntent({ x: ix, y: iy });
    if (npc.currentStateName !== "walk" && npc.hasState("walk")) {
        npc.enterState("walk");
    }
}
```

**设计要点**：
- **分轴判断**：X 和 Y 独立判断是否移动，适配狭长 walkArea（Y 空间小）
- **Y 死区**：`[player.y - 0.15, player.y + 0.15]` 内 Y intent=0，玩家小幅度 Y 移动时 Charlotte 不抖
- **Y 滞回**：进入移动后要降到 `followStopY=0.05` 才停，防抖
- **归一化 intent**：斜向移动时 (1,1) 归一化为 (0.707, 0.707)，避免斜向比直线快 41%
- **速度仍按 X 映射**：X 是主轴，Y 跟随不单独提速

### 5.4 [已删除] NpcController currentBehavior getter

原设计要暴露 `currentBehavior` getter 给 `isBlockingNow()` 判断 following 状态。实际改用 `_isFollowing` 标志后（见 §4.2），NpcController 不需要暴露此 getter。NpcCharacter 直接读自身 `_isFollowing`，与 controller 解耦。

## 6. occupancy 与碰撞框

### 6.1 现状
[Charlotte.occupancy.json](file:///e:/se/BlindDuel/Data/RootMotion/NPCs/Charlotte.occupancy.json) 有 9 帧（frameIndex 0-8），每帧 40×16 px（h 已从 24 调为 16）。frame 7-8 未完工（无 tag 覆盖，不会播放），实际有效帧 0-6。

[NpcCharacter.getBlockerAabb](file:///e:/se/BlindDuel/scripts/Enties/NpcCharacter.js#L50-L68) 用 `animation.currentFrameIndex` 索引，[:55](file:///e:/se/BlindDuel/scripts/Enties/NpcCharacter.js#L55) 有边界检查兜底（越界返回 null，该帧无碰撞）。

### 6.2 尺度核对
- Charlotte occupancy：40×16 px → 0.8×0.32 world unit
- greetingRadius：1.6 world unit
- 按 [EXPLORE_MOVEMENT_DESIGN](file:///e:/se/BlindDuel/plans/archived/EXPLORE_MOVEMENT_DESIGN.md) 的 pxToWorld=0.02 推算

**结论**：occupancy 碰撞框(0.8) 远小于 greetingRadius(1.6)，玩家停在 Charlotte 身侧时仍能触发 greeting。✅ 无冲突。

### 6.3 未完工帧的影响
frame 7-8 未完工但不会被 tag 触发播放，无需处理。等动画完工后重新跑 occupancy 生成工具即可。

### 6.4 occupancy h 从 24 调为 16（实施时调整）
原工具常量 `$OCCUPANCY_H = 24` 导致 Charlotte 碰撞框高 0.48 world unit（上下各 0.24），视觉上"脚下一大片都 block"。调整 `$OCCUPANCY_H = 16`（[extract_rootmotion_occupancy.ps1:70](file:///e:/se/BlindDuel/scripts/tools/extract_rootmotion_occupancy.ps1#L70)），碰撞框变为 0.32 高（上下各 0.16），更符合实际占地。

### 6.5 occupancy 工具诊断日志（额外实施）
实施中发现 Charlotte walk 动画有 Y 抖动，调查期间给 [extract_rootmotion_occupancy.ps1](file:///e:/se/BlindDuel/scripts/tools/extract_rootmotion_occupancy.ps1) 加了诊断日志，输出到 `OutJson.diag.log`。每帧记录：frameRect、扫描区域数、每个区域的像素坐标列表和质心、最终选中的区域。

> 根因最终定位为**工具输入路径错误**（应扫 `Data\RootMotion\NPCs\Charlotte.png`，不是 `Art\Sprite\NPCs\Charlotte.png`，见 [COLLIDER_UPDATE_SKILL.md](file:///e:/se/BlindDuel/COLLIDER_UPDATE_SKILL.md) 路线 B）。Art 下的是合成后 sprite atlas，root 标记被角色绘画遮盖，导致扫描到残缺像素。用正确路径重跑后 frame 2 root anchor 恢复正常。
>
> 诊断日志功能保留，未来调 bug 有用，运行时成本可忽略。

## 7. sequencer 衔接

### 7.1 intro/flee sequence 的 Charlotte 处理
已确认（[prologue_intro.json:49-55](file:///e:/se/BlindDuel/Data/Sequences/prologue_intro.json#L49-L55)）：
- sequencer 用 `moveActorTo` 驱动 Charlotte 位置
- moveActorTo 期间 `controlledBySequence=true`，[_applyMovement](file:///e:/se/BlindDuel/scripts/Enties/CharacterBase.js#L341-L344) 直接 return
- sequence 结束 callback 切 idle/following 状态，Charlotte 自然追

### 7.2 sequence 结束瞬间的 moveIntent 残留
已查清（[CharacterFactory.js:446-454](file:///e:/se/BlindDuel/scripts/CharacterFactory.js#L446-L454)）：Charlotte 的 stateGraph 只配 `clip + loop`，**没有 `speed` 也没有 `frameSpeeds`**。所以：
- walk state 残留不会自动移动
- `controlledBySequence=false` 后 `_applyMovement` 走 moveIntent 分支
- controller.update 还没设新 intent 前，intent 是 (0,0)，magnitude ≤ moveDeadzone，currentSpd=0 直接 return

**结论**：无需在 handler 里显式清 intent，自然安全。

### 7.3 walkArea 覆盖
[prologue.json:191-194](file:///e:/se/BlindDuel/Data/SceneDefs/prologue.json#L191-L194)：
```javascript
"walkAreas": [
  { "if": { "scenarioMin": 105 }, "minX": -27, "maxX": 9, "minY": -1, "maxY": 0.7},
  { "if": {}, "minX": -32, "maxX": -16, "minY": -1, "maxY": 0.7 }
]
```

intro 期间 scenario < 105，生效第二条。Charlotte 的 moveActorTo 终点 (-23, 0.4) 在 walkArea 内。✅ 符合 intro 意图（把角色移进 walkArea）。

**潜在隐患（不在本设计范围）**：scenario 105 切换 walkArea 时，若 Charlotte 在 -27 以左，会被瞬间 clamp 回 -27。这是现有 walkArea 多 scenario 切换问题，本设计不处理。

## 8. 调试可视化

### 8.1 三色分类（已在 createDebugMeshes 实施）
[ExploreCollisionSystem.createDebugMeshes](file:///e:/se/BlindDuel/scripts/Systems/ExploreCollisionSystem.js#L51-L62) 在 [ExploreMode.enter:359](file:///e:/se/BlindDuel/scripts/Systems/Modes/ExploreMode.js#L359) 调用一次：
- dynamicActors 且同时在 blockers → **黄色**（actor + blocker）
- 纯 dynamicActors → **绿色**
- 纯 blockers → **红色**

Charlotte 同时在两个列表，显示黄色框。player 绿色，prop 红色。

> 注：`updateDebugMeshes`（[:63-78](file:///e:/se/BlindDuel/scripts/Systems/ExploreCollisionSystem.js#L63-L78)）是 dead code，三色改造落在 `createDebugMeshes` 上。未来清理时可直接删除 `updateDebugMeshes`。

### 8.2 debug mesh 跟随 entity（额外实施）
原 `createDebugMeshes` 只在 enter 时创建一次，位置不随 entity 移动，框停在 spawn 位置不可见。

**修复**：mesh 挂到 `entity.root` 下做 parent，借鉴 [CollisionComponent:86](file:///e:/se/BlindDuel/scripts/Components/CollisionComponent.js#L86) 做法：
```javascript
if (actor.root) {
    mesh.parent = actor.root;
    mesh.position.x = (aabb.minX + aabb.maxX) / 2 - actor.root.position.x;
    mesh.position.y = (aabb.minY + aabb.maxY) / 2 - actor.root.position.y;
    mesh.position.z = 0;
}
```
mesh 用相对 root 的局部坐标，root.position 更新时 mesh 自动同步。prop 同样处理（prop 有 root）。

构造函数新增 `_debugMeshByEntity` Map 持有映射，便于后续按 entity 刷新单个 mesh。

## 9. 实施步骤（按顺序）

### Step 1：数据层 ✅
- [x] [CharacterFactory.js](file:///e:/se/BlindDuel/scripts/CharacterFactory.js#L432-L462) Charlotte 配置：`blocksMovement: true`，新增 `isCompanion: true`
- [x] [NpcCharacter.js](file:///e:/se/BlindDuel/scripts/Enties/NpcCharacter.js) 新增 `isBlockingNow()` + `setFollowing()` 方法
- [x] [NpcController.js](file:///e:/se/BlindDuel/scripts/Systems/NpcController.js) `enterIdle`/`enterFollowing` 调用 `setFollowing`

### Step 2：碰撞系统 ✅
- [x] [ExploreCollisionSystem.resolveMovement](file:///e:/se/BlindDuel/scripts/Systems/ExploreCollisionSystem.js#L6-L48) 增加 `isBlockingNow()` 检查 + `blocker === entity` 自推防护
- [x] [createDebugMeshes](file:///e:/se/BlindDuel/scripts/Systems/ExploreCollisionSystem.js#L51-L62) 三色可视化 + mesh.parent 跟随 entity

### Step 3：索引构建 ✅
- [x] [ExploreMode._buildIndices](file:///e:/se/BlindDuel/scripts/Systems/Modes/ExploreMode.js#L488-L504) companion 进 dynamicActors
- [x] [ExploreMode.fixedUpdate](file:///e:/se/BlindDuel/scripts/Systems/Modes/ExploreMode.js#L62-L66) 合并 resolveMovement 循环

### Step 4：Y 轴跟随 ✅
- [x] [FollowingBehavior.js](file:///e:/se/BlindDuel/scripts/Systems/NpcBehaviors/FollowingBehavior.js) 增加 Y 轴判断 + 归一化 intent
- [x] ~~NpcController 暴露 `currentBehavior` getter~~（改用 `_isFollowing` 标志，不需要）

### Step 5：验证 ✅（基本功能正常）
- [x] 基础跟随、Y 轴跟随、碰撞、sequencer 衔接、debug 可视化均通过
- [ ] §10.3「Charlotte following 移动中被玩家挡」未实现（见 §11.5）

### 额外完成（计划外）
- [x] debug mesh 跟随 entity（原 createDebugMeshes 不跟随，框停在 spawn 位置）
- [x] occupancy 工具诊断日志（调查 Y 抖动时加）
- [x] occupancy h 从 24 调为 16（原值导致碰撞框过大）
- [x] resolveMovement 自推防护（`blocker === entity` continue）

## 10. 验证用例

### 10.1 基础跟随
- [ ] 玩家向右走，Charlotte 在身后 1.0 处跟随
- [ ] 玩家停下，Charlotte 走到 targetOffsetX=1.0 处停下
- [ ] 玩家向左走（朝 Charlotte），Charlotte 不穿过玩家，被玩家挡住后停下

### 10.2 Y 轴跟随
- [ ] 玩家向上移动 0.2，Charlotte 在死区外启动 Y 跟随
- [ ] 玩家向上移动 0.1（在死区内），Charlotte 不动
- [ ] 玩家斜向移动，Charlotte 斜向跟随（不比直线快）

### 10.3 碰撞
- [ ] Charlotte idle 时，玩家撞她会被挡（路障感）
- [ ] Charlotte following 时，玩家可穿过她（不卡路）
- [ ] Charlotte following 移动中，撞玩家会被挡（避让）
- [ ] Charlotte 撞墙/prop 被挡（不穿墙）

### 10.4 sequencer 衔接
- [ ] intro 播放期间 Charlotte 不被碰撞解算（controlledBySequence）
- [ ] intro 结束瞬间 Charlotte 不窜动（stateGraph 无 speed）
- [ ] intro 结束后 Charlotte 从 sequence 终点自然追上玩家

### 10.5 debug 可视化
- [ ] blocker AABB 框在 explore mode enter 时常驻显示，Charlotte 显示黄色框（actor+blocker）
- [ ] player 显示绿色框（纯 actor）
- [ ] prop 显示红色框（纯 blocker）
- [ ] X 键切换的是另一套 debug（entity collision hitbox + walkArea + stageBoundary + triggers + cameraRig corner panels），与 blocker AABB 框无关

## 11. 开放问题与后续

### 11.1 双退抖动观察
第一阶段不引入"主动/被动"判断。若观察到 player 和 companion 互相解算导致双退抖动，再引入：
```javascript
// 候选方案：仅主动移动者参与解算
if (entity.lastMoveMagnitude < EPSILON) return;
```

**当前状态**：因 §11.5 未实现（player 未进 blockers），player 和 companion 之间无双向解算，暂无抖动风险。若 §11.5 实现后出现抖动，再评估此方案。

### 11.2 Y 轴数值调优
`followDeadbandY: 0.15` 是初始值，跑起来后根据实际体验调整。若 Charlotte 跟随 Y 时抖动，加大死区；若反应迟钝，减小死区。

**当前状态**：0.15/0.05 实测基本正常，暂不调整。

### 11.3 命名重构
`staticBlockers → blockers` 延后到本设计跑通后。当前文档中 `blockers` 与代码 `staticBlockers` 同义。

**当前状态**：Step 1-4 跑通，可择机重构。建议同时清理 `updateDebugMeshes` dead code。

### 11.4 未来扩展（不在本设计范围）
- A* / NavMesh：当 Companion 需要绕障寻路时引入
- NPC 间 crowd separation：当多个自主移动 NPC 共存时引入
- 普通NPC 接入碰撞：sequence 驱动的 NPC 当前不需要

### 11.5 Charlotte following 移动中被玩家挡（未实现）
**问题**：[resolveMovement](file:///e:/se/BlindDuel/scripts/Systems/ExploreCollisionSystem.js#L6-L48) 解算 Charlotte 时遍历 `staticBlockers`，但 **player 不在 staticBlockers 里**（player 的 `blocksMovement` 是 false）。所以 Charlotte following 移动撞玩家时，玩家不在她的 blocker 列表，**她会穿过玩家**。

**当前影响**：X 方向有 `targetOffsetX: 1.0`，Charlotte 正常跟随时停在玩家身侧 1.0 处，不会重叠。只有玩家主动回头撞 Charlotte 才会穿过她。

**候选方案 A（推荐）**：player 也设 `blocksMovement: true`，进 staticBlockers。resolveMovement 已有 `if (blocker === entity) continue;` 自推防护，player 解算时跳过自己。Charlotte 解算时 player 是她的 blocker，撞上会被挡。
- 优点：一行配置改动，无需新代码
- 风险：player 进 blockers 后，所有 dynamicActor 解算都会遍历到 player，需确认无副作用（比如 enemy 未来接入碰撞时）

**候选方案 B**：dynamicActors 之间互相作为 blocker 传入。resolveMovement 解算 Charlotte 时，传 `blockers = staticBlockers + dynamicActors`（排除自己）。复杂度高，暂不采用。

**决策**：待玩家体验反馈。如果"玩家撞 Charlotte 穿过她"影响体验，再实施方案 A。