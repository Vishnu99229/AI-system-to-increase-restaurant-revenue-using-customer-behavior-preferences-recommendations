import { useRef, useEffect } from "react";

interface CategoryNavProps {
    categories: string[];
    activeCategory: string;
    onCategoryClick: (category: string) => void;
}

export default function CategoryNav({ categories, activeCategory, onCategoryClick }: CategoryNavProps) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const activeRef = useRef<HTMLButtonElement>(null);

    // Auto-scroll to keep active pill visible
    useEffect(() => {
        if (activeRef.current && scrollRef.current) {
            const container = scrollRef.current;
            const pill = activeRef.current;
            const left = pill.offsetLeft - container.offsetLeft - 16;
            container.scrollTo({ left, behavior: "smooth" });
        }
    }, [activeCategory]);

    return (
        <div
            ref={scrollRef}
            className="flex gap-2 overflow-x-auto hide-scrollbar py-1"
        >
            {categories.map(cat => {
                const isActive = cat === activeCategory;
                return (
                    <button
                        key={cat}
                        ref={isActive ? activeRef : null}
                        onClick={() => onCategoryClick(cat)}
                        className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-semibold transition-all duration-200 shrink-0
                            ${isActive
                                ? "bg-dark text-white shadow-md"
                                : "bg-white text-dark/70 border border-gray-200 hover:border-primary/30 hover:text-dark"
                            }`}
                        id={`category-pill-${cat.replace(/\s+/g, '-').toLowerCase()}`}
                    >
                        {cat}
                    </button>
                );
            })}
        </div>
    );
}
