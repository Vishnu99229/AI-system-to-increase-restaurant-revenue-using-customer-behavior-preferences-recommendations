import { useState, useEffect, useRef } from "react";
import { fetchAdminAnalytics, fetchAdminOrders, updateOrderStatus, fetchMenu, addMenuItem, updateMenuItem, deleteMenuItem } from "../../utils/api";

interface AdminDashboardProps {
    slug: string;
    onLogout: () => void;
}

export default function AdminDashboard({ slug, onLogout }: AdminDashboardProps) {
    const [activeTab, setActiveTab] = useState<"analytics" | "menu">("analytics");
    const [analytics, setAnalytics] = useState<any>(null);
    const [menuItems, setMenuItems] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [soundUnlocked, setSoundUnlocked] = useState(false);

    const handleEnableSound = () => {
        playBeep(440, 50, 0.01);
        setSoundUnlocked(true);
    };

    const loadData = async () => {
        setLoading(true);
        try {
            if (activeTab === "analytics") {
                const data = await fetchAdminAnalytics(slug);
                setAnalytics(data);
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
                <TabButton active={activeTab === "menu"} onClick={() => setActiveTab("menu")}>Menu Manager</TabButton>
            </nav>

            {/* Sound unlock banner */}
            {!soundUnlocked ? (
                <div className="bg-[#FF6B35] text-white px-6 py-3 flex items-center justify-between flex-wrap gap-2">
                    <span className="text-sm font-medium">Tap Enable Sound to receive order alerts</span>
                    <button
                        onClick={handleEnableSound}
                        className="bg-white text-[#FF6B35] font-bold px-4 py-1.5 rounded-lg text-sm hover:bg-orange-50 transition-colors"
                    >
                        Enable Sound
                    </button>
                </div>
            ) : (
                <div className="bg-[#1D9E75] text-white px-6 py-1.5 text-xs font-semibold flex items-center gap-1.5">
                    🔔 Sound enabled
                </div>
            )}

            {/* Content Area */}
            <main className="flex-1 p-6 max-w-7xl mx-auto w-full">
                {loading ? (
                    <div className="h-full flex items-center justify-center">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-600"></div>
                    </div>
                ) : (
                    <>
                        {activeTab === "analytics" && <AnalyticsView data={analytics} slug={slug} />}
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

// -----------------------------------------------------------------
// Response shape from GET /api/admin/:slug/orders (SELECT * FROM orders):
//   id            : number
//   restaurant_id : number
//   items         : string | array  (JSON.stringify'd on insert, but
//                   pg driver may auto-parse if column is json/jsonb)
//   total         : number (numeric)
//   customer_name : string
//   customer_phone: string
//   status        : 'pending' | 'preparing' | 'completed' | 'cancelled'
//   created_at    : string (ISO timestamp)
//   table_number  : string | null
//   pairing_accepted: boolean
// -----------------------------------------------------------------

// --- Item row for a single table ---
interface ItemRow {
    name: string;
    qty: number;
    orderId: number;
    orderedAt: string;
    itemKey: string;
}

// --- Active Tables types ---
interface TableGroup {
    tableNumber: string;
    itemRows: ItemRow[];
    total: number;
    earliestOrder: string;
    orderIds: number[];
}

interface ActiveAlert {
    level: "strong" | "medium";
    tableNumber?: string;
    unseenUpdates?: number;
}

// --- Safe items parser ---
// Handles: JSON string, already-parsed array, null, undefined
function safeParseItems(raw: any): any[] {
    if (Array.isArray(raw)) return raw;
    if (typeof raw === "string") {
        try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }
    return [];
}

// --- Audio helper ---
// Shared AudioContext singleton. Created once on first use, reused for all beeps
// so the user gesture unlock from the Enable Sound button persists across all
// subsequent notification beeps. Without this, Chrome silently blocks each new
// AudioContext after the first one because there is no fresh user gesture.
let sharedAudioCtx: AudioContext | null = null;

function getAudioCtx(): AudioContext | null {
    if (sharedAudioCtx) return sharedAudioCtx;
    try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioCtx) return null;
        sharedAudioCtx = new AudioCtx();
        return sharedAudioCtx;
    } catch (err) {
        console.error("Failed to create AudioContext:", err);
        return null;
    }
}

function playBeep(frequency: number, durationMs: number, gain: number): void {
    const ctx = getAudioCtx();
    if (!ctx) return;
    try {
        if (ctx.state === "suspended") {
            ctx.resume().catch(() => {});
        }
        const osc = ctx.createOscillator();
        const gainNode = ctx.createGain();
        osc.connect(gainNode);
        gainNode.connect(ctx.destination);
        osc.type = "sine";
        osc.frequency.setValueAtTime(frequency, ctx.currentTime);
        gainNode.gain.setValueAtTime(gain, ctx.currentTime);
        osc.start();
        osc.stop(ctx.currentTime + durationMs / 1000);
    } catch (err) {
        console.error("Audio beep failed:", err);
    }
}

function playBeepAsync(frequency: number, durationMs: number, gain: number): Promise<void> {
    return new Promise((resolve) => {
        const ctx = getAudioCtx();
        if (!ctx) { resolve(); return; }

        const fire = () => {
            try {
                const osc = ctx.createOscillator();
                const gainNode = ctx.createGain();
                osc.connect(gainNode);
                gainNode.connect(ctx.destination);
                osc.type = "sine";
                osc.frequency.setValueAtTime(frequency, ctx.currentTime);
                gainNode.gain.setValueAtTime(gain, ctx.currentTime);
                osc.onended = () => resolve();
                osc.start();
                osc.stop(ctx.currentTime + durationMs / 1000);
            } catch (err) {
                console.error("Audio beep failed:", err);
                resolve();
            }
        };

        if (ctx.state === "suspended") {
            ctx.resume().then(fire).catch(() => { resolve(); });
        } else {
            fire();
        }
    });
}

function AnalyticsView({ data, slug }: { data: any; slug: string }) {
    const [activeTables, setActiveTables] = useState<TableGroup[]>([]);
    const [activeAlert, setActiveAlert] = useState<ActiveAlert | null>(null);
    const [, setTick] = useState(0); // forces re-render for blink expiry

    const intervalRef = useRef<number | undefined>(undefined);
    const prevTableIdsRef = useRef<Set<string> | null>(null);
    const prevItemCountsRef = useRef<Map<string, number> | null>(null);
    const repeatIntervalRef = useRef<number | undefined>(undefined);
    const titleIntervalRef = useRef<number | undefined>(undefined);
    const repeatCountRef = useRef<number>(0);
    const activeTablesPanelRef = useRef<HTMLDivElement>(null);
    const alertSeqRef = useRef<number>(0);
    // @ts-ignore: Keep to satisfy constraints without breaking tsc
    const [isAlerting, setIsAlerting] = useState(false);

    // --- Build active tables from raw orders ---
    // Each order's items are flattened into individual ItemRows, sorted newest first.
    const buildActiveTables = (orders: any[]): TableGroup[] => {
        const activeOrders = orders.filter(
            (o: any) => o.status === "pending" || o.status === "preparing"
        );

        const grouped: Record<string, {
            itemRows: ItemRow[];
            total: number;
            earliest: string;
            orderIds: number[];
        }> = {};

        for (const order of activeOrders) {
            const tn = order.table_number;
            if (!tn) continue;

            if (!grouped[tn]) {
                grouped[tn] = { itemRows: [], total: 0, earliest: order.created_at, orderIds: [] };
            }

            const group = grouped[tn];
            group.total += Math.round(Number(order.total) || 0);
            group.orderIds.push(order.id);

            if (order.created_at && order.created_at < group.earliest) {
                group.earliest = order.created_at;
            }

            // Safely parse items (handles string, array, null)
            const items = safeParseItems(order.items);
            items.forEach((item: any, idx: number) => {
                group.itemRows.push({
                    name: item.name || "Unknown item",
                    qty: 1,
                    orderId: order.id,
                    orderedAt: order.created_at || "",
                    itemKey: `${order.id}-${idx}`,
                });
            });
        }

        return Object.entries(grouped)
            .map(([tableNumber, g]) => ({
                tableNumber,
                // Sort newest first
                itemRows: g.itemRows.sort((a, b) =>
                    new Date(b.orderedAt).getTime() - new Date(a.orderedAt).getTime()
                ),
                total: g.total,
                earliestOrder: g.earliest,
                orderIds: g.orderIds,
            }))
            .sort((a, b) => a.tableNumber.localeCompare(b.tableNumber, undefined, { numeric: true }));
    };

    // --- Dismiss all alerts ---
    const dismissAlert = () => {
        if (repeatIntervalRef.current) {
            window.clearInterval(repeatIntervalRef.current);
            repeatIntervalRef.current = undefined;
        }
        if (titleIntervalRef.current) {
            window.clearInterval(titleIntervalRef.current);
            titleIntervalRef.current = undefined;
        }
        repeatCountRef.current = 0;
        alertSeqRef.current++;
        setIsAlerting(false);
        document.title = "Admin Panel";
        setActiveAlert(null);
    };

    // --- Fire STRONG alert (7 sequential beeps) ---
    const fireStrongAlert = (tableNumber: string) => {
        dismissAlert();

        setActiveAlert({ level: "strong", tableNumber });

        // Play 7 sequential beeps using async chain
        const seqId = ++alertSeqRef.current;
        setIsAlerting(true);
        (async () => {
            for (let i = 0; i < 7; i++) {
                if (alertSeqRef.current !== seqId) return;
                await playBeepAsync(1000, 300, 0.3);
                if (alertSeqRef.current !== seqId) return;
                if (i < 6) await new Promise<void>(r => setTimeout(r, 300));
            }
            // Auto-clear alerting state when loop completes naturally
            if (alertSeqRef.current === seqId) {
                setIsAlerting(false);
            }
        })();

        let showNew = true;
        titleIntervalRef.current = window.setInterval(() => {
            document.title = showNew ? "(NEW) Admin Panel" : "Admin Panel";
            showNew = !showNew;
        }, 1000);
    };

    // --- Fire MEDIUM alert (5 sequential beeps, fire-and-forget, NOT cancelable) ---
    // Does NOT use alertSeqRef. Medium beeps are short (~2 seconds total) and must
    // play to completion even if dismissAlert is called (via window focus, panel click,
    // or dismiss button) during the loop.
    const fireMediumAlert = (unseenUpdates: number) => {
        setActiveAlert((prev) => ({
            level: "medium",
            unseenUpdates: (prev?.unseenUpdates || 0) + unseenUpdates,
        }));

        document.title = `(${unseenUpdates} update) Admin Panel`;

        // Play 5 sequential beeps. No cancellation. Run to completion always.
        (async () => {
            for (let i = 0; i < 5; i++) {
                await playBeepAsync(800, 200, 0.2);
                if (i < 4) await new Promise<void>(r => setTimeout(r, 250));
            }
        })();
    };

    // --- Close table ---
    const handleCloseTable = async (table: TableGroup) => {
        const ok = confirm(`Close Table ${table.tableNumber}? This will mark all active orders as completed.`);
        if (!ok) return;

        for (const orderId of table.orderIds) {
            const success = await updateOrderStatus(slug, orderId, "completed");
            if (!success) {
                alert(`Failed to update order on Table ${table.tableNumber}. Please try again.`);
                return;
            }
        }

        fetchActiveTables();
    };

    // --- Fetch and process active tables ---
    const fetchActiveTables = async () => {
        try {
            const orders = await fetchAdminOrders(slug);
            const tables = buildActiveTables(orders);
            setActiveTables(tables);

            // Build current snapshots (item row count per table)
            const currentTableIds = new Set(tables.map((t) => t.tableNumber));
            const currentItemCounts = new Map(
                tables.map((t) => [t.tableNumber, t.itemRows.reduce((sum, r) => sum + r.qty, 0)])
            );

            // First poll: initialize refs, no alerts
            if (prevTableIdsRef.current === null || prevItemCountsRef.current === null) {
                prevTableIdsRef.current = currentTableIds;
                prevItemCountsRef.current = currentItemCounts;
                return;
            }

            // Detect new tables
            let newTableNumber: string | null = null;
            for (const tn of currentTableIds) {
                if (!prevTableIdsRef.current.has(tn)) {
                    newTableNumber = tn;
                    break;
                }
            }

            if (newTableNumber) {
                fireStrongAlert(newTableNumber);
            } else {
                // Detect new items on existing tables
                let totalNewItems = 0;
                for (const [tn, count] of currentItemCounts) {
                    const prevCount = prevItemCountsRef.current.get(tn) || 0;
                    if (count > prevCount) {
                        totalNewItems += count - prevCount;
                    }
                }
                if (totalNewItems > 0) {
                    fireMediumAlert(totalNewItems);
                }
            }

            // Update refs
            prevTableIdsRef.current = currentTableIds;
            prevItemCountsRef.current = currentItemCounts;
        } catch (err) {
            console.error("Failed to fetch active tables", err);
        }
    };

    // --- Polling effect ---
    useEffect(() => {
        fetchActiveTables();
        intervalRef.current = window.setInterval(fetchActiveTables, 10000);

        return () => {
            if (intervalRef.current) window.clearInterval(intervalRef.current);
            dismissAlert();
        };
    }, [slug]);

    // --- Tick every 10s to expire blink animations ---
    useEffect(() => {
        const tickInterval = window.setInterval(() => setTick((t) => t + 1), 10000);
        return () => window.clearInterval(tickInterval);
    }, []);

    // --- Dismiss on window focus ---
    useEffect(() => {
        const handler = () => dismissAlert();
        window.addEventListener("focus", handler);
        return () => window.removeEventListener("focus", handler);
    }, []);

    // --- Time helpers ---
    const getTimeAgo = (timestamp?: string) => {
        if (!timestamp) return "Just now";
        const mins = Math.floor((new Date().getTime() - new Date(timestamp).getTime()) / 60000);
        if (mins < 1) return "< 1 min ago";
        if (mins === 1) return "1 min ago";
        if (mins > 60) return `${Math.floor(mins / 60)}h ${mins % 60}m ago`;
        return `${mins} mins ago`;
    };

    const getMinsAgo = (timestamp?: string) => {
        if (!timestamp) return "now";
        const mins = Math.floor((new Date().getTime() - new Date(timestamp).getTime()) / 60000);
        if (mins < 1) return "<1m ago";
        return `${mins}m ago`;
    };

    const isFresh = (timestamp?: string): boolean => {
        if (!timestamp) return false;
        const diffSec = (new Date().getTime() - new Date(timestamp).getTime()) / 1000;
        return diffSec < 120;
    };

    if (!data) return null;

    const cards = [
        { label: "Total Revenue", value: `₹${data.totalRevenue.toLocaleString()}`, color: "bg-green-50 text-green-700" },
        { label: "Total Orders", value: data.totalOrders, color: "bg-blue-50 text-blue-700" },
        { label: "Avg Order Value", value: `₹${data.aov.toFixed(2)}`, color: "bg-purple-50 text-purple-700" },
        { label: "Upsell Revenue", value: `₹${(data.confirmedUpsellRevenue || 0).toLocaleString()}`, color: "bg-orange-50 text-orange-700", highlight: true },
    ];

    return (
        <div className="space-y-8"> 

            {/* Notification Banner (STRONG alert only) */}
            {activeAlert?.level === "strong" && (
                <div
                    className="bg-[#E24B4A] text-white font-bold py-3 px-6 rounded-xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 transition-all duration-300 animate-[fadeSlideIn_0.3s_ease-out]"
                    style={{ position: "sticky", top: 0, zIndex: 40 }}
                >
                    <span className="text-sm sm:text-base">
                        🔔 New table ordering: Table {activeAlert.tableNumber}
                    </span>
                    <button
                        onClick={dismissAlert}
                        className="text-sm font-bold text-white border border-white/50 rounded px-3 py-1 hover:bg-white/10 transition-colors self-end sm:self-auto"
                    >
                        Dismiss
                    </button>
                </div>
            )}

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

            {/* Active Tables Section */}
            <div
                ref={activeTablesPanelRef}
                className="bg-white p-8 rounded-2xl border border-gray-100 shadow-sm"
                onClick={() => { if (activeAlert) dismissAlert(); }}
            >
                <div className="mb-6">
                    <h3 className="text-lg font-bold text-gray-800">Active Tables</h3>
                    <p className="text-sm text-gray-500 mt-1">Live view of tables currently ordering</p>
                </div>

                {activeTables.length === 0 ? (
                    <div className="text-center text-gray-400 py-12">
                        No active tables right now
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {activeTables.map((table) => {
                            const totalQty = table.itemRows.reduce((sum, r) => sum + r.qty, 0);
                            return (
                                <div key={table.tableNumber} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                                    {/* Header */}
                                    <div className="flex items-center justify-between mb-3">
                                        <span className="font-black text-lg text-[#1A1A2E]">Table {table.tableNumber}</span>
                                        <span className="text-xs font-bold text-white bg-[#FF6B35] px-2.5 py-1 rounded-full">
                                            {totalQty} items
                                        </span>
                                    </div>

                                    {/* Items List - per-order-item rows, newest on top */}
                                    <div className="bg-gray-50 rounded-lg p-3 max-h-48 overflow-y-auto">
                                        {table.itemRows.map((row) => (
                                            <div
                                                key={row.itemKey}
                                                className={`flex items-center justify-between py-1.5 px-2 rounded ${
                                                    isFresh(row.orderedAt)
                                                        ? "animate-pulse-highlight"
                                                        : ""
                                                }`}
                                            >
                                                <span className="text-sm font-medium text-gray-800">
                                                    {row.qty}x {row.name}
                                                </span>
                                                <span className="text-xs text-gray-400">
                                                    {getMinsAgo(row.orderedAt)}
                                                </span>
                                            </div>
                                        ))}
                                    </div>

                                    {/* Footer */}
                                    <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
                                        <span className="font-bold text-[#1D9E75]">₹{Math.round(table.total)}</span>
                                        <span className="text-xs text-gray-400 font-medium">Started {getTimeAgo(table.earliestOrder)}</span>
                                    </div>

                                    {/* Close Table Button */}
                                    <button
                                        onClick={() => handleCloseTable(table)}
                                        className="w-full bg-[#1D9E75] text-white hover:bg-[#15805E] font-bold py-2 rounded-lg text-sm mt-2 transition-colors"
                                    >
                                        Close Table
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
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
