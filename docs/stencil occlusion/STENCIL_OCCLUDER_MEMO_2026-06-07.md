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
