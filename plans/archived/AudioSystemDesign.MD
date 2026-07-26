# Audio System Design

> Version: 0.2（对齐 PROJECT_CONTEXT 后修订）
>
> 目标：
>
> - 优先支持 SFX（音效）
> - Music 为可选模块，即使没有 BGM 也能完整运行
> - 尽量减少业务代码直接依赖音频实现
> - 与现有 Sequencer / GameMode / WorldState 架构一致
> - 后续方便替换临时音效资源

***

# 1. Design Goals

## 1.1 第一阶段

实现一个足够稳定的音效系统，覆盖：

- 玩家动作
- 战斗
- NPC
- Quest
- Scene
- Environment

> UI 事件第一阶段不接入（项目当前为 HUD 形态，无 Menu 概念），等真有交互式 UI 再补。

暂不考虑：

- 混音器高级功能
- 空间音频
- 混响
- 动态音乐
- Wwise/FMOD 等中间件
- 材质细分音效（如 `hit_flesh` / `hit_metal`），先用 `hit_impact` / `hit_block` / `hit_parry`

***

## 1.2 原则

### Event Driven

业务代码不知道音频文件。

只知道：

```js
audio.play("sword_hit");
```

而不是：

```js
play("assets/audio/sword_hit_03.wav");
```

***

### Data Driven

音效资源全部配置化。

例如：

```json
{
    "id":"sword_hit",
    "clips":[
        "sword_hit_01",
        "sword_hit_02",
        "sword_hit_03"
    ],
    "volume":0.9,
    "pitch":[0.96,1.04]
}
```

以后增加随机变化无需修改代码。

> `pitch:[min,max]` 语义：在该区间内**线性随机**取值。

***

### Stateless Gameplay

Gameplay 不维护任何音频状态。

例如：

Character

不知道：

- 当前播放哪个声音
- 声音什么时候结束
- AudioNode 是否存在

这些全部由 AudioSystem 管理。

***

# 2. 系统结构

```
Game (scripts/Game.js)
  │
  ├── AudioManager (scripts/Systems/AudioManager.js)
  │     │
  │     ├── AudioDatabase   (scripts/Systems/Audio/AudioDatabase.js)
  │     ├── AudioPlayer     (scripts/Systems/Audio/AudioPlayer.js)
  │     ├── AudioPool       (scripts/Systems/Audio/AudioPool.js)
  │     ├── MusicPlayer     (scripts/Systems/Audio/MusicPlayer.js)
  │     └── AudioBus        (scripts/Systems/Audio/AudioBus.js)
  │
  └── Scene (scripts/Scene.js)
        └── 通过 this._game.audioManager 访问
```

> 依据 PROJECT_CONTEXT §6 注解 #13：稳定对象生命周期归 Game，Scene 不再持有稳定对象别名字段。AudioManager 由 `scripts/Game.js` 创建并持有，Scene 通过 `this._game.audioManager` 访问。

职责：

## AudioManager

唯一入口。

提供：

```js
play(id, options)

stop(id)

playMusic(id, options)

stopMusic()

setBusVolume(busName, value)

update(deltaTime)
```

### update(deltaTime)

由 `Scene.updateRender(deltaTime)` 每帧驱动。

- 第一阶段：空实现（占位，避免后续调用点散落）
- 第二阶段：Music Fade / Bus Volume Interpolation / Cross Fade / Ambient Transition

AudioManager 不维护独立的 `requestAnimationFrame`，也不参与 `Scene.fixedUpdate()`，以保持与其他 Manager 一致的生命周期和暂停语义。

### Pause 感知

项目已有按 P 键暂停游戏的逻辑。AudioManager 第一阶段先**感知**该事件（接收回调或标志位），具体处置策略（静音全部 bus / 仅暂停 Music / 保留 SFX 播完）后置决定。

***

## AudioDatabase

维护：

AudioId

↓

Clip Definition

例如：

```
"sword_hit"

↓

[
 hit01.wav,
 hit02.wav,
 hit03.wav
]
```

***

## AudioPlayer

负责：

- 取随机 Clip
- 设置音量
- 设置 Pitch
- 播放
- 回收

***

## AudioPool

避免频繁创建 `BABYLON.Sound` 实例。

> 项目已用 Babylon.js（CDN），第一阶段直接用 `BABYLON.Sound` + `BABYLON.AudioEngine`（基于 WebAudio），不再走 HTMLAudioElement，避免后续迁移成本。

后期若扩展 mixer / snapshot，走 Babylon API 即可，无需修改 Gameplay。

***

## MusicPlayer

单独维护：

当前 BGM

支持：

