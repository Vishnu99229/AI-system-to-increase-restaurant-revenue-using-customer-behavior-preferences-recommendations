export interface Item {
    id: number;
    name: string;
    price: string;
    popular: boolean;
    category: string;
    pairsWith?: string[]; // categories this item pairs well with
}

export interface Recommendation {
    item: Item;
    reason: string;
}

export const MENU_ITEMS: Item[] = [
    // --- Hot Coffee ---
    {
        id: 1,
        name: "Cappuccino",
        price: "₹180",
        popular: true,
        category: "Hot Coffee",
        pairsWith: ["Bakery", "Savory"],
    },
    {
        id: 2,
        name: "Latte",
        price: "₹200",
        popular: true,
        category: "Hot Coffee",
        pairsWith: ["Bakery"],
    },
    {
        id: 3,
        name: "Americano",
        price: "₹150",
        popular: false,
        category: "Hot Coffee",
        pairsWith: ["Bakery"],
    },
    {
        id: 4,
        name: "Filter Coffee",
        price: "₹120",
        popular: true,
        category: "Hot Coffee",
        pairsWith: ["Bakery", "Savory"],
    },
    // --- Cold Coffee ---
    {
        id: 5,
        name: "Cold Brew",
        price: "₹220",
        popular: true,
        category: "Cold Coffee",
        pairsWith: ["Bakery"],
    },
    {
        id: 6,
        name: "Iced Latte",
        price: "₹200",
        popular: false,
        category: "Cold Coffee",
        pairsWith: ["Bakery", "Savory"],
    },
    {
        id: 7,
        name: "Frappe",
        price: "₹250",
        popular: false,
        category: "Cold Coffee",
        pairsWith: ["Bakery"],
    },
    // --- Non Coffee ---
    {
        id: 8,
        name: "Matcha Latte",
        price: "₹220",
        popular: false,
        category: "Non Coffee",
        pairsWith: ["Bakery"],
    },
    {
        id: 9,
        name: "Hot Chocolate",
        price: "₹200",
        popular: true,
        category: "Non Coffee",
        pairsWith: ["Bakery"],
    },
    // --- Bakery ---
    {
        id: 10,
        name: "Croissant",
        price: "₹150",
        popular: true,
        category: "Bakery",
        pairsWith: ["Hot Coffee", "Cold Coffee"],
    },
    {
        id: 11,
        name: "Chocolate Croissant",
        price: "₹170",
        popular: false,
        category: "Bakery",
        pairsWith: ["Hot Coffee"],
    },
    {
        id: 12,
        name: "Brownie",
        price: "₹120",
        popular: true,
        category: "Bakery",
        pairsWith: ["Cold Coffee", "Non Coffee"],
    },
    {
        id: 13,
        name: "Banana Cake",
        price: "₹180",
        popular: false,
        category: "Bakery",
        pairsWith: ["Hot Coffee", "Cold Coffee"],
    },
    // --- Savory ---
    {
        id: 14,
        name: "Paneer Sandwich",
        price: "₹220",
        popular: true,
        category: "Savory",
        pairsWith: ["Cold Coffee", "Hot Coffee"],
    },
    {
        id: 15,
        name: "Chicken Wrap",
        price: "₹250",
        popular: false,
        category: "Savory",
        pairsWith: ["Cold Coffee", "Hot Coffee"],
    },
];

/**
 * Step 1: Deterministic Candidate Selection
 * Excludes the current item and selects up to 3 other items.
 */
export function getDeterministicCandidates(currentItem: Item, allItems: Item[]): Item[] {
    // Filter out the current item
    const candidates = allItems.filter(item => item.id !== currentItem.id);

    // Select up to 3 items. For now, we take the top 3 from the filtered list.
    return candidates.slice(0, 3);
}

/**
 * Step 2: Deterministic Candidate Selection for Checkout
 * Identifies items not in cart that pass a confidence threshold.
 */
export function getCheckoutUpsellCandidates(
    cartItems: Item[],
    viewedItems: Item[]
): Item[] {
    const cartIds = new Set(cartItems.map(i => i.id));
    const candidates = MENU_ITEMS.filter(item => !cartIds.has(item.id));

    if (candidates.length === 0) return [];

    const getPrice = (p: string) => parseFloat(p.replace(/[^0-9.]/g, "")) || 0;
    const cartTotal = cartItems.reduce((sum, item) => sum + getPrice(item.price), 0);

    const approvedCandidates: { item: Item, score: number }[] = [];

    candidates.forEach(candidate => {
        let score = 0;

        // Rule 1: Pairs with any cart item (+0.4)
        const pairsWithCart = cartItems.some(cartItem =>
            candidate.pairsWith?.includes(cartItem.category) ||
            cartItem.pairsWith?.includes(candidate.category)
        );
        if (pairsWithCart) score += 0.4;

        // Rule 2: Price <= 30% of cart total (+0.2)
        const price = getPrice(candidate.price);
        if (cartTotal > 0 && price <= (cartTotal * 0.30)) {
            score += 0.2;
        }

        // Rule 3: Popular (+0.2)
        if (candidate.popular) score += 0.2;

        // Rule 4: Category matches viewed items (+0.2)
        const categoryMatch = viewedItems.some(v => v.category === candidate.category);
        if (categoryMatch) score += 0.2;

        if (score >= 0.75) {
            approvedCandidates.push({ item: candidate, score });
        }
    });

    // Return items sorted by score desc
    return approvedCandidates
        .sort((a, b) => b.score - a.score)
        .map(c => c.item);
}

