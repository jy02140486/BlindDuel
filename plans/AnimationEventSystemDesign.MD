e:\se\BlindDuel\plans\AnimationEventSystemDesign.MD
# Animation Event System Design

> Version: 0.1
>
> 关系：接管 `plans/AudioSystemDesign.MD` §8「与 Animation 集成」。Audio 作为本系统的消费者之一，AudioSystemDesign.MD 主体已落地，归档至 `plans/archived/`。
>
> 目标：建立通用化的动画帧事件机制，让 Audio / VFX / Camera / Gameplay 等表现层系统以订阅者身份消费动画帧事件，避免 Animation 与任何具体表现系统耦合。

***

# 1. 设计目标

## 1.1 三层架构
Animation              // 动画推进
↓
Animation Event        // 帧事件抽象层
↓
Presentation Systems
├─ Audio             // 第一阶段唯一消费者
├─ VFX               // 未来
├─ Camera            // 未来
└─ Gameplay          // 极少
Animation 层只关心「动画推进到第 N 帧了」。
Animation Event 层只负责「把这件事告诉对此感兴趣的消费者」。
Presentation 层各自决定「这个事件对我意味着什么」。

## 1.2 原则

### Animation 不感知消费者

`FrameAnimationComponent` / `NpcFrameComponent` 不知道 Audio 存在，也不知道 VFX / Camera 存在。

### Event payload 不携带消费者语义

事件 payload 用通用 `type`（如 `footstep` / `swing`），不写 `audio_id` / `vfx_id` / `camera_shake_intensity`。消费者自行决定如何响应。

### Sidecar 元数据模式

`events.json` 跟随 `atlas.json` 组织，与 `.collider.json` 对称。一个 AnimationClip 的伴生资源集合：
attack01.png              // 图像
attack01.json             // atlas
attack01.collider.json    // 碰撞元数据（工具生成）
attack01.events.json      // 动画事件（人工维护）
### 多消费者订阅零侵入

新增消费者（如 VFX）只需 subscribe，不修改 `FrameAnimationComponent` / `AnimationEventBus` / Audio 消费者。

***

# 2. 系统结构
Animation 层
└─ FrameAnimationComponent / NpcFrameComponent.fixedUpdate()
└─ 帧推进命中事件帧 → 调用注入的 onAnimationEvent 回调
↓
事件层
└─ AnimationEventBus.dispatch(payload)
↓ (多消费者订阅)
Presentation 层
├─ AudioManager.subscribeAll → audioManager.play(type, options)
├─ VFXSystem.subscribe("effect") → spawn(id)              [未来]
├─ CameraSystem.subscribe("camera_shake_heavy") → shake() [未来]
└─ GameplayNotifier.subscribe("notify") → ...             [极少，未来]
职责：

## AnimationEventBus

事件分发中枢。提供：

```js
subscribe(type, handler)      // 按 type 订阅
subscribeAll(handler)         // 订阅所有事件
dispatch(payload)             // 由 component 触发
clear()                       // 场景切换时清理订阅（按需）
```

不维护事件历史，不分发到 `GameplayEventBus`（语义边界不同，见 §5.3）。

## FrameAnimationComponent / NpcFrameComponent

扩展（不改 API 表面）：在 `play(clipName)` 时挂载事件表，在 `fixedUpdate` 帧推进时检测命中事件帧，通过注入的 `onAnimationEvent` 回调转发。

不直接发 bus——保持 component 纯粹，由 owner（`CharacterBase` / `NpcCharacter`）注入回调并转发，附带 `source` 信息。

## CharacterBase / NpcCharacter

注入 `onAnimationEvent` 给动画组件，转发到 `AnimationEventBus` 时附带 `source: this`。

***

# 3. 资源组织（sidecar 模式）

## 3.1 与 atlas 对齐

`events.json` 跟随 `atlas.json` 而非 `collider.json`——动画的图像载体是 atlas，collider 是工具生成的衍生数据。

