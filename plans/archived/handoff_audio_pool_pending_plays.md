# Handoff: AudioPool 首次播放失败修复

> 下个会话执行。当前会话已确认问题存在性 + 修复方案，未落代码。
> 相关 PR 讨论见本会话日志。

---

## 1. 问题确认

### 现象

`AudioManager.play(id)` 第一次调用必定静默失败（返回 false 或无声音），第二次起才正常发声。

### 根因

`AudioPlayer.play()` → `AudioPool.getOrLoad(url)` → `AudioPool.play(url)` 链路里：

```js
// AudioPlayer.js:24
this._pool.getOrLoad(clipUrl);   // 启动 BABYLON.Sound 异步加载，state=PENDING
return this._pool.play(clipUrl, { volume, pitch });  // 立即检查 state===LOADED → false
```

`BABYLON.Sound` 构造函数传入的 onload 回调是**异步触发**的，主线程不会等待。所以 `getOrLoad` 返回时 `entry.state` 仍是 `LOAD_STATE.PENDING`，紧接着的 `play()` 检查 `entry.state !== LOAD_STATE.LOADED` 直接返回 false。

### 现状：被 Step 1 注释「合规化」

[scripts/Systems/Audio/AudioPlayer.js:4-5](file:///e:/se/BlindDuel/scripts/Systems/Audio/AudioPlayer.js#L4-5) 头部注释明说：

> 第一次 play 会因 lazy load 未完成而静默失败；第二次起开始有声（这是 Step 1 的简化，后续可加预加载）

设计稿 [plans/AudioSystemDesign.MD §11 Step 1](file:///e:/se/BlindDuel/plans/AudioSystemDesign.MD) 目标是 `audio.play("pickup")` 能工作，**但没明确"第一次必须有声"**。当前实现严格符合 Step 1 文档定义，但**用户体验上是 bug**：

- 玩家第一次拾取 → 没声音
- 第一次出剑 → 没声音
- 第一次受伤 → 没声音

Demo 时尤其尴尬。

---

## 2. 修复方案（已选定：方案 A - PendingPlays 队列）

### 为什么选 A

| 方案 | 改动 | 优点 | 缺点 | 选择 |
|---|---|---|---|---|
| **A. PendingPlays 队列** | 仅改 AudioPool.js，加 _pendingPlays 数组 + onload flush | API 不变；第一次有声（延迟到 loaded）；改动 ~30 行 | 第一次有微小延迟（本地 wav 通常 <100ms） | ✅ 选定 |
| B. 全局预加载 | 新增 AudioManager.preload(ids) + 进度追踪；Game 启动时 await | 第一次即时响 | 阻塞游戏启动；需要 loading UI；改动大 | ❌ 超出 Step 1 范围 |
| C. play 改 async | play 返回 Promise | 语义清晰 | 破坏同步签名 `play(id) → bool`；调用方都要改 | ❌ 破坏 API |

### 核心改动点

只动一个文件：`scripts/Systems/Audio/AudioPool.js`

改动集中在三处：

#### 2.1 `entry` 结构新增 `_pendingPlays` 字段

```js
// 修改前（line 30）
const entry = { state: LOAD_STATE.PENDING, sound: null };

// 修改后
const entry = { state: LOAD_STATE.PENDING, sound: null, _pendingPlays: [] };
```

#### 2.2 `play()` 增加分支：state === PENDING 时入队

```js
// 修改前（line 57-71 play 方法）
play(url, options) {
    const entry = this._cache.get(url);
    if (!entry || !entry.sound) return false;
    if (entry.state !== LOAD_STATE.LOADED) return false;
    try {
        const opts = options || {};
        if (typeof opts.volume === "number") entry.sound.setVolume(opts.volume);
        entry.sound.setPlaybackRate(opts.pitch ?? 1);
        entry.sound.play();
        return true;
    } catch (err) {
        console.warn("[AudioPool] play failed", url, err);
        return false;
    }
}

// 修改后
play(url, options) {
    const entry = this._cache.get(url);
    if (!entry || !entry.sound) return false;
    const opts = options || {};

    if (entry.state === LOAD_STATE.PENDING) {
        // 排队等 onload 触发后回放（防丢播放意图）
        entry._pendingPlays.push(opts);
        return true;  // 表示已接受播放请求
    }
    if (entry.state !== LOAD_STATE.LOADED) return false;

    try {
        if (typeof opts.volume === "number") entry.sound.setVolume(opts.volume);
        entry.sound.setPlaybackRate(opts.pitch ?? 1);
        entry.sound.play();
        return true;
    } catch (err) {
        console.warn("[AudioPool] play failed", url, err);
        return false;
    }
}
```

#### 2.3 `getOrLoad` 的 onload 回调里 flush 队列

```js
// 修改前（line 32-42）
const sound = new BABYLON.Sound(
    url,
    url,
    this._scene,
    () => { entry.state = LOAD_STATE.LOADED; },
    { autoplay: false, spatialSound: false }
);
entry.sound = sound;

// 修改后
const sound = new BABYLON.Sound(
    url,
    url,
    this._scene,
    () => {
        entry.state = LOAD_STATE.LOADED;
        // flush 排队的播放请求
        if (entry._pendingPlays && entry._pendingPlays.length > 0) {
            const pending = entry._pendingPlays.splice(0);
            for (const opts of pending) {
                try {
                    if (typeof opts.volume === "number") entry.sound.setVolume(opts.volume);
                    entry.sound.setPlaybackRate(opts.pitch ?? 1);
                    entry.sound.play();
                } catch (err) {
                    console.warn("[AudioPool] flush play failed", url, err);
                }
            }
        }
    },
    { autoplay: false, spatialSound: false }
);
entry.sound = sound;
```

#### 2.4 失败分支清理队列（可选但推荐）

```js
// 在 catch (err) 分支里
} catch (err) {
    console.warn("[AudioPool] create failed", url, err);
    entry.state = LOAD_STATE.FAILED;
    if (entry._pendingPlays && entry._pendingPlays.length > 0) {
        console.warn(`[AudioPool] ${entry._pendingPlays.length} pending play(s) dropped due to load failure: ${url}`);
        entry._pendingPlays.length = 0;
    }
}
```

---

## 3. 验证步骤

### 3.1 单元验证

启动游戏后立即触发 `audioManager.play("pickup")`（假设 AssetManifest 已注册），观察：

- **修复前**：第一次播放无声音，控制台可能无 warn（因为 return false 没打印）
- **修复后**：第一次播放延迟约 50-200ms 后有声

### 3.2 回归验证

- 连续快速触发同一音效 5 次 → 期望全部有声（最后一次立即响，前几次可能批量排队）
- 切换 scene → 期望 cache 清空后第一次播放仍能正常排队（attachScene 之后）
- 不存在的音效 URL → 期望走 catch 分支，warn 提示 pending dropped

### 3.3 需要测试的场景

1. AssetManifest 注册的某个 sfx 第一次播放（最关键）
2. TimelineSequencer 触发 playAudio clip（Step 3 之后才接入，本次不验证）
3. Pause / Resume 状态下播放（Pause 时 setPaused(true) 后 play 直接 return false，不进队列）

---

## 4. 不在本次范围

以下留到后续 Step：

- **预加载方案 B**：等接入 loading screen 时再考虑（Step 6+）
- **错误恢复**：FAILED 状态下重新尝试加载（暂不实现，FAILED 后下次 play 直接 return false）
- **播放统计 / debug UI**：暂不实现
- **Stop 实现**：Step 2 落地（覆盖 Player + Combat 时统一做）
- **MusicPlayer**：Step 4 落地

---

## 5. 相关文件清单

| 文件 | 角色 | 是否改动 |
|---|---|---|
| `scripts/Systems/Audio/AudioPool.js` | 待修改 | ✅ 唯一改动文件 |
| `scripts/Systems/Audio/AudioPlayer.js` | 调用方 | ❌ 不动（API 不变） |
| `scripts/Systems/AudioManager.js` | 调用方 | ❌ 不动 |
| `scripts/AssetManifest.js` | 资源注册 | ❌ 不动 |
| `plans/AudioSystemDesign.MD` | 设计稿 | ❌ 不动（修复符合 §11 Step 1 精神，不需要更新设计稿） |
| `PROJECT_CONTEXT.md` | 项目上下文 | ❌ 不动 |

### 实施完成后

修完后**更新 [AudioPlayer.js:4-5](file:///e:/se/BlindDuel/scripts/Systems/Audio/AudioPlayer.js#L4-5) 头部注释**：

```js
// 修改前
/*
- 第一次 play 会因 lazy load 未完成而静默失败；第二次起开始有声（这是 Step 1 的简化，后续可加预加载）
*/

// 修改后
/*
- PendingPlays 队列：首次 play 时若 wav 仍在加载，请求入队，loaded 后自动回放
- 不阻塞游戏启动；第一次播放有 50-200ms 延迟（本地 wav）
*/
```

---

## 6. 已知风险

1. **babylon Sound.play() 的语义**：需要确认 `BABYLON.Sound` 在 onload 之前调用 `play()` 会发生什么（是否会报错或静默失败）。本次修复通过在 LOADED 状态下才直接 play，规避了这个问题。但 PENDING 入队 flush 时 sound 已就绪，应该安全。
2. **重复 setVolume**：PENDING 入队时 setVolume 时机在 flush 里，不会丢失。但**如果调用方在 PENDING 期间连续多次 setVolume**，只有最后一次会生效（队列里只存最后一次的 opts）。这是 Step 1 可接受行为，未来如果需要更精细的状态合并再加。

---

## 7. 下个会话起步指令

1. 读本文件
2. 读 [scripts/Systems/Audio/AudioPool.js](file:///e:/se/BlindDuel/scripts/Systems/Audio/AudioPool.js) 确认现状
3. 按本文 §2 的三处改动出 diff（建议分 3 个 show_diff：entry 结构 / play 方法 / onload 回调）
4. 修完更新 AudioPlayer.js 头部注释
5. 跑游戏验证 §3.1，回贴日志
6. 修完后**本文件归档到 `plans/archived/`**