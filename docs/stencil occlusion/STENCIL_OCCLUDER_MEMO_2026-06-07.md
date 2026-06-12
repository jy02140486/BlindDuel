# Stencil Buffer 遮罩裁切方案备忘录

> 日期：2026-06-07
> 场景：`occludingtest.js` — 2D 精灵遮挡裁切测试
> 目标：用可移动的透明"遮挡片"裁切底图（longswordman），只显示框外内容，框内挖空

---

## 1. 最终效果

- 绿色线框（outlinePlane）可随 WASD 移动
- 线框范围内的底图（longswordman）被**挖空**（不显示）
- 线框范围外的底图正常显示
- 遮挡片本身不可见（无黑色填充）

---

## 2. 核心思路：Stencil Buffer 三步法

用 WebGL 原生 `gl.colorMask` + `gl.stencilFunc` + `gl.stencilOp` 实现，绕过 Babylon.js 高层 stencil API（`engine.setStencilOperation` 等方法在当前版本中不存在）。

### 2.1 三个 Mesh 的职责

| Mesh | 职责 | 关键属性 |
|------|------|----------|
| `stencilPlane` | **只写 stencil**，不画颜色 | `gl.colorMask(false,...)` + `REPLACE` |
| `outlinePlane` | **显示绿色线框** | `wireframe = true` |
| `basePlane` | **被裁切的底图** | 正常材质，受 stencil 测试影响 |

### 2.2 渲染顺序（按创建顺序）

```
1. stencilPlane
   onBeforeRender:  gl.colorMask(false,false,false,false)  // 禁用颜色写入
                    gl.enable(STENCIL_TEST)
                    gl.stencilFunc(ALWAYS, 1, 0xFF)          // 总是通过
                    gl.stencilOp(KEEP, KEEP, REPLACE)        // 通过时写入 1
   [绘制: 框内区域 stencil=1, 框外保持 0]
   onAfterRender:   gl.colorMask(true,true,true,true)        // 恢复颜色写入
                    gl.stencilFunc(NOTEQUAL, 1, 0xFF)        // 后续: stencil≠1 才画

2. outlinePlane
   [正常绘制绿色线框，此时 stencil 测试为 NOTEQUAL，但 outlinePlane 不需要特殊处理]

3. basePlane
   [绘制时 stencil 测试为 NOTEQUAL 1: 框内(stencil=1)不画, 框外(stencil=0)画]
   onAfterRender:   gl.disable(STENCIL_TEST)                 // 关闭 stencil，避免影响后续
```

---

## 3. 踩坑记录

### 坑 1：`alpha = 0` 导致透明队列排序问题

**现象**：
- `stencilMat.alpha = 0`
- y 坐标较低时遮罩正常，y 坐标较高时遮罩失效

**原因**：
- Babylon.js 渲染顺序：**Opaque → Alpha Test → Transparent**
- `alpha = 0` 把 `stencilPlane` 踢入 **Transparent 队列**
- Transparent 队列按深度从远到近排序，y 较高时 `stencilPlane` 可能被排到 `basePlane` **后面**
- 结果：`basePlane` 先画，`stencilPlane` 后写 stencil，遮罩对 `basePlane` 无效

**解决**：
- 不用 `alpha = 0` 隐藏，改用 `gl.colorMask(false, false, false, false)`
- 这样 `stencilPlane` 保持不透明（在 Opaque 队列），但屏幕上不显示颜色

### 坑 2：`renderingGroupId` 导致 stencil 被 clear

**现象**：
- 设置 `stencilPlane.renderingGroupId = 0`, `basePlane.renderingGroupId = 1`
- stencil 完全不生效

**原因**：
- Babylon.js 在切换 `renderingGroup` 时会 **clear depth/stencil 缓冲**
- Group 0 写入的 stencil 在 Group 1 渲染前被清掉了

**解决**：
- 去掉所有 `renderingGroupId`
- 纯靠**创建顺序**控制渲染先后

