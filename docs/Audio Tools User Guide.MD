# Audio Tools User Guide

> 适用于 `scripts/tools/slice_audio_pack.ps1` 与 `scripts/tools/convert_audio_format.ps1`
>
> 用途：把外部获取的「多音效合并 wav」处理为运行时可用的「单文件 wav」。

---

## 0. 总览

完整工作流：
Chat

参考了 1 个上下文

先验证：读 AudioManager.js 完整内容，看 36-49 行的实际状态。

scripts\Systems\Audio\AudioManager.js

scripts\Systems\AudioManager.js

确认问题存在。我 同意不修 ，理由如下：

## 这些空方法不是 bug，是设计稿明确的占位
根据 AudioSystemDesign.MD （v0.2）的设计：

方法 设计稿定位 当前状态 play §11 Step 1 ✅ 已实现 stop §11 Step 2（覆盖 Player + Combat） 占位（Step 2 实现） playMusic §11 Step 4（MusicPlayer） 占位（Step 4 实现） stopMusic §11 Step 4 占位（Step 4 实现） setBusVolume §11 Step 5（AudioBus 真正生效） 占位（Step 5 实现） update(dt) 设计稿 C1 决策：第一阶段空实现占位，由 Scene.updateRender(dt) 驱动 占位（符合决策 C1）

也就是说：

- Step 1（当前阶段）只需 play 工作 ，其他方法都是为后续 Step 预留的接口
- update(dt) 空实现是设计稿 C1 决策明确要求的 （"第一阶段 update() 可以为空实现"）
- 如果删掉这些方法声明，后续 Step 2/4/5 落地时要重新加方法签名，调用点（Game.js / Scene.js）也要同步改
## 设计稿依据

在工作区搜索 'C1|update\(dt\)|空实现'

设计稿明确写了：

- 第 149 行： "第一阶段：空实现（占位，避免后续调用点散落）"
- 第 700、815 行：调用链中注释"第一阶段空实现"
这正是 C1 决策的体现： 保留空方法 + 占位实现，避免调用点散落 。如果删掉方法，Scene.updateRender 那个 audioManager.update(dt) 调用就会报 update is not a function 。

## 结论
不修。 当前实现符合 v0.2 设计稿的 C1 决策。这些空方法会被 Game.js / Scene.js 调用（ update(dt) 、 setPaused 、 attachScene 等），保留空实现是正确的占位策略。

后续 Step 2/4/5 落地时再补实现即可。

01:59
用户6856009908

convert_audio_format和slice_audio_pack的用户文档得写个

工作流程讲解一下

Chat

思考过程

文档我倾向写一个统一的（两个工具是一套工作流，分开读会断片）。放 docs/ 目录下与项目其他用户文档同级（参考 docs/TimelineSequencer User Guide.md ）。

