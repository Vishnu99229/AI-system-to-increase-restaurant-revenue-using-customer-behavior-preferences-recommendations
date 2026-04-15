import { useState, useEffect } from "react";
import Landing from "./screens/Landing";
import Menu from "./screens/Menu";
import Checkout from "./screens/Checkout";
import InvalidTable from "./screens/InvalidTable";
import QRPrintPage from "./screens/QRPrintPage";
import AdminLogin from "./screens/admin/AdminLogin";
import AdminDashboard from "./screens/admin/AdminDashboard";
import PassportEntry from "./components/PassportEntry";
import { AppProvider, useApp } from "./contexts/AppContext";
import { getRestaurantConfig } from "./config/restaurants";


function AppContent() {
    const { state, dispatch } = useApp();
    const [screen, setScreen] = useState<"landing" | "menu" | "checkout">("landing");
    const [tableError, setTableError] = useState(false);
    const [welcomeBackName, setWelcomeBackName] = useState("");
    
    // Admin state
    const [isAdmin, setIsAdmin] = useState(false);
    const [adminSlug, setAdminSlug] = useState<string | null>(null);

    // Handle initial routing and auth check
    useEffect(() => {
        const path = window.location.pathname;
        if (path.startsWith("/admin")) {
            const token = localStorage.getItem("admin_token");
            const slug = localStorage.getItem("admin_slug");
            if (token && slug) {
                setIsAdmin(true);
                setAdminSlug(slug);
            }
        }

        const params = new URLSearchParams(window.location.search);
        const restaurant = params.get("restaurant") || "";
        const table = params.get("table") || "";

        if (!restaurant && !table) return;

        const tableNum = parseInt(table, 10);
        if (!restaurant || !table || isNaN(tableNum) || tableNum < 1) {
            setTableError(true);
            return;
        }

        dispatch({
            type: "SET_TABLE_INFO",
            payload: { restaurantId: restaurant, tableNumber: table },
        });

        // Auto-skip passport for returning customers within 6-hour window
        const config = getRestaurantConfig(restaurant);
        if (config.entryExperience === 'passport') {
            try {
                const nameKey = `${restaurant}_visitor_name`;
                const lastVisitKey = `${restaurant}_last_visit`;
                const countKey = `${restaurant}_visit_count`;
                const savedName = localStorage.getItem(nameKey);
                const savedLastVisit = localStorage.getItem(lastVisitKey);

                if (savedName && savedName.trim().length >= 2 && savedName.trim().length <= 30 && savedLastVisit) {
                    const visitDate = new Date(savedLastVisit);
                    const elapsed = Date.now() - visitDate.getTime();
                    const SIX_HOURS = 6 * 60 * 60 * 1000;

                    if (!isNaN(visitDate.getTime()) && elapsed < SIX_HOURS) {
                        const trimmedName = savedName.trim();
                        dispatch({ type: "SET_CUSTOMER_NAME", payload: trimmedName });
                        dispatch({ type: "SET_USER_NAME", payload: trimmedName });
                        setWelcomeBackName(trimmedName);
                        setScreen("menu");
                    } else {
                        // Expired: wipe keys for this restaurant only
                        localStorage.removeItem(nameKey);
                        localStorage.removeItem(countKey);
                        localStorage.removeItem(lastVisitKey);
                        localStorage.removeItem(`${restaurant}_session_orders`);
                    }
                }
            } catch (err) {
                console.error("Passport auto-skip check failed:", err);
            }
        }
    }, []);

    // If user already has a name, default to menu
    useEffect(() => {
        if (state.userName && screen === "landing") {
            setScreen("menu");
        }
    }, [state.userName]);

    // Auto-dismiss welcome-back toast after 3 seconds
    useEffect(() => {
        if (welcomeBackName) {
            const timer = setTimeout(() => setWelcomeBackName(""), 3000);
            return () => clearTimeout(timer);
        }
    }, [welcomeBackName]);

    const handleAdminLogin = (slug: string) => {
        setIsAdmin(true);
        setAdminSlug(slug);
        window.history.pushState({}, "", "/admin");
    };

    const handleAdminLogout = () => {
        localStorage.removeItem("admin_token");
        localStorage.removeItem("admin_slug");
        setIsAdmin(false);
        setAdminSlug(null);
        window.location.href = "/";
    };

    // Routing Logic
    const isRootAdminPath = window.location.pathname === "/admin" || window.location.pathname === "/admin/";

    if (isRootAdminPath) {
        if (!isAdmin) {
            return <AdminLogin onLogin={handleAdminLogin} />;
        }
        return <AdminDashboard slug={adminSlug!} onLogout={handleAdminLogout} />;
    }

    if (tableError) {
        return (
            <div className="max-w-md mx-auto min-h-screen bg-warm-bg shadow-2xl overflow-hidden">
                <InvalidTable />
            </div>
        );
    }

    return (
        <div className="max-w-md mx-auto min-h-screen bg-gray-50 shadow-2xl overflow-hidden">
            {screen === "landing" && (
                getRestaurantConfig(state.restaurantId).entryExperience === 'passport'
                    ? <PassportEntry onViewMenu={() => setScreen("menu")} />
                    : <Landing onViewMenu={() => setScreen("menu")} />
            )}
            {screen === "menu" && (
                <Menu
                    onBack={() => setScreen("landing")}
                    onViewCart={() => setScreen("checkout")}
                />
            )}
            {screen === "checkout" && (
                <Checkout onBack={() => setScreen("menu")} />
            )}

            {/* Welcome-back toast for returning passport customers */}
            {welcomeBackName && (
                <div
                    className="fixed top-4 left-0 right-0 flex justify-center z-50 pointer-events-none"
                    style={{ animation: 'welcomeFade 3s ease-out forwards' }}
                >
                    <div className="bg-[#1A1A2E] text-white px-5 py-3 rounded-xl shadow-lg text-sm font-medium">
                        Welcome back, {welcomeBackName}
                    </div>
                </div>
            )}
        </div>
    );
}

function App() {
    // Route /qr/* paths to QR print page (outside AppProvider)
    if (window.location.pathname.startsWith("/qr/")) {
        return <QRPrintPage />;
    }

    return (
        <AppProvider>
            <AppContent />
        </AppProvider>
    );
}

export default App;