| 类型 | atlas 组织 | events.json 组织 |
|---|---|---|
| 战斗角色（longswordman / manatarms_sword / rabble_stick） | 每 clip 一个 atlas 文件 | 每 clip 一个 events.json |
| NPC（traveller / merchant / bard / charlotte 等） | 一个 atlas 文件含所有 clip（用 frameTags 切分） | 一个 events.json 含所有 clip |

## 3.2 目录结构
Chat

思考过程

好问题，A1 需要适配两种 atlas 组织方式。我先查一下 NPC 类的 atlas 实际结构，再回答能否覆盖。

在工作区搜索 'NPCs|merchant|traveller'

在工作区搜索 'atlasData|clips\s*[:=]'

Data\CollisionMask\longswordman\longswordman_walk.collider.json

Thought

我需要再确认一下 NPC 的 clip 组织方式，看 NpcFrameComponent 是怎么按 clip 切分的。

scripts\Components\NpcFrameComponent.js

在工作区搜索 'Art/Sprite/NPCs/*.json'

Thought

确认完毕。现状是两种 component 并存：

类型 Component atlas 组织 clip 切分方式 战斗角色（longswordman / manatarms_sword / rabble_stick） FrameAnimationComponent 每 clip 一个 png/json（如 longswordman_walk.png ） 整个 atlas 就是一个 clip NPC（traveller / merchant / bard / charlotte 等） NpcFrameComponent 一个 png/json 含所有 clip（如 merchant.png ） 用 atlasData.meta.frameTags 里 name === clipName 的 tag 切 from/to

## A1 能覆盖，但需要两个调整
### 调整 1：events.json 物理组织跟 atlas.json 对齐（不是跟 collider.json 对齐）
付费 AI 的核心原则是「一个动画就是一个资源」，而 动画的图像载体是 atlas，不是 collider 。collider 是工具生成的衍生数据，可以独立组织。所以：

- 战斗角色 ：atlas 每 clip 一个文件 → events.json 也每 clip 一个文件（跟 collider.json 顺带也对称）
- NPC ：atlas 一个文件含所有 clip → events.json 也一个文件含所有 clip
### 调整 2：Schema 统一为「按 clip 分组」形态
为了同时覆盖单 clip 文件和多 clip 文件，所有 .events.json 顶层统一用 clips 字段：

战斗角色 Data/AnimationEvents/longswordman/longswordman_walk.events.json ：

（虽然只有一个 clip，但 schema 跟 NPC 统一，避免加载器写两条路径）

NPC Data/AnimationEvents/NPCs/merchant.events.json ：

## 加载链路（跟现有 atlas/collider 完全对称）
1. AssetManifest 新增 animationEvents 分组：
2. CharacterFactory clips 配置 新增 eventsData 字段，跟 atlasData / colliderData 平级：
   
   NPC 端同理，所有 clip 共享同一个 eventsData （指向 merchant.events.json ），NpcFrameComponent 在 play(clipName) 时按 clipName 查 eventsData.clips[clipName].events 。
3. FrameAnimationComponent / NpcFrameComponent 接入点统一 ： play(clipName) 时查 eventsData.clips[clipName].events ，缓存到 this._currentClipEvents 。两个 component 的事件触发逻辑可以共用一个 mixin 或基类方法。
## 需要额外确认的子决策
# 子决策点 选项 我的倾向 A-1 NPC events.json 里 frame 索引语义 A-1a. 相对于 frameTag.from 的偏移（clip 内 0-based）
 A-1b. atlas 绝对帧索引 A-1a ——跟「一个动画就是一个资源」一致，clip 帧范围调整不影响 events A-2 战斗角色单 clip 文件是否允许简写 {events: [...]} 省略 clips 嵌套 A-2a. 允许，加载器双形态识别
 A-2b. 不允许，统一 clips 嵌套 A-2b ——schema 统一优先，冗余可接受 A-3 eventsData 注入方式 A-3a. CharacterFactory clips 配置加 eventsData 字段
 A-3b. FrameAnimationComponent 自己按 clipName fetch A-3a ——跟 atlasData/colliderData 对称，加载链路统一

