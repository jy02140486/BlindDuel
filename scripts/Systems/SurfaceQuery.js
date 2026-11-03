/*
- 地表材质查询：按世界坐标 (x, y) 返回 SurfaceType（footstep 等脚步声按材质选音效用）
- 数据来源：SceneDef 的 defaultSurfaceType + surfaceRegions[]（矩形，语义同 walkAreas）
- 矩形命中采用"后定义覆盖先定义"（逆序遍历取首个命中），与 walkAreas 评估习惯一致
- 纯查询层，无 Babylon 依赖
*/
export class SurfaceQuery {
    constructor(defaultSurfaceType = null, regions = []) {
        this._default = typeof defaultSurfaceType === "string" ? defaultSurfaceType : null;
        this._regions = Array.isArray(regions)
            ? regions.filter(r => r && typeof r.surfaceType === "string")
            : [];
    }

    queryAt(x, y) {
        for (let i = this._regions.length - 1; i >= 0; i--) {
            const r = this._regions[i];
            if (x >= r.minX && x <= r.maxX && y >= r.minY && y <= r.maxY) {
                return r.surfaceType;
            }
        }
        return this._default;
    }
}
