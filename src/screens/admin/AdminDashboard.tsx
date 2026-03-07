import { useState, useEffect } from "react";
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
    const handleUpdateStatus = async (id: number, status: string) => {
        const success = await updateOrderStatus(slug, id, status);
        if (success) onStatusUpdate();
    };

    return (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <table className="w-full text-left">
                <thead className="bg-gray-50 border-b border-gray-100 text-gray-500 text-xs font-bold uppercase tracking-wider">
                    <tr>
                        <th className="px-6 py-4">Order ID</th>
                        <th className="px-6 py-4">Customer</th>
                        <th className="px-6 py-4">Items</th>
                        <th className="px-6 py-4">Total</th>
                        <th className="px-6 py-4">Status</th>
                        <th className="px-6 py-4">Action</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                    {orders.map((order) => (
                        <tr key={order.id} className="hover:bg-gray-50 transition-colors">
                            <td className="px-6 py-4 font-bold text-gray-800">#{order.id}</td>
                            <td className="px-6 py-4">
                                <p className="font-bold text-gray-800">{order.customer_name}</p>
                                <p className="text-xs text-gray-500">{order.customer_phone}</p>
                            </td>
                            <td className="px-6 py-4 max-w-xs truncate">
                                {JSON.parse(order.items).map((i: any) => i.name).join(", ")}
                            </td>
                            <td className="px-6 py-4 font-bold text-green-600">₹{order.total}</td>
                            <td className="px-6 py-4">
                                <span className={`px-2 py-1 rounded-full text-xs font-bold uppercase ${
                                    order.status === 'completed' ? 'bg-green-100 text-green-700' :
                                    order.status === 'cancelled' ? 'bg-red-100 text-red-700' :
                                    'bg-orange-100 text-orange-700'
                                }`}>
                                    {order.status}
                                </span>
                            </td>
                            <td className="px-6 py-4">
                                <div className="flex gap-2">
                                    {order.status === 'pending' && (
                                        <button 
                                            onClick={() => handleUpdateStatus(order.id, 'completed')}
                                            className="text-xs font-bold text-green-600 hover:bg-green-50 px-2 py-1 rounded transition-colors"
                                        >
                                            Complete
                                        </button>
                                    )}
                                    {order.status !== 'cancelled' && (
                                        <button 
                                            onClick={() => handleUpdateStatus(order.id, 'cancelled')}
                                            className="text-xs font-bold text-red-600 hover:bg-red-50 px-2 py-1 rounded transition-colors"
                                        >
                                            Cancel
                                        </button>
                                    )}
                                </div>
                            </td>
                        </tr>
                    ))}
                    {orders.length === 0 && (
                        <tr>
                            <td colSpan={6} className="text-center py-12 text-gray-500 font-medium">No orders found</td>
                        </tr>
                    )}
                </tbody>
            </table>
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
