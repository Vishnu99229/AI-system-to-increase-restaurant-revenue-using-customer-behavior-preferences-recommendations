import { useState, useEffect, useRef, useMemo } from "react";
import { fetchMenu, trackUpsellShown } from "../utils/api";
import type { Item } from "../utils/recommendations";
import { useApp } from "../contexts/AppContext";
import { Button } from "../components/Button";

const UPSELL_TAGS = [
    "🔥 Popular",
    "❤️ Most liked",
    "👨‍🍳 Chef's pick",
    "🤝 Combo deal"
];

interface MenuProps {
    onBack: () => void;
    onViewCart: () => void;
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

export default function Menu({ onBack, onViewCart }: MenuProps) {
    const { state, dispatch } = useApp();

    const [items, setItems] = useState<Item[]>(state.menuItems);
    const [loading, setLoading] = useState(state.menuItems.length === 0);

    const [selectedItem, setSelectedItem] = useState<Item | null>(null);
    const [quantity, setQuantity] = useState(1);

    const hasTrackedCurrentModal = useRef(false);

    const precomputedRecs = useMemo(() => {
        const map = new Map<number, { item: Item; tag: string }>();
        if (!items.length) return map;

        items.forEach((item) => {
            const candidates = items.filter(i => i.id !== item.id && i.category !== item.category);
            const pool = candidates.length > 0 ? candidates : items.filter(i => i.id !== item.id);

            if (pool.length > 0) {
                const recItem = pool[item.id % pool.length];
                const tag = UPSELL_TAGS[item.id % UPSELL_TAGS.length];
                map.set(item.id, { item: recItem, tag });
            }
        });

        return map;
    }, [items]);

    const upsellData = selectedItem ? precomputedRecs.get(selectedItem.id) : null;

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
    }, [state.restaurantId]);

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
        }
    }, [selectedItem, upsellData]);

    const handleItemClick = (item: Item) => {
        setSelectedItem(item);
        setQuantity(1);
        dispatch({ type: "ADD_VIEWED_ITEM", payload: item });
    };

    const closeDetail = () => {
        setSelectedItem(null);
        hasTrackedCurrentModal.current = false;
    };

    const handleAddToOrder = (item: Item) => {
        for (let i = 0; i < quantity; i++) {
            dispatch({ type: "ADD_TO_CART", payload: item });
        }
        
    };

    const handleAddBothToOrder = (mainItem: Item, recItem: Item) => {
        for (let i = 0; i < quantity; i++) {
            dispatch({ type: "ADD_TO_CART", payload: mainItem });
            dispatch({ type: "ADD_TO_CART", payload: recItem });
        }
        closeDetail();
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-warm-bg flex items-center justify-center">
                <p className="text-highlight text-lg font-medium">Loading menu...</p>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-warm-bg pb-24">

            {state.cartItems.length > 0 && (
                <button
                    onClick={onViewCart}
                    className="fixed bottom-6 right-4 left-4 mx-auto max-w-xs bg-dark text-white px-6 py-4 rounded-xl shadow-lg z-40 font-bold flex items-center justify-center gap-3"
                >
                    <span>View Order</span>
                    <span className="bg-white text-dark rounded-full min-w-[24px] h-6 px-2 flex items-center justify-center text-sm font-bold">
                        {state.cartItems.length}
                    </span>
                </button>
            )}

            <div className="px-6 pt-8 pb-2">
                <button onClick={onBack} className="text-highlight mb-4 font-medium">← Back</button>
                <h1 className="text-4xl font-bold mb-1 text-dark">Menu</h1>
            </div>

            <div className="px-6 py-4 space-y-6">
                {items.map((item) => (
                    <div
                        key={item.id}
                        onClick={() => handleItemClick(item)}
                        className="bg-white p-4 rounded-xl shadow flex justify-between cursor-pointer"
                    >
                        <div>
                            <h3 className="font-bold">{item.name}</h3>
                            <p>{item.price}</p>
                        </div>
                        <MenuItemImage src={item.image_url} alt={item.name} className="w-20 h-20 rounded-xl" />
                    </div>
                ))}
            </div>

            {selectedItem && (
                <div className="fixed inset-0 z-50 flex items-end justify-center">
                    <div className="absolute inset-0 bg-black/30" onClick={closeDetail} />
                    <div className="bg-white w-full max-w-md rounded-t-2xl p-6 relative">
                        <h2 className="text-2xl font-bold">{selectedItem.name}</h2>

                        {upsellData && (
                            <div className="mt-4 flex justify-between">
                                <span>{upsellData.item.name}</span>
                                <button
                                    onClick={() => handleAddBothToOrder(selectedItem, upsellData.item)}
                                    className="bg-orange-500 text-white px-3 py-1 rounded"
                                >
                                    Add
                                </button>
                            </div>
                        )}

                        <Button onClick={() => handleAddToOrder(selectedItem)} fullWidth>
                            Add to Order
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}
