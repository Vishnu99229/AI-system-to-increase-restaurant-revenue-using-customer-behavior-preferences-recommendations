import { useApp } from "../contexts/AppContext";

interface CartPreviewBarProps {
    onViewCart: () => void;
}

export default function CartPreviewBar({ onViewCart }: CartPreviewBarProps) {
    const { state } = useApp();
    const itemCount = state.cartItems.length;

    if (itemCount === 0) return null;

    return (
        <div className="fixed bottom-16 left-0 right-0 z-30 px-4 pb-2 pointer-events-none">
            <div className="max-w-md mx-auto pointer-events-auto">
                <div
                    className="bg-dark text-white rounded-2xl shadow-lg flex items-center justify-between px-5 py-3.5 animate-fade-in cursor-pointer hover:bg-dark/95 active:scale-[0.98] transition-all"
                    onClick={onViewCart}
                    id="cart-preview-bar"
                >
                    <div className="flex items-center gap-2">
                        <span className="bg-primary text-dark text-xs font-bold rounded-full w-6 h-6 flex items-center justify-center">
                            {itemCount}
                        </span>
                        <span className="text-sm font-semibold">
                            {itemCount === 1 ? "1 Item in cart" : `${itemCount} Items in cart`}
                        </span>
                    </div>
                    <span className="text-sm font-bold flex items-center gap-1">
                        View Cart
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                        </svg>
                    </span>
                </div>
            </div>
        </div>
    );
}
