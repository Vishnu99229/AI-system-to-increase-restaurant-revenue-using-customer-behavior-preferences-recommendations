import { useState, useEffect } from "react";
import Landing from "./screens/Landing";
import Menu from "./screens/Menu";
import InvalidTable from "./screens/InvalidTable";
import QRPrintPage from "./screens/QRPrintPage";
import AdminLogin from "./screens/admin/AdminLogin";
import AdminDashboard from "./screens/admin/AdminDashboard";
import { AppProvider, useApp } from "./contexts/AppContext";


function AppContent() {
    const { state, dispatch } = useApp();
    const [screen, setScreen] = useState<"landing" | "menu">("landing");
    const [tableError, setTableError] = useState(false);
    
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
    }, []);

    // If user already has a name, default to menu
    useEffect(() => {
        if (state.userName && screen === "landing") {
            setScreen("menu");
        }
    }, [state.userName]);

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
                <Landing onViewMenu={() => setScreen("menu")} />
            )}
            {screen === "menu" && (
                <Menu onBack={() => setScreen("landing")} />
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
