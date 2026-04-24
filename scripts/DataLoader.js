async function loadJson(url) {
    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`Failed to load JSON: ${url}`);
    }
    return res.json();
}

async function resolveManifestNode(node) {
    if (typeof node === "string") {
        return loadJson(node);
    }

    if (Array.isArray(node)) {
        return Promise.all(node.map(resolveManifestNode));
    }

    if (node && typeof node === "object") {
        const entries = Object.entries(node);
        const resolvedEntries = await Promise.all(
            entries.map(async ([key, value]) => [key, await resolveManifestNode(value)])
        );
        return Object.fromEntries(resolvedEntries);
    }

    return node;
}

export async function loadDataAssets(manifest) {
    return resolveManifestNode(manifest);
}
