import { useState, useEffect } from "react";
import Landing from "./screens/Landing";
import Menu from "./screens/Menu";
import Checkout from "./screens/Checkout";
import InvalidTable from "./screens/InvalidTable";
import QRPrintPage from "./screens/QRPrintPage";
import { AppProvider, useApp } from "./contexts/AppContext";

function AppContent() {
    const { state, dispatch } = useApp();
    const [screen, setScreen] = useState<"landing" | "menu" | "checkout">("landing");
    const [tableError, setTableError] = useState(false);
    const [validating, setValidating] = useState(false);

    // Parse QR table info from URL params on mount and validate
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const restaurant = params.get("restaurant") || "";
        const table = params.get("table") || "";

        if (!restaurant && !table) return; // No QR params, normal flow

        // Basic validation: table must be numeric and >= 1
        const tableNum = parseInt(table, 10);
        if (!table || isNaN(tableNum) || tableNum < 1) {
            setTableError(true);
            return;
        }

        // Fetch restaurant config to validate maxTables
        setValidating(true);
        fetch(`http://localhost:3001/api/restaurant/${restaurant}`)
            .then(res => {
                if (!res.ok) throw new Error("not found");
                return res.json();
            })
            .then(data => {
                if (tableNum > data.maxTables) {
                    setTableError(true);
                } else {
                    dispatch({
                        type: "SET_TABLE_INFO",
                        payload: { restaurantId: restaurant, tableNumber: table },
                    });
                }
            })
            .catch(() => {
                setTableError(true);
            })
            .finally(() => setValidating(false));
    }, []);

    // If user already has a name, default to menu
    useEffect(() => {
        if (state.userName && screen === "landing") {
            setScreen("menu");
        }
    }, [state.userName]);

    if (tableError) {
        return (
            <div className="max-w-md mx-auto min-h-screen bg-gray-50 shadow-2xl overflow-hidden">
                <InvalidTable />
            </div>
        );
    }

    if (validating) {
        return (
            <div className="max-w-md mx-auto min-h-screen bg-gray-50 shadow-2xl overflow-hidden flex items-center justify-center">
                <p className="text-gray-400">Verifying table...</p>
            </div>
        );
    }

    return (
        <div className="max-w-md mx-auto min-h-screen bg-gray-50 shadow-2xl overflow-hidden">
            {screen === "landing" && (
                <Landing onViewMenu={() => setScreen("menu")} />
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
