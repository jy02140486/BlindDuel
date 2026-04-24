# Rabble Stick 受击与双角色接入计划

更新时间：2026-04-23

## 归档结论（2026-04-23）
本计划已完成首版落地，达到“可跑通、可验证、可继续扩展”的归档标准。

已完成范围：
1. 双角色接入与主循环结算链路已打通（`Character + CombatSystem + ContactResolver`）。
2. `Character.takeDamage(ctx)` 与 `Character.getCombatSnapshot()` 已落地并参与运行时结算。
3. `rabble_stick` 最小状态图（`idle / hit`）已接入，受击可切 `hit` 并回到预期状态。
4. 命中去重、`attackActive`、`guard weaponbox`、同帧快照结算规则已接入当前原型。
5. 控制器扩展位已建立：新增 `BaseController`，并落地 `DummyController` 最小实现；`PlayerController` 已抽取复用逻辑到基类。

遗留到后续计划：
1. 完整 `Dummy/Test/AI` 行为策略（当前仅最小控制器骨架）。
2. `AABB -> OBB` 判定升级。
3. 显式攻击实例生命周期（替代纯隐式结束判定）。
4. `rabble_stick` 更完整动作与 `strong_blade` 数据补齐。

## 0. 当前落地状态（2026-04-23）
1. 已落地 `ContactResolver + CombatSystem`（系统层），并接入 `character_demo.js` 主循环。
2. 已落地 `Character.takeDamage(ctx)` 与 `Character.getCombatSnapshot()`。
3. 已落地 `RabbleStick.json`（最小 `idle / hit`），并在场景中使用该状态图。
4. 已落地 `attackActive` 状态标记（`LongSwordMan.json` 的 `thrust / quart`）。
5. 已支持 `guard weaponbox`：非攻击态 weaponbox 仅用于拦截，不视为主动攻击实例。

## 1. 目标
1. 在场景中生成右侧 `rabble_stick` 角色（当前不接玩家输入）。
2. 为 `Character` 增加 `takeDamage` 入口，支持受击切到 `hit`。
3. 为后续控制器扩展（`Dummy/AI/Test`）预留统一结构。
4. 补齐 `rabble_stick` 状态图框架，支持“任意状态进入 hit”。

## 2. 已确认决策
1. 需要命中去重：同一攻击实例不能在连续帧重复命中同一目标。
2. 暂不做受击锁定机制：`hit` 动画期间不配攻击/受击碰撞盒即可避免重复交互。
3. 暂不做阵营判定：当前按格斗游戏对战假设推进。
4. 状态图必须补：`rabble_stick` 需要状态图框架，并支持从任意状态进入 `hit`。

## 3. 实现顺序
1. 场景接入双角色
2. 新增 `DummyController`（静止或最小行为）
3. `Character.takeDamage(ctx)` 最小实现
4. `rabble_stick` 状态图文件落地
5. 命中检测链路里接入“去重 + 调用 takeDamage”

## 4. 状态图框架要求（Rabble Stick）
1. 最小状态：`idle / move / thrust / swing / hit`（可按资源裁剪）。
2. `hit` 为非循环状态，播放完自动回 `idle`（或后续按设计回其他状态）。
3. 需要支持“任意状态进入 hit”。
4. 当前阶段建议两种实现择一：
   - 运行时强制切状态：`takeDamage` 内直接进入 `hit`。
   - 状态图扩展 `anyTransitions`：统一描述任意态转移。
5. 先实现可跑通版本，再决定是否全面数据驱动。

## 5. 命中去重规则（首版）
1. 去重粒度：`attackInstanceId + targetId`。
2. 同一攻击实例在生命周期内对同一目标只生效一次。
3. 攻击实例结束后释放去重记录。

## 6. 本轮不做
1. 受击硬直叠加/刷新规则。
2. 阵营与友伤过滤。
3. 复杂 AI 行为逻辑。

## 7. 验收标准
1. 场景内同时存在 `longswordman` 与 `rabble_stick`，且位置明显分离（`rabble_stick` 在右侧）。
2. `rabble_stick` 无玩家输入也可稳定播放状态动画。
3. 命中触发后，`rabble_stick` 能进入 `hit` 并在结束后回到预期状态。
4. 同一攻击帧持续接触时，不会对同一目标重复触发受击。

