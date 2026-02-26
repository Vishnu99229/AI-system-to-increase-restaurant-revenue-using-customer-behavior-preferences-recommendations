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

    // Parse QR table info from URL params on mount and validate
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const restaurant = params.get("restaurant") || "";
        const table = params.get("table") || "";

        console.log("Restaurant param:", restaurant);
        console.log("Table param:", table);

        if (!restaurant && !table) return; // No QR params, normal flow

        // Basic validation: restaurant and table must exist, table must be numeric and >= 1
        const tableNum = parseInt(table, 10);
        console.log("Parsed tableNum:", tableNum);

        if (!restaurant || !table || isNaN(tableNum) || tableNum < 1) {
            setTableError(true);
            return;
        }

        // Validation passed — store table info and proceed
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
