import { useState, useEffect, useRef } from "react";
import { MENU_ITEMS } from "../utils/recommendations";
import { trackUpsellShown } from "../utils/api";
import type { Item } from "../utils/recommendations";
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
    const [quantity, setQuantity] = useState(1);
    const [showAddedToast, setShowAddedToast] = useState(false);

    // Guard: fires once per modal open, resets when modal closes
    const hasTrackedCurrentModal = useRef(false);

    // Fire trackUpsellShown() when a menu-level recommendation becomes visible
    useEffect(() => {
        if (selectedItem?.recommendation && !hasTrackedCurrentModal.current) {
            hasTrackedCurrentModal.current = true;
            trackUpsellShown();
            dispatch({ type: "INCREMENT_UPSELL_METRIC", payload: "pairingShownCount" });
        }
    }, [selectedItem, dispatch]);

    const handleItemClick = (item: Item) => {
        setSelectedItem(item);
        setQuantity(1);
        dispatch({ type: "ADD_VIEWED_ITEM", payload: item });
    };

    const closeDetail = () => {
        setSelectedItem(null);
        hasTrackedCurrentModal.current = false; // Reset for next modal open
    };

    const handleAddToOrder = (item: Item) => {
        for (let i = 0; i < quantity; i++) {
            dispatch({ type: "ADD_TO_CART", payload: item });
        }
        setShowAddedToast(true);
        setTimeout(() => setShowAddedToast(false), 2000);
        closeDetail();
    };

    const handleAddBothToOrder = (mainItem: Item, recData: { name: string, price: string }) => {
        // Mark that a recommendation was accepted before checkout (legacy + per-item)
        const recommendedItem = items.find(i => i.name === recData.name) || {
            id: Date.now(), name: recData.name, price: recData.price, popular: false, category: 'Bakery'
        } as Item;

        dispatch({ type: "MARK_RECOMMENDATION_ACCEPTED_BEFORE_CHECKOUT" });
        // Mark BOTH items as pairing-accepted so neither triggers checkout upsell
        dispatch({ type: "MARK_PAIRING_ACCEPTED_FOR_ITEM", payload: mainItem.id });
        dispatch({ type: "MARK_PAIRING_ACCEPTED_FOR_ITEM", payload: recommendedItem.id });
        // Store only the recommended item's price for analytics (not the cart total)
        const recPrice = parseFloat(recommendedItem.price.replace(/[^0-9.]/g, "")) || 0;
        dispatch({ type: "SET_MENU_UPSELL_ITEM_PRICE", payload: recPrice });

        for (let i = 0; i < quantity; i++) {
            dispatch({ type: "ADD_TO_CART", payload: mainItem });
            dispatch({ type: "ADD_TO_CART", payload: recommendedItem });
        }
        setShowAddedToast(true);
        setTimeout(() => setShowAddedToast(false), 2000);
        closeDetail();
    };

    const getPriceValue = (priceStr: string) => parseFloat(priceStr.replace(/[^0-9.]/g, "")) || 0;

    return (
        <div className="min-h-screen bg-warm-bg pb-24 relative">
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
                <div className="fixed top-4 left-1/2 transform -translate-x-1/2 bg-green-600 text-white px-6 py-3 rounded-full shadow-lg z-50 font-medium animate-bounce">
                    Added to order!
                </div>
            )}

            <div className="bg-warm-bg px-6 pt-8 pb-2">
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
                {/* Group items by category, preserving insertion order */}
                {Array.from(new Set(items.map(i => i.category))).map(category => (
                    <section key={category}>
                        <h2 className="text-xl font-heading font-bold text-dark border-b-2 border-primary/20 pb-2 mb-6 inline-block">
                            {category}
                        </h2>
                        <div className="space-y-5">
                            {items.filter(item => item.category === category).map((item) => (
                                <div
                                    key={item.id}
                                    onClick={() => handleItemClick(item)}
                                    className="bg-white p-5 rounded-2xl shadow-soft border border-transparent hover:border-primary/20 flex items-center justify-between cursor-pointer active:scale-95 hover:-translate-y-1 transition-all duration-300"
                                >
                                    <div className="flex-1 pr-4">
                                        {item.popular && (
                                            <span className="inline-block bg-primary/20 text-dark text-xs font-bold px-2 py-1 rounded-md mb-2 uppercase tracking-wide">
                                                Popular
                                            </span>
                                        )}
                                        <h3 className="font-heading font-bold text-lg text-dark leading-tight">{item.name}</h3>
                                        {item.description && (
                                            <p className="text-gray-500 font-body text-sm mt-1 mb-2 leading-relaxed">
                                                {item.description}
                                            </p>
                                        )}
                                        <p className="text-highlight font-medium mt-1 font-body">{item.price}</p>
                                    </div>
                                    <div className="w-24 h-24 bg-gray-100 rounded-xl ml-0 shrink-0 object-cover flex items-center justify-center text-gray-300">
                                        {/* Placeholder for now */}
                                        <svg className="w-8 h-8 opacity-20" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" /></svg>
                                    </div>
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
                    <div className="bg-white w-full max-w-md rounded-t-3xl sm:rounded-3xl p-8 shadow-2xl transform transition-transform pointer-events-auto relative">
                        <button
                            onClick={closeDetail}
                            className="absolute top-6 right-6 text-gray-400 hover:text-dark transition-colors bg-gray-50 rounded-full p-2"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                        </button>

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

                        {/* Recommendation Section */}
                        {selectedItem.recommendation && (
                            <div className="border-t border-dashed border-gray-200 pt-6">
                                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">
                                    CHEF’S RECOMMENDATION FOR YOU
                                </h3>
                                <div className="bg-primary/5 border border-primary/20 rounded-2xl p-5 animate-fade-in">
                                    <div className="flex items-start justify-between mb-2">
                                        <h4 className="font-heading font-bold text-dark text-lg">{selectedItem.recommendation.name}</h4>
                                        <span className="text-sm font-bold text-highlight">{selectedItem.recommendation.price}</span>
                                    </div>
                                    <p className="text-sm text-dark/80 italic mb-4 font-body leading-relaxed">
                                        "{selectedItem.recommendation.description}"
                                    </p>
                                    <button
                                        onClick={() => handleAddBothToOrder(selectedItem, selectedItem.recommendation!)}
                                        className="w-full py-3 bg-[#E65C00] hover:bg-[#CC5200] text-white rounded-xl font-bold text-sm transition-all duration-200 shadow-md hover:shadow-lg"
                                    >
                                        Add Both to Order
                                    </button>
                                </div>
                            </div>
                        )}

                        <div className="mt-8 space-y-3">
                            <button
                                onClick={() => handleAddToOrder(selectedItem)}
                                className="w-full py-4 bg-[#E65C00] hover:bg-[#CC5200] text-white rounded-xl font-bold text-lg shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200"
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