> **2026-06-08 更新**：如果场景中加入了背景图（如 `bgPlane`），背景图也可能被 stencil 影响或遮挡人物。
> 此时若再用 `renderingGroupId` 分层（背景 group 0，人物 group 1），会重新触发 stencil clear 问题。
> 正确做法：**背景也放在 group 1，但通过 `z` 坐标确保它最先绘制**，而不是用 `renderingGroupId` 强行分层。
> 或者关闭背景的 `hasAlpha`，让它进入 Opaque 队列先画，避免透明排序干扰。

### 坑 3：`engine.setStencilOperation` 不存在

**现象**：
- 报错 `engine.setStencilOperation is not a function`

**原因**：
- 当前 Babylon.js 版本（或构建方式）没有暴露这些高层 API

**解决**：
- 直接用 `engine._gl` 获取 WebGL context，调用原生 `gl.stencilFunc` / `gl.stencilOp` / `gl.enable(STENCIL_TEST)`

### 坑 4：深度冲突（z 坐标相同）

**现象**：
- `stencilPlane` 和 `basePlane` z 都为 0
- 某些情况下深度测试导致 stencil 未写入

**解决**：
- 确保 `stencilPlane` 在创建顺序上先于 `basePlane`
- 或者给 `stencilPlane` 设置 `z = -0.01`（更靠近相机），确保它先通过深度测试

### 坑 5：加入背景图后背景遮挡人物

**现象**：
- 原本只有人物和遮罩时遮挡关系正确
- 加入背景图（`bgPlane`，z=1）后，背景把人挡住了

**原因**：
- 背景也启用了 `hasAlpha = true`，进入 Transparent 队列
- Babylon.js 的透明物体按深度排序，背景的 z=1 可能被排到人物后面，但绘制顺序仍可能错乱
- 更关键的是：背景的 `onBeforeRenderObservable` 没有关闭 stencil，如果背景在 stencil 开启后绘制，可能被 stencil 裁切；或者透明排序导致背景画在了人物前面

**解决**：
- **不要**用 `renderingGroupId` 分层（会触发坑 2，stencil 被 clear）
- 关闭背景的 alpha 测试，让它进入 Opaque 队列最先绘制：
  ```javascript
  bgMat.useAlphaFromDiffuseTexture = false;  // 背景不需要透明
  bgMat.transparencyMode = BABYLON.Material.MATERIAL_OPAQUE;
  ```
- 或者给背景添加 `onBeforeRenderObservable` 强制关闭 stencil：
  ```javascript
  bgPlane.onBeforeRenderObservable.add(() => {
      gl.disable(gl.STENCIL_TEST);
  });
  ```
- 最简方案：背景不启用 `hasAlpha`，也不设置 `useAlphaFromDiffuseTexture`，作为纯不透明物体最先画

### 坑 6：Alpha Blending 透明像素仍写入深度缓冲

**现象**：
- 两个 sprite（如 basePlane 和 merchantPlane）靠近时
- merchant 的**透明区域**会遮挡 base 的内容
- 即使 merchant 那部分像素完全透明（alpha=0），base 对应位置仍被裁掉

**原因**：
- `useAlphaFromDiffuseTexture = true` 启用的是 **alpha blending（混合）**，而非 alpha testing（测试）
- WebGL 渲染管线顺序：**深度测试 → 深度写入 → 颜色混合**
- 也就是说，深度写入发生在颜色混合**之前**
- 即使 fragment 的 alpha=0（完全透明），深度值依然被写入深度缓冲
- 后续物体在同一像素位置做深度测试时，发现深度缓冲已有值，就会被剔除

```
渲染管线：
  fragment → 深度测试 → 深度写入 → 颜色混合
                              ↑
                    透明像素也会走到这里！
```

**更严重的情况**：
- 同一 renderingGroupId 内渲染顺序不稳定
- 如果 merchant 在 base 之前渲染，整个 128×128 quad（含透明区）写入深度
- base 尝试渲染时被深度测试剔除

**解决**：
- 对 sprite 材质启用 **alpha testing** 模式，透明像素直接丢弃（不写深度、不写颜色）：
```javascript
material.transparencyMode = BABYLON.Material.MATERIAL_ALPHATEST;
material.alphaCutOff = 0.4;  // alpha < 0.4 的像素直接丢弃
```

