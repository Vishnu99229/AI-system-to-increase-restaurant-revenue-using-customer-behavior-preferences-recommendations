import { useState, useEffect, useRef } from "react";

import { fetchMenu } from "../utils/api";
import type { Item } from "../utils/recommendations";
import { useApp } from "../contexts/AppContext";
import SearchBar from "../components/SearchBar";
import CategoryNav from "../components/CategoryNav";
import MenuItemCard from "../components/MenuItemCard";
import CartPreviewBar from "../components/CartPreviewBar";
import CartOverlay from "../components/CartOverlay";
import BottomNav from "../components/BottomNav";

export default function Menu({ onBack: _onBack }: { onBack: () => void }) {
    const { state, dispatch } = useApp();

    const [items, setItems] = useState<Item[]>(state.menuItems);
    const [loading, setLoading] = useState(state.menuItems.length === 0);
    const [searchQuery, setSearchQuery] = useState("");
    const [activeCategory, setActiveCategory] = useState("");
    const [isCartOpen, setIsCartOpen] = useState(false);
    const [activeTab, setActiveTab] = useState<"menu" | "orders" | "bill">("menu");

    const categoryRefs = useRef<Record<string, HTMLElement | null>>({});

    // Fetch menu on mount
    useEffect(() => {
        if (state.menuItems.length > 0) {
            setItems(state.menuItems);
            setLoading(false);
            return;
        }
        const slug = state.restaurantId;
        if (!slug) { setLoading(false); return; }

        fetchMenu(slug).then(menuItems => {
            setItems(menuItems);
            dispatch({ type: "SET_MENU_ITEMS", payload: menuItems });
            setLoading(false);
        });
    }, [state.restaurantId]); // eslint-disable-line react-hooks/exhaustive-deps

    // Derive categories
    const categories = [...new Set(items.map(i => i.category))];

    // Set initial active category
    useEffect(() => {
        if (categories.length > 0 && !activeCategory) {
            setActiveCategory(categories[0]);
        }
    }, [categories.length]); // eslint-disable-line react-hooks/exhaustive-deps

    // Filter items by search
    const filteredItems = searchQuery
        ? items.filter(i => i.name.toLowerCase().includes(searchQuery.toLowerCase()))
        : items;

    // Group by category
    const filteredCategories = [...new Set(filteredItems.map(i => i.category))];

    const handleCategoryClick = (cat: string) => {
        setActiveCategory(cat);
        const el = categoryRefs.current[cat];
        if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "start" });
        }
    };

    // Intersection observer to update active category on scroll
    useEffect(() => {
        const observer = new IntersectionObserver(
            entries => {
                for (const entry of entries) {
                    if (entry.isIntersecting) {
                        const cat = entry.target.getAttribute("data-category");
                        if (cat) setActiveCategory(cat);
                    }
                }
            },
            { rootMargin: "-100px 0px -60% 0px", threshold: 0.1 }
        );

        Object.values(categoryRefs.current).forEach(el => {
            if (el) observer.observe(el);
        });

        return () => observer.disconnect();
    }, [filteredCategories.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

    if (loading) {
        return (
            <div className="min-h-screen bg-warm-bg flex items-center justify-center">
                <div className="text-center">
                    <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                    <p className="text-highlight text-sm font-medium">Loading menu...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-warm-bg pb-32 relative">
            {/* Header */}
            <div className="bg-warm-bg px-5 pt-6 pb-3 sticky top-0 z-20">
                <div className="flex items-center justify-between mb-3">
                    <div>
                        <p className="text-xs text-highlight font-medium">Welcome, {state.userName || "Guest"}</p>
                        <h1 className="text-2xl font-heading font-bold text-dark">Menu</h1>
                    </div>
                    {state.tableNumber && (
                        <div className="bg-primary/15 border border-primary/25 rounded-lg px-3 py-1.5 text-xs font-bold text-dark">
                            🪑 Table {state.tableNumber}
                        </div>
                    )}
                </div>

                {/* Search */}
                <SearchBar onSearch={setSearchQuery} />

                {/* Category Nav */}
                {!searchQuery && categories.length > 0 && (
                    <div className="mt-3">
                        <CategoryNav
                            categories={categories}
                            activeCategory={activeCategory}
                            onCategoryClick={handleCategoryClick}
                        />
                    </div>
                )}
            </div>

            {/* Menu Content */}
            {activeTab === "menu" && (
                <div className="px-5 py-3">
                    {filteredItems.length === 0 ? (
                        <div className="text-center py-16">
                            <p className="text-gray-400 text-base font-medium">No items found</p>
                            {searchQuery && (
                                <p className="text-gray-400 text-sm mt-1">Try a different search term</p>
                            )}
                        </div>
                    ) : (
                        <div className="space-y-8">
                            {filteredCategories.map(category => (
                                <section
                                    key={category}
                                    ref={el => { categoryRefs.current[category] = el; }}
                                    data-category={category}
                                >
                                    <h2 className="text-lg font-heading font-bold text-dark mb-3 flex items-center gap-2">
                                        <span className="w-1 h-5 bg-primary rounded-full" />
                                        {category}
                                    </h2>
                                    <div className="space-y-3">
                                        {filteredItems
                                            .filter(item => item.category === category)
                                            .map(item => (
                                                <MenuItemCard key={item.id} item={item} />
                                            ))
                                        }
                                    </div>
                                </section>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Orders Tab Placeholder */}
            {activeTab === "orders" && (
                <div className="px-5 py-16 text-center">
                    <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                    <h3 className="text-lg font-heading font-bold text-dark mb-1">Your Orders</h3>
                    <p className="text-sm text-gray-400">Order history will appear here</p>
                </div>
            )}

            {/* Bill Tab Placeholder */}
            {activeTab === "bill" && (
                <div className="px-5 py-16 text-center">
                    <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                    <h3 className="text-lg font-heading font-bold text-dark mb-1">Ask for Bill</h3>
                    <p className="text-sm text-gray-400">Request your bill when you're ready</p>
                    <button className="mt-6 bg-dark text-white px-8 py-3 rounded-xl font-bold text-sm hover:bg-dark/90 active:scale-95 transition-all">
                        Request Bill
                    </button>
                </div>
            )}

            {/* Cart Preview Bar */}
            <CartPreviewBar onViewCart={() => setIsCartOpen(true)} />

            {/* Cart Overlay */}
            <CartOverlay isOpen={isCartOpen} onClose={() => setIsCartOpen(false)} />

            {/* Bottom Navigation */}
            <BottomNav activeTab={activeTab} onTabChange={setActiveTab} />
        </div>
    );
}