/**
 * Step 3: AI Ranking and Reason Generation
 * Ranks approved candidates and generates a short reason.
 */
export async function rankCandidatesAI(
    userName: string,
    cartItems: Item[],
    approvedCandidates: Item[]
): Promise<Recommendation | null> {
    if (approvedCandidates.length === 0) return null;

    const cartNames = cartItems.map(i => i.name).join(", ");
    const candidateList = approvedCandidates.map(c => `${c.id}: ${c.name} (${c.category})`).join("\n");

    const systemPrompt = `You are a helpful waiter. Rank these upsell candidates for ${userName} who is ordering ${cartNames}. Pick the best one and explain why in <15 words.
    Return ONLY JSON: { "selectedItemId": number, "reason": string }`;

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000);

        const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model: "gpt-3.5-turbo",
                messages: [
                    { role: "system", content: "Output valid JSON only." },
                    { role: "user", content: `Candidates:\n${candidateList}\n\nTask: ${systemPrompt}` }
                ],
                temperature: 0.5,
                max_tokens: 100,
            }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) throw new Error(`AI API error: ${response.status}`);

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;
        if (!content) throw new Error("No content from AI");

        const parsed = JSON.parse(content);
        const selectedItem = approvedCandidates.find(c => c.id === parsed.selectedItemId) || approvedCandidates[0];

        return {
            item: selectedItem,
            reason: parsed.reason || "Perfect addition to your order."
        };

    } catch (error) {
        console.warn("[Dev] AI Ranking failed, falling back to deterministic:", error);
        return {
            item: approvedCandidates[0],
            reason: "Perfect addition to your order."
        };
    }
}

/**
 * Orchestrator for Checkout Upsell
 * MAINTAINED for compatibility, but recommend calling gates separately in UI.
 */
export async function getCheckoutUpsell(
    userName: string,
    cartItems: Item[],
    viewedItems: Item[]
): Promise<Recommendation | null> {
    const approved = getCheckoutUpsellCandidates(cartItems, viewedItems);
    if (approved.length === 0) return null;

    return await rankCandidatesAI(userName, cartItems, approved);
}


export async function getAIRecommendation(
    viewedItem: Item,
    candidates: Item[]
): Promise<Recommendation> {
    return new Promise((resolve, reject) => {
        // Simulate network delay (longer to show loading state if we want, but keeping it snappy for demo)
        setTimeout(() => {
            // Simulate 10% failure rate to test fallback
            if (Math.random() < 0.1) {
                // reject(new Error("AI Service Timeout")); 
                // Kept low for now to avoid annoyance during demo
            }

            // Mock reasoning logic
            const candidate = candidates[0]; // Just pick the first one for the mock
            if (!candidate) {
                reject(new Error("No candidates available"));
                return;
            }

            // Dynamic mock reason based on inputs
            const reasons = [
                `The ${candidate.name} provides a classic flavor match for the ${viewedItem.name}.`,
                `Enhance the culinary experience of ${viewedItem.name} with ${candidate.name}.`,
                `The ${candidate.name} creates a perfectly balanced pairing with ${viewedItem.name}.`
            ];
            const randomReason = reasons[Math.floor(Math.random() * reasons.length)];

            resolve({
                item: candidate,
                reason: randomReason
            });

        }, 1500); // 1.5s delay to feel like "thinking"
    });
}

/**
 * Main Orchestrator
 */
export async function getRecommendations(
    viewedItem: Item,
    allItems: Item[]
): Promise<Recommendation> {

    // 1. Get Candidates
    const candidates = getDeterministicCandidates(viewedItem, allItems);

    if (candidates.length === 0) {
        // Edge case: no other items
        throw new Error("No recommendations available");
    }

    // 2. Try AI Recommendation
    try {
        // We could verify timeout here over the promise if needed, 
        // but let's assume getAIRecommendation handles its internal timeout or we wrap it.
        const result = await getAIRecommendation(viewedItem, candidates);
        return result;
    } catch (error) {
        console.warn("AI Recommendation failed, falling back to deterministic:", error);

        // 3. Fallback: Deterministic
        // Just return the first candidate with a generic reason
        return {
            item: candidates[0],
            reason: `A chef-selected pairing known for its balanced flavor profile.`
        };
    }
}
