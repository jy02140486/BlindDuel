// 暂不采用：prop depthMask（stencil 遮挡）方案搁置
// 这类 prop 不与场景画在一起，blocker 避免位置重叠 + y-fighting，
// 靠现有 y-sort / alphaIndex 即可达到足够效果，无需 stencil plane。
// 保留文件供未来重启 prop depthMask 方案时参考。
//
// export function attachStencilOccluder(plane, scene) {
//     const gl = scene.getEngine()._gl;
//     plane.onBeforeRenderObservable.add(() => {
//         gl.colorMask(false, false, false, false);
//         gl.enable(gl.STENCIL_TEST);
//         gl.stencilMask(0xFF);
//         gl.stencilFunc(gl.ALWAYS, 1, 0xFF);
//         gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
//     });
//     plane.onAfterRenderObservable.add(() => {
//         gl.colorMask(true, true, true, true);
//         gl.stencilFunc(gl.NOTEQUAL, 1, 0xFF);
//         gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
//         gl.stencilMask(0x00);
//     });
// }