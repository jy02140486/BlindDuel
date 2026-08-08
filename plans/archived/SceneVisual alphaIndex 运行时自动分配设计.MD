# SceneVisual alphaIndex 运行时自动分配设计

> 状态：方案已确认，代码已落地（2026-08-08）
> 涉及：`scripts/Enties/SceneVisualSystem.js`、`Data/SceneDefs/prologue.json`、`DEFAULT_ENVIRONMENT_CONFIG`

## 1. 背景与问题

`SceneVisualSystem` 当前要求每个 element 手填 `alphaIndex` 做「同层内透明排序」。问题：
- 元素一多，人工维护「同层内不撞号、跨层不冲突」的成本高，改一处常常连带重排一串；
- alphaIndex 数值语义不直观（数值越大越靠前绘制=越近），改图时容易填错；
- JSON 里数组的书写顺序与实际绘制顺序解耦，读图者看不出谁压谁。

## 2. 目标

去掉手填 `alphaIndex`，改为运行时按 JSON 数组顺序自动算：
- **先写的离镜头远（先绘制），后写的离镜头近（后绘制）**；
- 配置只描述资源顺序，排序行为由代码负责（符合「配置描述资源，代码描述行为」原则）。

## 3. 现状梳理

### 3.1 读取点
全工程只有 `SceneVisualSystem.js` 读取 `elementConfig.alphaIndex`，共两处：
- `_createVisualElement`
- `_createAnimatedTileElement`

### 3.2 数据来源
- 外部 JSON：仅 `Data/SceneDefs/prologue.json` 一个 SceneDef。
- 内存兜底：`DEFAULT_ENVIRONMENT_CONFIG`（`Scene.js` 在 `sceneDef.environment` 缺省时使用）。

### 3.3 渲染分组与竞争关系

prologue 的 5 个层：

| 层 | z | renderingGroupId | 与谁竞争 |
|---|---|---|---|
| bg_forest | 40 | 0 | 仅本组场景元素 |
| mid_ruin | 20 | 0 | 仅本组场景元素 |
| mid_treeline_1 | 24 | 0 | 仅本组场景元素 |
| STAGE | 10 | **1** | **与角色/道具/depthMask 同组** |
| FG_DECOR | -10 | 2 | 仅本组（整组在角色之上） |

**关键约束**：
- 角色在 group 1 用 y-sort 动态算 `alphaIndex = 1000 + round(-y*100)`（`ExploreMode.js`）；
- depthMask 用 `10000`（`SceneVisualSystem.js`）；
- STAGE 层场景元素必须保持 **alphaIndex < 1000**，才能停在角色身后。

## 4. 设计

### 4.1 排序规则映射

Babylon 透明队列规则：**同 `renderingGroupId` 内，按 `alphaIndex` 升序绘制**（小=先画=在后/远，大=后画=在前/近）。

「数组顺序」→「alphaIndex 递增」正好对应「远→近」。

### 4.2 计数器作用域：全局扁平计数

跨所有层按「层顺序 × 元素顺序」扁平递增，一个全局游标。

安全性：alphaIndex 只在**同一 renderingGroupId 内**比较。全局游标给 group 0/1/2 各自分配的子集仍是单调递增的，互不干扰；STAGE 元素拿到的索引（约 11~15）仍远小于角色 1000，**不破坏「场景元素在角色身后」的语义**。

### 4.3 代码改动（SceneVisualSystem.js）✅ 已落地

- `init(config)` 入口初始化游标 `this._nextAlphaIndex = 0;`；
- 新增 `_resolveAlphaIndex(elementConfig)` 辅助方法；
- `_createVisualElement` / `_createAnimatedTileElement` 两处赋值点改为 `plane.alphaIndex = this._resolveAlphaIndex(elementConfig);`；
- **保留 escape hatch**：若元素显式带 `alphaIndex` 字段，则用显式值并同步推进游标（防后续元素穿模）。

```js
_resolveAlphaIndex(elementConfig) {
    if (elementConfig.alphaIndex !== undefined) {
        this._nextAlphaIndex = elementConfig.alphaIndex + 1;
        return elementConfig.alphaIndex;
    }
    return this._nextAlphaIndex++;
}
```

### 4.4 数据改动（prologue.json + DEFAULT_ENVIRONMENT_CONFIG）⏳ 待落地

**必须配套做两件事**，否则改变视觉效果：

1. **删除所有 `alphaIndex` 字段**；
2. **把每个 `elements` 数组重排为「远→近」顺序**——因为现在数组顺序=深度顺序。

## 5. prologue.json 重排建议（远→近）

