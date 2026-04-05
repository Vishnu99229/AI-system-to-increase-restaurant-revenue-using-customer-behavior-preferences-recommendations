import { useState, useEffect, useRef } from "react";
import { fetchMenu, trackUpsellShown } from "../utils/api";
import type { Item, Recommendation } from "../utils/recommendations";
import { useApp } from "../contexts/AppContext";
import { Button } from "../components/Button";
import {
    getCachedRecommendation,
    prefetchRecommendations,
    fetchRecommendationCached,
} from "../utils/recommendationCache";

const UPSELL_HEADERS = [
    "Recommended by our chef for this order",
    "Most loved pairing by our guests",
    "A popular combination in our cafe",
    "Most paired item with this order",
    "Guests often add this with your selection",
    "One of the most ordered pairings today",
    "Our chef's favorite pairing for this item",
    "Highly recommended with your order"
];

interface MenuProps {
    onBack: () => void;
    onViewCart: () => void;
}

/**
 * MenuItemImage — lazy-loaded image with fade-in transition and fallback.
 */
function MenuItemImage({ src, alt, className = "" }: { src?: string; alt: string; className?: string }) {
    const [loaded, setLoaded] = useState(false);
    const [error, setError] = useState(false);

    if (!src || error) {
        return (
            <div className={`bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center text-gray-300 ${className}`}>
                <svg className="w-8 h-8 opacity-30" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" /></svg>
            </div>
        );
    }

    return (
        <div className={`relative overflow-hidden ${className}`}>
            {/* Placeholder shimmer while loading */}
            {!loaded && (
                <div className="absolute inset-0 bg-gradient-to-br from-gray-100 to-gray-200 animate-pulse" />
            )}
            <img
                src={src}
                alt={alt}
                loading="lazy"
                onLoad={() => setLoaded(true)}
                onError={() => setError(true)}
                className={`w-full h-full object-cover transition-opacity duration-400 ${loaded ? 'opacity-100' : 'opacity-0'}`}
            />
        </div>
    );
}