- Fade In
- Fade Out
- Cross Fade（场景切换时默认 `crossfade`，时长 800ms）
- Loop

第一阶段甚至可以只有：

```
play(id, options)

stop()

switchMusic(id, transition)  // transition: "crossfade" | "cut"
```

***

## AudioBus

预留：

```
Master

Music

SFX

UI

Ambient
```

第一阶段：`play()` 内部默认走 `sfx` bus，即使 bus 配置后置也能保持 API 不变。

以后设置音量：

```
Master 80%

Music 40%

SFX 100%
```

无需修改播放逻辑。

### 音量持久化

音量设置走 `localStorage`，**不混入 WorldState**（WorldState 仅保留 gameplay 状态：scenario / flags / quests / sceneStates）。

***

# 3. Audio Event

统一接口：

```js
audio.play(id, options)
```

options：

```js
{
    volume: 1,
    pitch: 1,           // 也可传 [min,max] 走线性随机
    position: null,
    loop: false,
    bus: "sfx"          // 默认 sfx bus
}
```

大部分情况下：

```
audio.play("pickup")
```

即可。

### 频率限制

同一事件连续触发时，内部维护一个最小间隔（默认 50ms）。

低于该间隔的同一 `id` 调用直接吞掉，避免帧速过快时声音叠死（如 `footstep` 连击）。

***

# 4. 推荐目录

> 资源统一放根目录 `Audio/`（与 `Art/` 同级，`Art/` 专门是美术资源）。配置统一走 `Data/`，与项目其它数据一致。

资源：

```
Audio/

    music/

    sfx/

        combat/

        player/

        npc/

        environment/

        quest/
```

> UI 目录第一阶段不创建（UI 事件未接入）。

配置：

```
Data/

    Audio/

        audio_clips.json     // AudioId → Clip Definition

        audio_buses.json     // AudioBus 配置（Master/Music/SFX/UI/Ambient）

        frame_events.json    // Animation Event 帧事件映射（详见 §8）
```

***

# 5. 推荐事件

## Player

```
footstep

jump

land

pickup

drop

interact

hurt

death
```

***

## Combat

```
swing_light

swing_heavy

hit_impact     // 第一阶段统一用 impact，材质细分后置

hit_block

hit_parry

stagger

enemy_die

projectile_throw

projectile_hit
```

> 原 `hit_flesh` / `hit_metal` 需要材质字段，项目当前 CharacterDef / ContactResolver 不提供，后置。

***

## UI

```
confirm

cancel

hover

open

close
```

> **第一阶段不接入**（项目当前为 HUD 形态：InventoryBar / BuffBar / HpBar，无 Menu 概念）。等真有交互式 UI 再补。

***

## NPC

```
talk_start

talk_end

trade

quest_complete
```

***

## Environment

```
door_open

door_close

lever

fire

water

wind

bird
```

***

# 6. 调用链

## 玩家攻击

```
PlayerController

↓

CombatSystem

↓

Attack Connected

↓
audio.play("hit_impact")
```

***

## 拾取物品

```
ExploreMode

↓

InventoryManager

↓

audio.play("pickup")
```

***

## Quest

```
QuestManager

↓

Quest Complete

↓

audio.play("quest_complete")
```

***

## Scene

```
Scene Loaded

↓
audio.playMusic(...)
```

> SceneDef 的 `music` 字段支持世界状态条件（见 §9）。

***

# 7. 与 Sequencer 集成

只接 `TimelineSequencer`（项目有 SceneSequencer + TimelineSequencer，后者是主用的多 track + clip 方案）。

Timeline clip：

```json
{
    "type": "playAudio",
    "id": "door_open",
    "volume": 0.8,
    "pitch": 1.0,
    "bus": "sfx"
}
```

字段语义（与项目现有 clip 如 `moveActorTo` / `dialogueBubble` 一致，全部可选字段除 `id`）：

- `id`（必填）：AudioId
- `volume?`：0.0 ~ 1.0
- `pitch?`：固定值或 `[min,max]` 线性随机
- `bus?`：默认 `sfx`

### 中断策略

默认 `stopOnInterrupt: true`——sequencer 被打断（场景切换 / 模式切换 / 异常）时，该 clip 已触发的音频随 sequencer 停止。

后续如需「播完即止」，可在 clip 里加 `"stopOnInterrupt": false` 覆盖。

> 实现位置：TimelineSequencer 的 `playAudio` handler 注册到 `clipHandlers`，与 `dialogueBubble` / `moveActorTo` 同级。

***

# 8. 与 Animation 集成

后期支持 Animation Event：

```
Frame 3

↓
footstep

Frame 5

↓
swing
```

