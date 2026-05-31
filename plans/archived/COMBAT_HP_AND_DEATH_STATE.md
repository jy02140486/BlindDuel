> **状态**: ✅ 已完成（2026-05-30）

# CombatCharacter HP 与死亡状态 / 战斗结束切回探索模式 方案

## 1. 背景与目标

- 当前 `CombatCharacter.takeDamage()` 只播 "hit" 动画，无血量概念
- 需要为 CombatCharacter 加入 HP，HP 归零时播放死亡动画并结束战斗
- 战斗结束后通过 SceneSequencer 切回探索模式（"battle" → "explore"）
- Hero 死亡动画 `longswordman_defeated`、Rabble 死亡动画 `rabble_stick_die` 已添加

> **前置规则**：`PROJECT_CONTEXT.md` → `0. 前置工作` → 遵守 `andrej-karpathy-skills-CLAUDE.MD`

## 2. 方案概览

```
takeDamage(damage)
  → hp -= damage
  → hp > 0: 照旧进入 "hit" 状态 + 击退
  → hp == 0:
      isDead = true
      enterState("defeated" | "die")
      → 死亡动画播完定格

BattleMode.fixedUpdate 每帧检测
  → character.isDead || rabbleStick.isDead
  → SceneSequencer.play("exit_battle"):
      1. lockInput
      2. sendCommand "sheath"
      3. wait 1.5s
      4. startCameraBlend → explore
      5. switchMode → "explore"
      6. unlockInput
```

## 3. 实施步骤（每步可独立验证）

```
Step 0  提取 collider ──→ 验证：.collider.json 生成成功，含 boxes/anchors
Step 1  资源接线      ──→ 验证：构造不报错，Network 无 404
Step 2  状态图接线    ──→ 验证：hasState("defeated")/hasState("die") === true
Step 3  HP 核心       ──→ 验证：攻击 3 次 → 播死亡动画定格 ★ 可体验
Step 4  战斗结束      ──→ 验证：死亡后 1.5s → 切回探索模式 ★ 可体验
```

### Step 0: 提取 collider 数据（一次性离线）

运行提取脚本，从 CollisionMask + RootMotion PNG 中扫描出碰撞盒数据，输出 `.collider.json`。

```
验证方式：
  - 脚本执行无报错
  - 输出文件存在且有 boxes/anchors 字段：
      Data/CollisionMask/longswordman/longswordman_defeated.collider.json
      Data/CollisionMask/rabble_stick/rabble_stick_die.collider.json
```

<details>
<summary>执行命令</summary>

```powershell
# Hero defeated
powershell -ExecutionPolicy Bypass -File scripts/tools/extract_collision_boxes.ps1 `
  -CollisionAtlasJson "Data/CollisionMask/longswordman/longswordman_defeated.json" `
  -CollisionAtlasPng "Data/CollisionMask/longswordman/longswordman_defeated.png" `
  -RootAtlasJson "Data/RootMotion/longswordman/longswordman_defeated.json" `
  -RootAtlasPng "Data/RootMotion/longswordman/longswordman_defeated.png" `
  -OutJson "Data/CollisionMask/longswordman/longswordman_defeated.collider.json"

# Rabble die
powershell -ExecutionPolicy Bypass -File scripts/tools/extract_collision_boxes.ps1 `
  -CollisionAtlasJson "Data/CollisionMask/rabble_stick/rabble_stick_die.json" `
  -CollisionAtlasPng "Data/CollisionMask/rabble_stick/rabble_stick_die.png" `
  -RootAtlasJson "Data/RootMotion/rabble_stick/rabble_stick_die.json" `
  -RootAtlasPng "Data/RootMotion/rabble_stick/rabble_stick_die.png" `
  -OutJson "Data/CollisionMask/rabble_stick/rabble_stick_die.collider.json"
```

</details>

---

### Step 1: 资源接线（不可见，可验证）

**改 2 文件**：`AssetManifest.js` + `CharacterFactory.js`

注册 `defeated` / `die` 的 atlas、collider 路径，并在工厂中装配 clip（使用 Step 0 生成的 `.collider.json`）。

```
验证方式：
  - 刷新页面，F12 Network 面板检查无红色 404
  - Console 无 "unknown clip" 报错
  - 角色正常渲染，战斗功能无变化
```

<details>
<summary>详细改动</summary>

**AssetManifest.js** — atlas.hero 加 `defeated`，atlas.rabble 加 `die`，colliders 同步加。

**CharacterFactory.js** — `createHeroCharacter` clips 加：
```js
defeated: {
    spriteSheetUrl: "./Art/Sprite/longswordman/longswordman_defeated.png",
    atlasData: assets.atlas.hero.defeated,
    colliderData: assets.colliders.hero.defeated,
    loop: false
}
```
`createRabbleStickCharacter` clips 加：
```js
die: {
    spriteSheetUrl: "./Art/Sprite/rabble_stick/rabble_stick_die.png",
    atlasData: assets.atlas.rabble.die,
    colliderData: assets.colliders.rabble.die,
    loop: false
}
```

</details>

---

### Step 2: 状态图接线（不可见，可验证）

**改 2 文件**：`LongSwordMan.json` + `RabbleStick.json`

```
验证方式：
  - 浏览器 Console 输入：
      character.hasState("defeated")  // → true
      rabbleStick.hasState("die")     // → true
  - 手动 enterState("defeated") 可播死亡动画：
      character.enterState("defeated")
```

<details>
<summary>详细改动</summary>

**LongSwordMan.json** — states 下加：
```json
"defeated": {
  "clip": "defeated",
  "allowMoveInput": false,
  "loop": false
}
```
无 transitions（死亡不可逆）。