确认 A-1 / A-2 / A-3 后 ，A1 方案就完全落地，我可以开始写 plans/AnimationEventSystemDesign.MD 草案。其余决策点 B-I（事件分发机制、type 字段名、id 语义、消费者映射、bus 引入、文档归属、Step 拆分、接入范围）也一并等你拍板。

19:54
用户6856009908

好，没啥问题，写MD，然后Audio是不是可以archived了

Chat

思考过程

用户要我：

1. 写``plans/AnimationEventSystemDesign.MD`` 设计文档
2. 询问 AudioSystemDesign.MD 是否可以归档
这是一个文档撰写任务，不是代码改动。需要先确认归档问题的逻辑，再写 MD。

归档逻辑分析：

- AudioSystemDesign.MD §8 当前包含 frame_events.json 设计——这部分会被 AnimationEventSystemDesign.MD 接管
- §1-7, §9-14 仍然是 Audio 系统的有效设计——MusicPlayer/AudioBus/Sequencer playAudio 等都已实现
- AudioSystemDesign.MD 还描述了 §3 Audio Event / §5 推荐事件列表 / §6 调用链 / §7 Sequencer 集成 / §9 Music / §11 开发顺序 / §13 系统集成 / §14 切片工具——这些都是 Audio 自身的设计，仍然有效
所以归档判断：

- AudioSystemDesign 不能完全归档，因为大部分内容仍有效
- §8「与 Animation 集成」这一节需要从「主设计」变成「消费者接入说明」，引用 AnimationEventSystemDesign
但是用户说「Audio 是不是可以 archived 了」——这个判断需要谨慎。

从 Handoff 看，Audio 系统的 Step 1-5 都已完成，并且 Step 6 现在被拆分出去。剩下 Step 6 的 audio 部分变成「Audio 作为 AnimationEvent 消费者接入」，这部分工作量很小。

所以归档的真正含义应该是：Audio 系统作为独立计划已经完成主体设计实现，剩余部分（消费者接入）属于 AnimationEvent 系统的工作。所以可以归档。

但 AudioSystemDesign.MD 是设计文档，不是计划文档。归档通常指计划文档归档到 plans/archived/。设计文档一般保留在 plans/ 作为参考。

让我先看一下 plans/ 目录结构，理解归档惯例。

我应该：

1. 先 LS plans/ 看一下结构
2. 读 INDEX.md 确认归档惯例
3. 写 AnimationEventSystemDesign.MD
4. 决定 AudioSystemDesign 的处理方式（归档 / 保留 / 修订 §8）
让我并行执行这些任务。

先做规划——

AnimationEventSystemDesign.MD 应该包含：

# Animation Event System Design
- Version 0.1
- 目标
## 1. Design Goals
- 三层架构
- Animation → AnimationEvent → Presentation Systems
- 解耦消费者
- sidecar 模式
## 2. 系统结构
- 三层架构图
- FrameAnimationComponent / NpcFrameComponent 扩展
- AnimationEventBus
- 消费者注册
## 3. 资源组织（sidecar 模式）
- 战斗角色 vs NPC 两种 atlas 形态
- 统一 schema``clips`` 嵌套
- 加载链路
## 4. Event Schema
- ``{frame, type}`` 主形态
- ``{frame, type, id}`` 参数化形态
- type 字段规范
- frame 索引语义
## 5. AnimationEventBus
- 接口设计
- 多消费者订阅
- payload 结构
## 6. FrameAnimationComponent 扩展
- play() 时挂载事件表
- fixedUpdate 触发判定
- 防重触发
- 重置时机
- 回调注入
## 7. NpcFrameComponent 扩展
- 类似 FrameAnimationComponent
- frame 索引相对 frameTag.from 偏移
## 8. 消费者接入
- Audio 消费者（第一阶段）
- 第一阶段 type === audioId 简化策略
- 未来武器感知映射
## 9. 与现有架构关系
- 与 Sequencer playAudio 的边界
- 与 attackActiveFrames 的边界
- 与 GameplayEventBus 的边界
## 10. 第一阶段不做
- VFX/Camera/Gameplay 消费者
- 武器感知映射
- 事件编辑器
- 等等
## 11. 开发步骤
- Step 6a：AnimationEvent 系统（数据 + 组件扩展 + bus）
- Step 6b：Audio 消费者接入
## 12. 与 AudioSystemDesign 的关系
- §8 由本文档接管
- AudioSystemDesign §8 改为引用
关于 Audio 归档判断：

