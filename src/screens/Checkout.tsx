import { useState, useEffect, useRef, useCallback } from "react";
import { useApp } from "../contexts/AppContext";
import { rankCandidatesAI } from "../utils/recommendations";
import { trackUpsellShown, trackUpsellEvent, trackOrderComplete } from "../utils/api";
import type { Recommendation } from "../utils/recommendations";
import { Button } from "../components/Button";
import PhoneVerificationModal from "../components/PhoneVerificationModal";

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
    const { cartItems, lastItemAddedId, pairingAcceptedByItemId, checkoutUpsellShownByItemId } = state;

    // Upsell UI state
    const [upsellData, setUpsellData] = useState<Recommendation | null>(null);
    const [showUpsell, setShowUpsell] = useState(false);
    const [upsellLoading, setUpsellLoading] = useState(false);
    const [checkoutMessage, setCheckoutMessage] = useState("");

    // Track if we've already evaluated the upsell decision (once per checkout mount)
    const hasEvaluatedUpsell = useRef(false);

    // Safety guard: prevent state updates after unmount
    const isMounted = useRef(true);
    useEffect(() => {
        const msgs = [
            "{name}, most guests add this before placing their order",
            "{name}, complete your meal with the chef's pick",
            "{name}, don't miss today's most popular pairing",
            "{name}, guests who ordered this also grabbed {item}"
        ];
        setCheckoutMessage(msgs[Math.floor(Math.random() * msgs.length)]);

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

        // No menu items mean no upsell candidates possible
        if (!state.menuItems || state.menuItems.length === 0) return;

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

        // Send FULL menu to backend — it handles all filtering
        rankCandidatesAI(state.menuItems, cartItems)
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

    // Build upsell event payload from current state — used for shown/accepted/rejected
    const buildUpsellEventPayload = (eventType: "shown" | "accepted" | "rejected") => ({
        restaurant_slug: state.restaurantId,
        table_number: state.tableNumber || "",
        item_id: upsellData?.item.id ?? 0,
        cart_value: Math.round(subtotal),
        upsell_value: upsellData ? parsePrice(upsellData.item.price) : 0,
        event_type: eventType,
        gpt_word_count: upsellData?.reason ? upsellData.reason.split(" ").length : 0,
        upsell_reason: upsellData?.reason || "",
        candidate_pool_size: upsellData?.candidate_pool_size || 0,
    });

    // Track upsell shown event when it becomes visible (only after loading completes)
    useEffect(() => {
        if (showUpsell && !upsellLoading) {
            trackUpsellShown({
                restaurant_slug: state.restaurantId,
                table_number: state.tableNumber || "",
                item_id: upsellData?.item.id ?? 0,
                cart_value: Math.round(subtotal),
                candidate_pool_size: upsellData?.candidate_pool_size || 0
            });
            trackUpsellEvent(buildUpsellEventPayload("shown"));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [showUpsell, upsellLoading]);


    const subtotal = Math.round(cartItems.reduce((acc, item) => acc + parsePrice(item.price), 0));
    const tax = Math.round(subtotal * 0.05);
    const total = subtotal + tax;

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [showPhoneModal, setShowPhoneModal] = useState(false);
    const [verifiedPhone, setVerifiedPhone] = useState("");

    // Check localStorage for cached phone verification on mount
    useEffect(() => {
        try {
            const stored = localStorage.getItem("orlena_phone_verification");
            if (stored) {
                const parsed = JSON.parse(stored);
                if (parsed.phone && parsed.expires && Date.now() < parsed.expires) {
                    setVerifiedPhone(parsed.phone);
                }
            }
        } catch {
            // Ignore parse errors
        }
    }, []);

    const submitOrder = useCallback((phone: string) => {
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
            phone
        );

        console.log("[order] order placed");
        alert("Order placed! (Check console for details)");
        // Reset session state after successful order, then navigate back
        resetSessionAfterOrder();
        onBack();
    }, [isSubmitting, state, cartItems, total, upsellAccepted, upsellValue, resetSessionAfterOrder, onBack]);

    const handlePlaceOrder = () => {
        if (isSubmitting) return;

        // If phone is already verified (cached or just verified), submit directly
        if (verifiedPhone) {
            dispatch({ type: "SET_CUSTOMER_PHONE", payload: verifiedPhone });
            submitOrder(verifiedPhone);
            return;
        }

        // Otherwise, show phone verification modal
        setShowPhoneModal(true);
    };

    const handlePhoneVerified = (phone: string) => {
        setVerifiedPhone(phone);
        setShowPhoneModal(false);
        dispatch({ type: "SET_CUSTOMER_PHONE", payload: phone });
        submitOrder(phone);
    };

    const handleAddUpsell = () => {
        if (!upsellData) return;
        trackUpsellEvent(buildUpsellEventPayload("accepted"));
        dispatch({ type: "ADD_TO_CART", payload: upsellData.item });
        dispatch({ type: "INCREMENT_UPSELL_METRIC", payload: "checkoutUpsellAcceptedCount" });
        setUpsellAccepted(true);
        setUpsellValue(parsePrice(upsellData.item.price));
        setShowUpsell(false);
    };

    const handleDismissUpsell = () => {
        trackUpsellEvent(buildUpsellEventPayload("rejected"));
        dispatch({ type: "INCREMENT_UPSELL_METRIC", payload: "checkoutUpsellDismissedCount" });
        setShowUpsell(false);
        // Do NOT navigate, clear cart, or reset lastItemAddedId
    };

    const nameStr = state.userName || "Hey";
    const sourceItem = cartItems.find(i => i.id === state.lastItemAddedId);
    const sourceItemName = sourceItem?.name || "Your order";
    
    const displayCheckoutMessage = checkoutMessage
        .replace("{name}", nameStr)
        .replace("{item}", upsellData?.item.name || "");

    return (
        <div className="min-h-screen bg-warm-bg flex flex-col max-w-md mx-auto relative shadow-[0_0_40px_rgba(0,0,0,0.05)] border-x border-gray-100">
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
                                    <span className="font-medium text-highlight font-body">₹{Math.round(parsePrice(item.price))}</span>
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
                <div className="sticky bottom-0 z-40 bg-white px-6 py-6 sm:py-8 shadow-[0_-10px_30px_rgba(0,0,0,0.1)] rounded-t-3xl sm:rounded-none mt-auto">

                    {/* Optional Addition - Calm Upsell */}
                    {(showUpsell || upsellLoading) && (
                        <div className="mb-6 border-t border-gray-100 pt-5 animate-fade-in">
                            <p className="text-sm font-medium text-gray-600 mb-3">{displayCheckoutMessage}</p>

                            {upsellLoading ? (
                                <div className="space-y-3 mb-4">
                                    <div className="h-6 w-24 bg-gray-100 rounded-full animate-pulse" />
                                    <div className="flex items-center justify-between">
                                        <div className="space-y-2">
                                            <div className="h-4 w-32 bg-gray-100 rounded animate-pulse" />
                                            <div className="h-3 w-16 bg-gray-100 rounded animate-pulse" />
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="bg-orange-50/60 rounded-xl p-4 border border-orange-100 mb-4">
                                    <div className="flex items-center justify-center mb-3">
                                        <span className="text-sm font-medium text-dark text-center truncate">{sourceItemName}</span>
                                        <span className="text-lg font-bold text-[#FF6B35] mx-2">+</span>
                                        <span className="text-sm font-medium text-dark text-center truncate">{upsellData?.item.name}</span>
                                    </div>

                                    <div className="text-center">
                                        <div className="text-xs text-gray-400 mb-0.5 inline-block">
                                           ₹{Math.round(parsePrice(sourceItem?.price || "0"))} + ₹{Math.round(upsellData ? parsePrice(upsellData.item.price) : 0)}
                                        </div>
                                        <div className="text-base font-bold text-gray-800">
                                            Both for ₹{Math.round(parsePrice(sourceItem?.price || "0")) + Math.round(upsellData ? parsePrice(upsellData.item.price) : 0)}
                                        </div>
                                    </div>
                                </div>
                            )}

                            <style>{`
                                @keyframes checkout-pulse {
                                    0% { transform: scale(1); }
                                    50% { transform: scale(1.02); }
                                    100% { transform: scale(1); }
                                }
                                .animate-checkout-pulse {
                                    animation: checkout-pulse 600ms ease-in-out 1;
                                }
                            `}</style>

                            <div className="flex flex-col gap-2 mt-2">
                                <button
                                    onClick={handleAddUpsell}
                                    disabled={upsellLoading}
                                    className="w-full py-3.5 bg-[#FF6B35] text-white font-bold rounded-xl text-base shadow-md shadow-orange-200/50 animate-checkout-pulse transition-transform active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed text-center"
                                >
                                    Add Both to Order
                                </button>
                                <button
                                    onClick={handleDismissUpsell}
                                    disabled={upsellLoading}
                                    className="w-full py-2.5 bg-orange-50 text-[#FF6B35] font-medium rounded-xl text-sm border border-orange-200 transition-transform active:scale-95 disabled:opacity-50 text-center"
                                >
                                    Just my order
                                </button>
                            </div>
                        </div>
                    )}

                    <div className="space-y-3 mb-8 text-sm text-dark/80 font-medium">
                        <div className="flex justify-between">
                            <span>Subtotal</span>
                            <span className="font-bold">₹{Math.round(subtotal)}</span>
                        </div>
                        <div className="flex justify-between">
                            <span>Tax (5%)</span>
                            <span>₹{Math.round(tax)}</span>
                        </div>
                        <div className="flex justify-between text-2xl font-heading font-bold text-dark border-t border-dashed border-gray-200 pt-4 mt-4">
                            <span>Total</span>
                            <span>₹{Math.round(total)}</span>
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

            {/* Phone Verification Modal */}
            {showPhoneModal && (
                <PhoneVerificationModal
                    onVerified={handlePhoneVerified}
                    onClose={() => setShowPhoneModal(false)}
                />
            )}
        </div>
    );
}
