/*
- 语义事件 type → audioId 翻译层（表驱动，配置见 Data/Audio/sfx_map.json）
- 职责划分（plans/26.11.3 声音系统事件驱动改造计划.MD）：动画事件报告动作时机，
  游戏逻辑报告实际结果，音频系统负责把结果翻译成具体音效
- resolve(type, payload) → { audioId, options } | null
  - null = 静默忽略（map 未收录的 type，如 throw_draw/throw_release 等非音频事件）
- mode:
  - "direct"（缺省）：type → audioId 直映射
  - "surface"：按 payload.source 落脚点查询 SurfaceType，再查 bySurface 表；查不到走 fallback
  - "impact"：战斗碰撞事件（combat_impact）条件规则匹配——rules 顺序匹配（when 声明的
    字段与 context 全等即命中），未命中按 interaction 查 fallbacks 表，再未命中静默
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

        if (rule.mode === "impact") {
            return this.#resolveImpact(rule, payload?.context ?? {});
        }

        if (typeof rule.audioId !== "string") return null;
        const options = {};
        if (typeof rule.volume === "number") options.volume = rule.volume;
        return { audioId: rule.audioId, options, interruptible: rule.interruptible === true };
    }

    /**
     * impact 模式解析（combat_impact 规则集，plans/26.11.3 声音材质映射细分计划 §2）：
     * 1. rules 顺序匹配——when 里声明的每个 key 与 context 对应值全等才算命中
     *    （context 里有而 when 没声明的字段不参与匹配 → 部分匹配，不做维度全排列）
     * 2. 无规则命中 → fallbacks[interaction]（各碰撞结果的基础音效）
     * 3. interaction 也无 fallback → null 静默
     */
    #resolveImpact(rule, context) {
        for (const entry of rule.rules ?? []) {
            const when = entry?.when ?? {};
            const keys = Object.keys(when);
            if (keys.length === 0) continue;  // 空条件视为配置错误，跳过
            if (keys.every((key) => context[key] === when[key])) {
                return this.#entryToResult(entry);
            }
        }
        const fallbackId = rule.fallbacks?.[context.interaction];
        return fallbackId ? this.#entryToResult({ audioId: fallbackId }) : null;
    }

    #entryToResult(entry) {
        if (!entry || typeof entry.audioId !== "string") return null;
        const options = {};
        if (typeof entry.volume === "number") options.volume = entry.volume;
        return { audioId: entry.audioId, options, interruptible: entry.interruptible === true };
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
        return { audioId: resolved.audioId, options, interruptible: resolved.interruptible === true };
    }
}