按现有 alphaIndex 升序还原原作者意图，撞号处保留 JSON 原相对顺序：

| 层 | 原 JSON 顺序 (alphaIndex) | 新顺序（远→近） | 是否需重排 |
|---|---|---|---|
| bg_forest | tree_bg(1), sky_bg(0) | sky_bg → tree_bg | ✅ 需重排 |
| mid_ruin | ruin_layer1(14), ground(3), pine(7), brush_2(9), brush_1(8) | ground → pine → brush_1 → brush_2 → ruin_layer1 | ✅ 需重排 |
| mid_treeline_1 | pine(5), ground(2), brush_mid_1(6), brush_mid_2(6) | ground → pine → brush_mid_1 → brush_mid_2 | ✅ 需重排 |
| STAGE | ground(2), ruin_main(24), grass_deco(24), grass_deco2(25), grass_deco3(26) | ground → ruin_main → grass_deco → grass_deco2 → grass_deco3 | ❌ 原序已对，仅删字段 |
| FG_DECOR | brush_far(1) | brush_far | ❌ 单元素 |

**删字段后全局扁平自动分配的 alphaIndex**（供验证遮挡语义不变）：

| 层 | 元素 → 自动 alphaIndex |
|---|---|
| bg_forest | sky=0, tree=1 |
| mid_ruin | ground=2, pine=3, brush_1=4, brush_2=5, ruin=6 |
| mid_treeline_1 | ground=7, pine=8, brush_mid_1=9, brush_mid_2=10 |
| STAGE | ground=11, ruin_main=12, grass_deco=13, grass_deco2=14, grass_deco3=15 |
| FG_DECOR | brush_far=16 |

STAGE 最大值 15，远小于角色下限 1000，**不破坏「场景元素在角色身后」语义**。

`mid_ruin` 的 `ruin_layer1` 原作者给 14（该层最近），重排后它在层内排末尾，符合美术意图。

`DEFAULT_ENVIRONMENT_CONFIG` 同步删除 `alphaIndex`；BG_MID 层 `treeline`(原=1) 需前移到 `building_1` 之前，其余层顺序基本已对。

## 6. 不改动 / 不受影响

- 角色 y-sort（`ExploreMode`）、depthMask(10000)、PropEntity/PickableEntity 的 alphaIndex——都不读 `elementConfig.alphaIndex`，**无需动**；
- 层的 `z` / `parallaxFactor` / `renderingGroupId` 保持不变。`z` 现在只影响视差与透视，不再决定透明排序。

## 7. 风险与边界

1. **STAGE 元素始终在角色身后**：方案给 STAGE 元素的索引（<1000）天然小于角色（1000+）。若未来需要「前景草叶盖住角色脚」的效果，得改走 renderingGroupId=2 或给该元素显式 `alphaIndex > 角色上限`。这是**现有方案就有的限制，非本次引入**。
2. **极多元素场景**：若 group 1 内 STAGE 之前累计元素超过 1000，会撞进角色区间。原型阶段元素数量远达不到，暂不处理；真要防，可给计数器加 `Math.min(idx, 999)` 上限。
3. **重排数组是必须的人工步骤**：光删字段不重排，会回退到 z 距离排序，结果可能与预期不符。

## 8. 已确认决策

1. **作用域**：全局扁平计数（跨层连续递增）✅
2. **`alphaIndex` 字段**：保留作为可选 override，但 `prologue.json` / `DEFAULT_ENVIRONMENT_CONFIG` 中现有手写值全部删除 ✅
3. **重排顺序**：按本文档 §5 建议稿执行 ✅

## 9. 落地清单

- [x] `SceneVisualSystem.js`：`_nextAlphaIndex` 游标 + `_resolveAlphaIndex` + 两处赋值点替换
- [ ] `prologue.json`：按 §5 重排 5 个层的 `elements` 数组 + 删除所有 `alphaIndex` 字段
- [ ] `DEFAULT_ENVIRONMENT_CONFIG`：删除 `alphaIndex` 字段 + BG_MID 层 `treeline` 前移
- [ ] 启动验证：`py -m http.server 9000 --bind 127.0.0.1`，访问 `http://127.0.0.1:9000/babylon_demo.html`，对照原效果检查各层遮挡关系
````

文档已更新：状态改为「已确认」，§8 由「待确认」改为「已确认决策」记录三条最终结论，§9 加了落地清单标注代码已完成、数据待落地。

剩下两步数据改动（prologue.json 重排 + DEFAULT_ENVIRONMENT_CONFIG）需要继续的话告诉我，我直接出 diff。