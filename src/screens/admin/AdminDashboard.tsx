import { useState, useEffect, useRef } from "react";
import { fetchAdminAnalytics, fetchAdminOrders, updateOrderStatus, fetchMenu, addMenuItem, updateMenuItem, deleteMenuItem } from "../../utils/api";

interface AdminDashboardProps {
    slug: string;
    onLogout: () => void;
}

export default function AdminDashboard({ slug, onLogout }: AdminDashboardProps) {
    const [activeTab, setActiveTab] = useState<"analytics" | "orders" | "menu">("analytics");
    const [analytics, setAnalytics] = useState<any>(null);
    const [orders, setOrders] = useState<any[]>([]);
    const [menuItems, setMenuItems] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    const prevOrdersLengthRef = useRef<number>(0);
    const hasInitialLoadedRef = useRef<boolean>(false);
    const unseenCountRef = useRef<number>(0);

    const playBeep = () => {
        try {
            const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
            if (!AudioContext) return;
            const ctx = new AudioContext();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            
            osc.connect(gain);
            gain.connect(ctx.destination);
            
            osc.type = "sine";
            osc.frequency.setValueAtTime(800, ctx.currentTime);
            
            gain.gain.setValueAtTime(0.2, ctx.currentTime);
            
            osc.start();
            osc.stop(ctx.currentTime + 0.25);
        } catch (err) {
            console.error("Audio beep failed:", err);
        }
    };

    const clearUnseen = () => {
        if (activeTab === "orders") {
            unseenCountRef.current = 0;
            document.title = "Admin Panel";
        }
    };

    useEffect(() => {
        if (activeTab === "orders") {
            clearUnseen();
        }
        hasInitialLoadedRef.current = false;
        prevOrdersLengthRef.current = 0;
    }, [activeTab]);

    useEffect(() => {
        const handler = () => clearUnseen();
        window.addEventListener("focus", handler);
        window.addEventListener("click", handler);
        return () => {
            window.removeEventListener("focus", handler);
            window.removeEventListener("click", handler);
        };
    }, [activeTab]);

    useEffect(() => {
        let interval: number | undefined;

        if (activeTab === "orders") {
            interval = window.setInterval(async () => {
                try {
                    const data = await fetchAdminOrders(slug);
                    
                    if (hasInitialLoadedRef.current) {
                        if (data.length > prevOrdersLengthRef.current) {
                            const newCount = data.length - prevOrdersLengthRef.current;
                            unseenCountRef.current += newCount;
                            document.title = `(${unseenCountRef.current} new) Admin Panel`;
                            playBeep();
                        }
                    } else {
                        hasInitialLoadedRef.current = true;
                    }
                    
                    prevOrdersLengthRef.current = data.length;
                    setOrders(data);
                } catch (e) {}
            }, 10000);
        }

        return () => {
            if (interval) window.clearInterval(interval);
        };
    }, [activeTab, slug]);

    const loadData = async () => {
        setLoading(true);
        try {
            if (activeTab === "analytics") {
                const data = await fetchAdminAnalytics(slug);
                setAnalytics(data);
            } else if (activeTab === "orders") {
                const data = await fetchAdminOrders(slug);
                setOrders(data);
            } else if (activeTab === "menu") {
                const data = await fetchMenu(slug);
                setMenuItems(data);
            }
        } catch (err) {
            console.error("Failed to load data", err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, [activeTab]);

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col">
            {/* Header */}
            <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-orange-600 rounded-lg flex items-center justify-center text-white font-bold text-xl">D</div>
                    <h1 className="text-xl font-bold text-gray-800">Admin Panel</h1>
                </div>
                <button 
                    onClick={onLogout}
                    className="text-sm font-medium text-gray-500 hover:text-red-600 transition-colors"
                >
                    Logout
                </button>
            </header>

            {/* Navigation Tabs */}
            <nav className="bg-white border-b border-gray-200 px-6 flex gap-8">
                <TabButton active={activeTab === "analytics"} onClick={() => setActiveTab("analytics")}>Analytics</TabButton>
                <TabButton active={activeTab === "orders"} onClick={() => setActiveTab("orders")}>Incoming Orders</TabButton>
                <TabButton active={activeTab === "menu"} onClick={() => setActiveTab("menu")}>Menu Manager</TabButton>
            </nav>

            {/* Content Area */}
            <main className="flex-1 p-6 max-w-7xl mx-auto w-full">
                {loading ? (
                    <div className="h-full flex items-center justify-center">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-600"></div>
                    </div>
                ) : (
                    <>
                        {activeTab === "analytics" && <AnalyticsView data={analytics} />}
                        {activeTab === "orders" && <OrdersView orders={orders} onStatusUpdate={() => loadData()} slug={slug} />}
                        {activeTab === "menu" && <MenuView items={menuItems} onUpdate={() => loadData()} slug={slug} />}
                    </>
                )}
            </main>
        </div>
    );
}

function TabButton({ children, active, onClick }: { children: React.ReactNode; active: boolean; onClick: () => void }) {
    return (
        <button
            onClick={onClick}
            className={`py-4 text-sm font-bold border-b-2 transition-all ${
                active ? "border-orange-600 text-orange-600" : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
        >
            {children}
        </button>
    );
}

function AnalyticsView({ data }: { data: any }) {
    if (!data) return null;

    const cards = [
        { label: "Total Revenue", value: `₹${data.totalRevenue.toLocaleString()}`, color: "bg-green-50 text-green-700" },
        { label: "Total Orders", value: data.totalOrders, color: "bg-blue-50 text-blue-700" },
        { label: "Avg Order Value", value: `₹${data.aov.toFixed(2)}`, color: "bg-purple-50 text-purple-700" },
        { label: "Upsell Revenue", value: `₹${data.upsellRevenue.toLocaleString()}`, color: "bg-orange-50 text-orange-700", highlight: true },
    ];

    return (
        <div className="space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {cards.map((card, i) => (
                    <div key={i} className={`p-6 rounded-2xl border border-gray-100 shadow-sm ${card.color}`}>
                        <p className="text-sm font-bold uppercase tracking-wider opacity-70 mb-1">{card.label}</p>
                        <p className="text-3xl font-black">{card.value}</p>
                    </div>
                ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Impact Chart */}
                <div className="bg-white p-8 rounded-2xl border border-gray-100 shadow-sm">
                    <h3 className="text-lg font-bold text-gray-800 mb-6">Revenue Impact</h3>
                    <div className="space-y-6">
                        <div>
                            <div className="flex justify-between text-sm font-bold mb-2">
                                <span>Revenue from AI Upsells</span>
                                <span className="text-orange-600">+{data.revenueIncreasePercent.toFixed(1)}%</span>
                            </div>
                            <div className="w-full h-4 bg-gray-100 rounded-full overflow-hidden">
                                <div 
                                    className="h-full bg-orange-600 transition-all duration-1000" 
                                    style={{ width: `${Math.min(data.revenueIncreasePercent * 2, 100)}%` }}
                                ></div>
                            </div>
                        </div>
                        <div>
                            <div className="flex justify-between text-sm font-bold mb-2">
                                <span>Upsell Conversion Rate</span>
                                <span className="text-blue-600">{data.upsellConversionRate.toFixed(1)}%</span>
                            </div>
                            <div className="w-full h-4 bg-gray-100 rounded-full overflow-hidden">
                                <div 
                                    className="h-full bg-blue-600 transition-all duration-1000" 
                                    style={{ width: `${data.upsellConversionRate}%` }}
                                ></div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Top Items */}
                <div className="bg-white p-8 rounded-2xl border border-gray-100 shadow-sm">
                    <h3 className="text-lg font-bold text-gray-800 mb-6">Top Upsell Items</h3>
                    <div className="space-y-4">
                        {data.topUpsellItems.map((item: any, i: number) => (
                            <div key={i} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
                                <div className="flex items-center gap-4">
                                    <span className="w-8 h-8 flex items-center justify-center bg-white rounded-lg text-sm font-bold text-gray-400">#{i+1}</span>
                                    <span className="font-bold text-gray-800">{item.name}</span>
                                </div>
                                <div className="text-right">
                                    <p className="text-sm font-bold text-gray-800">{item.count} sold</p>
                                    <p className="text-xs text-green-600 font-bold">₹{item.revenue}</p>
                                </div>
                            </div>
                        ))}
                        {data.topUpsellItems.length === 0 && (
                            <p className="text-center text-gray-500 py-8">No upsell data available yet</p>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

function OrdersView({ orders, onStatusUpdate, slug }: { orders: any[]; onStatusUpdate: () => void; slug: string }) {
    const [showCancelled, setShowCancelled] = useState(false);

    const handleUpdateStatus = async (id: number, status: string) => {
        const success = await updateOrderStatus(slug, id, status);
        if (success) onStatusUpdate();
    };

    const pendingOrders = orders.filter(o => o.status === 'pending');
    const preparingOrders = orders.filter(o => o.status === 'preparing');
    const completedOrders = orders.filter(o => o.status === 'completed');
    const cancelledOrders = orders.filter(o => o.status === 'cancelled');

    const getTimeAgo = (timestamp?: string) => {
        if (!timestamp) return "Just now";
        const mins = Math.floor((new Date().getTime() - new Date(timestamp).getTime()) / 60000);
        if (mins < 1) return "< 1 min ago";
        if (mins === 1) return "1 min ago";
        if (mins > 60) return `${Math.floor(mins / 60)}h ${mins % 60}m ago`;
        return `${mins} mins ago`;
    };

    const OrderCard = ({ order, status }: { order: any, status: 'pending' | 'preparing' | 'completed' }) => {
        const items = JSON.parse(order.items || "[]");
        
        return (
            <div className={`bg-white rounded-xl shadow-sm border p-4 flex flex-col gap-3 transition-all ${
                status === 'completed' ? 'border-[#1D9E75]/30' : 'border-gray-200'
            }`}>
                <div className="flex justify-between items-start">
                    <div>
                        <span className="font-black text-lg text-[#1A1A2E]">#{order.id}</span>
                        <p className="text-sm font-bold text-gray-700 mt-1">{order.customer_name}</p>
                    </div>
                    <span className="text-xs font-bold text-gray-400 bg-gray-100 px-2 py-1 rounded-md">
                        {getTimeAgo(order.created_at)}
                    </span>
                </div>
                
                <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-800 space-y-1">
                    {items.map((item: any, idx: number) => (
                        <div key={idx} className="flex justify-between font-medium">
                            <span>1x {item.name}</span>
                        </div>
                    ))}
                </div>

                <div className="flex justify-between items-center pt-2 border-t border-gray-100">
                    <span className="font-bold text-[#1D9E75]">₹{Math.round(order.total)}</span>
                    {order.customer_phone && <span className="text-xs text-gray-500">{order.customer_phone}</span>}
                </div>

                <div className="grid grid-cols-2 gap-2 mt-2">
                    {status === 'pending' && (
                        <>
                            <button 
                                onClick={() => handleUpdateStatus(order.id, 'preparing')}
                                className="col-span-2 bg-[#FF6B35] text-white hover:bg-[#E85D2A] font-bold py-2 rounded-lg text-sm transition-colors"
                            >
                                Start Preparing
                            </button>
                            <button 
                                onClick={() => handleUpdateStatus(order.id, 'cancelled')}
                                className="col-span-2 bg-transparent text-[#E24B4A] hover:bg-red-50 border border-red-100 font-bold py-1.5 rounded-lg text-xs transition-colors"
                            >
                                Cancel Order
                            </button>
                        </>
                    )}
                    {status === 'preparing' && (
                        <>
                            <button 
                                onClick={() => handleUpdateStatus(order.id, 'completed')}
                                className="col-span-2 bg-[#1D9E75] text-white hover:bg-[#15805E] font-bold py-2 rounded-lg text-sm transition-colors"
                            >
                                Mark Completed
                            </button>
                            <button 
                                onClick={() => handleUpdateStatus(order.id, 'cancelled')}
                                className="col-span-2 bg-transparent text-[#E24B4A] hover:bg-red-50 border border-red-100 font-bold py-1.5 rounded-lg text-xs transition-colors"
                            >
                                Cancel Order
                            </button>
                        </>
                    )}
                    {status === 'completed' && (
                        <div className="col-span-2 text-center py-2 bg-green-50 text-[#1D9E75] rounded-lg text-sm font-bold flex flex-col justify-center gap-1">
                            <span>Completed successfully</span>
                        </div>
                    )}
                </div>
            </div>
        );
    };

    return (
        <div className="flex flex-col gap-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Pending Column */}
                <div className="flex flex-col gap-4 bg-gray-50/50 rounded-2xl p-4 border border-gray-100 min-h-[500px]">
                    <div className="flex justify-between items-center mb-2 px-1">
                        <h2 className="font-black text-gray-800 uppercase tracking-wide text-sm">Order Received</h2>
                        <span className="bg-gray-200 text-gray-700 text-xs font-bold px-2 py-0.5 rounded-full">{pendingOrders.length}</span>
                    </div>
                    {pendingOrders.map(order => (
                        <OrderCard key={order.id} order={order} status="pending" />
                    ))}
                    {pendingOrders.length === 0 && (
                        <div className="text-center py-10 text-gray-400 font-medium text-sm">No new orders</div>
                    )}
                </div>

                {/* Preparing Column */}
                <div className="flex flex-col gap-4 bg-gray-50/50 rounded-2xl p-4 border border-gray-100 min-h-[500px]">
                    <div className="flex justify-between items-center mb-2 px-1">
                        <h2 className="font-black text-gray-800 uppercase tracking-wide text-sm">Preparing</h2>
                        <span className="bg-[#FF6B35]/10 text-[#FF6B35] text-xs font-bold px-2 py-0.5 rounded-full">{preparingOrders.length}</span>
                    </div>
                    {preparingOrders.map(order => (
                        <OrderCard key={order.id} order={order} status="preparing" />
                    ))}
                    {preparingOrders.length === 0 && (
                        <div className="text-center py-10 text-gray-400 font-medium text-sm">No active prep</div>
                    )}
                </div>

                {/* Completed Column */}
                <div className="flex flex-col gap-4 bg-green-50/30 rounded-2xl p-4 border border-green-50 min-h-[500px]">
                    <div className="flex justify-between items-center mb-2 px-1">
                        <h2 className="font-black text-[#1D9E75] uppercase tracking-wide text-sm">Completed</h2>
                        <span className="bg-[#1D9E75]/10 text-[#1D9E75] text-xs font-bold px-2 py-0.5 rounded-full">{completedOrders.length}</span>
                    </div>
                    {completedOrders.map(order => (
                        <OrderCard key={order.id} order={order} status="completed" />
                    ))}
                    {completedOrders.length === 0 && (
                        <div className="text-center py-10 text-green-700/50 font-medium text-sm">No completions yet</div>
                    )}
                </div>
            </div>

            {/* Cancelled Section */}
            {cancelledOrders.length > 0 && (
                <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden mt-4">
                    <button 
                        onClick={() => setShowCancelled(!showCancelled)}
                        className="w-full px-6 py-4 flex justify-between items-center bg-gray-50 hover:bg-gray-100 transition-colors"
                    >
                        <h3 className="font-bold text-gray-700">Cancelled Orders ({cancelledOrders.length})</h3>
                        <svg className={`w-5 h-5 text-gray-500 transform transition-transform ${showCancelled ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                    </button>
                    {showCancelled && (
                        <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 bg-gray-50 border-t border-gray-200">
                            {cancelledOrders.map(order => (
                                <div key={order.id} className="bg-white p-4 rounded-xl border border-red-100 shadow-sm opacity-70">
                                    <div className="flex justify-between mb-2">
                                        <span className="font-bold text-gray-800">#{order.id}</span>
                                        <span className="text-xs font-bold text-[#E24B4A]">CANCELLED</span>
                                    </div>
                                    <p className="text-sm text-gray-500 truncate">
                                        {JSON.parse(order.items || "[]").map((i: any) => i.name).join(", ")}
                                    </p>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function MenuView({ items, onUpdate, slug }: { items: any[]; onUpdate: () => void; slug: string }) {
    const [isAdding, setIsAdding] = useState(false);
    const [editItem, setEditItem] = useState<any>(null);

    const handleDelete = async (id: number) => {
        if (confirm("Are you sure?")) {
            await deleteMenuItem(slug, id);
            onUpdate();
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h3 className="text-lg font-bold text-gray-800">Manage Menu</h3>
                <button 
                    onClick={() => setIsAdding(true)}
                    className="bg-orange-600 text-white font-bold px-4 py-2 rounded-lg hover:bg-orange-700 transition-colors flex items-center gap-2 text-sm"
                >
                    Add New Item
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {items.map((item) => (
                    <div key={item.id} className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex gap-4">
                        <img src={item.image_url || 'https://via.placeholder.com/80'} className="w-20 h-20 rounded-xl object-cover bg-gray-100" />
                        <div className="flex-1 min-w-0">
                            <h4 className="font-bold text-gray-800 truncate">{item.name}</h4>
                            <p className="text-sm font-bold text-orange-600 mb-2">{item.price}</p>
                            <div className="flex gap-2">
                                <button 
                                    onClick={() => setEditItem(item)}
                                    className="text-xs font-bold text-blue-600 hover:bg-blue-50 px-2 py-1 rounded transition-colors"
                                >
                                    Edit
                                </button>
                                <button 
                                    onClick={() => handleDelete(item.id)}
                                    className="text-xs font-bold text-red-600 hover:bg-red-50 px-2 py-1 rounded transition-colors"
                                >
                                    Delete
                                </button>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Modals for Add/Edit would go here - for brevity, keeping them as placeholders */}
            {(isAdding || editItem) && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-2xl p-8 max-w-md w-full">
                        <h3 className="text-xl font-bold mb-6">{isAdding ? "Add Item" : "Edit Item"}</h3>
                        <form onSubmit={async (e) => {
                            e.preventDefault();
                            const formData = new FormData(e.currentTarget);
                            const data = Object.fromEntries(formData.entries());
                            data.price = (data.price as string).replace('₹', '');
                            
                            if (isAdding) {
                                await addMenuItem(slug, data);
                            } else {
                                await updateMenuItem(slug, editItem.id, { ...editItem, ...data });
                            }
                            setIsAdding(false);
                            setEditItem(null);
                            onUpdate();
                        }} className="space-y-4">
                            <input name="name" defaultValue={editItem?.name} placeholder="Item Name" className="w-full p-2 border rounded" required />
                            <input name="price" defaultValue={editItem?.price} placeholder="Price (e.g. 150)" className="w-full p-2 border rounded" required />
                            <input name="category" defaultValue={editItem?.category} placeholder="Category" className="w-full p-2 border rounded" required />
                            <input name="image_url" defaultValue={editItem?.image_url} placeholder="Image URL" className="w-full p-2 border rounded" />
                            <textarea name="description" defaultValue={editItem?.description} placeholder="Description" className="w-full p-2 border rounded" />
                            <div className="flex gap-4 pt-4">
                                <button type="button" onClick={() => { setIsAdding(false); setEditItem(null); }} className="flex-1 py-2 font-bold text-gray-500">Cancel</button>
                                <button type="submit" className="flex-1 py-2 font-bold bg-orange-600 text-white rounded-lg">Save</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
