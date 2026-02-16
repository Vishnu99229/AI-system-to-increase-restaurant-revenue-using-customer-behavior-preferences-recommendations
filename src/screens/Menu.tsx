import { useState, useEffect, useRef } from "react";
import { getRecommendations, MENU_ITEMS } from "../utils/recommendations";
import { rephraseReason, trackUpsellShown } from "../utils/api";
import type { Item, Recommendation } from "../utils/recommendations";
import { useApp } from "../contexts/AppContext";

interface MenuProps {
    onBack: () => void;
    onViewCart: () => void;
}

export default function Menu({ onBack, onViewCart }: MenuProps) {
    // Use the central MENU_ITEMS
    const [items] = useState<Item[]>(MENU_ITEMS);

    const { state, dispatch } = useApp();

    const [selectedItem, setSelectedItem] = useState<Item | null>(null);
    const [recommendation, setRecommendation] = useState<Recommendation | null>(null);
    const [loadingRec, setLoadingRec] = useState(false);
    const [showAddedToast, setShowAddedToast] = useState(false);

    // Track which recommendation IDs have already been sent to analytics
    const trackedRecIds = useRef<Set<number>>(new Set());

    // Fire trackUpsellShown() when a menu-level recommendation becomes visible
    useEffect(() => {
        if (recommendation && !loadingRec) {
            if (!trackedRecIds.current.has(recommendation.item.id)) {
                trackedRecIds.current.add(recommendation.item.id);
                trackUpsellShown();
                dispatch({ type: "INCREMENT_UPSELL_METRIC", payload: "pairingShownCount" });
            }
        }
    }, [recommendation, loadingRec, dispatch]);

    const handleItemClick = async (item: Item) => {
        setSelectedItem(item);
        dispatch({ type: "ADD_VIEWED_ITEM", payload: item });
        setLoadingRec(true);
        setRecommendation(null);

        try {
            const rec = await getRecommendations(item, items);
            setRecommendation(rec);

            // Async rephrase - non-blocking
            if (rec) {
                rephraseReason(item.name, rec.item.name, rec.reason).then(newReason => {
                    if (newReason) {
                        setRecommendation(prev => {
                            // Only update if we are still looking at the same recommendation
                            if (prev && prev.item.id === rec.item.id) {
                                return { ...prev, reason: newReason };
                            }
                            return prev;
                        });
                    }
                });
            }
        } catch (error) {
            console.error("Failed to load recommendation", error);
        } finally {
            setLoadingRec(false);
        }
    };

    const closeDetail = () => {
        setSelectedItem(null);
        setRecommendation(null);
    };

    const handleAddToOrder = (itemsToAdd: Item[]) => {
        itemsToAdd.forEach(item => dispatch({ type: "ADD_TO_CART", payload: item }));
        setShowAddedToast(true);
        setTimeout(() => setShowAddedToast(false), 2000);
        closeDetail();
    };

    const handleAddBothToOrder = (mainItem: Item, recommendedItem: Item) => {
        // Mark that a recommendation was accepted before checkout (legacy + per-item)
        dispatch({ type: "MARK_RECOMMENDATION_ACCEPTED_BEFORE_CHECKOUT" });
        // Mark BOTH items as pairing-accepted so neither triggers checkout upsell
        dispatch({ type: "MARK_PAIRING_ACCEPTED_FOR_ITEM", payload: mainItem.id });
        dispatch({ type: "MARK_PAIRING_ACCEPTED_FOR_ITEM", payload: recommendedItem.id });
        dispatch({ type: "ADD_TO_CART", payload: mainItem });
        dispatch({ type: "ADD_TO_CART", payload: recommendedItem });
        setShowAddedToast(true);
        setTimeout(() => setShowAddedToast(false), 2000);
        closeDetail();
    };

    return (
        <div className="min-h-screen bg-gray-50 pb-8 relative">
            {/* View Order Floating Button - Always visible when cart has items */}
            {state.cartItems.length > 0 && (
                <button
                    onClick={onViewCart}
                    className="fixed bottom-6 right-4 left-4 mx-auto max-w-xs bg-gray-900 hover:bg-black text-white px-6 py-3.5 rounded-full shadow-lg z-40 font-semibold transition-all flex items-center justify-center gap-3"
                >
                    <span>View Order</span>
                    <span className="bg-white text-gray-900 rounded-full min-w-[24px] h-6 px-2 flex items-center justify-center text-sm font-bold">
                        {state.cartItems.length}
                    </span>
                </button>
            )}

            {/* Added Toast */}
            {showAddedToast && (
                <div className="fixed top-4 left-1/2 transform -translate-x-1/2 bg-green-500 text-white px-6 py-2 rounded-full shadow-lg z-50 font-medium animate-bounce">
                    Added to order!
                </div>
            )}

            <div className="bg-white px-6 pt-8 pb-6 shadow-sm">
                <button
                    onClick={onBack}
                    className="text-gray-600 mb-4 font-medium flex items-center"
                >
                    ← Back
                </button>
                <div className="mb-2">
                    <h2 className="text-lg text-gray-800">Welcome, {state.userName || "Guest"}</h2>
                </div>
                <h1 className="text-3xl font-bold mb-1">Menu</h1>
            </div>

            <div className="px-6 py-6 space-y-8">
                {/* Group items by category, preserving insertion order */}
                {Array.from(new Set(items.map(i => i.category))).map(category => (
                    <section key={category}>
                        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">
                            {category}
                        </h2>
                        <div className="space-y-4">
                            {items.filter(item => item.category === category).map((item) => (
                                <div
                                    key={item.id}
                                    onClick={() => handleItemClick(item)}
                                    className="bg-white p-4 rounded-xl shadow-sm flex items-center justify-between cursor-pointer active:scale-95 transition-transform"
                                >
                                    <div className="flex-1">
                                        {item.popular && (
                                            <span className="inline-block bg-orange-100 text-orange-600 text-xs font-semibold px-2 py-0.5 rounded-md mb-2">
                                                Popular
                                            </span>
                                        )}
                                        <h3 className="font-semibold text-lg">{item.name}</h3>
                                        <p className="text-gray-600 mt-1">{item.price}</p>
                                    </div>
                                    <div className="w-24 h-24 bg-gray-200 rounded-lg ml-4"></div>
                                </div>
                            ))}
                        </div>
                    </section>
                ))}
            </div>

            {/* Item Detail Modal */}
            {selectedItem && (
                <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center pointer-events-none">
                    {/* Backdrop */}
                    <div
                        className="absolute inset-0 bg-black/40 pointer-events-auto transition-opacity"
                        onClick={closeDetail}
                    />

                    {/* Modal Content */}
                    <div className="bg-white w-full max-w-md rounded-t-2xl sm:rounded-2xl p-6 shadow-xl transform transition-transform pointer-events-auto relative">
                        <button
                            onClick={closeDetail}
                            className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"
                        >
                            ✕
                        </button>

                        <div className="mb-6">
                            <h2 className="text-2xl font-bold mb-2">{selectedItem.name}</h2>
                            <p className="text-xl text-gray-600">{selectedItem.price}</p>
                        </div>

                        {/* Recommendation Section */}
                        <div className="border-t pt-6">
                            <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4">
                                Chef's Recommendation for You
                            </h3>

                            {loadingRec ? (
                                <div className="flex items-center space-x-3 text-gray-500 animate-pulse">
                                    <div className="w-5 h-5 border-2 border-gray-300 border-t-orange-500 rounded-full animate-spin"></div>
                                    <span>Consulting our AI Sommelier...</span>
                                </div>
                            ) : recommendation ? (
                                <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
                                    <div className="flex items-start justify-between mb-2">
                                        <h4 className="font-bold text-gray-900">{recommendation.item.name}</h4>
                                        <span className="text-sm font-medium text-gray-600">{recommendation.item.price}</span>
                                    </div>
                                    <p className="text-sm text-gray-600 italic mb-3">
                                        "{recommendation.reason}"
                                    </p>
                                    <button
                                        onClick={() => handleAddBothToOrder(selectedItem, recommendation.item)}
                                        className="w-full py-2.5 bg-amber-100 hover:bg-amber-200 text-amber-800 rounded-lg font-medium text-sm transition-colors"
                                    >
                                        Add Both to Order
                                    </button>
                                </div>
                            ) : (
                                <p className="text-sm text-gray-500">No specific pairings found.</p>
                            )}
                        </div>

                        <div className="mt-6 space-y-3">
                            <button
                                onClick={() => handleAddToOrder([selectedItem])}
                                className="w-full py-4 bg-gray-900 hover:bg-black text-white rounded-2xl font-bold text-lg shadow-md hover:shadow-lg transition-all"
                            >
                                Add to Order
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
