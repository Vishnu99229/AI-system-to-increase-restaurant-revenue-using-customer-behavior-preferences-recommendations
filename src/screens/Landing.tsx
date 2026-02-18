import { useState, useEffect } from "react";
import { useApp } from "../contexts/AppContext";

interface LandingProps {
    onViewMenu: () => void;
}

export default function Landing({ onViewMenu }: LandingProps) {
    const { state, dispatch } = useApp();
    const [inputValue, setInputValue] = useState("");

    useEffect(() => {
        // Initialize input with stored name if available
        if (state.userName) {
            setInputValue(state.userName);
        }
    }, [state.userName]);

    const handleViewMenu = () => {
        if (inputValue.trim()) {
            dispatch({ type: "SET_USER_NAME", payload: inputValue.trim() });
        }
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
                <input
                    type="text"
                    placeholder="Enter your name (optional)"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    className="w-full px-4 py-3 rounded-lg border border-primary/30 bg-white text-dark placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all text-base"
                />

                <button
                    onClick={handleViewMenu}
                    className="w-full bg-dark hover:bg-[#2c2323] text-white py-4 rounded-xl text-lg font-bold tracking-wide shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all"
                >
                    Let's Start →
                </button>
            </div>
        </div>
    );
}