**Alpha Blending vs Alpha Testing 对比**：

| | Alpha Blending | Alpha Testing |
|---|---|---|
| alpha < cutoff 的像素 | 混合颜色，**仍写入深度** ❌ | **直接丢弃**，不写深度不写颜色 ✅ |
| alpha ≥ cutoff 的像素 | 正常混合 | 正常渲染为不透明 |
| 边缘效果 | 平滑过渡 | 硬边缘（像素风 sprite 无影响） |

> **注意**：alpha testing 会产生硬边缘，不适合需要平滑半透明过渡的特效（如光晕、阴影）。
> 但对于像素风 sprite（本身边缘就是硬的），alpha testing 是最佳选择。

---

## 4. 关键代码片段

```javascript
// 创建引擎时必须开启 stencil
const engine = new BABYLON.Engine(canvas, true, { stencil: true });

// 获取 WebGL context
const gl = engine._gl;

// stencilPlane: 只写 stencil，不画颜色
stencilPlane.onBeforeRenderObservable.add(() => {
    gl.colorMask(false, false, false, false); // 禁用颜色写入
    gl.enable(gl.STENCIL_TEST);
    gl.stencilFunc(gl.ALWAYS, 1, 0xFF);       // 总是通过
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE); // 通过时写入 ref=1
});

stencilPlane.onAfterRenderObservable.add(() => {
    gl.colorMask(true, true, true, true);     // 恢复颜色写入
    gl.stencilFunc(gl.NOTEQUAL, 1, 0xFF);     // 后续: stencil≠1 才画
});

// basePlane: 正常绘制，受 stencil 测试影响
basePlane.onAfterRenderObservable.add(() => {
    gl.disable(gl.STENCIL_TEST);              // 绘制完后关闭 stencil
});
```

---

## 5. 参数速查

### `gl.stencilFunc(func, ref, mask)`

| 参数 | 说明 |
|------|------|
| `func` | 测试函数：`ALWAYS`, `NEVER`, `EQUAL`, `NOTEQUAL`, `LESS`, `LEQUAL`, `GREATER`, `GEQUAL` |
| `ref` | 参考值（reference），用于和 stencil buffer 中的值比较 |
| `mask` | 掩码，按位与后比较。`0xFF` = 不掩码 |

### `gl.stencilOp(fail, zfail, zpass)`

| 参数 | 说明 |
|------|------|
| `fail` | stencil 测试失败时的操作 |
| `zfail` | stencil 通过但深度测试失败时的操作 |
| `zpass` | stencil 和深度都通过时的操作 |

常用操作：`KEEP`（保持）, `REPLACE`（替换为 ref）, `ZERO`（清零）, `INCR`（递增）

---

## 6. 延伸应用

此方案可直接用于：
- **角色被障碍物部分遮挡**：障碍物作为 stencilPlane，角色作为 basePlane
- **UI 遮罩**：不规则形状的遮罩裁切
- **场景过渡**：圆形/矩形展开效果

只要需要"某个区域不绘制"的效果，都可以用这个 stencil 三步法。

---

## 7. 相关文件

- `occludingtest.js` — 完整实现
- `occludingtest.html` — 测试页面

---

## 8. 多角色 Y-sort + Per-Character Stencil（2026-06-10）

### 8.1 背景

场景中有多个角色 sprite（hero、customer）+ 多个遮挡 mask（桌子、柱子）。需求：

- 角色之间按 y 坐标 painter 排序（y 越大越靠后，先画）
- Mask 对"站在掩体后面"的角色做 stencil 裁剪，"站在掩体前面"的角色不受影响
- 角色透明区域（sprite 贴图 alpha=0）不能裁掉其他角色

### 8.2 坑 7：ALPHATEST 队列不做 painter 排序

**现象**：hero（y=-2.48，远处）先画，customer（y=-3.20，近处）后画，但画面效果是 hero 挡在前面。

**原因**：`MATERIAL_ALPHATEST` 进入的是 AlphaTest Queue，该队列不做 painter 排序（不按 alphaIndex 也不按深度），按创建顺序绘制。