让我先读 INDEX.md 看归档惯例。

实际上用户问「Audio 是不是可以 archived 了」——这是询问，我应该先回答这个判断。

根据 Handoff §3.6「不在 Step 6 范围」和 §4「遗留事项」，Audio 系统的 Step 1-5 都已完成。Step 6 的 Audio 部分会变成 AnimationEvent 系统的消费者接入（Step 6b）。所以：

- AudioSystemDesign.MD 作为整体设计文档，仍需保留作为 Audio 子系统的设计参考
- 但 §8「与 Animation 集成」这一节的内容会被 AnimationEventSystemDesign.MD 接管
- 修订方式：§8 改为简短的「Audio 作为 AnimationEvent 消费者，详见 AnimationEventSystemDesign.MD」
归档（移到 plans/archived/）的判断：

- 如果「归档」是指 plans/INDEX.md 里把 Audio Step 1-5 标记为已完成归档，那应该可以
- 如果「归档」是指 AudioSystemDesign.MD 文件移到 plans/archived/，那不应该——它仍然是有效设计
让我先 LS plans/ 看结构再决定。

另外用户说「写MD，然后Audio是不是可以archived了」——分两步：

1. 写 AnimationEventSystemDesign.MD（这是新文件创建，根据规则用 markdown code block 输出，不用 show_diff）
2. 回答 Audio 是否可以归档
根据系统提示，新文件创建用 markdown code block，不用 show_diff。

让我先 LS plans/ 看现有结构。

我先看一下 plans/ 目录结构和 INDEX.md 的归档惯例，再决定 Audio 的处理方式。

BlindDuel\plans

plans\INDEX.md

Thought

下面分两步：先输出 AnimationEventSystemDesign.MD 设计文档（新文件，用 code block），再回答 Audio 归档判断与操作。

## 一、新建设计文档
Animation              // 动画推进
↓
Animation Event        // 帧事件抽象层
↓
Presentation Systems
├─ Audio             // 第一阶段唯一消费者
├─ VFX               // 未来
├─ Camera            // 未来
└─ Gameplay          // 极少

attack01.png              // 图像
attack01.json             // atlas
attack01.collider.json    // 碰撞元数据（工具生成）
attack01.events.json      // 动画事件（人工维护）

Animation 层
└─ FrameAnimationComponent / NpcFrameComponent.fixedUpdate()
└─ 帧推进命中事件帧 → 调用注入的 onAnimationEvent 回调
↓
事件层
└─ AnimationEventBus.dispatch(payload)
↓ (多消费者订阅)
Presentation 层
├─ AudioManager.subscribeAll → audioManager.play(type, options)
├─ VFXSystem.subscribe("effect") → spawn(id)              [未来]
├─ CameraSystem.subscribe("camera_shake_heavy") → shake() [未来]
└─ GameplayNotifier.subscribe("notify") → ...             [极少，未来]

