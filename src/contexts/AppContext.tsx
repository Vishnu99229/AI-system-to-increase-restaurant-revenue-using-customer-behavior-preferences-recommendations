import { createContext, useContext, useEffect, useReducer } from "react";
import type { ReactNode } from "react";
import type { Item } from "../utils/recommendations";

// --- State Definition ---

/**
 * Session State for QR Menu App
 * 
 * STATE MODEL (Per-Item Tracking):
 * 
 * Per-item maps:
 * - pairingAcceptedByItemId: Records which items had their pairing accepted via "Add Both to Order".
 * - checkoutUpsellShownByItemId: Records which items have already been shown a checkout upsell.
 * 
 * Checkout upsell decision (per item):
 *   shouldShowCheckoutUpsell =
 *     lastItemAddedId != null
 *     AND pairingAcceptedByItemId[lastItemAddedId] is NOT true
 *     AND checkoutUpsellShownByItemId[lastItemAddedId] is NOT true
 *     AND confidence >= 0.75
 * 
 * Legacy session-level booleans (recommendationAcceptedBeforeCheckout, checkoutUpsellShown)
 * are kept for backwards compatibility but are no longer used in checkout trigger logic.
 */
export interface AppState {
    userName: string;
    restaurantId: string;
    tableNumber: string;
    cartItems: Item[];
    viewedItems: Item[];
    recommendationAcceptedBeforeCheckout: boolean;
    checkoutUpsellShown: boolean;
    lastItemAddedId: number | null;
    pairingAcceptedByItemId: Record<number, boolean>;
    checkoutUpsellShownByItemId: Record<number, boolean>;
    upsellMetrics: UpsellMetrics;
}

export interface UpsellMetrics {
    pairingShownCount: number;
    pairingAcceptedCount: number;
    pairingDismissedCount: number;
    checkoutUpsellShownCount: number;
    checkoutUpsellAcceptedCount: number;
    checkoutUpsellDismissedCount: number;
}

const initialState: AppState = {
    userName: "",
    restaurantId: "",
    tableNumber: "",
    cartItems: [],
    viewedItems: [],
    recommendationAcceptedBeforeCheckout: false,
    checkoutUpsellShown: false,
    lastItemAddedId: null,
    pairingAcceptedByItemId: {},
    checkoutUpsellShownByItemId: {},
    upsellMetrics: {
        pairingShownCount: 0,
        pairingAcceptedCount: 0,
        pairingDismissedCount: 0,
        checkoutUpsellShownCount: 0,
        checkoutUpsellAcceptedCount: 0,
        checkoutUpsellDismissedCount: 0,
    },
};

// --- Actions ---

export type AppAction =
    | { type: "SET_USER_NAME"; payload: string }
    | { type: "ADD_TO_CART"; payload: Item }
    | { type: "REMOVE_FROM_CART"; payload: number } // remove by ID
    | { type: "CLEAR_CART" }
    | { type: "ADD_VIEWED_ITEM"; payload: Item }
    | { type: "MARK_RECOMMENDATION_ACCEPTED_BEFORE_CHECKOUT" }
    | { type: "MARK_CHECKOUT_UPSELL_SHOWN" }
    | { type: "MARK_PAIRING_ACCEPTED_FOR_ITEM"; payload: number }
    | { type: "MARK_CHECKOUT_UPSELL_SHOWN_FOR_ITEM"; payload: number }
    | { type: "INCREMENT_UPSELL_METRIC"; payload: keyof UpsellMetrics }
    | { type: "SET_TABLE_INFO"; payload: { restaurantId: string; tableNumber: string } }
    | { type: "RESET_SESSION_AFTER_ORDER" }
    | { type: "LOGOUT" };

// --- Reducer ---

