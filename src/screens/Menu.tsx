import { useState, useEffect, useRef, useMemo } from "react";
import { fetchMenu, trackUpsellShown } from "../utils/api";
import { chatWithMenuAssistant } from "../utils/api";
import { rankCandidatesAI } from "../utils/recommendations";
import type { Item } from "../utils/recommendations";
import type { MenuChatMessage } from "../utils/api";
import { getCachedRecommendation, getCachedRecSync } from "../utils/recommendationCache";
import { useApp } from "../contexts/AppContext";

// Playful upsell headline variants. Selected deterministically using
// itemId % array.length so each menu item consistently shows the same
// variant across all taps in all sessions.
const UPSELL_HEADLINE_VARIANTS: string[] = [
    "this pair is basically engaged",
    "the combo that refuses to be apart",
    "two items, one vibe",
    "some pairings just get each other",
    "these two, a little love story",
    "a duo that belongs on a poster",
    "certified dream team on the menu",
    "they come as a package, honestly",
    "a pairing the regulars keep on speed dial",
    "legally, these should be sold together"
];

function getUpsellHeadline(primaryItemId: number, userName?: string | null): string {
    const index = Math.abs(primaryItemId) % UPSELL_HEADLINE_VARIANTS.length;
    const variant = UPSELL_HEADLINE_VARIANTS[index];
    const trimmedName = (userName || "").trim();
    if (trimmedName.length > 0) {
        return `${trimmedName}, ${variant}`;
    }
    // No name: capitalize the first letter of the variant
    return variant.charAt(0).toUpperCase() + variant.slice(1);
}

// Playful microcopy variants shown below the combined price. Deterministic
// by itemId so the same item always shows the same line.
const UPSELL_MICROCOPY_VARIANTS: string[] = [
    "the crowd pleaser move",
    "objectively the smart choice",
    "tiny upgrade, big win",
    "trust the menu on this one",
    "this is how you cafe",
    "a small yes, a big vibe",
    "future you will thank you"
];

function getUpsellMicrocopy(primaryItemId: number): string {
    const index = Math.abs(primaryItemId) % UPSELL_MICROCOPY_VARIANTS.length;
    return UPSELL_MICROCOPY_VARIANTS[index];
}
interface MenuProps {
    onBack: () => void;
    onViewCart: () => void;
}

// --- Tab-to-Category Mapping ---
const TAB_GROUPS: Record<string, string[]> = {
    "Drinks": ["Coffee", "Tea", "Hot Chocolate", "Brewmaster's Picks", "Fresh Juices"],
    "Breakfast": ["All Day Breakfast", "Eggs", "Pancakes Waffles Crepes", "Savoury Waffles"],
    "Mains": ["Sandwiches", "Cafe Classics", "Pastas", "Signature Salads"],
    "Snacks": ["Quick Bites", "Bakery", "Ice Creams"],
    "Healthy": ["Healthy Options"],
};

const TAB_NAMES = Object.keys(TAB_GROUPS);
const DEFAULT_TAB = "Drinks";
const CHAT_OPENING_TEXT = "Hey! I know this menu well. Ask me anything -- what's good, what's popular, what goes well together.";
const QUICK_REPLIES: string[] = ["What's popular? 🔥", "Something cold 🧊", "Surprise me ✨"];

// --- Diet-dot color by tags ---
function getDietDot(tags?: string[]): { color: string; label: string } | null {
    if (!tags || tags.length === 0) return null;
    if (tags.includes("non-veg")) return { color: "#E24B4A", label: "Non-veg" };
    if (tags.includes("egg")) return { color: "#F4B400", label: "Contains egg" };
    if (tags.includes("veg")) return { color: "#1D9E75", label: "Veg" };
    return null;
}