## 8. ContactResolver 接入与调用约定（新增）
1. 不采用“角色各自一个 Resolver”的方案；战斗结算必须由场景内单例 `ContactResolver` 统一处理。
2. `ContactResolver` 由 `CombatSystem` 持有，`CombatSystem` 由主循环编排层调用（当前已接到 `character_demo.js`）。
3. 建议主循环顺序：
   - `inputSystem.update()`
   - `playerController.update()`
   - `character.update()/rabbleStick.update()`（先推进动画和当前帧盒子）
   - `combatSystem.update(characters)`（内部调用 `ContactResolver.resolve` 并触发 `takeDamage`）
   - `scene.render()`

## 9. 同帧双方攻击结算规则（新增）
1. 同一帧采用“快照结算”，禁止按调用先后决定胜负。
2. 统一顺序：
   - 先收集本帧接触对（不立即生效）
   - 先结算 `weapon vs weapon`
   - 再结算 `weapon vs hitbox`
   - 最后统一下发结果（受击/弹刀/击退）
3. 规则首版：
   - `strong_blade` 与 `weak_blade` 相碰：强方赢，弱方弹刀后退，弱方该次攻击失效
   - 同级相碰（`strong vs strong` / `weak vs weak`）：双方都弹刀后退
   - 任意 `weaponbox` 命中对方 `hitbox`：记为有效命中
   - `offense weaponbox` 与 `guard weaponbox` 相碰：若 `guard >= offense`，则攻击方失效并触发弹刀后退
4. 当同帧既发生“刀碰刀”又发生“刀打身体”时，是否允许强方继续命中以本规则顺序裁决（先刀碰刀，后刀打人）。

## 10. `Character.takeDamage(ctx)` 参数草案（新增）
1. `attackInstanceId`：攻击实例 ID（命中去重主键之一）
2. `attackerId`：攻击方角色 ID
3. `targetId`：受击方角色 ID
4. `attackLevel`：`strong_blade | weak_blade`
5. `contactType`：`weapon_vs_hitbox | clash_win | clash_lose | clash_tie`
6. `damage`：伤害值（首版可固定）
7. `hitState`：受击目标状态（首版为 `hit`）
8. `knockbackX`：X 轴击退量（符号表示方向）
9. `frame`：发生帧编号（调试/回放）

## 11. 接触对与去重记录存放（新增）
1. 帧内接触对放在 `ContactResolver` 的临时容器（每帧清空）：
   - `weaponVsWeapon[]`
   - `weaponVsHitbox[]`
2. 跨帧去重记录放在 `ContactResolver` 的持久容器（按攻击生命周期清理）：
   - `hitDedupe: attackInstanceId + targetId`
   - `clashDedupe: sorted(attackInstanceA, attackInstanceB)`
   - `guardDedupe: attackInstanceId + guardTargetId`
3. 不把命中去重表存到单个角色内部，避免双算和不同步。

## 12. 攻击实例生命周期与“攻击结束”判定（新增）
1. 仅当 `state.attackActive === true` 且当前帧存在 `weaponbox` 时，才生成 `attackInstanceId`。
2. `state.attackActive !== true` 的 `weaponbox` 标记为 `guard`，用于拦截，不作为主动攻击实例。
3. 当前“攻击结束”采用隐式判定：当某 `attackInstanceId` 不再出现在 `activeAttackIds` 集合中，即视为结束并释放去重记录。
4. 风险：若后续动作存在“中间空帧再出刀”，该隐式判定可能过早释放，后续需升级为显式生命周期机制。

## 13. 架构分层决策（新增）
1. 本阶段先不上完整 `GameMode`。
2. 先做最小编排层（`CombatSystem` 或 `MatchRuntime`）：
   - 持有单例 `ContactResolver`
   - 每帧执行结算更新
   - 管理攻击实例与去重释放
3. 等后续接入倒计时、胜负、回合切换、重开局时，再升级为完整 `GameMode`。

## 14. 规则缺口与风险清单（新增）
1. 需要补充“受击中是否可再次受击”的明确规则，避免连续帧抖动触发。
2. 需要定义弹刀后状态归属（复用 `hit` 还是新增 `recoil/parry`）。
3. 需要定义击退方向来源（建议基于双方 `root.position.x`）。
4. 当前 `rabble_stick` 的部分动作数据仅有 `weak_blade`，若要验证“强压弱”，需补 `strong_blade` 数据。
5. 当前接触判定为 AABB 简化；若动作盒体旋转较大，需升级到 OBB 级判定。