```

职责：

## AnimationEventBus

事件分发中枢。提供：

```js
subscribe(type, handler)      // 按 type 订阅
subscribeAll(handler)         // 订阅所有事件
dispatch(payload)             // 由 component 触发
clear()                       // 场景切换时清理订阅（按需）
```

不维护事件历史，不分发到 `GameplayEventBus`（语义边界不同，见 §5.3）。

## FrameAnimationComponent / NpcFrameComponent

扩展（不改 API 表面）：在 `play(clipName)` 时挂载事件表，在 `fixedUpdate` 帧推进时检
测命中事件帧，通过注入的 `onAnimationEvent` 回调转发。

不直接发 bus——保持 component 纯粹，由 owner（`CharacterBase` / `NpcCharacter`）注
入回调并转发，附带 `source` 信息。

## CharacterBase / NpcCharacter

注入 `onAnimationEvent` 给动画组件，转发到 `AnimationEventBus` 时附带 `source: 
this`。

***

# 3. 资源组织（sidecar 模式）

## 3.1 与 atlas 对齐

`events.json` 跟随 `atlas.json` 而非 `collider.json`——动画的图像载体是 atlas，
collider 是工具生成的衍生数据。

| 类型 | atlas 组织 | events.json 组织 |
|---|---|---|
| 战斗角色（longswordman / manatarms_sword / rabble_stick） | 每 clip 一个 atlas 
文件 | 每 clip 一个 events.json |
| NPC（traveller / merchant / bard / charlotte 等） | 一个 atlas 文件含所有 clip
（用 frameTags 切分） | 一个 events.json 含所有 clip |

## 3.2 目录结构

```
Data/
AnimationEvents/
longswordman/
longswordman_walk.events.json
longswordman_thrust.events.json
longswordman_quart.events.json
...
manatarms_sword/
manatarms_sword_smash.events.json
...
rabble_stick/
rabble_stick_swing.events.json
...
NPCs/
merchant.events.json
traveller.events.json
...
CS_Chars/
prologue_rabble_flee0.events.json
...
## 3.3 加载链路

与 atlas / collider 完全对称：

1. **AssetManifest** 新增 `animationEvents` 分组：

   ```js
   animationEvents: {
       hero: {
           walk: "./Data/AnimationEvents/longswordman/longswordman_walk.events.json",
           thrust: "./Data/AnimationEvents/longswordman/longswordman_thrust.events.json",
           // ... 每个 clip 一个入口
       },
       npc: {
           merchant: "./Data/AnimationEvents/NPCs/merchant.events.json"  // 整个 NPC 一个文件
       }
   }
   ```

2. **CharacterFactory clips 配置**新增 `eventsData` 字段，与 `atlasData` / `colliderData` 平级：

   ```js
   walk: {
       spriteSheetUrl: "./Art/Sprite/longswordman/longswordman_walk.png",
       atlasData: assets.atlas.hero.walk,
       colliderData: assets.colliders.hero.walk,
       eventsData: assets.animationEvents.hero.walk,  // ← 新增
       loop: true
   }
   ```

   NPC 端同理，所有 clip 共享同一个 `eventsData`。

3. **FrameAnimationComponent / NpcFrameComponent** 在 `play(clipName)` 时按 clipName 查 `eventsData.clips[clipName].events`，缓存到 `this._currentClipEvents`。

***

# 4. Event Schema

## 4.1 文件顶层结构

统一用 `clips` 嵌套，覆盖单 clip 文件与多 clip 文件两种形态：

```json
{
    "clips": {
        "<clipName>": {
            "events": [
                { "frame": 2, "type": "footstep" },
                { "frame": 6, "type": "footstep" }
            ]
        }
    }
}
```

战斗角色单 clip 文件也用 `clips` 嵌套（schema 统一优先，冗余可接受）：

```json
{
    "clips": {
        "walk": {
            "events": [
                { "frame": 2, "type": "footstep" },
                { "frame": 6, "type": "footstep" }
            ]
        }
    }
}
```

## 4.2 单个 event 结构

两种形态：

**形态 1**（type 即语义，最常见）：

```json
{ "frame": 3, "type": "footstep" }
```

**形态 2**（type + id 参数化）：

```json
{ "frame": 5, "type": "effect", "id": "dust_small" }
```

## 4.3 字段规范

| 字段 | 必填 | 说明 |
|---|---|---|
| `frame` | 是 | clip 内 0-based 帧索引 |
| `type` | 是 | 事件类型字符串，是事件的主语义 |
| `id` | 否 | type 的参数，仅当 type 是参数化类型（`effect` / `camera_shake` / `notify` 等）时填 |

## 4.4 frame 索引语义

