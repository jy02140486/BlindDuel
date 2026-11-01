// trajectory → 刀光颜色（plans/26.10.31 刀光计划.MD §4.3）。人类玩家语义：颜色 = 攻击类型 = 应对方式。
// slash（斩击）：可被剑身格挡、可拼刀；thrust（刺击）：剑身格挡无效，只能闪避/盾挡。
export const TRAIL_COLORS = {
    slash:  "#FFE9A8",   // 暖白金（示意值，可调）
    thrust: "#FF7A45",   // 橙红（示意值，可调）
};

export function getTrailColor(trajectory) {
    return TRAIL_COLORS[trajectory] ?? "#FFFFFF";   // 未声明 trajectory → 中性白
}
