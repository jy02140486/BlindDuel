# NPC / Quest / WorldState 概要设计

## 设计原则

### Runtime 与 State 分离

Runtime：

- NpcController
- QuestController
- UI
- 动画
- Mesh

切场景时销毁。

State：

- WorldState

始终存在。

### WorldState 是唯一真相

NPC 不保存剧情状态：

```ts
npc.questCompleted = true;
```

不要这样做。

应该：

```ts
world.quests.herb.completed = true;
```

NPC 每次需要显示内容时：

```ts
npc.resolve(worldState);
```

从 WorldState 推导当前状态。

---

## WorldState

```ts
interface WorldState {
    scenario: number;
    flags: Record<string, boolean>;
    quests: Record<string, QuestState>;
}
```

---

## Scenario

主线剧情阶段。

```ts
scenario = 100;
```

例如：

- 100 到达村庄
- 200 获得钥匙
- 300 击败 Boss
- 400 离开村庄

用于控制：

- 主线剧情
- NPC 对白
- 场景变化

---

## Flags

世界事实。

```ts
flags = {
    gateOpened: true,
    metBlacksmith: true,
    bossDead: false
};
```

用于控制：

- 局部事件
- 机关状态
- 特殊触发

---

## QuestState

```ts
interface QuestState {
    stage: number;
    completed: boolean;
}
```

例如：

```ts
quests.herb = {
    stage: 2,
    completed: false
};
```

表示：

- 0 未接
- 1 已接
- 2 已获得药草
- 3 已完成

---

## QuestManager

职责：

- 修改 WorldState

例如：

```ts
world.quests.herb.stage = 1;
```

```ts
world.quests.herb.completed = true;
```

不负责：

- 修改 NPC
- 控制场景
- 刷新对白

---

## NPC

NPC 不保存任务状态。

错误：

```ts
npc.currentQuestStage = 2;
```

正确：

```ts
world.quests.herb.stage = 2;
```

NPC 查询 WorldState 决定当前表现。

---

## NpcConfig

```ts
interface NpcConfig {
    id: string;
    dialogues: DialogueEntry[];
}
```

---

## DialogueEntry

```ts
interface DialogueEntry {
    priority: number;
    condition: string;
    text: string;
    action?: string;
}
```

示例：

```json
{
    "priority": 100,
    "condition": "quest.herb.completed",
    "text": "谢谢你的帮助。"
}
```

```json
{
    "priority": 90,
    "condition": "quest.herb.stage == 2",
    "text": "你找到药草了吗？",
    "action": "completeHerbQuest"
}
```

```json
{
    "priority": 0,
    "condition": "true",
    "text": "今天天气不错。"
}
```

---

## NPC 对白解析

```ts
npc.resolveDialogue(world);
```

流程：

```text
WorldState
      ↓
遍历 DialogueEntry
      ↓
按 priority 排序
      ↓
找到第一条满足条件的配置
      ↓
返回结果
```

例如：

```ts
quest.herb.stage = 2;
```

得到：

```text
你找到药草了吗？
```

任务完成：

```ts
quest.herb.completed = true;
```

再次查询：

```text
谢谢你的帮助。
```

---

## 主线剧情对白

使用：

```ts
world.scenario
```

例如：

```json
{
    "condition": "scenario >= 300",
    "text": "Boss终于被消灭了。"
}
```

---

## 任务对白

使用：

```ts
world.quests
```

例如：

```json
{
    "condition": "quest.herb.stage == 2",
    "text": "你找到药草了吗？"
}
```

---

## 世界事件对白

使用：

```ts
world.flags
```

例如：

```json
{
    "condition": "gateOpened",
    "text": "城门已经开放。"
}
```

---

## 数据流

```text
玩家行为
      ↓
QuestManager
      ↓
修改 WorldState
      ↓
NPC resolve(world)
      ↓
选择对白
      ↓
显示气泡
```

---

## 总结

NPC：

- 不保存剧情状态
- 不保存任务状态

Quest：

- 只修改 WorldState

WorldState：

```text
scenario  -> 主线进度
quests    -> 任务进度
flags     -> 世界事实
```

对白：

```text
WorldState
      ↓
条件匹配
      ↓
选中一条 DialogueEntry
      ↓
显示文本
```

核心思想：

> NPC 不知道发生了什么。
>
> NPC 只根据 WorldState 判断：
>
> “现在我应该说什么。”