export default function Menu({ onBack, onViewCart }: MenuProps) {
    const { state, dispatch } = useApp();

    const [items, setItems] = useState<Item[]>(state.menuItems);
    const [loading, setLoading] = useState(state.menuItems.length === 0);

    const [selectedItem, setSelectedItem] = useState<Item | null>(null);
    const [quantity, setQuantity] = useState(1);
    const [showAddedToast, setShowAddedToast] = useState(false);

    // Guard: fires once per modal open, resets when modal closes
    const hasTrackedCurrentModal = useRef(false);

    // Single GPT recommendation state — shimmer while loading, final reason when resolved
    const [upsellData, setUpsellData] = useState<Recommendation | null>(null);
    const [upsellLoading, setUpsellLoading] = useState(false);
    const [upsellHeader, setUpsellHeader] = useState("");

    // Safety guard: prevent ranking being called twice for the same item
    const rankCalledFor = useRef<number | null>(null);

    // Safety guard: prevent state updates after unmount
    const isMounted = useRef(true);
    useEffect(() => {
        return () => {
            isMounted.current = false;
        };
    }, []);

    // Fetch menu on mount if not already loaded
    useEffect(() => {
        if (state.menuItems.length > 0) {
            setItems(state.menuItems);
            setLoading(false);
            return;
        }

        const slug = state.restaurantId;
        if (!slug) {
            setLoading(false);
            return;
        }

        fetchMenu(slug).then(menuItems => {
            setItems(menuItems);
            dispatch({ type: "SET_MENU_ITEMS", payload: menuItems });
            setLoading(false);
        });
    }, [state.restaurantId]); // eslint-disable-line react-hooks/exhaustive-deps

    // Prefetch recommendations when menu items are loaded
    useEffect(() => {
        if (items.length > 0) {
            prefetchRecommendations(items, items, state.cartItems);
        }
    }, [items.length]); // eslint-disable-line react-hooks/exhaustive-deps

    // When selectedItem changes: check cache first, then call API if needed
    useEffect(() => {
        // Reset upsell state whenever selection changes
        setUpsellData(null);
        setUpsellLoading(false);
        rankCalledFor.current = null;

        if (!selectedItem) return;
        if (items.length === 0) return;

        // Guard: only call ranking once per selected item
        if (rankCalledFor.current === selectedItem.id) return;
        rankCalledFor.current = selectedItem.id;

        // Check cache FIRST — instant if cached
        const cached = getCachedRecommendation(selectedItem.id);
        if (cached) {
            setUpsellData(cached);
            setUpsellHeader(UPSELL_HEADERS[Math.floor(Math.random() * UPSELL_HEADERS.length)]);
            return;
        }

        // Show shimmer immediately
        setUpsellLoading(true);
        setUpsellHeader(UPSELL_HEADERS[Math.floor(Math.random() * UPSELL_HEADERS.length)]);

        // Fetch via the cache-aware function (deduplicates in-flight requests)
        fetchRecommendationCached(selectedItem.id, items, [selectedItem, ...state.cartItems]).then(rec => {
            if (!isMounted.current) return;

            setUpsellLoading(false);

            if (!rec) {
                setUpsellData(null);
                return;
            }

            setUpsellData(rec);
        }).catch(() => {
            if (!isMounted.current) return;
            setUpsellLoading(false);
            setUpsellData(null);
        });
    }, [selectedItem?.id]); // eslint-disable-line react-hooks/exhaustive-deps

    // Track upsell shown — only fires once per modal, only after GPT resolves
    useEffect(() => {
        if (upsellData && !upsellLoading && !hasTrackedCurrentModal.current) {
            hasTrackedCurrentModal.current = true;
            trackUpsellShown({
                restaurant_slug: state.restaurantId,
                table_number: state.tableNumber || "",
                item_id: upsellData.item.id,
                cart_value: 0, // In menu up-sell we could compute cart if needed, omitted here
                candidate_pool_size: upsellData.candidate_pool_size || 0
            });
            dispatch({ type: "INCREMENT_UPSELL_METRIC", payload: "pairingShownCount" });
        }
    }, [upsellData, upsellLoading, dispatch, state.restaurantId, state.tableNumber]);

    const handleItemClick = (item: Item) => {
        setSelectedItem(item);
        setQuantity(1);
        dispatch({ type: "ADD_VIEWED_ITEM", payload: item });
    };

    const closeDetail = () => {
        setSelectedItem(null);
        setUpsellData(null);
        setUpsellLoading(false);
        hasTrackedCurrentModal.current = false; // Reset for next modal open
        rankCalledFor.current = null;
    };

    const handleAddToOrder = (item: Item) => {
        for (let i = 0; i < quantity; i++) {
            dispatch({ type: "ADD_TO_CART", payload: item });
        }
        setShowAddedToast(true);
        setTimeout(() => setShowAddedToast(false), 2000);
        closeDetail();
    };

    const handleAddBothToOrder = (mainItem: Item, recItem: Item) => {
        dispatch({ type: "MARK_RECOMMENDATION_ACCEPTED_BEFORE_CHECKOUT" });
        // Mark BOTH items as pairing-accepted so neither triggers checkout upsell
        dispatch({ type: "MARK_PAIRING_ACCEPTED_FOR_ITEM", payload: mainItem.id });
        dispatch({ type: "MARK_PAIRING_ACCEPTED_FOR_ITEM", payload: recItem.id });
        // Store only the recommended item's price for analytics (not the cart total)
        const recPrice = parseFloat(recItem.price.replace(/[^0-9.]/g, "")) || 0;
        dispatch({ type: "SET_MENU_UPSELL_ITEM_PRICE", payload: recPrice });

        for (let i = 0; i < quantity; i++) {
            dispatch({ type: "ADD_TO_CART", payload: mainItem });
            dispatch({ type: "ADD_TO_CART", payload: recItem });
        }
        setShowAddedToast(true);
        setTimeout(() => setShowAddedToast(false), 2000);
        closeDetail();
    };

    const getPriceValue = (priceStr: string) => parseFloat(priceStr.replace(/[^0-9.]/g, "")) || 0;

    if (loading) {
        return (
            <div className="min-h-screen bg-warm-bg flex items-center justify-center">
                <p className="text-highlight text-lg font-medium">Loading menu...</p>
            </div>
        );
    }

    return (
        <div className="min-h-screen menu-bg relative">
            {/* Background overlay for readability */}
            <div className="min-h-screen menu-bg-overlay pb-24">

                {/* View Order Floating Button - Always visible when cart has items */}
                {state.cartItems.length > 0 && (
                    <button
                        onClick={onViewCart}
                        className="fixed bottom-6 right-4 left-4 mx-auto max-w-xs bg-dark hover:bg-[#2c2323] text-white px-6 py-4 rounded-xl shadow-lg z-40 font-bold tracking-wide transition-all flex items-center justify-center gap-3 hover:-translate-y-1"
                    >
                        <span>View Order</span>
                        <span className="bg-white text-dark rounded-full min-w-[24px] h-6 px-2 flex items-center justify-center text-sm font-bold">
                            {state.cartItems.length}
                        </span>
                    </button>
                )}

                {/* Added Toast */}
                {showAddedToast && (
                    <div className="fixed top-4 left-1/2 transform -translate-x-1/2 bg-green-600 text-white px-6 py-3 rounded-full shadow-lg z-50 font-medium animate-scale-in">
                        ✓ Added to order!
                    </div>
                )}

                <div className="px-6 pt-8 pb-2">
                    <button
                        onClick={onBack}
                        className="text-highlight mb-4 font-medium flex items-center hover:text-dark transition-colors"
                    >
                        ← Back
                    </button>
                    <div className="mb-2">
                        <h2 className="text-lg text-highlight font-body">Welcome, {state.userName || "Guest"}</h2>
                    </div>
                    <h1 className="text-4xl font-heading font-bold mb-1 text-dark">Menu</h1>
                </div>

                <div className="px-6 py-4 space-y-10">
                    {items.length === 0 ? (
                        <div className="text-center py-12">
                            <p className="text-highlight text-lg font-medium">No menu items available yet.</p>
                        </div>
                    ) : (
                        /* Group items by category, preserving insertion order */
                        Array.from(new Set(items.map(i => i.category))).map(category => (
                            <section key={category}>
                                <h2 className="text-xl font-heading font-bold text-dark border-b-2 border-primary/20 pb-2 mb-6 inline-block">
                                    {category}
                                </h2>
                                <div className="space-y-4">
                                    {items.filter(item => item.category === category).map((item) => (
                                        <div
                                            key={item.id}
                                            onClick={() => handleItemClick(item)}
                                            className="bg-white/80 backdrop-blur-sm p-4 rounded-2xl shadow-soft border border-transparent hover:border-primary/20 hover:shadow-soft-lg flex items-center justify-between cursor-pointer active:scale-[0.98] hover:scale-[1.01] transition-all duration-300"
                                        >
                                            <div className="flex-1 pr-4">
                                                {item.popular && (
                                                    <span className="inline-block bg-primary/20 text-dark text-xs font-bold px-2 py-1 rounded-md mb-2 uppercase tracking-wide">
                                                        Popular
                                                    </span>
                                                )}
                                                <h3 className="font-heading font-bold text-lg text-dark leading-tight">{item.name}</h3>
                                                {item.description && (
                                                    <p className="text-gray-500 font-body text-sm mt-1 mb-2 leading-relaxed line-clamp-2">
                                                        {item.description}
                                                    </p>
                                                )}
                                                <p className="text-highlight font-medium mt-1 font-body">{item.price}</p>
                                            </div>
                                            <MenuItemImage
                                                src={item.image_url}
                                                alt={item.name}
                                                className="w-20 h-20 rounded-xl shrink-0 shadow-sm"
                                            />
                                        </div>
                                    ))}
                                </div>
                            </section>
                        ))
                    )}
                </div>

                {/* Item Detail Modal */}
                {selectedItem && (
                    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center pointer-events-none">
                        {/* Backdrop */}
                        <div
                            className="absolute inset-0 bg-black/40 pointer-events-auto transition-opacity animate-fade-in"
                            onClick={closeDetail}
                        />

                        {/* Modal Content */}
                        <div className="bg-white w-full max-w-md rounded-t-3xl sm:rounded-3xl p-8 shadow-2xl pointer-events-auto relative animate-slide-up">
                            <button
                                onClick={closeDetail}
                                className="absolute top-6 right-6 text-gray-400 hover:text-dark transition-colors bg-gray-50 rounded-full p-2"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                            </button>

                            {/* Modal item image */}
                            {selectedItem.image_url && (
                                <div className="w-full h-44 rounded-2xl overflow-hidden mb-5 -mt-2">
                                    <img
                                        src={selectedItem.image_url}
                                        alt={selectedItem.name}
                                        className="w-full h-full object-cover"
                                    />
                                </div>
                            )}

                            <div className="mb-6 mt-2">
                                <h2 className="text-3xl font-heading font-bold mb-2 text-dark">{selectedItem.name}</h2>
                                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                                    <div className="flex items-center gap-2">
                                        {selectedItem.discountedPrice ? (
                                            <>
                                                <p className="text-lg text-gray-400 font-medium line-through opacity-50">{selectedItem.originalPrice}</p>
                                                <p className="text-xl font-bold text-[#E65C00]">{selectedItem.discountedPrice}</p>
                                            </>
                                        ) : (
                                            <p className="text-xl text-highlight font-medium">{selectedItem.price}</p>
                                        )}
                                    </div>
                                    <div className="ml-auto flex items-center bg-white border border-gray-200 rounded-full shadow-sm p-1">
                                        <button
                                            onClick={() => setQuantity(Math.max(1, quantity - 1))}
                                            className="w-8 h-8 rounded-full flex items-center justify-center text-dark hover:bg-gray-100 transition-colors"
                                        >
                                            -
                                        </button>
                                        <span className="w-8 text-center font-bold text-dark">{quantity}</span>
                                        <button
                                            onClick={() => setQuantity(quantity + 1)}
                                            className="w-8 h-8 rounded-full flex items-center justify-center text-dark hover:bg-gray-100 transition-colors"
                                        >
                                            +
                                        </button>
                                    </div>
                                </div>
                                <div className="mt-3 text-lg font-bold text-dark">
                                    Total: ₹{((selectedItem.discountedPrice ? getPriceValue(selectedItem.discountedPrice) : getPriceValue(selectedItem.price)) * quantity).toFixed(2).replace(/\.00$/, '')}
                                </div>
                            </div>

                            {/* Recommendation Section — instant from cache, shimmer while GPT loads */}
                            {(upsellData || upsellLoading) && (
                                <div className="border-t border-dashed border-gray-200 pt-6">
                                    <h3 className="text-sm font-bold text-dark/70 mb-4 font-body">
                                        {upsellHeader}
                                    </h3>
                                    <div className="bg-primary/5 border border-primary/20 rounded-2xl p-5 animate-fade-in shadow-glow relative overflow-hidden">
                                        {/* Popular combo badge */}
                                        {!upsellLoading && upsellData && (
                                            <div className="absolute top-3 right-3">
                                                <span className="inline-flex items-center gap-1 bg-primary/15 text-dark text-xs font-bold px-2.5 py-1 rounded-full badge-shimmer">
                                                    🔥 Popular combo
                                                </span>
                                            </div>
                                        )}

                                        <div className="flex items-start justify-between mb-2 pr-28">
                                            {upsellLoading ? (
                                                <div className="flex-1 space-y-2">
                                                    <div className="h-4 w-1/2 bg-gray-200 rounded animate-pulse" />
                                                    <div className="h-3 w-1/4 bg-gray-200 rounded animate-pulse" />
                                                </div>
                                            ) : (
                                                <>
                                                    <h4 className="font-heading font-bold text-dark text-lg">{upsellData?.item.name}</h4>
                                                    <span className="text-sm font-bold text-highlight ml-2 whitespace-nowrap">{upsellData?.item.price}</span>
                                                </>
                                            )}
                                        </div>
                                        {upsellLoading ? (
                                            <div className="h-4 w-3/4 bg-gray-200 rounded animate-pulse mb-4" />
                                        ) : (
                                            <p className="text-sm text-dark/80 italic mb-4 font-body leading-relaxed">
                                                "{upsellData?.reason}"
                                            </p>
                                        )}
                                        <Button
                                            onClick={() => upsellData && handleAddBothToOrder(selectedItem, upsellData.item)}
                                            disabled={upsellLoading}
                                            variant="primary"
                                            fullWidth
                                        >
                                            Add Both to Order
                                        </Button>
                                    </div>
                                </div>
                            )}

                            <div className="mt-8 space-y-3">
                                <Button
                                    onClick={() => handleAddToOrder(selectedItem)}
                                    variant="secondary"
                                    fullWidth
                                >
                                    Add to Order
                                </Button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