**解决**：改用 `MATERIAL_ALPHABLEND`，进入 Transparent 队列，配合每帧动态设置 `alphaIndex = Math.round(-y * 1000)` 实现 Y-sort。同时必须 `gl.disable(DEPTH_TEST)` 让角色彻底退出 depth pipeline：

```javascript
// ExploreMode.updateRender() 每帧更新
entity.spritePlane.alphaIndex = Math.round(-entity.root.position.y * 1000);
```

```javascript
// 角色 onBeforeRender
gl.disable(gl.DEPTH_TEST);
```

### 8.3 坑 8：Stencil 状态泄漏 — gl.stencilOp(REPLACE) 未恢复

**现象**：角色透明区域（sprite alpha=0）裁掉了后面的角色。

**原因**：

- Mask 的 `onBeforeRender` 设置了 `gl.stencilOp(KEEP, KEEP, REPLACE)`，但 `onAfterRender` 从未恢复
- 角色的 `onBeforeRender` 启用 stencil 但没有设 `stencilOp`，继承到 REPLACE
- `MATERIAL_ALPHABLEND` 不同于 `ALPHATEST`：透明 fragment（alpha=0）不会被 discard，仍然走完整个管线，**包括执行 stencilOp**
- 结果：hero 整张 quad 的透明像素也在写 stencil=1，customer 被 NOTEQUAL 全部裁掉

**解决**：

- Mask 的 `onAfterRender` 恢复 `gl.stencilOp(KEEP, KEEP, KEEP)` + `gl.stencilMask(0x00)`
- 角色的 `onBeforeRender`（stencil 分支）显式设置 `gl.stencilMask(0x00)` + `gl.stencilOp(KEEP, KEEP, KEEP)`，**只读不写**

### 8.4 坑 9：stencilMask(0x00) 阻止后续 Mask 写入

**现象**：修复 stencil 泄漏后角色间遮挡正确，但 mask 对角色不再生效。

**原因**：Mask1 的 `onAfterRender` 设置了 `gl.stencilMask(0x00)`，Mask2 的 `onBeforeRender` 没有恢复 `gl.stencilMask(0xFF)`，导致 Mask2 及之后的 mask 全部写不进 stencil。

**解决**：每个 mask 的 `onBeforeRender` 显式调用 `gl.stencilMask(0xFF)`，确保每次写 stencil 前恢复写入权限。

### 8.5 最终稳定的 Stencil 流程

```
Mask1 onBefore → stencilMask(0xFF) + stencilFunc(ALWAYS,1) + stencilOp(REPLACE)
Mask1 绘制     → 框内写 stencil=1
Mask1 onAfter  → stencilFunc(NOTEQUAL,1) + stencilOp(KEEP) + stencilMask(0x00)

Mask2 onBefore → stencilMask(0xFF)  ← 恢复写入！
Mask2 绘制     → 框内写 stencil=1
Mask2 onAfter  → stencilFunc(NOTEQUAL,1) + stencilOp(KEEP) + stencilMask(0x00)

角色 onBefore  → disable(DEPTH_TEST)                  ← 退出 depth
               + stencilMask(0x00) + stencilOp(KEEP)   ← 只读不写
               + stencilFunc(NOTEQUAL,1)               ← 仅 needMask 时
角色绘制       → ALPHABLEND, alphaIndex painter 排序
角色 onAfter   → disable(STENCIL_TEST) + enable(DEPTH_TEST)
```

### 8.6 三条线分离的渲染架构

| 管线 | 机制 | 用途 |
|------|------|------|
| Mask → 角色（场景遮挡） | Stencil buffer | 桌子/柱子挡住后面的角色 |
| 角色 → 角色（前后排序） | Painter（alphaIndex） | Y 越大越先画，DEPTH_TEST off |
| 背景层（天空/地面） | renderingGroup 0 | 最底层，不受 stencil 影响 |

关键原则：**角色之间不参与 depth pipeline，完全靠 painter 排序；场景遮挡靠 stencil，两条线互不干扰。**
