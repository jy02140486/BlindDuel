/*
- 语义事件 type → audioId 翻译层（表驱动，配置见 Data/Audio/sfx_map.json）
- 职责划分（plans/26.11.3 声音系统事件驱动改造计划.MD）：动画事件报告动作时机，
  游戏逻辑报告实际结果，音频系统负责把结果翻译成具体音效
- resolve(type, payload) → { audioId, options } | null
  - null = 静默忽略（map 未收录的 type，如 throw_draw/throw_release 等非音频事件）
- mode:
  - "direct"（缺省）：type → audioId 直映射
  - "surface"：按 payload.source 落脚点查询 SurfaceType，再查 bySurface 表；查不到走 fallback
- SurfaceProvider 由 Scene 生命周期注入（setSurfaceProvider），未注入时 surface 模式走 fallback
*/
export class SfxResolver {
    constructor(sfxMap = {}) {
        this._map = sfxMap ?? {};
        this._surfaceProvider = null;
    }

    setSurfaceProvider(provider) {
        this._surfaceProvider = provider ?? null;
    }

    resolve(type, payload = {}) {
        const rule = this._map[type];
        if (!rule) return null;

        if (rule.mode === "surface") {
            return this.#resolveSurface(rule, payload);
        }

        if (typeof rule.audioId !== "string") return null;
        const options = {};
        if (typeof rule.volume === "number") options.volume = rule.volume;
        return { audioId: rule.audioId, options };
    }

    #resolveSurface(rule, payload) {
        const source = payload?.source;
        let surfaceType = null;
        if (this._surfaceProvider && source?.root?.position) {
            surfaceType = this._surfaceProvider.queryAt(
                source.root.position.x ?? 0,
                source.root.position.y ?? 0
            );
        }
        const entry = surfaceType ? rule.bySurface?.[surfaceType] : null;
        const fallbackId = typeof rule.fallback === "string" ? rule.fallback : null;
        const resolved = entry ?? (fallbackId ? { audioId: fallbackId } : null);
        if (!resolved || typeof resolved.audioId !== "string") return null;
        const options = {};
        if (typeof resolved.volume === "number") options.volume = resolved.volume;
        return { audioId: resolved.audioId, options };
    }
}
