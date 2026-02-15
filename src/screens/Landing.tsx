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
        <div className="min-h-screen flex flex-col justify-center px-6 bg-white">
            <h1 className="text-2xl font-semibold text-center mb-2">
                Welcome
            </h1>

            <p className="text-gray-500 text-center mb-8">
                View our menu and order at your table
            </p>

            <div className="space-y-5">
                <input
                    type="text"
                    placeholder="Enter your name (optional)"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    className="w-full px-4 py-3 rounded-lg border border-gray-200 bg-gray-50 text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-300 focus:bg-white transition-all text-sm"
                />

                <button
                    onClick={handleViewMenu}
                    className="w-full bg-gray-900 hover:bg-black text-white py-4 rounded-2xl text-lg font-semibold tracking-wide shadow-md hover:shadow-lg transition-all"
                >
                    Let's Start →
                </button>
            </div>
        </div>
    );
}
