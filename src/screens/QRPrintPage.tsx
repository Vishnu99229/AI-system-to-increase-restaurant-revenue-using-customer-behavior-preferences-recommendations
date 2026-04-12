import { useState, useEffect } from "react";
import QRCode from "qrcode";

interface RestaurantConfig {
    name: string;
    maxTables: number;
}

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:3001";

export default function QRPrintPage() {
    const [config, setConfig] = useState<RestaurantConfig | null>(null);
    const [error, setError] = useState("");
    const [qrCodes, setQrCodes] = useState<string[]>([]);

    // Extract restaurantId from pathname: /qr/:restaurantId
    const restaurantId = window.location.pathname.replace(/^\/qr\//, "").replace(/\/$/, "");

    // Allow ?tables=N query param to override table count
    const tablesOverride = new URLSearchParams(window.location.search).get("tables");

    useEffect(() => {
        if (!restaurantId) {
            setError("No restaurant specified.");
            return;
        }

        fetch(`${API_BASE}/api/restaurant/${restaurantId}`)
            .then(res => {
                if (!res.ok) throw new Error("Restaurant not found");
                return res.json();
            })
            .then(async (data: any) => {
                // Backend returns snake_case max_tables; query param overrides; default 20
                const tableCount = tablesOverride
                    ? parseInt(tablesOverride, 10)
                    : (data.max_tables || data.maxTables || 20);
                const resolvedConfig: RestaurantConfig = {
                    name: data.name,
                    maxTables: tableCount,
                };
                setConfig(resolvedConfig);

                // Generate QR codes for all tables
                const codes: string[] = [];
                for (let t = 1; t <= resolvedConfig.maxTables; t++) {
                    const url = `${window.location.origin}/?restaurant=${restaurantId}&table=${t}`;
                    const dataUrl = await QRCode.toDataURL(url, {
                        width: 200,
                        margin: 2,
                        color: { dark: "#000000", light: "#ffffff" },
                    });
                    codes.push(dataUrl);
                }
                setQrCodes(codes);
            })
            .catch(() => setError("Restaurant not found."));
    }, [restaurantId]);

    if (error) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-white">
                <p className="text-red-500 text-lg">{error}</p>
            </div>
        );
    }

    if (!config || qrCodes.length === 0) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-white">
                <p className="text-gray-400 text-lg">Generating QR codes...</p>
            </div>
        );
    }

    return (
        <div className="qr-print-page bg-white min-h-screen p-8">
            <style>{`
                @media print {
                    body { margin: 0; }
                    .qr-print-page { padding: 0; }
                    .qr-card { break-inside: avoid; page-break-inside: avoid; }
                    .no-print { display: none !important; }
                }
                .qr-grid {
                    display: grid;
                    grid-template-columns: repeat(3, 1fr);
                    gap: 24px;
                }
                .qr-card {
                    border: 1px solid #e5e7eb;
                    border-radius: 12px;
                    padding: 20px;
                    text-align: center;
                }
                .qr-card img { margin: 0 auto 12px; }
            `}</style>

            <div className="text-center mb-8">
                <h1 className="text-3xl font-bold text-gray-900">{config.name}</h1>
                <p className="text-gray-500 mt-1">Table QR Codes</p>
                <button
                    onClick={() => window.print()}
                    className="no-print mt-4 bg-gray-900 text-white px-6 py-2 rounded-lg font-medium hover:bg-black transition-colors"
                >
                    🖨️ Print All
                </button>
            </div>

            <div className="qr-grid">
                {qrCodes.map((dataUrl, index) => (
                    <div key={index + 1} className="qr-card">
                        <img src={dataUrl} alt={`Table ${index + 1}`} width={200} height={200} />
                        <div className="text-4xl font-bold text-gray-900 mb-1">
                            Table {index + 1}
                        </div>
                        <p className="text-sm text-gray-500 font-medium">
                            Scan to Order &amp; Pay
                        </p>
                    </div>
                ))}
            </div>

            <div className="text-center mt-10 text-xs text-gray-400">
                Increase your average bill with smart suggestions
            </div>
        </div>
    );
}
