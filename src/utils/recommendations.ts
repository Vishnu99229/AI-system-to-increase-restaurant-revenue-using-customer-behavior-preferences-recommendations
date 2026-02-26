export interface Item {
    id: number;
    name: string;
    description?: string;
    price: string;
    originalPrice?: string;
    discountedPrice?: string;
    popular: boolean;
    category: string;
    pairsWith?: string[]; // Legacy, kept for compatibility but not used in strict logic
}

export interface Recommendation {
    item: Item;
    reason: string;
}

// --- Deterministic Logic ---

const getPrice = (p: string) => parseFloat(p.replace(/[^0-9.]/g, "")) || 0;

// Logic Categories
type LogicCategory = 'Beverage' | 'Main' | 'Side' | 'Dessert';

const CATEGORY_MAP: Record<string, LogicCategory> = {
    'Hot Coffee': 'Beverage',
    'Cold Coffee': 'Beverage',
    'Non Coffee': 'Beverage',
    'Savory': 'Main',
    'Bakery': 'Side', // Bakery acts as Side/Dessert
};

const PAIRING_RULES: Record<LogicCategory, LogicCategory[]> = {
    'Beverage': ['Side', 'Main'], // Bev -> suggest Side (Bakery) first, then Main
    'Main': ['Beverage', 'Side'], // Main -> suggest Beverage first, then Side
    'Side': ['Beverage'],         // Side -> suggest Beverage
    'Dessert': ['Beverage'],      // Dessert -> suggest Beverage
};

function getLogicCategory(item: Item): LogicCategory {
    return CATEGORY_MAP[item.category] || 'Side';
}

/**
 * Returns a strictly deterministic recommendation based on rules.
 * Rules:
 * 1. Category Mapping: (Beverage -> Side, Main -> Beverage, etc.)
 * 2. Price Constraint: Upsell price strictly between 20% and 60% of base item price.
 * 3. Not in Cart: Exclude items already in cart/viewed.
 * 4. Ranking: Popular first, then Highest Price (Revenue Optimization).
 */
export function getDeterministicUpsell(
    baseItem: Item,
    cartItems: Item[] = [],
    allItems: Item[] = []
): Recommendation | null {
    const baseCategory = getLogicCategory(baseItem);
    const targetCategories = PAIRING_RULES[baseCategory];
    const basePrice = getPrice(baseItem.price);

    const cartIds = new Set(cartItems.map(i => i.id));

    // Pass 1: Strict Price Guard (20% to 60%)
    const minPrice = basePrice * 0.20;
    const strictMaxPrice = basePrice * 0.60;
    const relaxedMaxPrice = basePrice * 1.0; // Relaxed to 100% of base price if strict fails

    const getCandidates = (maxPrice: number) => {
        return allItems.filter(candidate => {
            if (candidate.id === baseItem.id || cartIds.has(candidate.id)) return false;

            const candidateLogCat = getLogicCategory(candidate);
            if (!targetCategories.includes(candidateLogCat)) return false;

            const price = getPrice(candidate.price);
            return price >= minPrice && price <= maxPrice;
        });
    };

    let candidates = getCandidates(strictMaxPrice);

    if (candidates.length === 0) {
        // Fallback: Relax price constraint to 100% of base item
        // Necessary because for a 150 item, 60% is 90, and we have no items < 90.
        // This ensures we at least satisfy the category rule.
        candidates = getCandidates(relaxedMaxPrice);
    }

    if (candidates.length === 0) {
        return null;
    }

    // Sort Candidates
    // 1. Category Priority (First target category > Second)
    // 2. Popularity (True > False)
    // 3. Price (Highest First -> optimize revenue)
    candidates.sort((a, b) => {
        const catAIndex = targetCategories.indexOf(getLogicCategory(a));
        const catBIndex = targetCategories.indexOf(getLogicCategory(b));
        if (catAIndex !== catBIndex) return catAIndex - catBIndex; // Lower index is better

        if (a.popular !== b.popular) return a.popular ? -1 : 1; // Popular first

        return getPrice(b.price) - getPrice(a.price); // Higher price first
    });

    const selected = candidates[0];

    // Deterministic Reason
    const reason = `Perfectly pairs with your ${baseItem.name}.`;

    return { item: selected, reason };
}

// --- Legacy Adapters (kept to avoid breaking call sites) ---

export async function getRecommendations(
    viewedItem: Item,
    allItems: Item[]
): Promise<Recommendation> {
    const rec = getDeterministicUpsell(viewedItem, [], allItems);

    if (rec) return rec;

    // Fallback if no specific rule matches (e.g. price constraint too strict)
    // Return a 'Safe' fallback like Brownie if valid, strictly excluding self
    const fallback = allItems.find(i => i.id !== viewedItem.id && i.category === 'Bakery' && getPrice(i.price) < getPrice(viewedItem.price));

    if (fallback) {
        return { item: fallback, reason: "A classic pairing." };
    }

    throw new Error("No recommendation available");
}

export function getCheckoutUpsellCandidates(
    cartItems: Item[],
    _viewedItems: Item[],
    allItems: Item[] = []
): Item[] {
    // Only used for checkout upsell logic - implement simplified logic
    if (cartItems.length === 0) return [];

    // Find cheap add-ons (under 150) that are not in cart
    const cartIds = new Set(cartItems.map(i => i.id));
    return allItems
        .filter(i => !cartIds.has(i.id) && getPrice(i.price) <= 150 && i.popular)
        .slice(0, 3);
}

export async function rankCandidatesAI(
    _userName: string,
    _cartItems: Item[],
    approvedCandidates: Item[]
): Promise<Recommendation | null> {
    if (approvedCandidates.length === 0) return null;
    return { item: approvedCandidates[0], reason: "Last minute treat?" };
}

export async function getCheckoutUpsell(
    userName: string,
    cartItems: Item[],
    viewedItems: Item[],
    allItems: Item[] = []
): Promise<Recommendation | null> {
    const candidates = getCheckoutUpsellCandidates(cartItems, viewedItems, allItems);
    if (candidates.length === 0) return null;
    return await rankCandidatesAI(userName, cartItems, candidates);
}
