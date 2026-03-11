import { createContext, useContext, useEffect, useReducer } from "react";
import type { ReactNode } from "react";
import type { Item } from "../utils/recommendations";

// --- State Definition ---

export interface AppState {
    userName: string;
    customerName: string;
    customerPhone: string;
    restaurantId: string;
    tableNumber: string;
    cartItems: Item[];
    viewedItems: Item[];
    itemNotes: Record<number, string>;
    orderNote: string;
    activeTab: "menu" | "orders" | "bill";
    recommendationAcceptedBeforeCheckout: boolean;
    checkoutUpsellShown: boolean;
    lastItemAddedId: number | null;
    pairingAcceptedByItemId: Record<number, boolean>;
    checkoutUpsellShownByItemId: Record<number, boolean>;
    menuUpsellItemPrice: number;
    menuItems: Item[];
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
    customerName: "",
    customerPhone: "",
    restaurantId: "",
    tableNumber: "",
    cartItems: [],
    viewedItems: [],
    itemNotes: {},
    orderNote: "",
    activeTab: "menu",
    recommendationAcceptedBeforeCheckout: false,
    checkoutUpsellShown: false,
    lastItemAddedId: null,
    pairingAcceptedByItemId: {},
    checkoutUpsellShownByItemId: {},
    menuUpsellItemPrice: 0,
    menuItems: [],
    upsellMetrics: {
        pairingShownCount: 0,
        pairingAcceptedCount: 0,
        pairingDismissedCount: 0,
        checkoutUpsellShownCount: 0,
        checkoutUpsellAcceptedCount: 0,
        checkoutUpsellDismissedCount: 0,
    },
};

// --- Helpers ---

function getItemQuantity(cartItems: Item[], itemId: number): number {
    return cartItems.filter(i => i.id === itemId).length;
}

// --- Actions ---

export type AppAction =
    | { type: "SET_USER_NAME"; payload: string }
    | { type: "SET_CUSTOMER_NAME"; payload: string }
    | { type: "SET_CUSTOMER_PHONE"; payload: string }
    | { type: "ADD_TO_CART"; payload: Item }
    | { type: "REMOVE_FROM_CART"; payload: number }
    | { type: "REMOVE_ONE_FROM_CART"; payload: number }
    | { type: "CLEAR_CART" }
    | { type: "ADD_VIEWED_ITEM"; payload: Item }
    | { type: "SET_ITEM_NOTE"; payload: { itemId: number; note: string } }
    | { type: "SET_ORDER_NOTE"; payload: string }
    | { type: "SET_ACTIVE_TAB"; payload: "menu" | "orders" | "bill" }
    | { type: "MARK_RECOMMENDATION_ACCEPTED_BEFORE_CHECKOUT" }
    | { type: "MARK_CHECKOUT_UPSELL_SHOWN" }
    | { type: "MARK_PAIRING_ACCEPTED_FOR_ITEM"; payload: number }
    | { type: "MARK_CHECKOUT_UPSELL_SHOWN_FOR_ITEM"; payload: number }
    | { type: "INCREMENT_UPSELL_METRIC"; payload: keyof UpsellMetrics }
    | { type: "SET_MENU_UPSELL_ITEM_PRICE"; payload: number }
    | { type: "SET_MENU_ITEMS"; payload: Item[] }
    | { type: "SET_TABLE_INFO"; payload: { restaurantId: string; tableNumber: string } }
    | { type: "RESET_SESSION_AFTER_ORDER" }
    | { type: "LOGOUT" };

// --- Reducer ---

