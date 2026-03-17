import type { Item } from "./recommendations";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:3001";

/**
 * Fetches menu items for a restaurant by slug.
 */
export async function fetchMenu(slug: string): Promise<Item[]> {
    try {
        const response = await fetch(`${API_BASE}/api/${slug}/menu`);
        if (!response.ok) return [];
        const rows = await response.json();
        return rows.map((row: any) => ({
            id: row.id,
            name: row.name,
            description: row.description || "",
            price: `₹${parseFloat(String(row.price)).toFixed(0)}`,
            popular: false,
            category: row.category || "Other",
            image_url: row.image_url
        }));
    } catch (error) {
        return [];
    }
}

export async function trackUpsellShown(payload?: {
    restaurant_slug?: string;
    table_number?: string;
    item_id?: number;
    cart_value?: number;
    candidate_pool_size?: number;
}): Promise<void> {
    try {
        await fetch(`${API_BASE}/api/upsell-shown`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: payload ? JSON.stringify(payload) : undefined
        });
    } catch (error) {}
}

export function trackUpsellEvent(params: {
    restaurant_slug: string;
    table_number: string;
    item_id: number;
    cart_value: number;
    upsell_value: number;
    event_type: "shown" | "accepted" | "rejected";
    gpt_word_count: number;
    upsell_reason: string;
    candidate_pool_size?: number;
}): void {
    fetch(`${API_BASE}/api/upsell-event`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
    }).catch(() => {});
}

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
                total: totalValue,
                upsellAccepted,
                upsellValue,
                items,
                tableNumber,
                customer_name: customerName,
                customer_phone: customerPhone,
            }),
        });
    } catch (error) {}
}

// --- Customer Login (after Firebase phone verification) ---

export async function customerLogin(
    phone_number: string
): Promise<{ success: boolean; token?: string; expires_in?: number; error?: string }> {
    try {
        const res = await fetch(`${API_BASE}/api/customer-login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ phone_number }),
        });
        return await res.json();
    } catch {
        return { success: false, error: "Network error" };
    }
}


// --- Admin API ---

const getAuthHeader = (): Record<string, string> => {
    const token = localStorage.getItem("admin_token");
    return token ? { "Authorization": `Bearer ${token}` } : {};
};

export async function loginAdmin(credentials: { email: string; password: string }) {
    const res = await fetch(`${API_BASE}/api/admin/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(credentials)
    });
    if (!res.ok) throw new Error("Login failed");
    const data = await res.json();
    localStorage.setItem("admin_token", data.token);
    localStorage.setItem("admin_slug", data.admin.slug);
    return data;
}

export async function fetchAdminAnalytics(slug: string) {
    const res = await fetch(`${API_BASE}/api/admin/${slug}/analytics`, {
        headers: getAuthHeader()
    });
    if (!res.ok) throw new Error("Failed to fetch analytics");
    return res.json();
}

export async function fetchAdminOrders(slug: string) {
    const res = await fetch(`${API_BASE}/api/admin/${slug}/orders`, {
        headers: getAuthHeader()
    });
    if (!res.ok) throw new Error("Failed to fetch orders");
    return res.json();
}

export async function updateOrderStatus(slug: string, orderId: number, status: string) {
    const res = await fetch(`${API_BASE}/api/admin/${slug}/orders/${orderId}/status`, {
        method: "PUT",
        headers: {
            ...getAuthHeader(),
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ status })
    });
    return res.ok;
}

export async function addMenuItem(slug: string, item: any) {
    const res = await fetch(`${API_BASE}/api/admin/${slug}/menu`, {
        method: "POST",
        headers: {
            ...getAuthHeader(),
            "Content-Type": "application/json"
        },
        body: JSON.stringify(item)
    });
    return res.json();
}

export async function updateMenuItem(slug: string, id: number, item: any) {
    const res = await fetch(`${API_BASE}/api/admin/${slug}/menu/${id}`, {
        method: "PUT",
        headers: {
            ...getAuthHeader(),
            "Content-Type": "application/json"
        },
        body: JSON.stringify(item)
    });
    return res.json();
}

export async function deleteMenuItem(slug: string, id: number) {
    const res = await fetch(`${API_BASE}/api/admin/${slug}/menu/${id}`, {
        method: "DELETE",
        headers: getAuthHeader()
    });
    return res.ok;
}
