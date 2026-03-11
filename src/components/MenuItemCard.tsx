import { useApp } from "../contexts/AppContext";
import type { Item } from "../utils/recommendations";

interface MenuItemCardProps {
    item: Item;
}

export default function MenuItemCard({ item }: MenuItemCardProps) {
    const { dispatch, getItemQuantity } = useApp();
    const qty = getItemQuantity(item.id);

    const handleAdd = () => {
        dispatch({ type: "ADD_TO_CART", payload: item });
    };

    const handleIncrement = () => {
        dispatch({ type: "ADD_TO_CART", payload: item });
    };

    const handleDecrement = () => {
        dispatch({ type: "REMOVE_ONE_FROM_CART", payload: item.id });
    };

    return (
        <div className="bg-white rounded-2xl shadow-soft border border-transparent hover:border-primary/15 transition-all duration-200 overflow-hidden" id={`menu-item-${item.id}`}>
            <div className="flex">
                {/* Image placeholder */}
                <div className="w-28 h-28 bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center shrink-0">
                    {item.image_url ? (
                        <img src={item.image_url} alt={item.name} className="w-full h-full object-cover" />
                    ) : (
                        <svg className="w-8 h-8 text-primary/30" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" />
                        </svg>
                    )}
                </div>

                {/* Content */}
                <div className="flex-1 p-3 flex flex-col justify-between min-w-0">
                    <div>
                        <h3 className="font-heading font-bold text-dark text-base leading-tight truncate">{item.name}</h3>
                        {item.description && (
                            <p className="text-xs text-gray-400 mt-0.5 line-clamp-2 font-body leading-relaxed">{item.description}</p>
                        )}
                    </div>
                    <div className="flex items-center justify-between mt-2">
                        <span className="text-highlight font-bold text-sm">{item.price}</span>
                        {qty === 0 ? (
                            <button
                                onClick={handleAdd}
                                className="bg-dark text-white text-xs font-bold px-4 py-1.5 rounded-lg hover:bg-dark/90 active:scale-95 transition-all"
                                id={`add-btn-${item.id}`}
                            >
                                + Add
                            </button>
                        ) : (
                            <div className="flex items-center gap-1 bg-dark rounded-lg overflow-hidden">
                                <button
                                    onClick={handleDecrement}
                                    className="text-white w-7 h-7 flex items-center justify-center hover:bg-dark/80 transition-colors text-sm font-bold"
                                    id={`decrement-btn-${item.id}`}
                                >
                                    −
                                </button>
                                <span className="text-white text-xs font-bold w-5 text-center">{qty}</span>
                                <button
                                    onClick={handleIncrement}
                                    className="text-white w-7 h-7 flex items-center justify-center hover:bg-dark/80 transition-colors text-sm font-bold"
                                    id={`increment-btn-${item.id}`}
                                >
                                    +
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
