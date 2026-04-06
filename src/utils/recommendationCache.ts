import type { Item } from "./recommendations";

interface CachedRec {
    item: Item;
    reason: string;
    candidate_pool_size?: number;
}

const cache = new Map<number, CachedRec>();
const inflight = new Map<number, Promise<CachedRec | null>>();

export async function getCachedRecommendation(
    itemId: number,
    fetchFn: () => Promise<CachedRec | null>
): Promise<CachedRec | null> {
    if (cache.has(itemId)) return cache.get(itemId) || null;
    if (inflight.has(itemId)) return inflight.get(itemId) || null;

    const promise = fetchFn().then(rec => {
        if (rec) cache.set(itemId, rec);
        inflight.delete(itemId);
        return rec;
    }).catch(err => {
        inflight.delete(itemId);
        console.error("[recCache] fetch failed:", err);
        return null;
    });

    inflight.set(itemId, promise);
    return promise;
}

export function setCachedRecommendation(itemId: number, rec: CachedRec) {
    cache.set(itemId, rec);
}

export function getCachedRecSync(itemId: number): CachedRec | null {
    return cache.get(itemId) || null;
}

export function clearRecommendationCache() {
    cache.clear();
    inflight.clear();
}