function appReducer(state: AppState, action: AppAction): AppState {
    switch (action.type) {
        case "SET_USER_NAME":
            return { ...state, userName: action.payload };
        case "SET_CUSTOMER_NAME":
            return { ...state, customerName: action.payload };
        case "SET_CUSTOMER_PHONE":
            return { ...state, customerPhone: action.payload };
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
        case "REMOVE_ONE_FROM_CART": {
            // Remove only the LAST occurrence of the item with this ID
            const idx = state.cartItems.map(i => i.id).lastIndexOf(action.payload);
            if (idx === -1) return state;
            const next = [...state.cartItems];
            next.splice(idx, 1);
            return { ...state, cartItems: next };
        }
        case "CLEAR_CART":
            return { ...state, cartItems: [] };
        case "ADD_VIEWED_ITEM":
            if (state.viewedItems.some(item => item.id === action.payload.id)) {
                return state;
            }
            return { ...state, viewedItems: [...state.viewedItems, action.payload] };
        case "SET_ITEM_NOTE":
            return {
                ...state,
                itemNotes: {
                    ...state.itemNotes,
                    [action.payload.itemId]: action.payload.note,
                },
            };
        case "SET_ORDER_NOTE":
            return { ...state, orderNote: action.payload };
        case "SET_ACTIVE_TAB":
            return { ...state, activeTab: action.payload };
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
        case "SET_MENU_UPSELL_ITEM_PRICE":
            return { ...state, menuUpsellItemPrice: action.payload };
        case "SET_MENU_ITEMS":
            return { ...state, menuItems: action.payload };
        case "SET_TABLE_INFO":
            return {
                ...state,
                restaurantId: action.payload.restaurantId,
                tableNumber: action.payload.tableNumber,
            };
        case "RESET_SESSION_AFTER_ORDER":
            return {
                ...state,
                cartItems: [],
                viewedItems: [],
                itemNotes: {},
                orderNote: "",
                recommendationAcceptedBeforeCheckout: false,
                checkoutUpsellShown: false,
                lastItemAddedId: null,
                pairingAcceptedByItemId: {},
                checkoutUpsellShownByItemId: {},
                menuUpsellItemPrice: 0,
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
    getItemQuantity: (itemId: number) => number;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

const STORAGE_KEY = "qr-menu-app-state";

export function AppProvider({ children }: { children: ReactNode }) {
    const [state, dispatch] = useReducer(appReducer, initialState, (defaultState) => {
        const stored = sessionStorage.getItem(STORAGE_KEY);
        if (stored) {
            try {
                const parsed = JSON.parse(stored);
                return {
                    ...defaultState,
                    ...parsed,
                    customerName: parsed.customerName ?? "",
                    customerPhone: parsed.customerPhone ?? "",
                    restaurantId: parsed.restaurantId ?? "",
                    tableNumber: parsed.tableNumber ?? "",
                    itemNotes: parsed.itemNotes ?? {},
                    orderNote: parsed.orderNote ?? "",
                    activeTab: parsed.activeTab ?? "menu",
                    recommendationAcceptedBeforeCheckout: parsed.recommendationAcceptedBeforeCheckout ?? false,
                    checkoutUpsellShown: parsed.checkoutUpsellShown ?? false,
                    lastItemAddedId: parsed.lastItemAddedId ?? null,
                    pairingAcceptedByItemId: parsed.pairingAcceptedByItemId ?? {},
                    checkoutUpsellShownByItemId: parsed.checkoutUpsellShownByItemId ?? {},
                    menuUpsellItemPrice: parsed.menuUpsellItemPrice ?? 0,
                    menuItems: parsed.menuItems ?? [],
                    upsellMetrics: parsed.upsellMetrics ?? defaultState.upsellMetrics,
                };
            } catch (e) {
                console.error("Failed to parse stored app state", e);
                return defaultState;
            }
        }
        return defaultState;
    });

    useEffect(() => {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }, [state]);

    const resetSessionAfterOrder = () => {
        dispatch({ type: "RESET_SESSION_AFTER_ORDER" });
    };

    const getItemQty = (itemId: number) => getItemQuantity(state.cartItems, itemId);

    return (
        <AppContext.Provider value={{ state, dispatch, resetSessionAfterOrder, getItemQuantity: getItemQty }}>
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
