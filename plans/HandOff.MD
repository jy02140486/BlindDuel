## ✅ 本会话完成清单
改动 状态 文件 cooldownPenalty scope bug 修复 ✅ AIController.js:906 tuning 还原（baseWeight=0.4, preemptiveBonus=0.2） ✅ AITuning.js Step B 分项诊断日志 ✅ AIController.js:900-1098 Step C 意图权重 + debug 开关 ✅ AIController.js:98-103, 1065-1078 constructor`}` 语法错误修复 ✅ AIController.js:104 intentWeights 补全 common 系数 ✅ AIController.js:1068-1085 计划 MD 更新（Step 3→A/B/C/D, Step 4 标记意外实现） ✅ plans/26.10.9 预测能力通用化计划.MD

## 📍 当前代码状态
- `attackIntentMode` 默认值 =`"normal"` ✅（已确认）
- positioning opp startup suppress approach ✅
- PREEMPTIVE 物理门控 =`distance ≤ effectiveRange` （已知限制，需近距离才能触发）
## 🚀 下一个会话可以做
选项 内容 复杂度 A. 验证 normal 模式 跑一轮正常 AI，看三条 intent 路径自然竞争的效果 低（测试为主） B. B5 预测驱动 positioning 让 positioning 也消费 events（比如 opp_attack_active_window.startMs 决定要不要 hold） 中 C. B6 predictionAccuracy 旋钮 给 aiProfile 加 predictionAccuracy 对象，让 PREEMPTIVE bonus 精度可调（模拟"敏锐老江湖"vs"迟钝新手"） 中 D. PREEMPTIVE 物理门控放宽 `distance ≤ effR` →`distance ≤ maxRange` ，让 PREEMPTIVE 更容易触发 低（1 行改动）

建议新会话开头先读：

1. `plans\26.10.9 预测能力通用化计划.MD` （Step 3 部分）
2. `plans\AI_Attack_Intent_Scoring_Guideline.MD` （GPT 提案）
3. `scripts\Systems\AI\AIController.js` 的`#scoreAttack` 方法（lines 880-1110）