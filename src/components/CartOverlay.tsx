import { useState, useEffect, useRef } from "react";
import { useApp } from "../contexts/AppContext";
import { rankCandidatesAI } from "../utils/recommendations";
import { trackUpsellShown, trackUpsellEvent, trackOrderComplete } from "../utils/api";
import type { Item, Recommendation } from "../utils/recommendations";

interface CartOverlayProps {
    isOpen: boolean;
    onClose: () => void;
}

export default function CartOverlay({ isOpen, onClose }: CartOverlayProps) {
    const { state, dispatch, resetSessionAfterOrder, getItemQuantity } = useApp();
    const { cartItems, itemNotes, orderNote } = state;

    const [isClosing, setIsClosing] = useState(false);
    const [editingNoteId, setEditingNoteId] = useState<number | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // AI recommendations state
    const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
    const [recsLoading, setRecsLoading] = useState(false);
    const recsLoaded = useRef(false);

    const parsePrice = (priceStr: string) => parseFloat(priceStr.replace(/[^0-9.]/g, "")) || 0;

    // Deduplicate cart items for display (group by id)
    const uniqueItems = cartItems.reduce<Item[]>((acc, item) => {
        if (!acc.find(i => i.id === item.id)) acc.push(item);
        return acc;
    }, []);

    const subtotal = cartItems.reduce((acc, item) => acc + parsePrice(item.price), 0);

    // Fetch AI recommendations once when overlay opens
    useEffect(() => {
        if (!isOpen || recsLoaded.current || state.menuItems.length === 0 || cartItems.length === 0) return;
        recsLoaded.current = true;
        setRecsLoading(true);

        // Get 3 recommendations by calling the existing AI system
        const fetchRecs = async () => {
            try {
                const results: Recommendation[] = [];
                // Make up to 3 calls to get varied recommendations
                for (let i = 0; i < 3; i++) {
                    const rec = await rankCandidatesAI(state.menuItems, cartItems);
                    if (rec && !results.find(r => r.item.id === rec.item.id) && !cartItems.find(c => c.id === rec.item.id)) {
                        results.push(rec);
                    }
                    if (results.length >= 3) break;
                }
                setRecommendations(results);
            } catch (err) {
                console.error("[CartOverlay] Recommendation fetch failed:", err);
            } finally {
                setRecsLoading(false);
            }
        };
        fetchRecs();
    }, [isOpen]);

    // Reset recsLoaded on close so fresh recs next open
    useEffect(() => {
        if (!isOpen) {
            recsLoaded.current = false;
            setRecommendations([]);
        }
    }, [isOpen]);

    const handleClose = () => {
        setIsClosing(true);
        setTimeout(() => {
            setIsClosing(false);
            onClose();
        }, 250);
    };

    const handleIncrement = (item: Item) => {
        dispatch({ type: "ADD_TO_CART", payload: item });
    };

    const handleDecrement = (itemId: number) => {
        dispatch({ type: "REMOVE_ONE_FROM_CART", payload: itemId });
    };

    const handleAddRecommendation = (item: Item) => {
        dispatch({ type: "ADD_TO_CART", payload: item });
        // Remove from recommendations display
        setRecommendations(prev => prev.filter(r => r.item.id !== item.id));
    };

    const handlePlaceOrder = () => {
        if (isSubmitting || cartItems.length === 0) return;
        setIsSubmitting(true);

        trackOrderComplete(
            state.restaurantId,
            Date.now().toString(),
            subtotal * 1.05, // including tax
            false,
            0,
            cartItems.map(item => ({ name: item.name, price: item.price })),
            state.tableNumber,
            state.customerName,
            state.customerPhone
        );

        alert("Order placed successfully!");
        resetSessionAfterOrder();
        setIsSubmitting(false);
        handleClose();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50" id="cart-overlay">
            {/* Backdrop */}
            <div
                className={`absolute inset-0 bg-black/40 ${isClosing ? 'opacity-0' : 'animate-backdrop'} transition-opacity`}
                onClick={handleClose}
            />

            {/* Bottom Sheet */}
            <div className={`absolute bottom-0 left-0 right-0 max-w-md mx-auto bg-white rounded-t-3xl shadow-2xl flex flex-col ${isClosing ? 'animate-slide-down' : 'animate-slide-up'}`}
                style={{ maxHeight: "80vh" }}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-gray-100 shrink-0">
                    <h2 className="text-xl font-heading font-bold text-dark">Your Order Summary</h2>
                    <button
                        onClick={handleClose}
                        className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors"
                        id="close-cart-overlay"
                    >
                        <svg className="w-4 h-4 text-dark" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Scrollable Content */}
                <div className="flex-1 overflow-y-auto px-6 py-4">
                    {cartItems.length === 0 ? (
                        <div className="text-center py-12">
                            <p className="text-gray-400 text-lg font-medium">Your cart is empty</p>
                        </div>
                    ) : (
                        <>
                            {/* Cart Items */}
                            <div className="space-y-4">
                                {uniqueItems.map(item => {
                                    const qty = getItemQuantity(item.id);
                                    if (qty === 0) return null;
                                    const note = itemNotes[item.id] || "";
                                    const isEditing = editingNoteId === item.id;

                                    return (
                                        <div key={item.id} className="pb-4 border-b border-gray-100 last:border-0">
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="flex-1 min-w-0">
                                                    <h3 className="font-heading font-bold text-dark text-base truncate">{item.name}</h3>
                                                    <p className="text-highlight font-bold text-sm mt-0.5">{item.price}</p>
                                                </div>
                                                {/* Quantity Controls */}
                                                <div className="flex items-center gap-1 bg-gray-100 rounded-lg shrink-0">
                                                    <button
                                                        onClick={() => handleDecrement(item.id)}
                                                        className="w-8 h-8 flex items-center justify-center text-dark font-bold hover:bg-gray-200 rounded-l-lg transition-colors"
                                                    >
                                                        −
                                                    </button>
                                                    <span className="w-6 text-center text-sm font-bold text-dark">{qty}</span>
                                                    <button
                                                        onClick={() => handleIncrement(item)}
                                                        className="w-8 h-8 flex items-center justify-center text-dark font-bold hover:bg-gray-200 rounded-r-lg transition-colors"
                                                    >
                                                        +
                                                    </button>
                                                </div>
                                            </div>
                                            {/* Item Note */}
                                            {isEditing ? (
                                                <div className="mt-2">
                                                    <input
                                                        type="text"
                                                        placeholder="e.g. No onions, Extra spicy"
                                                        value={note}
                                                        onChange={e => dispatch({ type: "SET_ITEM_NOTE", payload: { itemId: item.id, note: e.target.value } })}
                                                        onBlur={() => setEditingNoteId(null)}
                                                        autoFocus
                                                        className="w-full text-xs px-3 py-2 rounded-lg border border-gray-200 focus:outline-none focus:ring-1 focus:ring-primary/50 text-dark placeholder-gray-400"
                                                    />
                                                </div>
                                            ) : (
                                                <button
                                                    onClick={() => setEditingNoteId(item.id)}
                                                    className="mt-1.5 text-xs text-primary/80 font-medium hover:text-primary transition-colors flex items-center gap-1"
                                                >
                                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                                    </svg>
                                                    {note ? note : "Add Note"}
                                                </button>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>

                            {/* Recommendations Section */}
                            {(recommendations.length > 0 || recsLoading) && (
                                <div className="mt-6 pt-4 border-t border-dashed border-gray-200">
                                    <h3 className="text-sm font-bold text-dark/60 uppercase tracking-wider mb-3">You may also like</h3>
                                    {recsLoading ? (
                                        <div className="space-y-2">
                                            {[1, 2, 3].map(i => (
                                                <div key={i} className="flex items-center justify-between py-2">
                                                    <div className="h-4 w-32 bg-gray-200 rounded animate-pulse" />
                                                    <div className="h-7 w-14 bg-gray-200 rounded animate-pulse" />
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="space-y-1">
                                            {recommendations.map(rec => (
                                                <div key={rec.item.id} className="flex items-center justify-between py-2 px-2 rounded-lg hover:bg-gray-50 transition-colors">
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-sm font-semibold text-dark truncate">{rec.item.name}</p>
                                                        <p className="text-xs text-gray-400">{rec.item.price}</p>
                                                    </div>
                                                    <button
                                                        onClick={() => handleAddRecommendation(rec.item)}
                                                        className="text-xs font-bold text-primary border border-primary/30 px-3 py-1 rounded-lg hover:bg-primary/10 transition-colors shrink-0"
                                                    >
                                                        + Add
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Order Note */}
                            <div className="mt-6 pt-4 border-t border-dashed border-gray-200">
                                <label className="text-xs font-bold text-dark/60 uppercase tracking-wider block mb-2">Order Note</label>
                                <input
                                    type="text"
                                    placeholder="e.g. Serve together, No plastic cutlery"
                                    value={orderNote}
                                    onChange={e => dispatch({ type: "SET_ORDER_NOTE", payload: e.target.value })}
                                    className="w-full text-sm px-4 py-3 rounded-xl border border-gray-200 bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:bg-white text-dark placeholder-gray-400 transition-all"
                                    id="order-note-input"
                                />
                            </div>
                        </>
                    )}
                </div>

                {/* Footer */}
                {cartItems.length > 0 && (
                    <div className="px-6 py-4 border-t border-gray-100 bg-white shrink-0 rounded-b-0">
                        <div className="flex items-center justify-between mb-4">
                            <span className="text-sm text-dark/60 font-medium">Subtotal</span>
                            <span className="text-xl font-heading font-bold text-dark">₹{subtotal.toFixed(2)}</span>
                        </div>
                        <button
                            onClick={handlePlaceOrder}
                            disabled={isSubmitting}
                            className="w-full bg-[#E65C00] text-white py-3.5 rounded-xl font-bold text-base shadow-md hover:bg-[#CC5200] active:scale-[0.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                            id="place-order-btn"
                        >
                            {isSubmitting ? "Processing..." : "Place Order"}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