```
e:\se\BlindDuel\docs\AudioToolsUserGuide.md
```
```
# Audio Tools User Guide

> 适用于 `scripts/tools/slice_audio_pack.ps1` 与 `scripts/tools/
convert_audio_format.ps1`
>
> 用途：把外部获取的「多音效合并 wav」处理为运行时可用的「单文件 wav」。

---

## 0. 总览

完整工作流：

```
原始合包 wav (24-bit 192kHz stereo, 含 N 个音效)
↓ slice_audio_pack.ps1 -Mode EvenSplit -Count N
slice.json (人工编辑 name 即可)
↓ slice_audio_pack.ps1 -Mode Slice
单文件 wav (仍是 24-bit 192kHz stereo)
↓ convert_audio_format.ps1 -Recurse
最终 wav (16-bit 44100Hz mono)
↓ 复制到 Audio/sfx/combat/ 等 + 注册 audio_clips.json
涉及的目录约定（与 [AudioSystemDesign.MD §4](file:///e:/se/BlindDuel/plans/AudioSystemDesign.MD) 一致）：

| 目录 | 用途 |
|---|---|
| `Audio/sfx/_raw/` | 原始合并包 + slice.json + sliceinfo.txt（不进 AssetManifest） |
| `Audio/sfx/<合包名>/` | 切出的单文件 wav（仍为源格式） |
| `Audio/sfx_converted/<合包名>/` | 转格式后的最终 wav |

---

# 1. slice_audio_pack.ps1

切分合包 wav 为多个单文件 wav。

支持六种模式：

| 模式 | 用途 | 推荐场景 |
|---|---|---|
| `Scan` | 自动扫描静音区间生成 slice.json | 仅当合包是「音效 + 静音交替」格式且采样率正常（44.1k/48k）时；192kHz 等 high-rate 文件不推荐 |
| `Slice` | 按 slice.json 切出单文件 wav | 所有模式的第二步 |
| `EvenSplit` | 把单个 wav 等分 N 份生成 slice.json | **推荐**：合包里音效间隔不规律或没有静音时 |
| `EvenSplitBatch` | 批处理目录，按 sliceinfo.txt 等分 | 多个合包一起处理 |
| `ScanBatch` | 批处理目录，对每个 wav 跑 Scan | 目录里所有 wav 都是「音效 + 静音交替」格式 |
| `SliceBatch` | 批处理目录，对每个 slice.json 跑 Slice | EvenSplitBatch / ScanBatch 之后的批量切片 |

## 1.1 模式 1：EvenSplit（推荐）

把单个 wav 按指定份数等分。

### 命令

```powershell
powershell -ExecutionPolicy Bypass -File e:\se\BlindDuel\scripts\tools\slice_audio_pack.ps1 -Mode EvenSplit -WavPath "源wav路径" -Count 6
```

### 参数

| 参数 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `-Mode` | ✅ | - | `EvenSplit` |
| `-WavPath` | ✅ | - | 源 wav 文件路径（路径含空格用双引号） |
| `-Count` | ✅ | - | 等分份数（≥1） |

### 输出

在源 wav 同目录生成 `<同名>.slice.json`：

```json
{
    "source":  "xxx.wav",
    "outputDir":  "../xxx/",
    "_scanMeta":  {
        "mode":  "EvenSplit",
        "sampleRate":  192000,
        "channels":  2,
        "bitsPerSample":  24,
        "duration":  12.96,
        "count":  6
    },
    "slices":  [
        { "name":  "slice_01", "start":  0,     "end":  2.16,  "_peak":  0.21 },
        { "name":  "slice_02", "start":  2.16,  "end":  4.32,  "_peak":  0.18 },
        ...
    ]
}
```

字段含义：
- `source`：源 wav 文件名
- `outputDir`：切片输出目录（相对该 JSON 所在目录）
- `slices[].name`：默认 `slice_NN`，**人工改成语义名**（如 `swing_light_01`）
- `slices[].start` / `end`：秒（浮点）
- `slices[]._peak`：该切片峰值振幅，便于判断是否切到了静音段
- `_scanMeta`：扫描元数据，Slice 模式忽略

## 1.2 模式 2：EvenSplitBatch（批量等分）

按 `sliceinfo.txt` 配置批处理整个目录。

### sliceinfo.txt 格式

放在 `Audio/sfx/_raw/sliceinfo.txt`，格式：
# 注释行（# 开头）和空行忽略
# 格式 A（推荐，文件名可含空格）：
"<完整文件名>" <份数>

# 格式 B（仅文件名不含空格时可用）：
<文件名> <份数>
示例：
# sliceinfo.txt
"WEAPSwrd_Sword Slide Cuts, Metallic, Impact CM4 2_344 Audio_Medieval Weapons Vol 2.wav" 6
"另一个合包.wav" 12

# 不带空格的可以省略引号
simple_effect.wav 4
### 命令

```powershell
powershell -ExecutionPolicy Bypass -File e:\se\BlindDuel\scripts\tools\slice_audio_pack.ps1 -Mode EvenSplitBatch -BatchDir "E:\se\BlindDuel\Audio\sfx\_raw" -SliceInfo "E:\se\BlindDuel\Audio\sfx\_raw\sliceinfo.txt"
```

### 参数

| 参数 | 必填 | 说明 |
|---|---|---|
| `-Mode` | ✅ | `EvenSplitBatch` |
| `-BatchDir` | ✅ | 待处理 wav 所在目录（不递归） |
| `-SliceInfo` | ✅ | sliceinfo.txt 路径 |

### 错误处理

- sliceinfo.txt 找不到 → 抛异常退出
- sliceinfo.txt 无有效条目 → 抛异常退出
- BatchDir 下某 wav 不在 sliceinfo.txt → warn + 跳过该 wav
- 单文件处理失败 → warn + 继续处理下一个
- 末尾汇总 `processed=N skipped=M failed=K`，并写日志到 `<BatchDir>/EvenSplitBatch.log`

## 1.3 模式 3：Slice（按 JSON 切出单文件）

按 slice.json 切出实际的单文件 wav。这是 EvenSplit / Scan 之后的第二步。

### 命令

```powershell
powershell -ExecutionPolicy Bypass -File e:\se\BlindDuel\scripts\tools\slice_audio_pack.ps1 -Mode Slice -SliceJson "xxx.slice.json"
```

### 参数

| 参数 | 必填 | 说明 |
|---|---|---|
| `-Mode` | ✅ | `Slice` |
| `-SliceJson` | ✅ | slice.json 文件路径 |

### 输出

按 slice.json 里 `outputDir` 字段创建目录，输出 `<name>.wav`。EvenSplit 默认 `outputDir` 是 `../<fileBase>/`，所以输出到 `Audio/sfx/<合包名>/` 下。

### 校验规则

- `source` 文件不存在 → 抛异常退出
- `outputDir` 不存在 → 自动创建
- `slices` 为空 → 抛异常退出
- `start >= end` → 跳过该 slice + warn
- 切片超出源文件时长 → 跳过 + warn
- 末尾汇总 `written=N skipped=M`

## 1.4 模式 5：SliceBatch（批量切片）

对目录下所有 `*.slice.json` 执行 Slice，**以 sliceinfo.txt 为白名单**（wav 文件名去掉扩展名后加 `.slice.json` 作为匹配名）。未在 sliceinfo.txt 中列出的 slice.json 会被跳过。

### 命令

```powershell
powershell -ExecutionPolicy Bypass -File e:\se\BlindDuel\scripts\tools\slice_audio_pack.ps1 -Mode SliceBatch -BatchDir "E:\se\BlindDuel\Audio\sfx\_raw" -SliceInfo "E:\se\BlindDuel\Audio\sfx\_raw\sliceinfo.txt"
```

### 参数

| 参数 | 必填 | 说明 |
|---|---|---|
| `-Mode` | ✅ | `SliceBatch` |
| `-BatchDir` | ✅ | 待处理 `*.slice.json` 所在目录（不递归） |
| `-SliceInfo` | ✅ | sliceinfo.txt 路径（作为白名单，count 值被忽略） |

### 错误处理

- BatchDir / sliceinfo.txt 不存在 → 抛异常退出
- sliceinfo.txt 无有效条目 → 抛异常退出
- BatchDir 下无 `*.slice.json` → warn + 直接返回
- 某个 slice.json 对应的 wav 不在 sliceinfo.txt → warn + 跳过
- 单文件处理失败 → warn + 继续下一个
- 末尾汇总 `processed=N skipped=M failed=K`，并写日志到 `<BatchDir>/SliceBatch.log`

> 与 EvenSplitBatch / ScanBatch 共用同一份 sliceinfo.txt，便于一条龙处理。

## 1.5 模式 6：ScanBatch（批量静音检测）

对目录下所有 `*.wav` 执行 Scan，**以 sliceinfo.txt 为白名单**。ScanBatch 忽略 sliceinfo.txt 中的 count 值（Scan 算法不需要），仅用文件名清单控制哪些 wav 参与处理——未标注的 wav 跳过。

> 波形识别不够准确，必须人工指定哪些文件值得 Scan，避免目目对所有 wav 跑产生无效 slice.json。

### 命令

```powershell
powershell -ExecutionPolicy Bypass -File e:\se\BlindDuel\scripts\tools\slice_audio_pack.ps1 -Mode ScanBatch -BatchDir "E:\se\BlindDuel\Audio\sfx\_raw" -SliceInfo "E:\se\BlindDuel\Audio\sfx\_raw\sliceinfo.txt" [-SilenceThreshold 0.02] [-MinSilenceMs 80] [-MinSliceMs 50] [-HeadTrimMs 20] [-TailTrimMs 30] [-SampleStep 1]
```

### 参数

| 参数 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `-Mode` | ✅ | - | `ScanBatch` |
| `-BatchDir` | ✅ | - | 待处理 wav 所在目录（不递归） |
| `-SliceInfo` | ✅ | - | sliceinfo.txt 路径（作为白名单，count 值被忽略） |
| `-SilenceThreshold` | ❌ | 0.02 | 同 Scan |
| `-MinSilenceMs` | ❌ | 80 | 同 Scan |
| `-MinSliceMs` | ❌ | 50 | 同 Scan |
| `-HeadTrimMs` | ❌ | 20 | 同 Scan |
| `-TailTrimMs` | ❌ | 30 | 同 Scan |
| `-SampleStep` | ❌ | 1 | 同 Scan |

### 错误处理

- BatchDir / sliceinfo.txt 不存在 → 抛异常退出
- sliceinfo.txt 无有效条目 → 抛异常退出
- BatchDir 下无 wav → warn + 直接返回
- 某个 wav 不在 sliceinfo.txt → warn + 跳过
- 单文件处理失败 → warn + 继续下一个
- 末尾汇总 `processed=N skipped=M failed=K`，并写日志到 `<BatchDir>/ScanBatch.log`

> 与 Scan 同样不推荐用于 192kHz 等 high-rate 文件（详见 §1.6）。ScanBatch 模式下每个 wav 独立输出一份 Probe，探测失败的可单独用 `-Mode Scan -WavPath` 反复调参。

## 1.6 模式 4：Scan（静音检测，不推荐）

**不推荐使用**。仅在合包是「音效 + 静音交替」格式且采样率正常（44.1k/48k）时可用。

192kHz 等 high-rate 文件下，单样本级别振幅分类会产生高频抖动，分段全是噪声，切片数=0。改用 EvenSplit。

### 命令

```powershell
powershell -ExecutionPolicy Bypass -File e:\se\BlindDuel\scripts\tools\slice_audio_pack.ps1 -Mode Scan -WavPath "xxx.wav" [-SilenceThreshold 0.02] [-MinSilenceMs 80] [-MinSliceMs 50] [-HeadTrimMs 20] [-TailTrimMs 30] [-SampleStep 1]
```

### 参数

| 参数 | 默认 | 说明 |
|---|---|---|
| `-SilenceThreshold` | 0.02 | 归一化振幅阈值，低于此视为静音 |
| `-MinSilenceMs` | 80 | 静音段需 ≥ 此时长才认为是切片边界 |
| `-MinSliceMs` | 50 | 切出的单文件需 ≥ 此时长，否则丢弃 |
| `-HeadTrimMs` | 20 | 切片起点向前保留 |
| `-TailTrimMs` | 30 | 切片终点向后保留 |
| `-SampleStep` | 1 | 采样步长（大文件慢可调大） |

### Probe 输出

Scan 会先输出振幅分布诊断：
[Scan] amplitude probe (n=1001, step=2488 samples):
min=0 max=0.2102 mean=0.0075
p50=0.0005 p90=0.0252 p99=0.1136
samples below threshold(0.02): 891 / 1001 = 89%
suggested -SilenceThreshold: 0.0151
根据这些数字调参：
- `silentPct > 99%` → 阈值太高，调低
- `silentPct < 1%` → 阈值太低，调高
- `max < 0.001` → 振幅计算失败，检查 wav 格式

> ScanBatch 模式下，每个 wav 都会独立输出一份 Probe。如果某些 wav 探测失败，可单独跳出来用 `-Mode Scan -WavPath` 对该文件反复调参。

---

# 2. convert_audio_format.ps1

批量转换 wav 格式（采样率 / 位深 / 声道数）。

典型用途：把 24-bit 192kHz stereo 转 16-bit 44.1kHz mono（游戏运行时格式）。

## 2.1 命令

```powershell
powershell -ExecutionPolicy Bypass -File e:\se\BlindDuel\scripts\tools\convert_audio_format.ps1 -InputPath "源路径" -OutputDir "输出目录" [-TargetSampleRate 44100] [-TargetBitsPerSample 16] [-TargetChannels 1] [-Recurse] [-Force]
```

## 2.2 参数

| 参数 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `-InputPath` | ✅ | - | 输入文件或目录 |
| `-OutputDir` | ❌ | `<input>/_converted/` | 输出目录（保留子目录结构） |
| `-TargetSampleRate` | ❌ | 44100 | 目标采样率（Hz） |
| `-TargetBitsPerSample` | ❌ | 16 | 目标位深（8/16/24） |
| `-TargetChannels` | ❌ | 1 | 目标声道数（1=mono, 2=stereo） |
| `-Recurse` | ❌ | false | 递归扫描子目录 |
| `-Force` | ❌ | false | 覆盖已存在输出文件 |

## 2.3 用法示例

### 切片目录批量转格式

```powershell
powershell -ExecutionPolicy Bypass -File e:\se\BlindDuel\scripts\tools\convert_audio_format.ps1 -InputPath "E:\se\BlindDuel\Audio\sfx\WEAPSwrd_Sword Slide Cuts, Metallic, Impact CM4 2_344 Audio_Medieval Weapons Vol 2" -OutputDir "E:\se\BlindDuel\Audio\sfx_converted" -Recurse
```

输出到 `Audio/sfx_converted/<合包名>/slice_NN.wav`，每个文件 16-bit 44.1kHz mono。

### 单文件转换

```powershell
... -InputPath "E:\se\BlindDuel\Audio\sfx\xxx.wav" -OutputDir "E:\se\BlindDuel\Audio\sfx_converted"
```

### 自定义目标（保留立体声）

```powershell
... -TargetChannels 2 -TargetSampleRate 48000
```

## 2.4 算法说明

| 转换 | 算法 |
|---|---|
| 位深 | 先归一化到 `[-1.0, 1.0]`，再按目标位深重新量化 |
| 声道下混 | stereo → mono = `(L+R)/2`；mono → stereo = 复制 |
| 重采样 | 线性插值（简单但够用） |
| 削波保护 | 归一化值 clamp 到 `[-1.0, 1.0]` |

## 2.5 已知限制

1. 只支持 PCM wav（`audioFormat=1`），不支持 float wav / mp3 / ogg
2. 线性插值重采样质量不如 sinc，含高频成分的源可能产生轻微 aliasing
3. 不支持淡入淡出 / 音量标准化（normalize），后续可加 `-Normalize` 选项
4. 大文件全量读入内存（192kHz/24bit/stereo/13秒 ≈ 25 MB），不适合处理几分钟的音频

---

# 3. 完整工作流示例

## 3.1 单个合包处理

假设合包 `WEAPSwrd_xxx.wav` 含 6 个 sword 音效，24-bit 192kHz stereo。

### Step 1：等分生成 slice.json

```powershell
powershell -ExecutionPolicy Bypass -File e:\se\BlindDuel\scripts\tools\slice_audio_pack.ps1 -Mode EvenSplit -WavPath "E:\se\BlindDuel\Audio\sfx\_raw\WEAPSwrd_xxx.wav" -Count 6
```

输出：
[EvenSplit] wav: ...
[EvenSplit] format=1 ch=2 rate=192000 bits=24 duration=12.96s count=6
[EvenSplit] done: xxx.slice.json
[EvenSplit] slices: 6
slice_01  start=0s     end=2.16s  peak=0.21
slice_02  start=2.16s  end=4.32s  peak=0.18
...
### Step 2：（可选）人工编辑 slice.json

用文本编辑器打开 `xxx.slice.json`，把 `name` 从 `slice_01` 改成语义名：

```json
"slices":  [
    { "name":  "swing_light_01", "start":  0, "end":  2.16, ... },
    { "name":  "swing_heavy_01", "start":  2.16, "end":  4.32, ... },
    ...
]
```

不需要重命名可跳过此步。

### Step 3：切出单文件

```powershell
powershell -ExecutionPolicy Bypass -File e:\se\BlindDuel\scripts\tools\slice_audio_pack.ps1 -Mode Slice -SliceJson "E:\se\BlindDuel\Audio\sfx\_raw\WEAPSwrd_xxx.slice.json"
```

输出：
[Slice] source: ...
[Slice] outputDir: E:\se\BlindDuel\Audio\sfx\WEAPSwrd_xxx
 [Slice] format=1 ch=2 rate=192000 bits=24 duration=12.96s
slice_01.wav  [0s - 2.16s]  -> ...\slice_01.wav
...
[Slice] done: written=6 skipped=0
### Step 4：转格式

```powershell
powershell -ExecutionPolicy Bypass -File e:\se\BlindDuel\scripts\tools\convert_audio_format.ps1 -InputPath "E:\se\BlindDuel\Audio\sfx\WEAPSwrd_xxx" -OutputDir "E:\se\BlindDuel\Audio\sfx_converted" -Recurse
```

输出：
[Convert] target: rate=44100 bits=16 ch=1
[Convert] found 6 wav file(s)
src: ...\slice_01.wav
format=1 ch=2 rate=192000 bits=24
-> ...\sfx_converted\WEAPSwrd_xxx\slice_01.wav (ch=1 rate=44100 bits=16)
...
[Convert] done: converted=6 skipped=0 failed=0
### Step 5：复制到正式目录 + 注册

把 `sfx_converted/WEAPSwrd_xxx/` 下的 6 个 wav 复制到 `Audio/sfx/combat/`（按用途分类），然后注册到 `Data/Audio/audio_clips.json` 和 [AssetManifest.js](file:///e:/se/BlindDuel/scripts/AssetManifest.js) 的 `audio.sfx` 分组。

## 3.2 批量处理多个合包

### Step 1：建 sliceinfo.txt

在 `Audio/sfx/_raw/sliceinfo.txt` 写：
"WEAPSwrd_xxx.wav" 6
"另一个合包.wav" 12
"第三个合包.wav" 8
### Step 2：批量生成 slice.json

```powershell
powershell -ExecutionPolicy Bypass -File e:\se\BlindDuel\scripts\tools\slice_audio_pack.ps1 -Mode EvenSplitBatch -BatchDir "E:\se\BlindDuel\Audio\sfx\_raw" -SliceInfo "E:\se\BlindDuel\Audio\sfx\_raw\sliceinfo.txt"
```

### Step 3：批量切出单文件

```powershell
powershell -ExecutionPolicy Bypass -File e:\se\BlindDuel\scripts\tools\slice_audio_pack.ps1 -Mode SliceBatch -BatchDir "E:\se\BlindDuel\Audio\sfx\_raw" -SliceInfo "E:\se\BlindDuel\Audio\sfx\_raw\sliceinfo.txt"
```

### Step 4：批量转格式

```powershell
powershell -ExecutionPolicy Bypass -File e:\se\BlindDuel\scripts\tools\convert_audio_format.ps1 -InputPath "E:\se\BlindDuel\Audio\sfx" -OutputDir "E:\se\BlindDuel\Audio\sfx_converted" -Recurse
```

注意 `-InputPath` 指向 `Audio/sfx/` 父目录，配合 `-Recurse` 一次性处理所有合包的输出目录。

---

# 4. 常见问题

## 4.1 EvenSplit 切出的某片 `_peak=0` 怎么办？

说明那一段是静音。可能原因：
- 合包里实际只有 5 个音效但 Count=6，最后一段是尾部静音 → 改 `-Count 5`
- 音效之间有较长静音间隔 → 用 Scan 模式或人工编辑 slice.json 边界

## 4.2 切片边界不理想（音头/尾音被切）

EvenSplit 是按等分切，不感知内容。如果音效时长不均匀，需要人工编辑 slice.json 的 `start` / `end` 字段微调，然后重跑 Slice 模式。

## 4.3 转格式后音质明显变差

线性插值重采样在 192kHz → 44.1kHz 时可能产生轻微 aliasing。如果源含高频成分（如金属碰撞的高频泛音），建议：
- 用 Audacity 做 sinc 重采样作为对比
- 或保持 48kHz 而非降到 44.1kHz

## 4.4 PowerShell 报「`<` 运算符是为将来使用而保留」

脚本文件被 PowerShell 5.x 按 GBK 解码（中文 Windows 默认），但脚本是 UTF-8。两种解决：
- 把脚本保存为 UTF-8 with BOM（VS Code：右下角编码 → Save with Encoding → UTF-8 with BOM）
- 当前版本脚本已全部使用英文注释，不需要 BOM

## 4.5 PowerShell 报「意外的标记 `?.Path`」

`?.` 是 PowerShell 7+ 的 null 条件运算符，PS 5.x 不支持。脚本已修复，无需处理。如果再遇到类似语法，参考 [convert_audio_format.ps1](file:///e:/se/BlindDuel/scripts/tools/convert_audio_format.ps1) 的兼容写法。

## 4.6 sliceinfo.txt 解析失败 / 文件名含空格被截断

确认 sliceinfo.txt 用双引号格式：
"含 空格.wav" 6

而不是不带引号：
含 空格.wav 6   ← 错误，会被解析为 fname="含", cnt="空格.wav"

---

# 5. 工具能力边界

| 能力 | slice_audio_pack | convert_audio_format |
|---|---|---|
| 切片方式 | 等分 / 静音检测 / 按 JSON | - |
| 格式转换 | - | 采样率 / 位深 / 声道数 |
| 重采样算法 | - | 线性插值 |
| 淡入淡出 | ❌ | ❌ |
| 音量标准化 | ❌ | ❌ |
| mp3/ogg 支持 | ❌ | ❌ |
| 批处理 | ✅（EvenSplitBatch / ScanBatch / SliceBatch） | ✅（-Recurse） |
| 跨平台 | Windows PowerShell 5.x+ | 同左 |

如需更高级处理（sinc 重采样、淡入淡出、normalize、mp3 转码），建议引入 ffmpeg 或用 Audacity 后处理。