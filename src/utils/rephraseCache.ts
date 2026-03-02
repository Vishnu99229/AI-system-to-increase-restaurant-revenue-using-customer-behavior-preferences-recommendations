/**
 * Session-level in-memory cache for GPT-rephrased upsell reasons.
 * Keyed by baseItem name — ensures only ONE GPT call per base item per session.
 */

const cache = new Map<string, string>();

export function getCachedReason(baseItem: string): string | null {
    return cache.get(baseItem) ?? null;
}

export function setCachedReason(baseItem: string, reason: string): void {
    cache.set(baseItem, reason);
}
