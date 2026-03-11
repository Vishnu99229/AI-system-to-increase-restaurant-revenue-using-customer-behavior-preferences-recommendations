
interface BottomNavProps {
    activeTab: "menu" | "orders" | "bill";
    onTabChange: (tab: "menu" | "orders" | "bill") => void;
}

const tabs = [
    {
        id: "menu" as const,
        label: "Menu",
        icon: (active: boolean) => (
            <svg className={`w-5 h-5 ${active ? 'text-primary' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
        ),
    },
    {
        id: "orders" as const,
        label: "Orders",
        icon: (active: boolean) => (
            <svg className={`w-5 h-5 ${active ? 'text-primary' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
        ),
    },
    {
        id: "bill" as const,
        label: "Ask for Bill",
        icon: (active: boolean) => (
            <svg className={`w-5 h-5 ${active ? 'text-primary' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
        ),
    },
];

export default function BottomNav({ activeTab, onTabChange }: BottomNavProps) {
    return (
        <nav className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-100 shadow-[0_-2px_10px_rgba(0,0,0,0.05)]" id="bottom-nav">
            <div className="max-w-md mx-auto flex">
                {tabs.map(tab => {
                    const isActive = activeTab === tab.id;
                    return (
                        <button
                            key={tab.id}
                            onClick={() => onTabChange(tab.id)}
                            className={`flex-1 flex flex-col items-center justify-center py-2.5 gap-0.5 transition-colors ${isActive ? 'text-dark' : 'text-gray-400'}`}
                            id={`tab-${tab.id}`}
                        >
                            {tab.icon(isActive)}
                            <span className={`text-[10px] font-semibold ${isActive ? 'text-dark' : 'text-gray-400'}`}>
                                {tab.label}
                            </span>
                            {isActive && (
                                <div className="w-1 h-1 rounded-full bg-primary mt-0.5" />
                            )}
                        </button>
                    );
                })}
            </div>
        </nav>
    );
}