由动画驱动音效，不要在 Character Update 中判断。

### 数据存储

独立文件 `Data/Audio/frame_events.json`，不污染 StateGraphDef / `.collider.json`：

```json
{
    "longswordman_attack_01": [
        { "frame": 3,  "event": "footstep" },
        { "frame": 5,  "event": "swing_heavy" }
    ],
    "longswordman_walk": [
        { "frame": 2, "event": "footstep" },
        { "frame": 6, "event": "footstep" }
    ]
}
```

- key = 动画名（与 `.collider.json` 的 `frames` 体系对齐）
- value = 帧事件数组

> FrameAnimationComponent 在动画推进到该帧时触发 `audio.play(event)`。第一阶段不实现，但 schema 先定下。

***

# 9. Music

Music 独立于 SFX。

## 9.1 SceneDef 集成

SceneDef 根级 `music` 字段，与 `walkArea` / `entities` / `triggers` / `camera` 同级。

支持两种写法：

### 简单写法（无条件）

```json
{
    "music": "village_day",
    "ambient": ["birds", "wind_soft"]
}
```

### 条件写法（世界状态驱动）

同一个场景根据 WorldState 播不同音乐/环境音：

```json
{
    "music": [
        {
            "if": { "scenario": "prologue_before_flee" },
            "id": "village_peaceful",
            "ambient": ["birds", "wind_soft"]
        },
        {
            "if": { "scenario": "prologue_after_flee" },
            "id": "village_tense",
            "ambient": ["wind_cold"]
        }
    ]
}
```

- 数组按顺序匹配，第一个 `if` 命中的生效
- `if` 字段查询 WorldState（`scenario` / `flags` / `quests` / `sceneStates`）
- 全部不命中时走 fallback（`null` = 沿用上一场景音乐或静音）

> 条件匹配在 `Scene.init()` 时执行一次，WorldState 变化后需重新加载场景或手动调 `audioManager.switchMusic(...)`。

## 9.2 切换过渡

场景切换时默认 `crossfade`，时长 800ms。

可在 SceneDef 根级显式指定：

```json
{
    "music": "village_day",
    "musicTransition": "cut"
}
```

- `crossfade`（默认）：800ms 交叉淡入淡出
- `cut`：硬切

## 9.3 静音语义

若 SceneDef `music: null`，则保持静音。

**整个游戏没有任何 BGM 也完全成立。**

***

# 10. 第一阶段不做

- 3D Spatial Audio
- Reverb
- Occlusion
- Doppler
- Mixer Snapshot
- Dynamic Music
- Combat Layer Music
- Adaptive Music
- Lip Sync

全部留到以后。

***

# 11. 推荐开发顺序

## Step 1

完成：

```
AudioManager

AudioDatabase

AudioPlayer（基于 BABYLON.Sound）
```

能够：

```
audio.play("pickup")
```

同时：

- AssetManifest 注册音频资源 key（分组格式，见 §13.1）
- AudioManager 由 Game 创建并持有
- Scene.updateRender(deltaTime) 调用 audioManager.update(deltaTime)（第一阶段空实现）

## Step 2

覆盖：

- Player
- Combat

全部使用临时音效。UI 事件暂不接入。

## Step 3

Sequencer：

增加：

```
playAudio
```

Timeline clip（只接 TimelineSequencer）。

默认 `stopOnInterrupt: true`。

## Step 4

加入：

MusicPlayer。

支持：

```
play(id, options)

stop()

switchMusic(id, transition)  // transition: "crossfade" | "cut"
```

SceneDef 根级 `music` 字段读取（含世界状态条件写法）。

## Step 5

增加：

AudioBus。

支持：

```
Master

Music

SFX

UI

Ambient
```

音量设置，持久化走 `localStorage`。

## Step 6

Animation Event（`Data/Audio/frame_events.json` + FrameAnimationComponent 触发）。

***

# 12. 总结

本系统遵循以下原则：

- Gameplay 不依赖具体音频资源
- AudioManager 作为唯一入口，由 Game 持有
- Audio Definition 数据驱动，配置走 `Data/Audio/`
- 资源走根目录 `Audio/`（与 `Art/` 同级）
- Music 与 SFX 解耦，支持世界状态条件选曲
- TimelineSequencer 可直接驱动音效（`playAudio` clip）
- 基于 Babylon.js 原生 `BABYLON.Sound`，后续可无成本扩展 mixer/snapshot

***

# 13. 与现有系统集成

## 13.1 AssetManifest key 命名

采用分组格式，便于按组卸载：

