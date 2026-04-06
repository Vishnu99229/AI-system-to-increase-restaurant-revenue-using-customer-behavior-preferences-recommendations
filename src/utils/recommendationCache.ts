import type { Item, Recommendation } from "./recommendations";
import { rankCandidatesAI } from "./recommendations";

/**
 * In-memory recommendation cache with TTL.
 * Prevents duplicate API calls and enables instant modal opens.
 *
 * Cache key: item ID
 * Cache value: { data: Recommendation, timestamp: number }
 * TTL: 5 minutes
 */

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

interface CacheEntry {
    data: Recommendation;
    timestamp: number;
}

// Singleton cache — persists across component renders within the same session
const cache = new Map<number, CacheEntry>();

// Track in-flight requests to prevent duplicate API calls
const pendingRequests = new Map<number, Promise<Recommendation | null>>();

/**
 * Get a cached recommendation for an item, or null if expired/missing.
 */
export function getCachedRecommendation(itemId: number): Recommendation | null {
    const entry = cache.get(itemId);
    if (!entry) return null;

    if (Date.now() - entry.timestamp > CACHE_TTL) {
        cache.delete(itemId);
        return null;
    }

    return entry.data;
}

/**
 * Store a recommendation in the cache.
 */
export function setCachedRecommendation(itemId: number, rec: Recommendation): void {
    cache.set(itemId, { data: rec, timestamp: Date.now() });
}

/**
 * Fetch a recommendation for a single item, using cache if available.
 * Deduplicates in-flight requests.
 */
export async function fetchRecommendationCached(
    itemId: number,
    allMenuItems: Item[],
    cartItems: Item[]
): Promise<Recommendation | null> {
    // Check cache first
    const cached = getCachedRecommendation(itemId);
    if (cached) return cached;

    // Check if there's already an in-flight request for this item
    const pending = pendingRequests.get(itemId);
    if (pending) return pending;

    // Create new request
    const request = rankCandidatesAI(allMenuItems, cartItems)
        .then(rec => {
            if (rec) {
                setCachedRecommendation(itemId, rec);
            }
            pendingRequests.delete(itemId);
            return rec;
        })
        .catch(err => {
            pendingRequests.delete(itemId);
            console.error(`[recCache] Failed to fetch recommendation for item ${itemId}:`, err);
            return null;
        });

    pendingRequests.set(itemId, request);
    return request;
}

/**
 * Prefetch recommendations for visible items in the background.
 * Fires requests in parallel but with a slight stagger to avoid stampede.
 * Only prefetches items not already cached.
 */
export function prefetchRecommendations(
    visibleItems: Item[],
    allMenuItems: Item[],
    cartItems: Item[]
): void {
    // Only prefetch first 6 items (above the fold)
    const itemsToPrefetch = visibleItems.slice(0, 6);

    itemsToPrefetch.forEach((item, index) => {
        // Skip if already cached or in-flight
        if (getCachedRecommendation(item.id) || pendingRequests.has(item.id)) return;

        // Stagger requests by 200ms each to avoid API stampede
        setTimeout(() => {
            fetchRecommendationCached(item.id, allMenuItems, [item, ...cartItems]);
        }, index * 200);
    });
}

/**
 * Clear the entire cache (useful on session reset).
 */
export function clearRecommendationCache(): void {
    cache.clear();
    pendingRequests.clear();
}
