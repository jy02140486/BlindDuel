# RPG 世界状态架构概要设计

## 项目背景

项目特点：

* 2D RPG
* Babylon
* 探索 + 战斗双模式
* 探索/战斗切换已完成
* 场景配置 JSON 化
* 单人开发
* 中小规模（类似法老控/JRPG）

设计目标：

* 支持跨场景任务
* 支持 NPC 对话变化
* 支持 Pickable 永久变化
* 支持固定遭遇战
* 支持存档/读档
* 避免 Runtime 脏状态

---

# 总体结构

```text
Game
├─ WorldState
├─ SceneManager
├─ QuestManager
├─ InventoryManager
├─ CombatManager
└─ SaveManager
```

其中：

```text
QuestManager
InventoryManager
CombatManager
        ↓
修改
        ↓
WorldState
```

```text
SceneManager
        ↓
WorldState + SceneData
        ↓
构建 Runtime Scene
```

---

# 核心原则

## 1. Runtime 都是临时的

以下对象都属于 Runtime：

```text
NPC 实例
Pickable 实例
Encounter 实例
Babylon Mesh
事件监听器
动画状态
AI 状态
```

切场景时：

```text
dispose
```

重新进入场景时：

```text
重新生成
```

---

## 2. WorldState 是唯一真相

所有永久状态都保存在：

```ts
WorldState
```

---

## 3. 世界查询状态，而不是被推送状态

不是：

```text
Quest
    ↓
修改 NPC
```

而是：

```text
Quest
    ↓
修改 WorldState

NPC
    ↓
查询 WorldState
```

---

# WorldState

```ts
interface WorldState {

    scenario: number;

    quests: Record<string, QuestState>;

    flags: Record<string, boolean>;

    sceneStates: Record<string, SceneState>;

    player: PlayerState;
}
```

---

# Scenario

主线推进编号。

```ts
scenario: 120;
```

例如：

```text
100 = 到达村庄

110 = 接受讨伐任务

120 = 击败 Boss

130 = 离开村庄
```

---

# QuestState

任务进度。

```ts
interface QuestState {

    stage: number;

    completed: boolean;
}
```

例如：

```ts
quests: {

    herbQuest: {

        stage: 2,

        completed: false
    }
}
```

表示：

```text
0 = 未接任务

1 = 已接任务

2 = 已获得任务物品

3 = 已完成
```

---

# Flags

世界事实。

```ts
flags: {

    banditBossDead: true,

    villageGateOpened: true,

    rescuedChild: false
}
```

用于控制：

```text
NPC 状态

Boss 是否存在

机关状态

特殊事件
```

---

# SceneState

记录场景永久变化。

```ts
interface SceneState {

    pickables: Record<string, boolean>;

    encounters: Record<string, boolean>;
}
```

例如：

```ts
sceneStates: {

    forest: {

        pickables: {

            herb001: true
        },

        encounters: {

            wolfPack03: true
        }
    }
}
```

表示：

```text
药草已拾取

狼群已击败
```

---

# SceneData

每张地图的配置。

```ts
interface SceneData {

    npcs: NPCConfig[];

    pickables: PickableConfig[];

    encounters: EncounterConfig[];
}
```

---

# SceneBuilder

职责：

```text
SceneData
        +
WorldState
        ↓
SceneBuilder
        ↓
Runtime Scene
```

流程：

```ts
buildScene(sceneData, worldState);
```

内部：

```ts
spawnNPCs();

spawnPickables();

spawnEncounters();
```

---

# NPC

原则：

```text
NPC 不被任务直接修改。
```

---

NPC：

```ts
class NPC {

    resolve(world: WorldState): NPCState;
}
```

---

NPC 配置：

```ts
interface NPCStateConfig {

    condition: string;

    dialogueId: string;
}
```

例如：

```json
{
    "states": [

        {
            "condition": "scenario < 120",

            "dialogueId": "guard_normal"
        },

        {
            "condition": "scenario >= 120",

            "dialogueId": "guard_after_boss"
        }
    ]
}
```

交互：

```ts
const state = npc.resolve(world);

dialogue.play(state.dialogueId);
```

---

# Pickable

配置：

```ts
interface PickableConfig {

    id: string;

    spawnIf?: string;

    persistent: boolean;
}
```

生成：

```ts
if (evaluate(spawnIf)) {

    spawn();
}
```

拾取：

```ts
inventory.add(item);

world.sceneStates[sceneId]
    .pickables[id] = true;
```

---

# Encounter

配置：

```ts
interface EncounterConfig {

    id: string;

    battleId: string;

    spawnIf?: string;

    persistent: boolean;
}
```

生成：

```ts
if (!defeated) {

    spawn();
}
```

战斗胜利：

```ts
world.sceneStates[sceneId]
    .encounters[id] = true;
```

---

# QuestManager

职责：

```text
维护任务进度

修改 WorldState
```

不负责：

```text
控制 NPC

控制场景

生成物体
```

例如：

```ts
completeQuest(id) {

    quest.completed = true;

    world.flags.banditBossDead = true;
}
```

---

# InventoryManager

职责：

```text
维护玩家持有物品
```

例如：

```ts
inventory.add(item);

inventory.remove(item);
```

任务可查询：

```ts
inventory.has(itemId);
```

---

# 场景切换

流程：

```text
导出 Runtime
        ↓
更新 WorldState
        ↓
dispose Runtime
        ↓
加载 Scene JSON
        ↓
SceneBuilder(world)
        ↓
新 Runtime
```

即：

```text
Runtime Scene
        ↓
WorldState
        ↓
Runtime Scene
```

---

# 存档

存储：

```ts
WorldState
```

例如：

```json
{
    "scenario": 120,

    "quests": {},

    "flags": {},

    "sceneStates": {},

    "player": {}
}
```

不存储：

```text
Babylon Scene

NPC 实例

Mesh

AI 状态

事件监听器
```

这些属于 Runtime。

---

# 典型任务流程

## 场景 A 接任务

```text
村长：
帮我寻找药草。
```

```ts
world.quests["herbQuest"] = {

    stage: 1,

    completed: false
};
```

---

## 场景 B 采集药草

生成条件：

```text
quest.stage == 1
```

拾取：

```ts
inventory.add("specialHerb");

world.quests["herbQuest"]
    .stage = 2;

world.sceneStates["forest"]
    .pickables["specialHerb"] = true;
```

---

## 返回场景 A

NPC 查询：

```text
quest.stage == 2
```

对白：

```text
你找到药草了吗？
```

---

## 交任务

```ts
inventory.remove("specialHerb");

world.quests["herbQuest"]
    .completed = true;

world.quests["herbQuest"]
    .stage = 3;
```

NPC 查询：

```text
quest.completed == true
```

对白：

```text
谢谢你的帮助。
```

---

# 最终数据流

```text
玩家行为
    ↓
QuestManager / CombatManager
    ↓
修改 WorldState
    ↓
切场景
    ↓
SceneBuilder
    ↓
查询 WorldState
    ↓
生成正确的 Runtime Scene
```

---

# 总结

```text
Runtime 是临时的。

WorldState 是永久的。

Quest 修改 WorldState。

NPC 查询 WorldState。

SceneBuilder 查询 WorldState。

存档保存 WorldState。
```

法老控式 RPG 可以理解为：

```text
Scenario
    +
Quest Stage
    +
Flag
    +
SceneState
        ↓
决定 NPC 对话

决定 Boss 是否存在

决定 Pickable 是否生成

决定 Encounter 是否出现
```