function MenuItemImage({ src, alt, className = "" }: { src?: string; alt: string; className?: string }) {
    const [loaded, setLoaded] = useState(false);
    const [error, setError] = useState(false);

    if (!src || error) {
        return (
            <div className={`bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center text-gray-300 ${className}`}>
                <svg className="w-8 h-8 opacity-30" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" />
                </svg>
            </div>
        );
    }

    return (
        <div className={`relative overflow-hidden ${className}`}>
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

function getCafeInitial(slug?: string): string {
    const fallback = "O";
    if (!slug) return fallback;
    const clean = slug.replace(/-/g, " ").trim();
    if (!clean) return fallback;
    return clean.charAt(0).toUpperCase();
}

function ChatGlyph({ showClose }: { showClose: boolean }) {
    return (
        <span className="relative block w-6 h-6">
            <svg
                className={`absolute inset-0 w-6 h-6 transition-opacity duration-200 ${showClose ? "opacity-0" : "opacity-100"}`}
                width="26"
                height="26"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
            >
                <path d="M12 2C6.48 2 2 5.92 2 10.67c0 2.73 1.53 5.15 3.92 6.73L4.5 21.5l4.58-2.15c.95.25 1.93.38 2.92.38 5.52 0 10-3.92 10-8.73S17.52 2 12 2z" fill="white" />
            </svg>
            <svg
                className={`absolute inset-0 w-6 h-6 transition-opacity duration-200 ${showClose ? "opacity-100" : "opacity-0"}`}
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
            >
                <path d="M6 6L18 18M18 6L6 18" stroke="white" strokeWidth="2" strokeLinecap="round" />
            </svg>
        </span>
    );
}

export default function Menu({ onBack, onViewCart }: MenuProps) {
    const { state, dispatch } = useApp();

    const [items, setItems] = useState<Item[]>(state.menuItems);
    const [loading, setLoading] = useState(state.menuItems.length === 0);

    const [sessionOrders, setSessionOrders] = useState<any[]>([]);

    useEffect(() => {
        if (!state.restaurantId) return;
        try {
            const sessionOrdersKey = `${state.restaurantId}_session_orders`;
            const stored = localStorage.getItem(sessionOrdersKey);
            if (stored) {
                setSessionOrders(JSON.parse(stored));
            }
        } catch (err) {
            console.warn("Failed to parse session orders:", err);
        }
    }, [state.restaurantId]);

    const getRelativeTime = (placedAt: string) => {
        const diffMs = Date.now() - new Date(placedAt).getTime();
        const mins = Math.round(diffMs / 60000);
        if (mins < 1) return "just now";
        if (mins < 60) return `${mins}m ago`;
        const hours = Math.round(mins / 60);
        return `${hours}h ago`;
    };

    const [selectedItem, setSelectedItem] = useState<Item | null>(null);
    const [quantity, setQuantity] = useState(1);
    const [showAddedToast, setShowAddedToast] = useState(false);
    const [showChatBubble, setShowChatBubble] = useState(false);
    const [bubbleBreathing, setBubbleBreathing] = useState(false);
    const [sheetOpen, setSheetOpen] = useState(false);
    const [sheetClosing, setSheetClosing] = useState(false);
    const [showSheetContent, setShowSheetContent] = useState(false);
    const [showInitialTyping, setShowInitialTyping] = useState(false);
    const [showQuickReplies, setShowQuickReplies] = useState(false);
    const [messages, setMessages] = useState<MenuChatMessage[]>([]);
    const [chatInput, setChatInput] = useState("");
    const [chatLoading, setChatLoading] = useState(false);
    const [activeChip, setActiveChip] = useState<string | null>(null);
    const [keyboardInset, setKeyboardInset] = useState(0);

    const hasTrackedCurrentModal = useRef(false);
    const threadRef = useRef<HTMLDivElement>(null);

    const [upsellData, setUpsellData] = useState<{ item: Item; tag: string } | null>(null);

    // --- Navigation / Filter State ---
    const [activeTab, setActiveTab] = useState(() => {
        const params = new URLSearchParams(window.location.search);
        return params.get("tab") || DEFAULT_TAB;
    });
    const [searchQuery, setSearchQuery] = useState("");
    const [vegOnly, setVegOnly] = useState(false);

    const tabScrollRef = useRef<HTMLDivElement>(null);
    const categoryRefs = useRef<Record<string, HTMLElement | null>>({});

    useEffect(() => {
        if (!items || items.length === 0) return;

        // Prefetch real AI recommendations for every menu item, in parallel
        // Each call hits /api/rank-upsell with the item as cart and full menu as candidates
        items.forEach((item) => {
            getCachedRecommendation(item.id, async () => {
                try {
                    const rec = await rankCandidatesAI(items, [item]);
                    if (rec && rec.item) {
                        return {
                            item: rec.item,
                            reason: rec.reason || "Recommended for you",
                            candidate_pool_size: rec.candidate_pool_size
                        };
                    }
                    return null;
                } catch (err) {
                    console.error(`[Menu] Prefetch failed for item ${item.id}`, err);
                    return null;
                }
            });
        });
    }, [items]);

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

    useEffect(() => {
        if (selectedItem && upsellData && !hasTrackedCurrentModal.current) {
            hasTrackedCurrentModal.current = true;
            trackUpsellShown({
                restaurant_slug: state.restaurantId,
                table_number: state.tableNumber || "",
                item_id: upsellData.item.id,
                cart_value: 0,
                candidate_pool_size: items.length
            });
            dispatch({ type: "INCREMENT_UPSELL_METRIC", payload: "pairingShownCount" });
            // Cache this recommendation so Checkout can use it without a fresh API call
            dispatch({
                type: "SET_LAST_RECOMMENDATION",
                payload: { item: upsellData.item, reason: upsellData.tag }
            });
        }
    }, [selectedItem, upsellData]);

    // --- Browsable items: exclude add-ons ---
    const browseItems = useMemo(() => {
        return items.filter(i => !i.tags?.includes("addon"));
    }, [items]);

    // --- Filtered items based on active tab, search, veg toggle ---
    const { filteredGroups, resultCount, isSearching } = useMemo(() => {
        const query = searchQuery.trim().toLowerCase();
        const isSearching = query.length > 0;

        let pool = browseItems;

        // Veg-only filter: include only items with 'veg' tag (exclude egg, non-veg)
        if (vegOnly) {
            pool = pool.filter(i => {
                const tags = i.tags || [];
                return tags.includes("veg") && !tags.includes("egg") && !tags.includes("non-veg");
            });
        }

        if (isSearching) {
            // Search across name, description, category (ignore active tab)
            pool = pool.filter(i => {
                const haystack = `${i.name} ${i.description || ""} ${i.category}`.toLowerCase();
                return haystack.includes(query);
            });
        } else {
            // Filter by active tab's categories
            const tabCategories = TAB_GROUPS[activeTab];
            if (tabCategories) {
                pool = pool.filter(i => tabCategories.includes(i.category));
            }
        }

        // Group by category preserving insertion order
        const groups: { category: string; items: Item[] }[] = [];
        const seen = new Set<string>();
        for (const item of pool) {
            if (!seen.has(item.category)) {
                seen.add(item.category);
                groups.push({ category: item.category, items: [] });
            }
            groups.find(g => g.category === item.category)!.items.push(item);
        }

        return { filteredGroups: groups, resultCount: pool.length, isSearching };
    }, [browseItems, activeTab, searchQuery, vegOnly]);

    // --- Tab click handler ---
    const handleTabClick = (tab: string) => {
        setActiveTab(tab);
        setSearchQuery("");

        // Update URL param
        const params = new URLSearchParams(window.location.search);
        params.set("tab", tab);
        window.history.replaceState({}, "", `?${params.toString()}`);

        // Scroll to top of content
        window.scrollTo({ top: 0, behavior: "smooth" });
    };

    // --- Scroll active tab pill into view ---
    useEffect(() => {
        if (tabScrollRef.current) {
            const activeBtn = tabScrollRef.current.querySelector('[data-active="true"]');
            if (activeBtn) {
                activeBtn.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
            }
        }
    }, [activeTab]);

    const handleItemClick = (item: Item) => {
        setSelectedItem(item);
        setQuantity(1);
        dispatch({ type: "ADD_VIEWED_ITEM", payload: item });

        const cached = getCachedRecSync(item.id);
        if (cached) {
            setUpsellData({ item: cached.item, tag: cached.reason });
        } else {
            setUpsellData(null);
            getCachedRecommendation(item.id, async () => {
                try {
                    const rec = await rankCandidatesAI(items, [item]);
                    if (rec && rec.item) {
                        return {
                            item: rec.item,
                            reason: rec.reason || "Recommended for you",
                            candidate_pool_size: rec.candidate_pool_size
                        };
                    }
                    return null;
                } catch (err) {
                    console.error(`[Menu] Fetch failed for item ${item.id}`, err);
                    return null;
                }
            }).then(result => {
                if (result) {
                    setUpsellData({ item: result.item, tag: result.reason });
                }
            });
        }
    };

    const closeDetail = () => {
        setSelectedItem(null);
        setUpsellData(null);
        hasTrackedCurrentModal.current = false;
    };

    const handleAddToOrder = (item: Item) => {
        for (let i = 0; i < quantity; i++) {
            dispatch({ type: "ADD_TO_CART", payload: item });
        }
        setShowAddedToast(true);
        setTimeout(() => setShowAddedToast(false), 1500);
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
            dispatch({ type: "ADD_TO_CART", payload: { ...recItem, is_upsell: true } });
        }
        setShowAddedToast(true);
        setTimeout(() => setShowAddedToast(false), 1500);
        closeDetail();
    };

    const getPriceValue = (priceStr?: string) => parseFloat((priceStr || "").replace(/[^0-9.]/g, "")) || 0;

    useEffect(() => {
        const showTimer = window.setTimeout(() => {
            setShowChatBubble(true);
            setBubbleBreathing(true);
        }, 3000);
        const stopPulseTimer = window.setTimeout(() => setBubbleBreathing(false), 9000);

        return () => {
            window.clearTimeout(showTimer);
            window.clearTimeout(stopPulseTimer);
        };
    }, []);

    useEffect(() => {
        if (!threadRef.current) return;
        threadRef.current.scrollTo({
            top: threadRef.current.scrollHeight,
            behavior: "smooth"
        });
    }, [messages, chatLoading, showInitialTyping]);

    useEffect(() => {
        if (!sheetOpen) {
            setKeyboardInset(0);
            return;
        }

        const viewport = window.visualViewport;
        if (!viewport) return;

        const updateInset = () => {
            const inset = Math.max(0, Math.round(window.innerHeight - viewport.height));
            setKeyboardInset(inset);
        };

        updateInset();
        viewport.addEventListener("resize", updateInset);
        viewport.addEventListener("scroll", updateInset);
        return () => {
            viewport.removeEventListener("resize", updateInset);
            viewport.removeEventListener("scroll", updateInset);
        };
    }, [sheetOpen]);

    useEffect(() => {
        if (!sheetOpen) return;

        setShowSheetContent(false);
        setShowInitialTyping(false);
        setShowQuickReplies(false);
        setMessages([]);
        setChatInput("");
        setChatLoading(false);

        const avatarTimer = window.setTimeout(() => setShowSheetContent(true), 400);
        const typingTimer = window.setTimeout(() => setShowInitialTyping(true), 600);
        const greetingTimer = window.setTimeout(() => {
            setShowInitialTyping(false);
            setMessages([{ role: "assistant", content: CHAT_OPENING_TEXT }]);
        }, 1400);
        const chipTimer = window.setTimeout(() => setShowQuickReplies(true), 1800);

        return () => {
            window.clearTimeout(avatarTimer);
            window.clearTimeout(typingTimer);
            window.clearTimeout(greetingTimer);
            window.clearTimeout(chipTimer);
        };
    }, [sheetOpen]);

    const closeChatSheet = () => {
        setSheetClosing(true);
        window.setTimeout(() => {
            setSheetOpen(false);
            setSheetClosing(false);
            setShowQuickReplies(false);
            setShowInitialTyping(false);
            setMessages([]);
            setChatInput("");
            setChatLoading(false);
            setActiveChip(null);
        }, 280);
    };

    const openChatSheet = () => {
        setSheetClosing(false);
        setSheetOpen(true);
    };

    const sendChatMessage = async (rawText: string) => {
        const text = rawText.trim();
        if (!text || chatLoading || !state.restaurantId) return;

        const baseHistory = messages;
        const userMessage: MenuChatMessage = { role: "user", content: text };
        const nextMessages = [...baseHistory, userMessage];
        setMessages(nextMessages);
        setChatInput("");
        setChatLoading(true);
        setShowQuickReplies(false);

        try {
            const data = await chatWithMenuAssistant(state.restaurantId, text, nextMessages);
            const assistantMessage: MenuChatMessage = {
                role: "assistant",
                content: data.reply
            };
            setMessages((prev) => [...prev, assistantMessage]);
        } catch (err) {
            console.error("Menu chat failed:", err);
            setMessages((prev) => [
                ...prev,
                { role: "assistant", content: "Hmm, something went wrong. Try asking again?" }
            ]);
        } finally {
            setChatLoading(false);
        }
    };

    const onChipTap = async (chip: string) => {
        if (chatLoading) return;
        setActiveChip(chip);
        window.setTimeout(() => setActiveChip(null), 150);
        window.setTimeout(() => {
            sendChatMessage(chip);
        }, 150);
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-warm-bg flex items-center justify-center max-w-md mx-auto">
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
                    <div className="fixed bottom-10 left-1/2 transform -translate-x-1/2 text-sm bg-gray-800 text-white px-4 py-2 rounded-lg shadow-lg z-50">
                        Added to order
                    </div>
                )}

                {/* ===== STICKY HEADER ===== */}
                <div className="sticky top-0 z-30 bg-white/95 backdrop-blur-md shadow-sm">
                    {/* Top row: back + restaurant name */}
                    <div className="flex items-center gap-3 px-4 pt-3 pb-1">
                        <button
                            onClick={onBack}
                            className="text-gray-500 hover:text-dark transition-colors shrink-0"
                            aria-label="Go back"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
                            </svg>
                        </button>
                        <span className="text-sm font-medium text-gray-600 truncate font-body">
                            {state.restaurantId ? state.restaurantId.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()) : "Menu"}
                        </span>
                        {state.tableNumber && (
                            <span className="text-xs text-gray-400 ml-auto shrink-0 font-body">
                                Table {state.tableNumber}
                            </span>
                        )}
                    </div>

                    {/* YOUR ORDERS TODAY section */}
                    {sessionOrders.length > 0 && (
                        <div className="px-4 py-3 mb-3 bg-white w-full max-w-md mx-auto">
                            <h3 className="text-xs font-bold tracking-wider mb-2" style={{ color: "rgba(26, 26, 46, 0.5)", textTransform: "uppercase" }}>
                                YOUR ORDERS TODAY
                            </h3>
                            <div 
                                className="flex flex-row gap-2 overflow-x-auto pb-1"
                                style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
                            >
                                <style>{`
                                    .hide-scrollbar::-webkit-scrollbar {
                                        display: none;
                                    }
                                `}</style>
                                <div className="flex gap-2 hide-scrollbar">
                                    {sessionOrders.map((order, i) => (
                                        <div 
                                            key={order.id} 
                                            className="bg-white rounded-xl p-3 flex flex-col gap-1 border"
                                            style={{ minWidth: "180px", maxWidth: "200px", borderColor: "rgba(0,0,0,0.06)" }}
                                        >
                                            <div className="text-[11px] font-medium" style={{ color: "rgba(26,26,46,0.5)" }}>
                                                Order #{sessionOrders.length - i} &middot; Table {order.tableNumber}
                                            </div>
                                            <div className="text-sm font-semibold text-[#1A1A2E] line-clamp-2 leading-tight">
                                                {order.items.map((it: any) => it.name).join(", ")}
                                            </div>
                                            <div className="flex justify-between items-center mt-auto pt-1">
                                                <span className="font-bold text-sm text-[#FF6B35]">₹{Math.round(order.total)}</span>
                                                <span className="text-[11px]" style={{ color: "rgba(26,26,46,0.4)" }}>
                                                    {getRelativeTime(order.placedAt)}
                                                </span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Search bar */}
                    <div className="px-4 py-2">
                        <div className="relative">
                            <svg
                                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                            >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Search items"
                                aria-label="Search menu items"
                                className="w-full pl-9 pr-8 py-2.5 rounded-xl bg-gray-100 text-sm text-dark placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#FF6B35]/30 focus:bg-white transition-all font-body border border-transparent focus:border-[#FF6B35]/20"
                            />
                            {searchQuery && (
                                <button
                                    onClick={() => setSearchQuery("")}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                                    aria-label="Clear search"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Tab pills row */}
                    <div
                        ref={tabScrollRef}
                        className="flex gap-2 px-4 pb-3 overflow-x-auto no-scrollbar"
                        role="tablist"
                        aria-label="Menu categories"
                    >
                        {/* Veg Only toggle */}
                        <button
                            onClick={() => setVegOnly(!vegOnly)}
                            className={`shrink-0 flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all border ${
                                vegOnly
                                    ? "bg-[#1D9E75] text-white border-[#1D9E75] shadow-sm"
                                    : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
                            }`}
                            aria-pressed={vegOnly}
                            aria-label={vegOnly ? "Show all items" : "Show veg only"}
                        >
                            <span
                                className={`inline-block w-2.5 h-2.5 rounded-full ${
                                    vegOnly ? "bg-white" : "bg-[#1D9E75]"
                                }`}
                            />
                            Veg
                        </button>

                        {/* Category tabs */}
                        {TAB_NAMES.map(tab => (
                            <button
                                key={tab}
                                role="tab"
                                aria-selected={activeTab === tab && !isSearching}
                                data-active={activeTab === tab && !isSearching}
                                onClick={() => handleTabClick(tab)}
                                className={`shrink-0 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all border ${
                                    activeTab === tab && !isSearching
                                        ? "bg-[#FF6B35] text-white border-[#FF6B35] shadow-sm"
                                        : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
                                }`}
                            >
                                {tab}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Search result count */}
                {isSearching && (
                    <div className="px-5 pt-3 pb-1">
                        <p className="text-xs text-gray-400 font-body">
                            {resultCount} {resultCount === 1 ? "result" : "results"}
                        </p>
                    </div>
                )}

                {/* ===== MENU CONTENT ===== */}
                <div className="px-4 py-4 space-y-8">
                    {filteredGroups.length === 0 ? (
                        <div className="text-center py-16">
                            {isSearching ? (
                                <div>
                                    <p className="text-gray-400 text-base font-body mb-1">
                                        No items match "{searchQuery}".
                                    </p>
                                    <p className="text-gray-300 text-sm font-body">
                                        Try a different search
                                    </p>
                                </div>
                            ) : (
                                <div>
                                    <p className="text-gray-400 text-base font-body mb-1">
                                        Nothing here yet.
                                    </p>
                                    <p className="text-gray-300 text-sm font-body">
                                        Try another tab
                                    </p>
                                </div>
                            )}
                        </div>
                    ) : (
                        filteredGroups.map(group => (
                            <section
                                key={group.category}
                                ref={(el) => { categoryRefs.current[group.category] = el; }}
                            >
                                <h2 className="text-base font-semibold text-gray-700 mb-3 font-body tracking-wide">
                                    {group.category}
                                </h2>
                                <div className="space-y-3">
                                    {group.items.map((item) => {
                                        const dietDot = getDietDot(item.tags);
                                        return (
                                            <div
                                                key={item.id}
                                                onClick={() => handleItemClick(item)}
                                                className="bg-white/80 backdrop-blur-sm p-4 rounded-2xl shadow-soft border border-transparent hover:border-primary/20 hover:shadow-soft-lg flex items-center justify-between cursor-pointer active:scale-[0.98] hover:scale-[1.01] transition-all duration-300 relative"
                                            >
                                                {/* Diet dot indicator */}
                                                {dietDot && (
                                                    <span
                                                        className="absolute top-3 right-3 w-3 h-3 rounded-sm z-10"
                                                        style={{ backgroundColor: dietDot.color }}
                                                        title={dietDot.label}
                                                        aria-label={dietDot.label}
                                                    />
                                                )}

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
                                                    <p className="text-highlight font-medium mt-1 font-body">₹{Math.round(getPriceValue(item.price))}</p>
                                                </div>
                                                <MenuItemImage
                                                    src={item.image_url}
                                                    alt={item.name}
                                                    className="w-20 h-20 rounded-xl shrink-0 shadow-sm"
                                                />
                                            </div>
                                        );
                                    })}
                                </div>
                            </section>
                        ))
                    )}
                </div>

                {/* Item Detail Modal */}
                {selectedItem && (
                    <div className="fixed inset-0 z-50 flex items-end justify-center pointer-events-none">
                        {/* Backdrop */}
                        <div
                            className="absolute inset-0 bg-black/30 backdrop-blur-sm pointer-events-auto transition-opacity animate-fade-in"
                            onClick={closeDetail}
                        />

                        {/* Modal Content */}
                        <div className="bg-white w-full max-w-md rounded-t-2xl sm:rounded-3xl p-6 sm:p-8 shadow-2xl transform transition-transform pointer-events-auto relative animate-slide-up">
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

                            <div className="mb-2">
                                <h2 className="text-lg font-bold mb-2 text-dark">{selectedItem.name}</h2>
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        {selectedItem.discountedPrice ? (
                                            <>
                                                <p className="text-sm text-gray-400 line-through opacity-50">₹{Math.round(getPriceValue(selectedItem.originalPrice))}</p>
                                                <p className="text-[#FF6B35] font-semibold text-base">₹{Math.round(getPriceValue(selectedItem.discountedPrice))}</p>
                                            </>
                                        ) : (
                                            <p className="text-[#FF6B35] font-semibold text-base">₹{Math.round(getPriceValue(selectedItem.price))}</p>
                                        )}
                                    </div>
                                    <div className="flex items-center bg-white border border-gray-200 rounded-full shadow-sm p-1">
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
                            </div>

                            {/* Combo Card Section */}
                            {upsellData && (
                                <div className="border-t border-dashed border-gray-200 mt-4 pt-4">
                                    <p className="text-[15px] font-semibold text-[#1A1A2E] mb-3">{getUpsellHeadline(selectedItem.id, state.userName || state.customerName)}</p>
                                    
                                    <span className="inline-block bg-[#FF6B35] text-white text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full mb-2">
                                        REGULARS' PICK
                                    </span>
                                    
                                    <div 
                                        className="rounded-xl p-4 animate-[subtlePulse_600ms_ease-out_1]"
                                        style={{ backgroundColor: 'rgba(255, 107, 53, 0.06)', border: '1px solid rgba(255, 107, 53, 0.15)' }}
                                    >
                                        <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 mb-3">
                                            <span className="text-sm font-medium text-dark text-center truncate whitespace-normal break-words">{selectedItem.name}</span>
                                            <span className="text-lg font-bold text-[#FF6B35] mx-2">+</span>
                                            <span className="text-sm font-medium text-dark text-center truncate whitespace-normal break-words">{upsellData.item.name}</span>
                                        </div>

                                        <div className="text-center">
                                            <div className="text-sm font-medium" style={{ color: 'rgba(26, 26, 46, 0.6)' }}>
                                               Add {upsellData.item.name} for just ₹{Math.round(getPriceValue(upsellData.item.discountedPrice || upsellData.item.price))} more
                                            </div>
                                            <div className="text-base font-bold text-[#1A1A2E]">
                                                ₹{Math.round(getPriceValue(selectedItem.discountedPrice || selectedItem.price) + getPriceValue(upsellData.item.discountedPrice || upsellData.item.price))} for the pair
                                            </div>
                                            <div className="text-xs font-medium mt-1" style={{ color: 'rgba(26, 26, 46, 0.4)' }}>
                                                {getUpsellMicrocopy(selectedItem.id)}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            <style>{`
                                @keyframes gentle-pulse {
                                    0% { transform: scale(1); }
                                    50% { transform: scale(1.02); }
                                    100% { transform: scale(1); }
                                }
                                .animate-gentle-pulse {
                                    animation: gentle-pulse 600ms ease-in-out 1;
                                }
                                @keyframes subtlePulse {
                                    0% { transform: scale(1); }
                                    50% { transform: scale(1.02); }
                                    100% { transform: scale(1); }
                                }
                            `}</style>

                            <div className="mt-6">
                                {upsellData ? (
                                    <div className="flex flex-col gap-2">
                                        <button
                                            onClick={() => handleAddBothToOrder(selectedItem, upsellData.item)}
                                            className="w-full py-3.5 bg-[#FF6B35] text-white font-bold rounded-xl text-base shadow-md shadow-orange-200/50 animate-gentle-pulse transition-transform active:scale-95"
                                        >
                                            Yes, add both
                                        </button>
                                        <button
                                            onClick={() => handleAddToOrder(selectedItem)}
                                            className="w-full py-2.5 bg-orange-50 text-[#FF6B35] font-medium rounded-xl text-sm border border-orange-200 transition-transform active:scale-95"
                                        >
                                            Just this for now
                                        </button>
                                    </div>
                                ) : (
                                    <button
                                        onClick={() => handleAddToOrder(selectedItem)}
                                        className="w-full py-3.5 bg-[#FF6B35] text-white font-bold rounded-xl text-base shadow-md shadow-orange-200/50 transition-transform active:scale-95 flex justify-center items-center"
                                    >
                                        Add to Order
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                <button
                    type="button"
                    aria-label={sheetOpen ? "Close menu chat" : "Open menu chat"}
                    onClick={() => (sheetOpen ? closeChatSheet() : openChatSheet())}
                    className={`fixed right-5 z-[1000] w-14 h-14 rounded-full shadow-lg transition-transform ${showChatBubble ? (bubbleBreathing ? "chat-bubble-breathe" : "chat-bubble-enter") : "scale-0 opacity-0"}`}
                    style={{
                        bottom: state.cartItems.length > 0 ? "108px" : "24px",
                        backgroundColor: "#FF6B35"
                    }}
                >
                    <span className="inline-flex items-center justify-center w-full h-full">
                        <ChatGlyph showClose={sheetOpen} />
                    </span>
                </button>

                {sheetOpen && (
                    <>
                        <button
                            type="button"
                            aria-label="Close menu chat"
                            onClick={closeChatSheet}
                            className={`fixed inset-0 z-[1001] bg-black/35 ${sheetClosing ? "chat-overlay-out" : "chat-overlay-in"}`}
                        />
                        <div
                            className={`fixed left-0 right-0 z-[1002] bg-[#FAFAFA] rounded-t-[24px] shadow-[0_-8px_40px_rgba(0,0,0,0.12)] ${sheetClosing ? "chat-sheet-out" : "chat-sheet-in"}`}
                            style={{
                                height: "70vh",
                                bottom: `${Math.round((state.cartItems.length > 0 ? 88 : 0) + keyboardInset)}px`
                            }}
                        >
                            <div className="w-full h-full flex flex-col">
                                <div className="flex justify-center pt-3">
                                    <div className="w-10 h-1 rounded-sm bg-[#D1D1D1]" />
                                </div>
                                <div className="px-5 py-3.5 border-b border-[#EEEEEE] flex items-center justify-between min-h-[64px]">
                                    <div className={`flex items-center gap-2.5 transition-opacity duration-300 ${showSheetContent ? "opacity-100" : "opacity-0"}`}>
                                        <div className="w-7 h-7 rounded-full bg-[#FF6B35] text-white text-sm font-semibold flex items-center justify-center">
                                            {getCafeInitial(state.restaurantId)}
                                        </div>
                                        <div>
                                            <div className="text-base font-semibold text-[#1A1A2E] leading-tight">Orlena</div>
                                            <div className="text-xs text-[#888888] leading-tight mt-0.5">Powered by GPT</div>
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        aria-label="Close chat panel"
                                        onClick={closeChatSheet}
                                        className="w-11 h-11 flex items-center justify-center text-[#999999]"
                                    >
                                        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
                                            <path d="M6 6L18 18M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                                        </svg>
                                    </button>
                                </div>

                                <div ref={threadRef} className="flex-1 overflow-y-auto px-4 pt-4 pb-2 space-y-3 chat-thread-scroll">
                                    {messages.map((msg, idx) => (
                                        <div key={`${msg.role}-${idx}`} className={`w-full flex ${msg.role === "assistant" ? "justify-start" : "justify-end"} chat-message-in`}>
                                            <div
                                                className={`max-w-[82%] text-sm leading-[1.5] break-words ${
                                                    msg.role === "assistant"
                                                        ? "bg-white border border-[#EEEEEE] text-[#1A1A2E] rounded-[18px_18px_18px_6px] px-4 py-3"
                                                        : "bg-[#FF6B35] text-white rounded-[18px_18px_6px_18px] px-4 py-3"
                                                }`}
                                            >
                                                {msg.content}
                                            </div>
                                        </div>
                                    ))}
                                    {(showInitialTyping || chatLoading) && (
                                        <div className="w-full flex justify-start chat-message-in">
                                            <div className="bg-white border border-[#EEEEEE] rounded-[18px_18px_18px_6px] px-5 py-3">
                                                <div className="flex items-center gap-1.5">
                                                    <span className="chat-dot" />
                                                    <span className="chat-dot" />
                                                    <span className="chat-dot" />
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {showQuickReplies && messages.length === 1 && messages[0]?.role === "assistant" && (
                                    <div className="px-4 py-2 overflow-x-auto chat-thread-scroll">
                                        <div className="flex gap-2 w-max">
                                            {QUICK_REPLIES.map((chip, idx) => (
                                                <button
                                                    key={chip}
                                                    type="button"
                                                    onClick={() => onChipTap(chip)}
                                                    className={`px-[18px] py-2 rounded-full text-[13px] font-medium whitespace-nowrap border-[1.5px] transition-all ${
                                                        activeChip === chip ? "bg-[#FF6B35] text-white border-[#FF6B35]" : "bg-white text-[#FF6B35] border-[#FF6B35]"
                                                    } chat-chip-in`}
                                                    style={{ animationDelay: `${Math.round(idx * 80)}ms`, minHeight: "36px" }}
                                                >
                                                    {chip}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                <form
                                    onSubmit={(e) => {
                                        e.preventDefault();
                                        sendChatMessage(chatInput);
                                    }}
                                    className="px-4 py-3 bg-white border-t border-[#EEEEEE]"
                                    style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}
                                >
                                    <div className="flex items-center">
                                        <input
                                            value={chatInput}
                                            onChange={(e) => setChatInput(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === "Enter") {
                                                    e.preventDefault();
                                                    sendChatMessage(chatInput);
                                                }
                                            }}
                                            placeholder="Ask about the menu..."
                                            className="flex-1 rounded-[24px] bg-[#F5F5F5] border-[1.5px] border-transparent focus:border-[#FF6B35] focus:outline-none text-sm px-5 py-3 transition-colors duration-200"
                                            disabled={chatLoading}
                                        />
                                        <button
                                            type="submit"
                                            disabled={!chatInput.trim() || chatLoading}
                                            className={`ml-2.5 w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200 ${chatInput.trim() && !chatLoading ? "bg-[#FF6B35] active:scale-90" : "bg-[#E0E0E0] cursor-not-allowed"}`}
                                            aria-label="Send message"
                                        >
                                            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none">
                                                <path d="M12 19V6M12 6L7 11M12 6L17 11" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                            </svg>
                                        </button>
                                    </div>
                                </form>
                            </div>
                        </div>
                    </>
                )}

                <style>{`
                    @keyframes chatBubbleIn {
                        0% { transform: scale(0); opacity: 0; }
                        70% { transform: scale(1.15); opacity: 1; }
                        100% { transform: scale(1); opacity: 1; }
                    }
                    @keyframes chatBubblePulse {
                        0% { box-shadow: 0 8px 20px rgba(255,107,53,0.28); }
                        50% { box-shadow: 0 8px 28px rgba(255,107,53,0.42); }
                        100% { box-shadow: 0 8px 20px rgba(255,107,53,0.28); }
                    }
                    @keyframes chatOverlayIn {
                        from { opacity: 0; }
                        to { opacity: 1; }
                    }
                    @keyframes chatOverlayOut {
                        from { opacity: 1; }
                        to { opacity: 0; }
                    }
                    @keyframes chatSheetIn {
                        from { transform: translateY(100%); }
                        to { transform: translateY(0); }
                    }
                    @keyframes chatSheetOut {
                        from { transform: translateY(0); }
                        to { transform: translateY(100%); }
                    }
                    @keyframes chatMessageIn {
                        from { opacity: 0; transform: translateY(8px); }
                        to { opacity: 1; transform: translateY(0); }
                    }
                    @keyframes chatDotWave {
                        0%, 100% { transform: scale(1); opacity: 0.8; }
                        50% { transform: scale(1.4); opacity: 1; }
                    }
                    @keyframes chatChipIn {
                        from { opacity: 0; transform: translateX(20px); }
                        to { opacity: 1; transform: translateX(0); }
                    }
                    .chat-bubble-enter {
                        animation: chatBubbleIn 500ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
                    }
                    .chat-bubble-breathe {
                        animation:
                            chatBubbleIn 500ms cubic-bezier(0.34, 1.56, 0.64, 1) both,
                            chatBubblePulse 2s ease-in-out 3;
                    }
                    .chat-overlay-in {
                        animation: chatOverlayIn 250ms ease-out both;
                    }
                    .chat-overlay-out {
                        animation: chatOverlayOut 250ms ease-out both;
                    }
                    .chat-sheet-in {
                        animation: chatSheetIn 350ms cubic-bezier(0.32, 0.72, 0, 1) both;
                    }
                    .chat-sheet-out {
                        animation: chatSheetOut 280ms cubic-bezier(0.32, 0.72, 0, 1) both;
                    }
                    .chat-message-in {
                        animation: chatMessageIn 300ms ease-out both;
                    }
                    .chat-dot {
                        width: 6px;
                        height: 6px;
                        border-radius: 999px;
                        background: #BBBBBB;
                        display: block;
                        animation: chatDotWave 900ms ease-in-out infinite;
                    }
                    .chat-dot:nth-child(2) { animation-delay: 150ms; }
                    .chat-dot:nth-child(3) { animation-delay: 300ms; }
                    .chat-chip-in {
                        animation: chatChipIn 300ms ease-out both;
                    }
                    .chat-thread-scroll {
                        scrollbar-width: none;
                        -webkit-overflow-scrolling: touch;
                    }
                    .chat-thread-scroll::-webkit-scrollbar {
                        display: none;
                    }
                `}</style>
            </div>
        </div>
    );
}