**RabbleStick.json** — states 下加：
```json
"die": {
  "clip": "die",
  "loop": false
}
```

</details>

---

### Step 3: HP 核心 ★ 可体验验证

**改 1 文件**：`CombatCharacter.js`

```
验证方式：
  - 进入战斗，攻击 RabbleStick 3 次
  - 预期：第 3 次命中 → rabble 切换到 die 动画并定格
  - 受击方仍可还手（BattleMode 尚未检测死亡）
  - 浏览器 Console 验证：
      rabbleStick.hp       // → 0
      rabbleStick.isDead   // → true
```

<details>
<summary>详细改动</summary>

**combat 对象加字段**：
```js
this.combat = {
    // ...existing...
    hp: config.maxHp ?? 3,
    maxHp: config.maxHp ?? 3,
    isDead: false
};
```

**新增 getter**：
```js
get hp()     { return this.combat.hp; }
get maxHp()  { return this.combat.maxHp; }
get isDead() { return this.combat.isDead; }
```

**takeDamage(ctx) 逻辑**：
```
1. invincible?  isDead? → return false
2. hp -= (ctx.damage ?? 1)，hp = max(0, hp)
3. hp == 0:
    isDead = true
    enterState(deathState)  // "defeated" for hero, "die" for rabble
    return true
4. hp > 0:
    knockbackX 击退
    enterState("hit")
    return true
```

**fixedUpdate 死亡分支**：
```js
if (this.combat.isDead) {
    // 只推进 TimeControl + animation（让死亡动画播完定格）
    // 跳过状态机、移动、碰撞解析
    const tcFrame = this.timeControlSystem.tick(this, dtMs, tickCount);
    if (tcFrame.shouldAdvanceAnimation) {
        this.animation.fixedUpdate(tcFrame.effectiveDeltaMs);
        // _applyFrame, _applyRootAlignment, collision.syncToFrame...
    }
    this._updateDebugPanel();
    return;
}
```

**ContactResolver 不做改动** — `takeDamage` 自行处理伤害值和 deathState 语义：
- 传给 `takeDamage` 的 `ctx.damage` 默认 1
- `ctx.deathState` 由调用方指定（hero="defeated"，rabble="die"）

</details>

---

### Step 4: 战斗结束 ★ 可体验验证 ✅

**改 1 文件**：`BattleMode.js`

在 `fixedUpdate` 末尾调用 `#checkBattleEnd`，检测任一方死亡后通过 `sceneSequencer` 播放退出序列。

```
验证方式（完整流程）：
  1. 进入战斗
  2. 攻击 RabbleStick 3 次 → die 动画播放
  3. hero 自动收刀（sheath）→ 等待 1.5s
  4. 镜头缓慢拉远切换至探索视角
  5. 回到探索模式，角色可自由移动
```

<details>
<summary>详细改动</summary>

**#checkBattleEnd 方法**：
```js
#checkBattleEnd(sceneSequencer) {
    // isBusy 保证只触发一次
    if (!sceneSequencer || sceneSequencer.isBusy()) return;
    if (!character.isDead && !rabbleStick.isDead) return;
    sceneSequencer.play(exitBattleSequence);
}
```
在 `combatSystem.fixedUpdate` 之后调用。

**exit_battle 序列**：
```
1. lockInput    actorId="hero"
2. sendCommand  actorId="hero" command="sheath"
3. wait         durationMs=1500
4. cameraBlend  to="explore" durationMs=2000
5. switchMode   modeId="explore"
6. unlockInput  actorId="hero"
```

</details>

---

## 4. 涉及文件总览

| Step | 文件 | 可测性 |
|------|------|--------|
| 0 | 运行 `extract_collision_boxes.ps1` ×2 | `.collider.json` 生成成功 |
| 1 | `scripts/AssetManifest.js` | Network 无 404 |
| 1 | `scripts/CharacterFactory.js` | 构造不报错 |
| 2 | `Data/StateGraphDef/LongSwordMan.json` | `hasState("defeated") === true` |
| 2 | `Data/StateGraphDef/RabbleStick.json` | `hasState("die") === true` |
| 3 | `scripts/Enties/CombatCharacter.js` | ★ 攻击 3 次 → 播死亡动画定格 |
| 4 | `scripts/Systems/Modes/BattleMode.js` | ★ 死亡后 → 切回探索模式 |

## 5. 待完成事项

### 5.1 碰撞遮罩检查 ✅

`longswordman_defeated.collider.json` 和 `rabble_stick_die.collider.json` 已通过 `extract_collision_boxes.ps1` 成功生成，含 boxes 和 anchors.root。

## 6. 不做的

- 不做 HP UI（HUD）——属于后续 UI 层工作
- 不做探索模式中的复活/重开逻辑
- 不处理 RabbleStick 在探索模式的可见性
- 不修改 `ContactResolver` — 伤害值由 `takeDamage` 自行处理，ContactResolver 不感知 HP

## 7. 验收标准

- [x] Step 0: 两个 `.collider.json` 生成成功，含 `boxes` 和 `anchors.root`
- [x] Step 1: Network 无 404，console 无资源报错
- [x] Step 2: `hasState("defeated")` / `hasState("die")` 返回 `true`
- [x] Step 3: Hero 被 Rabble 攻击 3 次 → `defeated` 动画定格；Rabble 被攻击 3 次 → `die` 动画定格
- [x] Step 3: invincible 状态（dodge）不受伤害
- [x] Step 3: 死亡动画期间不再响应输入和战斗碰撞
- [x] Step 4: 任一方死亡 → 收刀 → 1.5s → 镜头切换 → 回到探索模式
- [x] Step 4: 回到探索模式后角色可自由移动