| Component | frame 含义 |
|---|---|
| `FrameAnimationComponent` | atlas 绝对帧索引（整 atlas 就是一个 clip） |
| `NpcFrameComponent` | 相对 `frameTag.from` 的偏移，clip 内 0-based |

NPC 用相对偏移的好处：clip 帧范围（from/to）调整不影响 events 表。

## 4.5 推荐 type 列表

第一阶段常用：

| type | 触发场景 | 第一阶段消费者 |
|---|---|---|
| `footstep` | 走/跑动画落脚帧 | Audio |
| `swing_light` | 轻攻击挥剑帧 | Audio |
| `swing_heavy` | 重攻击挥剑帧 | Audio |
| `land` | 落地帧 | Audio |
| `cloth` | 衣服摩擦声帧（细节） | Audio |

未来扩展（不在第一阶段范围）：

| type | 消费者 |
|---|---|
| `effect` + `id` | VFXSystem |
| `camera_shake_small` / `camera_shake_heavy` | CameraSystem |
| `notify` + `id` | GameplayNotifier（极少） |

> 不引入 `enableHitbox` / `disableHitbox` 类型——攻击判定由状态图的 `attackActiveFrames` 权威源驱动，避免双源真相。

***

# 5. AnimationEventBus

## 5.1 接口

```js
class AnimationEventBus {
    subscribe(type, handler)      // 按 type 订阅
    subscribeAll(handler)         // 订阅所有事件
    dispatch(payload)             // 由 component 触发
    clear()                       // 场景切换时清理订阅（按需）
}
```

## 5.2 payload 结构

```js
{
    clipName: string,    // 触发事件的 clip 名
    frame: number,       // 触发帧索引
    type: string,        // 事件类型
    id?: string,         // 参数化 id（如有）
    source: object       // 触发事件的实体引用（CharacterBase / NpcCharacter 实例）
}
```

`source` 由 `CharacterBase` / `NpcCharacter` 注入回调时附加，消费者可读 `source.context`（武器、状态等）做映射。

## 5.3 与 GameplayEventBus 的边界

| Bus | 语义 | 示例 |
|---|---|---|
| `GameplayEventBus` | 业务事件 | `attack` / `hit` / `pickup` / `quest_complete` |
| `AnimationEventBus` | 演出层事件 | `footstep` / `swing` / `effect` / `camera_shake_heavy` |

两者独立，不互相订阅。业务逻辑监听 `GameplayEventBus`，表现层监听 `AnimationEventBus`。

***

# 6. FrameAnimationComponent 扩展

## 6.1 play() 时挂载事件表

```js
play(clipName, options = {}) {
    // 现有逻辑...
    this._currentClipEvents = this.#resolveEvents(clipName);
    this._firedEventKeys = new Set();
}

#resolveEvents(clipName) {
    const eventsData = this.currentClip?.eventsData;
    if (!eventsData?.clips?.[clipName]) return [];
    return eventsData.clips[clipName].events || [];
}
```

## 6.2 fixedUpdate 触发判定

在现有 while 循环里，每次 `currentFrameIndex` 变化后检查命中：

```js
fixedUpdate(dtMs) {
    // 现有逻辑...
    while (this.timeInFrameMs >= this.currentFrame.durationMs) {
        this.timeInFrameMs -= this.currentFrame.durationMs;
        if (this.currentFrameIndex + 1 < this.frames.length) {
            this.currentFrameIndex += 1;
            this.#tryFireEvents(this.currentFrameIndex);
        } else if (this.loop) {
            this.currentFrameIndex = 0;
            this._firedEventKeys.clear();  // loop 边界重置，下一圈可再触发
            this.#tryFireEvents(this.currentFrameIndex);
        } else {
            this.currentFrameIndex = this.frames.length - 1;
            this.timeInFrameMs = 0;
            this.finished = true;
            break;
        }
    }
}

#tryFireEvents(frameIndex) {
    const key = String(frameIndex);
    if (this._firedEventKeys.has(key)) return;
    const events = this._currentClipEvents.filter(e => e.frame === frameIndex);
    for (const event of events) {
        this.onAnimationEvent?.({
            clipName: this.currentClipName,
            frame: frameIndex,
            type: event.type,
            id: event.id
        });
    }
    this._firedEventKeys.add(key);
}
```