```js
// scripts/AssetManifest.js
"audio": {
    "sfx": {
        "swing_light_01": "Audio/sfx/combat/swing_light_01.wav",
        "hit_impact_01":   "Audio/sfx/combat/hit_impact_01.wav",
        "pickup_01":       "Audio/sfx/player/pickup_01.wav"
    },
    "music": {
        "village_day":     "Audio/music/village_day.ogg"
    }
}
```

> `audio_clips.json` / `audio_buses.json` 走现有 `loadDataAssets(ASSET_MANIFEST)` 自动 resolve。真正的音频二进制（`.wav`/`.ogg`）由 `BABYLON.Sound` 内部异步 fetch，**不经过 DataLoader**——所以 DataLoader 无需扩展。

## 13.2 Game / Scene 生命周期

```
Game.init()
  → 创建 AudioManager（读取 audio_clips.json + audio_buses.json）
  → 创建 Scene，传入 this.audioManager

Scene.updateRender(deltaTime)
  → audioManager.update(deltaTime)   // 第一阶段空实现

Scene._loadSceneInternal()
  → 读取 SceneDef.music（含条件写法）
  → audioManager.switchMusic(id, transition)
```

### BABYLON.Sound 绑定到 BABYLON.Scene

`BABYLON.Sound` 必须绑定到 `BABYLON.Scene` 实例。Scene 切换时旧 scene.dispose 会连带销毁 Sound，所以 AudioManager 用 `attachScene` / `detachScene` 桥接：

- AudioManager 归 Game 持有（生命周期独立）
- Sound cache 跟随当前 active babylonScene
- scene 切换时 cache 整体重建（lazy load 到新 scene）

## 13.3 模式切换不主动改音频

依据 PROJECT_CONTEXT §9.1，GameModeManager + Explore/Battle 双模式。

第一阶段：模式切换（ExploreMode ⇄ BattleMode）不主动触发音频事件，仅由 sequencer 或业务事件驱动音频。战斗开始 sting 等后置。

***

# 14. 音效切片工具（Audio Slicer）

## 14.1 背景

外部获取的音效资源常以「多音效合并在一个 wav 文件」的形式提供（如 `sfx_pack.wav` 含 20 个独立音效）。运行时 `BABYLON.Sound` 只能整文件播放，不能指定子区间，因此需要一个离线工具将合并文件切分为单文件。

## 14.2 设计原则

采用**单脚本双模式**（Scan + Slice），扫描结果 `slice.json` 作为中间产物：

- 静音检测算法可能误判（背景噪音、淡入淡出、相邻间隔极短），边界需要人工微调
- 切片元数据（每个 slice 的语义名如 `swing_light_01` / `hit_impact_01`）必须人工填，机器只能给 `slice_01`
- `slice.json` 可版本控制提交 git，切出的单文件 wav 不提交（二进制产物）
- 与项目现有 `extract_*.ps1` 工具一致：扫描 → 输出 JSON 中间产物

## 14.3 工具实现位置

与项目现有离线工具同级（PROJECT_CONTEXT §3 离线工具）：

```
scripts/tools/
    extract_collision_boxes.ps1
    extract_rootmotion_occupancy.ps1
    slice_audio_pack.ps1          ← 新增
```

> 与现有 .ps1 工具一致的命名风格（`extract_*` / `slice_*`），走 PowerShell 调用 .NET API。

## 14.4 模式 1：Scan（扫描生成候选 slice.json）

### 命令

```powershell
powershell -ExecutionPolicy Bypass -File scripts\tools\slice_audio_pack.ps1 -Mode Scan -Input "Audio\sfx\_raw\combat_pack.wav"
```

### 输出

在源 wav 同目录下生成同名 `.slice.json`：

```json
{
    "source": "combat_pack.wav",
    "outputDir": "../combat/",
    "_scanMeta": {
        "sampleRate": 44100,
        "channels": 2,
        "bitsPerSample": 16,
        "duration": 12.34,
        "silenceThreshold": 0.02,
        "minSilenceMs": 80
    },
    "slices": [
        { "name": "slice_01", "start": 0.000, "end": 0.450, "_peak": 0.82 },
        { "name": "slice_02", "start": 0.520, "end": 1.080, "_peak": 0.91 },
        { "name": "slice_03", "start": 1.150, "end": 1.550, "_peak": 0.75 }
    ]
}
```

### 字段语义

- `source`：源 wav 文件名（相对该 JSON 所在目录）
- `outputDir`：切出文件的输出目录（相对该 JSON 所在目录），默认 `../<源文件名去后缀>/`
- `_scanMeta`：扫描算法元数据，人工编辑时可留可删，切片阶段忽略
- `slices[]`：
  - `name`：默认 `slice_NN`，**人工重命名为语义名**（如 `swing_light_01`）
  - `start` / `end`：秒（浮点，精度到 ms），**人工可微调**
  - `_peak`：该切片峰值振幅，便于人工判断是否需调阈值

