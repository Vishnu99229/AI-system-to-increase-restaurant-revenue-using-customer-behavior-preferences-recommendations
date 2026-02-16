import { useState, useEffect, useRef } from "react";
import { useApp } from "../contexts/AppContext";
import { getCheckoutUpsellCandidates, rankCandidatesAI } from "../utils/recommendations";
import { rephraseReason, trackUpsellShown, trackOrderComplete } from "../utils/api";
import type { Recommendation } from "../utils/recommendations";

interface CheckoutProps {
    onBack: () => void;
}

/**
 * Checkout Upsell Decision Logic (Per-Item)
 * 
 * Pure function: shouldShowCheckoutUpsell =
 *   lastItemAddedId != null
 *   AND pairingAcceptedByItemId[lastItemAddedId] is NOT true
 *   AND checkoutUpsellShownByItemId[lastItemAddedId] is NOT true
 * 
 * Then evaluate confidence gate (>= 0.75).
 * 
 * When upsell renders: mark checkoutUpsellShownByItemId[lastItemAddedId] = true
 * When dismissed: do NOT navigate, clear cart, or reset lastItemAddedId
 */
export default function Checkout({ onBack }: CheckoutProps) {
    const { state, dispatch, resetSessionAfterOrder } = useApp();
    const { cartItems, viewedItems, lastItemAddedId, pairingAcceptedByItemId, checkoutUpsellShownByItemId } = state;

    // Upsell UI state
    const [upsellData, setUpsellData] = useState<Recommendation | null>(null);
    const [showUpsell, setShowUpsell] = useState(false);

    // Track if we've already evaluated the upsell decision (once per checkout mount)
    const hasEvaluatedUpsell = useRef(false);

    // Explicit state tracking for upsell acceptance
    // Initialize from menu-level acceptance state so "Add Both to Order" flows through

    // Helper to parse price string like "₹180" -> 180.00
    const parsePrice = (priceStr: string) => {
        return parseFloat(priceStr.replace(/[^0-9.]/g, "")) || 0;
    };

    const menuUpsellAccepted = state.recommendationAcceptedBeforeCheckout;
    const menuUpsellValue = menuUpsellAccepted
        ? cartItems
            .filter(item => state.pairingAcceptedByItemId[item.id])
            .reduce((sum, item) => sum + parsePrice(item.price), 0)
        : 0;

    const [upsellAccepted, setUpsellAccepted] = useState(menuUpsellAccepted);
    const [upsellValue, setUpsellValue] = useState(menuUpsellValue);

    // Evaluate upsell ONCE at checkout mount - pure function logic
    // This effect intentionally runs only once per checkout visit
    useEffect(() => {
        // Skip if already evaluated in this checkout session
        if (hasEvaluatedUpsell.current) {
            return;
        }

        // Console log for debugging (per requirements)
        console.log("Checkout Upsell Evaluation", {
            lastItemAddedId,
            pairingAcceptedByItemId,
            checkoutUpsellShownByItemId,
        });

        // Per-item pure function: shouldShowCheckoutUpsell
        const shouldShowCheckoutUpsell =
            lastItemAddedId != null &&
            !pairingAcceptedByItemId[lastItemAddedId] &&
            !checkoutUpsellShownByItemId[lastItemAddedId];

        if (!shouldShowCheckoutUpsell) {
            console.log("[Dev] Upsell Decision: No Render (Per-item gates failed)");
            hasEvaluatedUpsell.current = true;
            return;
        }

        // Only reach here if shouldShowCheckoutUpsell is true
        // Step 1: Deterministic confidence gate
        const approvedCandidates = getCheckoutUpsellCandidates(cartItems, viewedItems);

        if (approvedCandidates.length > 0) {
            console.log("[Dev] Upsell Decision: Render (Gates passed, candidates found)");

            // Step 2: AI Ranking (Safe integration after gates)
            rankCandidatesAI(state.userName, cartItems, approvedCandidates)
                .then(rec => {
                    if (rec) {
                        console.log("[Dev] AI Ranking: Success", rec.item.name);
                        setUpsellData(rec);
                        setShowUpsell(true);
                        // Mark checkout upsell as shown for this specific item
                        dispatch({ type: "MARK_CHECKOUT_UPSELL_SHOWN_FOR_ITEM", payload: lastItemAddedId });
                        dispatch({ type: "MARK_CHECKOUT_UPSELL_SHOWN" }); // legacy compat
                        dispatch({ type: "INCREMENT_UPSELL_METRIC", payload: "checkoutUpsellShownCount" });
                    }
                })
                .catch(err => {
                    console.error("[Dev] AI Ranking: Error", err);
                    // Fallback to top deterministic candidate
                    const fallbackRec = {
                        item: approvedCandidates[0],
                        reason: "Perfect addition to your order."
                    };
                    setUpsellData(fallbackRec);
                    setShowUpsell(true);
                    dispatch({ type: "MARK_CHECKOUT_UPSELL_SHOWN_FOR_ITEM", payload: lastItemAddedId });
                    dispatch({ type: "MARK_CHECKOUT_UPSELL_SHOWN" }); // legacy compat
                    dispatch({ type: "INCREMENT_UPSELL_METRIC", payload: "checkoutUpsellShownCount" });
                });
        } else {
            console.log("[Dev] Upsell Decision: No Render (No candidates passed confidence gate)");
        }

        hasEvaluatedUpsell.current = true;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Track upsell shown event when it becomes visible
    useEffect(() => {
        if (showUpsell) {
            trackUpsellShown();
        }
    }, [showUpsell]);

    // Rephrase upsell reason when it appears
    useEffect(() => {
        if (upsellData && showUpsell) {
            // Non-blocking rephrase
            rephraseReason(
                cartItems.map(i => i.name).join(", "),
                upsellData.item.name,
                upsellData.reason
            ).then(newReason => {
                if (newReason) {
                    setUpsellData(prev => prev && prev.item.id === upsellData.item.id ? { ...prev, reason: newReason } : prev);
                }
            });
        }
    }, [upsellData?.item.id, showUpsell]);


    const subtotal = cartItems.reduce((acc, item) => acc + parsePrice(item.price), 0);
    const tax = subtotal * 0.05;
    const total = subtotal + tax;

    const handlePlaceOrder = () => {
        console.log("Order placed:", {
            user: state.userName,
            items: cartItems,
            total: total.toFixed(2),
        });

        // Fire-and-forget analytics
        trackOrderComplete(
            Date.now().toString(), // Simple ID generation
            total,
            upsellAccepted,
            upsellValue,
            cartItems.map(item => ({ name: item.name, price: item.price })),
            state.restaurantId,
            state.tableNumber
        );

        alert("Order placed! (Check console for details)");
        // Reset session state after successful order, then navigate back
        resetSessionAfterOrder();
        onBack();
    };

    const handleAddUpsell = () => {
        if (!upsellData) return;
        dispatch({ type: "ADD_TO_CART", payload: upsellData.item });
        dispatch({ type: "INCREMENT_UPSELL_METRIC", payload: "checkoutUpsellAcceptedCount" });
        setUpsellAccepted(true);
        setUpsellValue(parsePrice(upsellData.item.price));
        setShowUpsell(false);
    };

    const handleDismissUpsell = () => {
        dispatch({ type: "INCREMENT_UPSELL_METRIC", payload: "checkoutUpsellDismissedCount" });
        setShowUpsell(false);
        // Do NOT navigate, clear cart, or reset lastItemAddedId
    };

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col">
            <div className="bg-white px-6 py-6 shadow-sm z-10 sticky top-0">
                <button
                    onClick={onBack}
                    className="text-gray-400 hover:text-gray-600 mb-4 text-sm font-medium flex items-center transition-colors"
                >
                    ← Back to Menu
                </button>
                <h1 className="text-3xl font-bold">Your Order</h1>
                {state.tableNumber && (
                    <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2 text-sm font-medium text-amber-800">
                        🪑 Ordering for Table {state.tableNumber}
                    </div>
                )}
            </div>

            <div className="flex-1 px-6 py-6 overflow-y-auto">
                {cartItems.length === 0 ? (
                    <div className="text-center py-12">
                        <p className="text-gray-500 mb-4">Your cart is empty.</p>
                        <button
                            onClick={onBack}
                            className="text-black underline font-medium"
                        >
                            Browse Menu
                        </button>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {cartItems.map((item, index) => (
                            <div
                                key={`${item.id}-${index}`}
                                className="bg-white p-4 rounded-xl shadow-sm flex justify-between items-center"
                            >
                                <div>
                                    <h3 className="font-semibold text-lg">{item.name}</h3>
                                </div>
                                <div className="flex items-center gap-3">
                                    <span className="font-medium">{item.price}</span>
                                    <button
                                        onClick={() => dispatch({ type: "REMOVE_FROM_CART", payload: item.id })}
                                        className="text-gray-400 hover:text-red-500 transition-colors p-1"
                                        aria-label="Remove item"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M3 6h18"></path>
                                            <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
                                            <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
                                        </svg>
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {cartItems.length > 0 && (
                <div className="bg-white px-6 py-8 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">

                    {/* Optional Addition - Calm Upsell */}
                    {showUpsell && upsellData && (
                        <div className="mb-6 bg-stone-50 border border-stone-200 rounded-xl p-4">
                            <div className="flex justify-between items-start mb-1">
                                <h3 className="font-medium text-gray-700">You might also enjoy</h3>
                            </div>
                            <p className="text-sm text-gray-500 mb-3">{upsellData.reason}</p>

                            <div className="flex items-center justify-between bg-white p-3 rounded-lg border border-stone-200 mb-3">
                                <div>
                                    <p className="font-medium text-gray-800">{upsellData.item.name}</p>
                                    <p className="text-sm text-gray-500">{upsellData.item.price}</p>
                                </div>
                                <button
                                    onClick={handleAddUpsell}
                                    className="bg-stone-100 hover:bg-stone-200 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                                >
                                    Add
                                </button>
                            </div>

                            <button
                                onClick={handleDismissUpsell}
                                className="w-full text-center text-xs text-gray-400 hover:text-gray-500 transition-colors"
                            >
                                No thanks, just my order
                            </button>
                        </div>
                    )}

                    <div className="space-y-2 mb-6 text-sm text-gray-600">
                        <div className="flex justify-between">
                            <span>Subtotal</span>
                            <span>₹{subtotal.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                            <span>Tax (5%)</span>
                            <span>₹{tax.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between text-lg font-bold text-black border-t pt-2 mt-2">
                            <span>Total</span>
                            <span>₹{total.toFixed(2)}</span>
                        </div>
                    </div>

                    <button
                        onClick={handlePlaceOrder}
                        className="w-full bg-gray-900 hover:bg-black text-white py-5 rounded-2xl text-xl font-bold shadow-lg hover:shadow-xl transition-all"
                    >
                        Place Order
                    </button>
                </div>
            )}
        </div>
    );
}
