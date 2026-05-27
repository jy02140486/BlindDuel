# NPC Controller 最小设计：Idle + Greeting

## 目标
- 为 NPC 提供一个轻量、非战斗的专用控制器。
- 满足第一版需求：
  - 平时播放 `idle`
  - 玩家进入一定距离时，播放 `greeting`
  - `greeting` 持续 `2s`
  - 结束后回到 `idle`

## 为什么单独做 `NpcController`
- `PlayerController` 负责读取玩家输入，不适合 NPC。
- 现有战斗 `AIController` 偏战斗决策，职责过重。
- NPC 当前只需要简单的非战斗状态切换，用轻量控制器最稳。

## 最小状态
- `idle`
- `greeting`

## 状态规则
- 默认状态是 `idle`
- 当玩家进入触发距离，且当前不在 `greeting` 中时，切到 `greeting`
- `greeting` 持续 `2000ms`
- 时间到后自动回到 `idle`
- 若玩家持续停留在范围内，第一版建议不要无限重复触发

## 推荐数据

```js
npcController = {
  state: "idle",
  stateElapsedMs: 0,
  greetingDurationMs: 2000,
  greetingRadius: 3.5,
  hasGreetedInRange: false
}
```

## 资源与碰撞约束
- NPC 第一版只依赖：
  - 动画帧 / spritesheet
  - root motion 数据
- NPC 不接入战斗碰撞资源：
  - 不需要 `CollisionMask`
  - 不需要 `PushBox`
  - 不需要 hitbox / hurtbox
- NPC 的基础碰撞直接使用 root motion 圆形占位的外接矩形（AABB）。
- 这个 AABB 只用于简单阻挡与接近判断，不参与战斗命中。

## 推荐更新逻辑

```js
update(dtMs, npc, context) {
  const player = context.player;
  if (!player) return;

  this.stateElapsedMs += dtMs;

  const dx = player.position.x - npc.position.x;
  const dy = player.position.y - npc.position.y;
  const distSq = dx * dx + dy * dy;
  const inGreetingRange = distSq <= this.greetingRadius * this.greetingRadius;

  if (this.state === "idle") {
    if (inGreetingRange && !this.hasGreetedInRange) {
      this.enterGreeting(npc);
      this.hasGreetedInRange = true;
      return;
    }
  }

  if (this.state === "greeting") {
    if (this.stateElapsedMs >= this.greetingDurationMs) {
      this.enterIdle(npc);
    }
  }

  if (!inGreetingRange) {
    this.hasGreetedInRange = false;
  }
}
```

## 动画联动
- `idle` 状态时：
  - `npc.animation.setState("idle")`
- `greeting` 状态时：
  - `npc.animation.setState("greeting")`

说明：
- 这里假设 NPC 使用轻量动画 driver
- 每个状态对应一个固定帧或一个很短的轻量表现
- 如果 `greeting` 只是单帧，也完全没问题，2 秒内保持该状态即可

## 推荐接口

```js
enterIdle(npc) {
  this.state = "idle";
  this.stateElapsedMs = 0;
  npc.animation.setState("idle");
}

enterGreeting(npc) {
  this.state = "greeting";
  this.stateElapsedMs = 0;
  npc.animation.setState("greeting");
}
```

## 第一版行为约束
- 不要求 NPC 主动移动
- 不要求 NPC 转身朝向玩家
- 不要求重复 greeting 冷却系统
- 不要求任务/对话系统联动
- 不要求单独制作战斗碰撞数据

## 可选增强
- 玩家离开范围并再次进入时，可再次触发 `greeting`
- 加 `cooldownMs`，避免频繁切换
- 加 `facePlayer`，在 greeting 时转向玩家
- 加 `canGreet` 开关，供任务系统控制

## 验收标准
- NPC 初始播放 `idle`
- 玩家进入半径后，NPC 切到 `greeting`
- `greeting` 持续约 2 秒
- 结束后自动回到 `idle`
- 玩家不离开范围时，不会每帧重复重置 `greeting`
- NPC 仅靠动画帧和 root motion 数据即可运行
- NPC 的 AABB 可用于基础接近判断和阻挡检查