### 算法参数（可选覆盖）

| 参数 | 默认 | 说明 |
|---|---|---|
| `-SilenceThreshold` | 0.02 | 归一化振幅，低于此视为静音 |
| `-MinSilenceMs` | 80 | 静音段需 ≥ 此时长才认为是切片边界（避免音效内部短停顿被误切） |
| `-MinSliceMs` | 50 | 切出的单文件需 ≥ 此时长，否则丢弃（去抖） |
| `-HeadTrimMs` | 20 | 切片起点向前多保留一点（避免音头被切） |
| `-TailTrimMs` | 30 | 切片终点向后多保留一点（避免尾音被切） |

## 14.5 模式 2：Slice（按 slice.json 切片）

### 命令

```powershell
powershell -ExecutionPolicy Bypass -File scripts\tools\slice_audio_pack.ps1 -Mode Slice -SliceJson "Audio\sfx\_raw\combat_pack.slice.json"
```

### 输出

按 `outputDir` 创建目录，输出单文件 wav：

```
Audio/sfx/combat/swing_light_01.wav
Audio/sfx/combat/swing_heavy_01.wav
Audio/sfx/combat/hit_impact_01.wav
Audio/sfx/combat/hit_block_01.wav
```

### 字段读取规则

只读：
- `source`（源 wav 文件名）
- `outputDir`（输出目录）
- `slices[].name` / `start` / `end`

忽略所有 `_` 前缀字段（`_scanMeta` / `_peak` 等），这些只供人工编辑参考。

### 校验

- `source` 文件不存在 → 报错退出
- `outputDir` 不存在 → 自动创建
- `slices` 为空 → 报错退出
- `start >= end` → 跳过该 slice 并 warn
- 切片超出源文件时长 → 跳过并 warn

## 14.6 技术方案

PowerShell + .NET `System.IO.FileStream` / `BinaryReader`，纯 wav 格式处理：

**Scan 模式**：
1. 解析 wav header（fmt chunk + data chunk offset）
2. 逐样本读振幅，检测静音区间
3. 合并相邻静音段（满足 `MinSilenceMs`），得到切片边界
4. 应用 `HeadTrimMs` / `TailTrimMs` 微调边界
5. 输出候选 `slice.json`

**Slice 模式**：
1. 解析 wav header
2. 按 `start`/`end` × sampleRate × bytesPerSample 计算 byte offset
3. 复制该区间字节 + 重写 wav header（更新 data chunk size / RIFF size）
4. 写入输出文件

> 不依赖 ffmpeg / sox 等外部依赖，仅用 PowerShell 内置能力。若后续需要更复杂处理（淡入淡出 / resample），再评估引入 ffmpeg。

## 14.7 完整工作流

```
1. 把原始合并包放 Audio/sfx/_raw/（约定 _raw 目录存放未处理素材，不进 AssetManifest）

2. 跑 Scan 生成候选 slice.json
   slice_audio_pack.ps1 -Mode Scan -Input "Audio/sfx/_raw/combat_pack.wav"
   → 输出 Audio/sfx/_raw/combat_pack.slice.json（name 默认 slice_NN）

3. 人工编辑 slice.json
   - name: slice_01 → swing_light_01（语义命名）
   - start/end: 可微调边界（算法给的候选可能不理想）
   - 删除不需要的切片（背景噪声误判等）

4. 跑 Slice 输出单文件
   slice_audio_pack.ps1 -Mode Slice -SliceJson "Audio/sfx/_raw/combat_pack.slice.json"
   → 输出 Audio/sfx/combat/swing_light_01.wav 等

5. 注册到 audio_clips.json + AssetManifest

6. 保留 _raw/ 做源文件备份（可选）
```

## 14.8 边界情况

- **无静音的合包**：如果整包无符合阈值的静音段，Scan 输出 `slices: []` + warn，提示用户手动写 slice.json 或调整 `-SilenceThreshold`
- **单音效包**：如果整包就是一个音效（无内部静音），Scan 输出 `slices: [{name:"slice_01", start:0, end:duration}]`
- **立体声 vs 单声道**：扫描与切片都需正确处理 `channels`，输出与源保持一致
- **不同采样率**：算法基于 `sampleRate` 字段动态计算，不支持跨采样率转换（需 resample 时后续引入 ffmpeg）

> 该辅助工具不在第一阶段范围，等切片量上来后再考虑。

