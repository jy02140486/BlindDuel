const _cache = new Map();
const _hardcoded = new Map();

export function registerScene(id, def) {
    _hardcoded.set(id, def);
}

export function getSceneDefSync(id) {
    return _hardcoded.get(id) ?? _cache.get(id);
}

export async function resolveSceneDef(id) {
    if (_hardcoded.has(id)) return _hardcoded.get(id);
    if (_cache.has(id)) return _cache.get(id);
    const res = await fetch(`Data/SceneDefs/${id}.json`);
    if (!res.ok) throw new Error(`[SceneDefRegistry] Failed to load scene "${id}": HTTP ${res.status} ${res.statusText}`);
    const def = await res.json();
    _cache.set(id, def);
    return def;
}