## 6.3 重置时机

- `play(restart=true)` 清空 `_firedEventKeys`
- loop 边界 `currentFrameIndex` 回 0 时清空（让下一圈能再触发）
- `finished` 时不重置（动画结束不再触发）

## 6.4 回调注入

component 不直接发 bus，由 owner 注入：

```js
// CharacterBase
this.animComponent.onAnimationEvent = (payload) => {
    this._animationEventBus.dispatch({ ...payload, source: this });
};
```

***

# 7. NpcFrameComponent 扩展

类似 `FrameAnimationComponent`，差异：

- `frame` 索引相对于 `frameTag.from`，触发判定时用 `currentFrameIndex - frameTag.from` 作为查询 key
- `_currentClipEvents` 来自 `eventsData.clips[clipName].events`
- `onAnimationEvent` 回调由 `NpcCharacter` 注入（如果 NPC 也需要事件，第一阶段可暂不接入）

第一阶段 NPC 不强制接入事件——大多数 NPC 动画（idle/talk）不需要帧事件。预留扩展点即可。

***

# 8. 消费者接入

## 8.1 第一阶段：Audio 消费者

```js
// AudioManager.init 或 attachScene 时
this._animEventBus.subscribeAll((payload) => {
    // 简化策略：type 直接当 audioId
    this.play(payload.type, { source: payload.source });
});
```

## 8.2 第一阶段简化策略

- `type === audioId`：要求事件 `type` 与 `audio_clips.json` 的 id 对齐（如 `footstep` / `swing_heavy` / `swing_light`）
- 不做武器感知映射（`swing` → `longsword_swing`）：后置

## 8.3 未来扩展：武器感知映射

新增 `Data/Audio/audio_event_mappings.json`：

```json
{
    "swing": {
        "longsword": "longsword_swing",
        "axe": "axe_swing"
    }
}
```

`AudioManager` 内部查表：`event.type + source.context.weapon → audioId`。Animation 端不需要任何改动——这正是 `type` 不携带消费者语义的好处。

## 8.4 未来消费者

| 消费者 | 订阅 type | 行为 |
|---|---|---|
| VFXSystem | `effect` | `spawn(event.id)` |
| CameraSystem | `camera_shake_heavy` | 触发镜头震动 |
| GameplayNotifier | `notify` | 极少，如 `open_hand` → `spawn_pickup` |

***

# 9. 与现有架构的边界

## 9.1 与 TimelineSequencer playAudio 的边界

| 机制 | 语义 | 场景 |
|---|---|---|
| TimelineSequencer `playAudio` clip | 编排层显式指定音效 | 过场动画里门开了 → `door_open` |
| AnimationEvent 驱动 audio | 动画自带元数据 | 走路脚步声、挥剑声 |

两者共存，`AudioManager` 都是入口，不需要统一。

## 9.2 与 attackActiveFrames 的边界

- `attackActiveFrames`：状态图配置，`CombatSystem` 权威源，决定攻击判定生效帧
- AnimationEvent：演出层事件，不影响 gameplay 判定

**不引入 `enableHitbox` / `disableHitbox` 事件类型**——避免双源真相。如果攻击判定漏配，应该修状态图，不应在事件里补。

## 9.3 与 Sequencer moveActorTo 的边界

- `moveActorTo`：编排层显式控制角色位置
- AnimationEvent：动画自带元数据，不影响位置

**不引入 rootmotion 类事件**——项目已有独立 RootMotion 数据，不通过事件系统传递。

***

# 10. 第一阶段不做

- VFX 消费者
- Camera 消费者
- Gameplay 消费者
- 武器感知映射（`type` 直接当 audioId）
- 事件编辑器（手工维护 `.events.json`）
- 事件可视化 debug 工具
- 跨实体事件冒泡
- NPC 事件接入（预留扩展点，但不强制配 `.events.json`）

