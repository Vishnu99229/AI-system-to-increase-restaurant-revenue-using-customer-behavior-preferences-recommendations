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
}

// --- Helpers ---

const getPrice = (p: string) => parseFloat(p.replace(/[^0-9.]/g, "")) || 0;

// --- Fully Data-Driven Category Pairing ---

/**
 * Keyword-based complementary category matching.
 * Keys are lowercase substrings matched against the item's category.
 * Values are arrays of lowercase substrings that define complementary categories.
 * This supports arbitrary restaurant menus without hardcoding specific category names.
 */
const COMPLEMENTARY_KEYWORDS: [string, string[]][] = [
    // Mains → suggest drinks and sides
    ['pizza', ['beverage', 'drink', 'side', 'dessert', 'bakery']],
    ['pasta', ['beverage', 'drink', 'side', 'dessert']],
    ['burger', ['beverage', 'drink', 'side', 'fries']],
    ['sandwich', ['beverage', 'drink', 'coffee', 'side']],
    ['wrap', ['beverage', 'drink', 'coffee', 'side']],
    ['main', ['beverage', 'drink', 'side', 'dessert']],
    ['savory', ['beverage', 'drink', 'coffee', 'side']],
    ['entree', ['beverage', 'drink', 'side', 'dessert']],
    // Drinks → suggest food
    ['coffee', ['bakery', 'side', 'dessert', 'sandwich', 'savory']],
    ['beverage', ['bakery', 'side', 'dessert', 'pizza', 'pasta', 'sandwich']],
    ['drink', ['bakery', 'side', 'dessert', 'pizza', 'pasta']],
    ['tea', ['bakery', 'side', 'dessert']],
    ['juice', ['bakery', 'side', 'sandwich']],
    ['shake', ['bakery', 'side', 'dessert']],
    // Sides → suggest drinks
    ['side', ['beverage', 'drink', 'coffee', 'juice']],
    ['bakery', ['coffee', 'beverage', 'drink', 'tea']],
    ['fries', ['beverage', 'drink', 'shake']],
    // Desserts → suggest drinks
    ['dessert', ['coffee', 'beverage', 'drink', 'tea']],
    ['sweet', ['coffee', 'beverage', 'drink']],
    ['cake', ['coffee', 'beverage', 'tea']],
];

/**
 * Returns whether a category (needle) matches any keyword in the list.
 * Case-insensitive substring match.
 */
function categoryMatchesKeywords(category: string, keywords: string[]): boolean {
    const lower = category.toLowerCase();
    return keywords.some(kw => lower.includes(kw));
}

/**
 * Finds complementary categories for a given item category from the available items.
 * Returns category strings from allItems that are considered complementary.
 */
function getComplementaryCategories(itemCategory: string, allCategories: string[]): string[] {
    const lowerCat = itemCategory.toLowerCase();

    // Find matching pairing rule
    for (const [keyword, complements] of COMPLEMENTARY_KEYWORDS) {
        if (lowerCat.includes(keyword)) {
            // Return all categories from the menu that match any complement keyword
            return allCategories.filter(cat =>
                cat.toLowerCase() !== lowerCat &&
                categoryMatchesKeywords(cat, complements)
            );
        }
    }

    // Fallback: return all categories that are different from the base item's category
    return allCategories.filter(cat => cat.toLowerCase() !== lowerCat);
}

// --- Core Recommendation Engine ---

/**
 * Returns a data-driven recommendation based on category pairing.
 * Works for any restaurant with arbitrary menu categories.
 *
 * Logic:
 * 1. Find complementary categories for the base item
 * 2. Filter to items not already in cart and not the same item
 * 3. Sort by: price ascending (affordable add-on first)
 * 4. Return top candidate
 */
export function getDeterministicUpsell(
    baseItem: Item,
    cartItems: Item[] = [],
    allItems: Item[] = []
): Recommendation | null {
    if (allItems.length <= 1) return null;

    const cartIds = new Set(cartItems.map(i => i.id));
    const allCategories = [...new Set(allItems.map(i => i.category))];
    const complementaryCategories = getComplementaryCategories(baseItem.category, allCategories);

    // Filter candidates: different item, not in cart, in a complementary category
    let candidates = allItems.filter(candidate => {
        if (candidate.id === baseItem.id) return false;
        if (cartIds.has(candidate.id)) return false;
        return complementaryCategories.some(cc =>
            cc.toLowerCase() === candidate.category.toLowerCase()
        );
    });

    // If no complementary category matches, fall back to any different category
    if (candidates.length === 0) {
        candidates = allItems.filter(candidate => {
            if (candidate.id === baseItem.id) return false;
            if (cartIds.has(candidate.id)) return false;
            return candidate.category.toLowerCase() !== baseItem.category.toLowerCase();
        });
    }

    // Last resort: any item that isn't the same one or in cart
    if (candidates.length === 0) {
        candidates = allItems.filter(candidate =>
            candidate.id !== baseItem.id && !cartIds.has(candidate.id)
        );
    }

    if (candidates.length === 0) return null;

    // Sort: cheapest first (affordable upsell), then alphabetical for stability
    candidates.sort((a, b) => {
        const priceDiff = getPrice(a.price) - getPrice(b.price);
        if (priceDiff !== 0) return priceDiff;
        return a.name.localeCompare(b.name);
    });

    const selected = candidates[0];
    const reason = `Pairs great with your ${baseItem.name}.`;

    return { item: selected, reason };
}

// --- Checkout Upsell ---

/**
 * Returns up to 3 candidate items for checkout upsell.
 * Filters to items from a different category, not in cart, cheapest first.
 */
export function getCheckoutUpsellCandidates(
    cartItems: Item[],
    _viewedItems: Item[],
    allItems: Item[] = []
): Item[] {
    if (cartItems.length === 0 || allItems.length === 0) return [];

    const cartIds = new Set(cartItems.map(i => i.id));
    const cartCategories = new Set(cartItems.map(i => i.category.toLowerCase()));

    // Find items from different categories, not in cart
    const candidates = allItems
        .filter(i => !cartIds.has(i.id) && !cartCategories.has(i.category.toLowerCase()))
        .sort((a, b) => getPrice(a.price) - getPrice(b.price))
        .slice(0, 3);

    // If no cross-category candidates, relax to any item not in cart
    if (candidates.length === 0) {
        return allItems
            .filter(i => !cartIds.has(i.id))
            .sort((a, b) => getPrice(a.price) - getPrice(b.price))
            .slice(0, 3);
    }

    return candidates;
}

export async function rankCandidatesAI(
    userName: string,
    cartItems: Item[],
    approvedCandidates: Item[]
): Promise<Recommendation | null> {
    if (!approvedCandidates.length) return null;

    try {
        const response = await fetch("/api/rank-upsell", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                userName,
                cartItems,
                candidates: approvedCandidates
            })
        });

        if (!response.ok) throw new Error("Ranking failed");

        const data = await response.json();

        if (!data?.item) throw new Error("Invalid response");

        return data;

    } catch (err) {
        console.error("AI ranking failed, falling back", err);
        return {
            item: approvedCandidates[0],
            reason: "A perfect addition to your order."
        };
    }
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

