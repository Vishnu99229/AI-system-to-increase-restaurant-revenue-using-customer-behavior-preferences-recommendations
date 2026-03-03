import { useState, useEffect, useRef } from "react";
import { useApp } from "../contexts/AppContext";
import { getCheckoutUpsellCandidates, rankCandidatesAI } from "../utils/recommendations";
import { trackUpsellShown, trackOrderComplete } from "../utils/api";
import type { Recommendation } from "../utils/recommendations";
import { Button } from "../components/Button";

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
    const [upsellLoading, setUpsellLoading] = useState(false);

    // Track if we've already evaluated the upsell decision (once per checkout mount)
    const hasEvaluatedUpsell = useRef(false);

    // Safety guard: prevent state updates after unmount
    const isMounted = useRef(true);
    useEffect(() => {
        return () => {
            isMounted.current = false;
        };
    }, []);

    // Explicit state tracking for upsell acceptance
    // Initialize from menu-level acceptance state so "Add Both to Order" flows through

    // Helper to parse price string like "₹180" -> 180.00
    const parsePrice = (priceStr: string) => {
        return parseFloat(priceStr.replace(/[^0-9.]/g, "")) || 0;
    };

    const menuUpsellAccepted = state.recommendationAcceptedBeforeCheckout;
    const menuUpsellValue = menuUpsellAccepted ? state.menuUpsellItemPrice : 0;

    const [upsellAccepted, setUpsellAccepted] = useState(menuUpsellAccepted);
    const [upsellValue, setUpsellValue] = useState(menuUpsellValue);

    // Evaluate upsell candidates ONCE at checkout mount
    // This effect decoupled from display gates
    useEffect(() => {
        if (hasEvaluatedUpsell.current) return;
        hasEvaluatedUpsell.current = true;

        // Step 1: Find candidates unconditionally
        const approvedCandidates = getCheckoutUpsellCandidates(cartItems, viewedItems, state.menuItems);

        if (approvedCandidates.length === 0) {
            return; // No candidates available
        }

        // Helper to check display gates when we are ready to render
        const checkDisplayGatesAndRender = (finalRec: Recommendation) => {
            if (!isMounted.current) return;

            const shouldShowCheckoutUpsell =
                lastItemAddedId != null &&
                !pairingAcceptedByItemId[lastItemAddedId] &&
                !checkoutUpsellShownByItemId[lastItemAddedId];

            if (shouldShowCheckoutUpsell) {
                console.log("Display gate passed");
                setUpsellData(finalRec);
                setShowUpsell(true);
                dispatch({ type: "MARK_CHECKOUT_UPSELL_SHOWN_FOR_ITEM", payload: lastItemAddedId });
                dispatch({ type: "MARK_CHECKOUT_UPSELL_SHOWN" }); // legacy compat
                dispatch({ type: "INCREMENT_UPSELL_METRIC", payload: "checkoutUpsellShownCount" });
            } else {
                let reason = "Unknown";
                if (lastItemAddedId == null) reason = "lastItemAddedId is null";
                else if (pairingAcceptedByItemId[lastItemAddedId]) reason = "pairing previously accepted for this item";
                else if (checkoutUpsellShownByItemId[lastItemAddedId]) reason = "upsell already shown for this item";

                console.log(`Display gate blocked because: ${reason}`);
            }
        };

        // Show loading state immediately so the card renders with shimmer
        setUpsellLoading(true);

        // Step 2: AI Ranking → POST /api/rank-upsell (single source of truth)
        // Backend handles GPT ranking + reason generation + fallback.
        rankCandidatesAI(approvedCandidates, cartItems)
            .then(rec => {
                if (!isMounted.current) return;

                setUpsellLoading(false);

                if (!rec) {
                    setUpsellData(null);
                    return;
                }

                checkDisplayGatesAndRender(rec);
            })
            .catch(err => {
                if (!isMounted.current) return;

                console.error("[Dev] AI Ranking: Error", err);
                setUpsellLoading(false);
                setUpsellData(null);
            });
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Track upsell shown event when it becomes visible (only after loading completes)
    useEffect(() => {
        if (showUpsell && !upsellLoading) {
            trackUpsellShown();
        }
    }, [showUpsell, upsellLoading]);


    const subtotal = cartItems.reduce((acc, item) => acc + parsePrice(item.price), 0);
    const tax = subtotal * 0.05;
    const total = subtotal + tax;

    const [isSubmitting, setIsSubmitting] = useState(false);

    const handlePlaceOrder = () => {
        if (isSubmitting) return;
        setIsSubmitting(true);

        console.log("Order placed:", {
            user: state.userName,
            items: cartItems,
            total: total.toFixed(2),
        });

        // Fire-and-forget analytics via slug-based endpoint
        trackOrderComplete(
            state.restaurantId, // slug
            Date.now().toString(), // Simple ID generation
            total,
            upsellAccepted,
            upsellValue,
            cartItems.map(item => ({ name: item.name, price: item.price })),
            state.tableNumber,
            state.customerName,
            state.customerPhone
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
        <div className="min-h-screen bg-warm-bg flex flex-col">
            <div className="bg-warm-bg px-6 py-4 shadow-sm z-10 sticky top-0 border-b border-primary/10">
                <button
                    onClick={onBack}
                    className="text-highlight hover:text-dark mb-4 text-sm font-medium flex items-center transition-colors"
                >
                    ← Back to Menu
                </button>
                <h1 className="text-3xl font-heading font-bold text-dark">Your Order</h1>
                {state.tableNumber && (
                    <div className="mt-3 bg-primary/10 border border-primary/20 rounded-lg px-4 py-2 text-sm font-bold text-dark inline-block">
                        🪑 Ordering for Table {state.tableNumber}
                    </div>
                )}
            </div>

            <div className="flex-1 px-6 py-6 overflow-y-auto">
                {cartItems.length === 0 ? (
                    <div className="text-center py-12">
                        <p className="text-highlight mb-4 text-lg font-medium">Your cart is empty.</p>
                        <button
                            onClick={onBack}
                            className="text-dark underline font-bold hover:text-primary transition-colors"
                        >
                            Browse Menu
                        </button>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {cartItems.map((item, index) => (
                            <div
                                key={`${item.id}-${index}`}
                                className="bg-white p-5 rounded-xl shadow-soft flex justify-between items-center border border-transparent hover:border-primary/10 transition-colors"
                            >
                                <div>
                                    <h3 className="font-heading font-bold text-lg text-dark">{item.name}</h3>
                                </div>
                                <div className="flex items-center gap-3">
                                    <span className="font-medium text-highlight font-body">{item.price}</span>
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
                <div className="bg-white px-6 py-8 shadow-[0_-4px_20px_rgba(0,0,0,0.05)] rounded-t-3xl relative z-20">

                    {/* Optional Addition - Calm Upsell */}
                    {(showUpsell || upsellLoading) && (
                        <div className="mb-8 bg-primary/5 border border-primary/20 rounded-2xl p-5 animate-fade-in shadow-[0_0_15px_rgba(244,196,48,0.15)]">
                            <div className="flex justify-between items-start mb-2">
                                <h3 className="font-heading font-bold text-dark text-lg">You might also enjoy</h3>
                            </div>

                            {upsellLoading ? (
                                <div className="h-4 w-3/4 bg-gray-200 rounded animate-pulse mb-4" />
                            ) : (
                                <p className="text-sm text-dark/80 mb-4 font-body leading-relaxed">{upsellData?.reason}</p>
                            )}

                            <div className="flex items-center justify-between bg-white p-3 rounded-xl border border-primary/10 mb-4 shadow-sm">
                                {upsellLoading ? (
                                    <div className="flex-1 space-y-2">
                                        <div className="h-4 w-1/2 bg-gray-200 rounded animate-pulse" />
                                        <div className="h-3 w-1/4 bg-gray-200 rounded animate-pulse" />
                                    </div>
                                ) : (
                                    <div>
                                        <p className="font-heading font-bold text-dark">{upsellData?.item.name}</p>
                                        <p className="text-sm text-highlight font-bold">{upsellData?.item.price}</p>
                                    </div>
                                )}
                                <button
                                    onClick={handleAddUpsell}
                                    disabled={upsellLoading}
                                    className="bg-primary/10 hover:bg-primary/20 text-dark border border-primary/20 px-4 py-2 rounded-lg text-sm font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    Add
                                </button>
                            </div>

                            <button
                                onClick={handleDismissUpsell}
                                disabled={upsellLoading}
                                className="w-full text-center text-xs text-gray-400 hover:text-dark transition-colors font-medium uppercase tracking-wide disabled:opacity-50"
                            >
                                No thanks, just my order
                            </button>
                        </div>
                    )}

                    <div className="space-y-3 mb-8 text-sm text-dark/80 font-medium">
                        <div className="flex justify-between">
                            <span>Subtotal</span>
                            <span className="font-bold">₹{subtotal.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between">
                            <span>Tax (5%)</span>
                            <span>₹{tax.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between text-2xl font-heading font-bold text-dark border-t border-dashed border-gray-200 pt-4 mt-4">
                            <span>Total</span>
                            <span>₹{total.toFixed(2)}</span>
                        </div>
                    </div>

                    <Button
                        onClick={handlePlaceOrder}
                        disabled={isSubmitting}
                        variant="primary"
                        fullWidth
                    >
                        {isSubmitting ? "Processing..." : "Place Order"}
                    </Button>
                </div>
            )}
        </div>
    );
}
