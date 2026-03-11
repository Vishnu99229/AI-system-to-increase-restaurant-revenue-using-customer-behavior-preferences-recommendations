export interface Item {
    id: number;
    name: string;
    description?: string;
    price: string;
    originalPrice?: string;
    discountedPrice?: string;
    popular: boolean;
    category: string;
    pairsWith?: string[]; // Legacy, kept for compatibility
}

export interface Recommendation {
    item: Item;
    reason: string;
    candidate_pool_size?: number;
}

// --- Config ---

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:3001";

/**
 * Sends the full candidate list + cart to the backend for GPT ranking.
 * The backend handles all filtering (exclude cart items, shuffle, slice to 10).
 * This is the ONLY source of candidate generation in the system.
 */
export async function rankCandidatesAI(
    allMenuItems: Item[],
    cartItems: Item[]
): Promise<Recommendation | null> {
    try {
        console.log("RANK API TRIGGERED");
        const response = await fetch(`${API_BASE}/api/rank-upsell`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                candidates: allMenuItems,
                cartItems
            })
        });

        if (!response.ok) {
            throw new Error("Ranking request failed");
        }

        const data = await response.json();

        return {
            item: data.item,
            reason: data.reason,
            candidate_pool_size: data.candidate_pool_size
        };

    } catch (error) {
        console.error("AI ranking failed:", error);
        return null;
    }
}
