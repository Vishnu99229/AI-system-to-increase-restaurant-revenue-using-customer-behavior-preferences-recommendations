import { useState, useEffect } from "react";
import { useApp } from "../contexts/AppContext";

interface LandingProps {
    onViewMenu: () => void;
}

export default function Landing({ onViewMenu }: LandingProps) {
    const { state, dispatch } = useApp();
    const [nameValue, setNameValue] = useState("");

    useEffect(() => {
        // Hydrate inputs from context for returning users
        if (state.customerName) setNameValue(state.customerName);
        // Also keep legacy userName in sync
        if (state.userName && !state.customerName) setNameValue(state.userName);
    }, [state.customerName, state.userName]);

    const isValid = nameValue.trim().length > 0;

    const handleViewMenu = () => {
        if (!isValid) return;
        dispatch({ type: "SET_CUSTOMER_NAME", payload: nameValue.trim() });
        // Keep legacy userName in sync
        dispatch({ type: "SET_USER_NAME", payload: nameValue.trim() });
        onViewMenu();
    };

    return (
        <div className="min-h-screen flex flex-col justify-center px-6 bg-warm-bg">
            <h1 className="text-4xl font-heading font-bold text-center mb-2 text-dark">
                Welcome
            </h1>

            <p className="text-highlight text-center mb-8 font-medium">
                View our menu and order at your table
            </p>

            <div className="space-y-5">
                <div>
                    <label className="block text-sm font-medium text-dark/70 mb-1">Your Name *</label>
                    <input
                        type="text"
                        placeholder="e.g. Rahul"
                        value={nameValue}
                        onChange={(e) => setNameValue(e.target.value)}
                        className="w-full px-4 py-3 rounded-lg border border-primary/30 bg-white text-dark placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all text-base"
                    />
                </div>

                <button
                    onClick={handleViewMenu}
                    disabled={!isValid}
                    className={`w-full py-4 rounded-xl text-lg font-bold tracking-wide shadow-lg transition-all ${isValid
                            ? "bg-dark hover:bg-[#2c2323] text-white hover:shadow-xl hover:-translate-y-0.5"
                            : "bg-gray-300 text-gray-500 cursor-not-allowed"
                        }`}
                >
                    Let's Start →
                </button>
            </div>
        </div>
    );
}