function appReducer(state: AppState, action: AppAction): AppState {
    switch (action.type) {
        case "SET_USER_NAME":
            return { ...state, userName: action.payload };
        case "ADD_TO_CART":
            return {
                ...state,
                cartItems: [...state.cartItems, action.payload],
                lastItemAddedId: action.payload.id,
            };
        case "REMOVE_FROM_CART":
            return {
                ...state,
                cartItems: state.cartItems.filter(item => item.id !== action.payload),
            };
        case "CLEAR_CART":
            return {
                ...state,
                cartItems: [],
            };
        case "ADD_VIEWED_ITEM":
            if (state.viewedItems.some(item => item.id === action.payload.id)) {
                return state;
            }
            return { ...state, viewedItems: [...state.viewedItems, action.payload] };
        case "MARK_RECOMMENDATION_ACCEPTED_BEFORE_CHECKOUT":
            return { ...state, recommendationAcceptedBeforeCheckout: true };
        case "MARK_CHECKOUT_UPSELL_SHOWN":
            return { ...state, checkoutUpsellShown: true };
        case "MARK_PAIRING_ACCEPTED_FOR_ITEM":
            return {
                ...state,
                pairingAcceptedByItemId: {
                    ...state.pairingAcceptedByItemId,
                    [action.payload]: true,
                },
            };
        case "MARK_CHECKOUT_UPSELL_SHOWN_FOR_ITEM":
            return {
                ...state,
                checkoutUpsellShownByItemId: {
                    ...state.checkoutUpsellShownByItemId,
                    [action.payload]: true,
                },
            };
        case "SET_TABLE_INFO":
            return {
                ...state,
                restaurantId: action.payload.restaurantId,
                tableNumber: action.payload.tableNumber,
            };
        case "RESET_SESSION_AFTER_ORDER":
            // Clear cart-related state but preserve userName, table info for returning customers
            return {
                ...state,
                cartItems: [],
                viewedItems: [],
                recommendationAcceptedBeforeCheckout: false,
                checkoutUpsellShown: false,
                lastItemAddedId: null,
                pairingAcceptedByItemId: {},
                checkoutUpsellShownByItemId: {},
                // restaurantId/tableNumber persist — table is locked for the session
                // upsellMetrics are session-level and persist across orders
            };
        case "INCREMENT_UPSELL_METRIC":
            return {
                ...state,
                upsellMetrics: {
                    ...state.upsellMetrics,
                    [action.payload]: state.upsellMetrics[action.payload] + 1,
                },
            };
        case "LOGOUT":
            return initialState;
        default:
            return state;
    }
}

// --- Context ---

interface AppContextType {
    state: AppState;
    dispatch: React.Dispatch<AppAction>;
    resetSessionAfterOrder: () => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

const STORAGE_KEY = "qr-menu-app-state";

export function AppProvider({ children }: { children: ReactNode }) {
    const [state, dispatch] = useReducer(appReducer, initialState, (defaultState) => {
        const stored = sessionStorage.getItem(STORAGE_KEY);
        if (stored) {
            try {
                const parsed = JSON.parse(stored);
                // Ensure all required fields exist (handles schema migrations)
                return {
                    ...defaultState,
                    ...parsed,
                    // Ensure new fields have defaults if missing from old storage
                    restaurantId: parsed.restaurantId ?? "",
                    tableNumber: parsed.tableNumber ?? "",
                    recommendationAcceptedBeforeCheckout: parsed.recommendationAcceptedBeforeCheckout ?? false,
                    checkoutUpsellShown: parsed.checkoutUpsellShown ?? false,
                    lastItemAddedId: parsed.lastItemAddedId ?? null,
                    pairingAcceptedByItemId: parsed.pairingAcceptedByItemId ?? {},
                    checkoutUpsellShownByItemId: parsed.checkoutUpsellShownByItemId ?? {},
                    upsellMetrics: parsed.upsellMetrics ?? {
                        pairingShownCount: 0,
                        pairingAcceptedCount: 0,
                        pairingDismissedCount: 0,
                        checkoutUpsellShownCount: 0,
                        checkoutUpsellAcceptedCount: 0,
                        checkoutUpsellDismissedCount: 0,
                    },
                };
            } catch (e) {
                console.error("Failed to parse stored app state", e);
                return defaultState;
            }
        }
        return defaultState;
    });

    useEffect(() => {
        if (import.meta.env.DEV) {
            console.log("AppContext State Update:", {
                lastItemAddedId: state.lastItemAddedId,
                upsellMetrics: state.upsellMetrics,
            });
        }
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }, [state]);

    const resetSessionAfterOrder = () => {
        dispatch({ type: "RESET_SESSION_AFTER_ORDER" });
    };

    return (
        <AppContext.Provider value={{ state, dispatch, resetSessionAfterOrder }}>
            {children}
        </AppContext.Provider>
    );
}

export function useApp() {
    const context = useContext(AppContext);
    if (context === undefined) {
        throw new Error("useApp must be used within an AppProvider");
    }
    return context;
}
