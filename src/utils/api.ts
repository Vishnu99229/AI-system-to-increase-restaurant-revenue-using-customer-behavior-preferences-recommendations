import type { Item } from "./recommendations";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:3001";

/**
 * Fetches menu items for a restaurant by slug.
 * Returns an empty array on error.
 */
export async function fetchMenu(slug: string): Promise<Item[]> {
    try {
        const response = await fetch(`${API_BASE}/api/${slug}/menu`);
        if (!response.ok) {
            console.warn("Menu fetch failed with status:", response.status);
            return [];
        }
        const rows = await response.json();
        return rows.map((row: { id: number; name: string; description?: string; price: string | number; category?: string; image_url?: string }) => ({
            id: row.id,
            name: row.name,
            description: row.description || "",
            price: `₹${parseFloat(String(row.price)).toFixed(0)}`,
            popular: false,
            category: row.category || "Other",
        }));
    } catch (error) {
        console.warn("Menu fetch network error:", error);
        return [];
    }
}

/**
 * Tracks when an upsell suggestion is displayed.
 */
export async function trackUpsellShown(): Promise<void> {
    try {
        await fetch(`${API_BASE}/api/upsell-shown`, { method: "POST" });
    } catch (error) {
        // Analytics should not block app flow
        console.warn("Analytics error (upsell-shown):", error);
    }
}

/**
 * Submits a completed order to the slug-based endpoint.
 */
export async function trackOrderComplete(
    slug: string,
    orderId: string,
    totalValue: number,
    upsellAccepted: boolean,
    upsellValue: number = 0,
    items: { name: string; price: string }[] = [],
    tableNumber: string = "",
    customerName: string = "",
    customerPhone: string = ""
): Promise<void> {
    try {
        await fetch(`${API_BASE}/api/${slug}/order-complete`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                orderId,
                totalValue,
                upsellAccepted,
                upsellValue,
                items: items.map(i => ({ name: i.name, price: i.price })),
                subtotal: totalValue / 1.05, // approximate from total
                tax: totalValue - totalValue / 1.05,
                total: totalValue,
                pairing_accepted: upsellAccepted,
                tableNumber,
                customer_name: customerName,
                customer_phone: customerPhone,
            }),
        });
    } catch (error) {
        console.warn("Analytics error (order-complete):", error);
    }
}
