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
    recommendation?: {
        name: string;
        price: string;
        description: string;
    };
}

export interface Recommendation {
    item: Item;
    reason: string;
}

export const MENU_ITEMS: Item[] = [
    // --- Hot Coffee ---
    {
        id: 1, name: "Cappuccino", description: "Fresh espresso blended with steamed milk and finished with velvety foam.",
        price: "₹180", originalPrice: "₹220", discountedPrice: "₹180", popular: true, category: "Hot Coffee",
        recommendation: { name: "Croissant", price: "₹150", description: "A buttery croissant complements your cappuccino with balanced texture and warmth." }
    },
    {
        id: 2, name: "Latte", description: "Smooth espresso gently mixed with steamed milk for a creamy finish.",
        price: "₹200", originalPrice: "₹250", discountedPrice: "₹200", popular: true, category: "Hot Coffee",
        recommendation: { name: "Banana Cake", price: "₹180", description: "The subtle sweetness of banana cake pairs perfectly with a creamy latte." }
    },
    {
        id: 3, name: "Americano", description: "Rich espresso diluted with hot water, offering a bold and robust flavor.",
        price: "₹150", popular: false, category: "Hot Coffee",
        recommendation: { name: "Brownie", price: "₹120", description: "A rich brownie balances the bold intensity of a classic Americano." }
    },
    {
        id: 4, name: "Filter Coffee", description: "Traditional South Indian style coffee, brewed strong and mixed with frothy milk.",
        price: "₹120", popular: true, category: "Hot Coffee",
        recommendation: { name: "Paneer Sandwich", price: "₹220", description: "A classic pair of savory paneer perfectly complementing strong filter coffee." }
    },
    // --- Cold Coffee ---
    {
        id: 5, name: "Cold Brew", description: "Slow-steeped over 18 hours for a remarkably smooth, low-acidity flavor profile.",
        price: "₹220", popular: true, category: "Cold Coffee",
        recommendation: { name: "Brownie", price: "₹120", description: "The deep notes of cold brew work beautifully with a fudgy brownie." }
    },
    {
        id: 6, name: "Iced Latte", description: "Chilled espresso poured over ice and milk for a refreshing pick-me-up.",
        price: "₹200", popular: false, category: "Cold Coffee",
        recommendation: { name: "Chicken Wrap", price: "₹250", description: "A savory chicken wrap provides a great contrast to a cool iced latte." }
    },
    {
        id: 7, name: "Frappe", description: "Blended ice coffee, sweet and creamy, for an indulgent treat.",
        price: "₹250", originalPrice: "₹300", discountedPrice: "₹250", popular: false, category: "Cold Coffee",
        recommendation: { name: "Chocolate Croissant", price: "₹170", description: "Enhance your sweet frappe with a flaky, buttery chocolate croissant." }
    },
    // --- Non Coffee ---
    {
        id: 8, name: "Matcha Latte", description: "Finely ground premium green tea leaves, whisked with steamed, velvety milk.",
        price: "₹220", popular: false, category: "Non Coffee",
        recommendation: { name: "Croissant", price: "₹150", description: "The earthy tones of matcha are lifted by a light, buttery croissant." }
    },
    {
        id: 9, name: "Hot Chocolate", description: "Rich, melted chocolate combined with hot milk for the ultimate comforting drink.",
        price: "₹200", popular: true, category: "Non Coffee",
        recommendation: { name: "Brownie", price: "₹120", description: "Double the chocolate experience with a rich, soft brownie." }
    },
    // --- Bakery ---
    {
        id: 10, name: "Croissant", description: "Classic French pastry with flaky, golden layers and a rich buttery taste.",
        price: "₹150", popular: true, category: "Bakery",
        recommendation: { name: "Cappuccino", price: "₹180", description: "A classic warm cappuccino perfectly balances the buttery layers of a croissant." }
    },
    {
        id: 11, name: "Chocolate Croissant", description: "Flaky pastry filled with premium dark chocolate batons, baked to perfection.",
        price: "₹170", popular: false, category: "Bakery",
        recommendation: { name: "Cold Brew", price: "₹220", description: "A smooth cold brew cuts nicely through the richness of a chocolate croissant." }
    },
    {
        id: 12, name: "Brownie", description: "Dense and fudgy chocolate square with a perfect crinkly top.",
        price: "₹120", popular: true, category: "Bakery",
        recommendation: { name: "Americano", price: "₹150", description: "A bold Americano beautifully balances the sweetness of a fudgy brownie." }
    },
    {
        id: 13, name: "Banana Cake", description: "Moist and tender cake baked with ripe bananas and a hint of cinnamon.",
        price: "₹180", originalPrice: "₹220", discountedPrice: "₹180", popular: false, category: "Bakery",
        recommendation: { name: "Latte", price: "₹200", description: "A creamy latte adds the perfect warmth to our soft banana cake." }
    },
    // --- Savory ---
    {
        id: 14, name: "Paneer Sandwich", description: "Grilled artisan bread stuffed with spiced paneer, fresh veggies, and mint chutney.",
        price: "₹220", popular: true, category: "Savory",
        recommendation: { name: "Filter Coffee", price: "₹120", description: "A strong filter coffee is the perfect companion to a spiced paneer sandwich." }
    },
    {
        id: 15, name: "Chicken Wrap", description: "Tender grilled chicken and fresh greens rolled in a warm, toasted tortilla.",
        price: "₹250", originalPrice: "₹300", discountedPrice: "₹250", popular: false, category: "Savory",
        recommendation: { name: "Iced Latte", price: "₹200", description: "A cool iced latte cleanses the palate after a flavorful chicken wrap." }
    },
];

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
    cartItems: Item[] = []
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
        return MENU_ITEMS.filter(candidate => {
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
    _allItems: Item[] // unused but kept for signature
): Promise<Recommendation> {
    const rec = getDeterministicUpsell(viewedItem, []);

    if (rec) return rec;

    // Fallback if no specific rule matches (e.g. price constraint too strict)
    // Return a 'Safe' fallback like Brownie if valid, strictly excluding self
    const fallback = MENU_ITEMS.find(i => i.id !== viewedItem.id && i.category === 'Bakery' && getPrice(i.price) < getPrice(viewedItem.price));

    if (fallback) {
        return { item: fallback, reason: "A classic pairing." };
    }

    throw new Error("No recommendation available");
}

export function getCheckoutUpsellCandidates(
    cartItems: Item[],
    _viewedItems: Item[]
): Item[] {
    // Only used for checkout upsell logic - implement simplified logic
    if (cartItems.length === 0) return [];

    // Find cheap add-ons (under 150) that are not in cart
    const cartIds = new Set(cartItems.map(i => i.id));
    return MENU_ITEMS
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
    viewedItems: Item[]
): Promise<Recommendation | null> {
    const candidates = getCheckoutUpsellCandidates(cartItems, viewedItems);
    if (candidates.length === 0) return null;
    return await rankCandidatesAI(userName, cartItems, candidates);
}