***

# 11. 开发步骤

## Step 6a：AnimationEvent 系统

| # | 任务 | 文件 |
|---|---|---|
| 1 | 新建 AnimationEventBus | `scripts/Systems/AnimationEventBus.js` |
| 2 | AssetManifest 新增 animationEvents 分组 | `scripts/AssetManifest.js` |
| 3 | CharacterFactory clips 配置新增 eventsData 字段 | `scripts/CharacterFactory.js` |
| 4 | FrameAnimationComponent 扩展（事件表挂载 + fixedUpdate 触发 + 防重 + 重置 + 回调注入） | `scripts/Components/FrameAnimationComponent.js` |
| 5 | NpcFrameComponent 同步扩展（预留扩展点，NPC 暂不接入） | `scripts/Components/NpcFrameComponent.js` |
| 6 | CharacterBase 注入 onAnimationEvent 回调转发到 bus | `scripts/Enties/CharacterBase.js` |
| 7 | Game / Scene 持有 AnimationEventBus 实例 | `scripts/Game.js` / `scripts/Scene.js` |
| 8 | 新建示例 .events.json（longswordman_walk + longswordman_thrust） | `Data/AnimationEvents/longswordman/` |

## Step 6b：Audio 消费者接入

| # | 任务 | 文件 |
|---|---|---|
| 1 | AudioManager 订阅 AnimationEventBus | `scripts/Systems/AudioManager.js` |
| 2 | 简化策略：`type === audioId` | 同上 |
| 3 | 移除 CharacterBase 的 `_footstepAccumMs` / `FOOTSTEP_INTERVAL_MS` 时间常量逻辑 | `scripts/Enties/CharacterBase.js` |
| 4 | 补充 audio_clips.json 的 swing_light / swing_heavy / footstep 条目（如未配置） | `Data/Audio/audio_clips.json` |
| 5 | 验证 walk / thrust 动画帧事件触发的 footstep / swing 音效 | — |

## Step 6c（后置）

- 武器感知映射（等真有武器切换需求时再做）
- VFX / Camera / Gameplay 消费者（等对应系统接入时再做）

***

# 12. 与 AudioSystemDesign 的关系

- `plans/AudioSystemDesign.MD` §8「与 Animation 集成」内容由本文档接管
- `plans/AudioSystemDesign.MD` 整体归档至 `plans/archived/AudioSystemDesign.MD`（Step 1-5 已全部实现，无后续 Step）
- Audio 作为 AnimationEvent 的消费者之一，AudioSystemDesign 不再单独描述帧事件机制

***

# 13. 验证方法

## Step 6a 验证

1. Console 临时加 log 验证 `AnimationEventBus.dispatch` 被调用
2. walk 循环时帧事件重复触发正常（每循环一次触发一次）
3. thrust 单次播放事件只触发一次
4. 重启 thrust 时事件状态重置（不会漏触发或重复触发）
5. sequencer 期间 `controlledBySequence` 不影响事件触发（动画照常推进）

## Step 6b 验证

1. CharacterBase 行走时 footstep 在 walk 动画指定帧触发（而非 380ms 间隔）
2. thrust 动画播放到指定帧时触发 swing 音效
3. Console `audioManager.setBusVolume("sfx", 0.5)` 后帧事件触发的音效同步降低
4. 移除时间常量后无回归（角色待机/移动/攻击音效正常）

***

# 14. 总结

本系统遵循以下原则：

- Animation 层不感知任何具体表现系统
- AnimationEventBus 作为事件分发中枢，支持多消费者订阅
- events.json 以 AnimationClip 为中心组织（sidecar 模式，与 atlas / collider 对称）
- 事件 payload 用通用 type，不携带消费者语义
- Audio 是第一阶段唯一消费者，未来 VFX / Camera / Gameplay 零侵入接入
- 攻击判定不依赖事件系统，由状态图 `attackActiveFrames` 权威源驱动