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
            sub_category: row.sub_category || "",
            tags: Array.isArray(row.tags) ? row.tags : [],
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
    items: { menu_item_id: number; name: string; quantity: number; price: number; is_upsell?: boolean; specialInstructions?: string }[] = [],
    tableNumber: string = "",
    customerName: string = "",
    customerPhone: string = ""
): Promise<void> {
    const res = await fetch(`${API_BASE}/api/${slug}/order-complete`, {
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
    if (!res.ok) throw new Error("Order failed");
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
    return res;
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
    return res;
}

export async function deleteMenuItem(slug: string, id: number) {
    const res = await fetch(`${API_BASE}/api/admin/${slug}/menu/${id}`, {
        method: "DELETE",
        headers: getAuthHeader()
    });
    return res;
}

export interface Ingredient {
    id: string;
    cafe_slug: string;
    name: string;
    category: string | null;
    unit: string;
    cost_per_unit: string | number;
    shelf_life_hours: number | null;
    storage_type: string | null;
    supplier_name: string | null;
    min_order_quantity: string | number | null;
    is_active: boolean;
}

export interface RecipeIngredient {
    id: string;
    menu_item_id: number;
    ingredient_id: string;
    quantity_used: string | number;
    unit: string;
    ingredient_name: string;
    ingredient_category: string | null;
    cost_per_unit: string | number;
}

export interface AdminMenuItem {
    id: number;
    name: string;
    price: string | number;
}

export interface InventorySnapshotRow {
    ingredient_id: string;
    ingredient_name: string;
    category: string | null;
    unit: string;
    quantity_on_hand: string | number | null;
    recorded_at: string | null;
    recorded_by: string | null;
}

export interface InventoryVarianceRow {
    ingredient_id: string;
    ingredient_name: string;
    theoretical_usage: number;
    actual_usage: number;
    variance: number;
    variance_cost: number;
}

export interface WasteLogRow {
    id: string;
    ingredient_id: string;
    ingredient_name: string;
    quantity_wasted: string | number;
    reason: "expired" | "spoiled" | "overprepped" | "dropped" | "plate_waste" | "other";
    cost_value: string | number;
    notes: string | null;
    logged_at: string;
    logged_by: string | null;
}

export interface WasteSummary {
    total_waste_cost: number;
    waste_by_reason: Array<{ reason: string; total_cost: number; percentage_of_total: number }>;
    top_wasted_ingredients: Array<{ ingredient_name: string; total_quantity: number; total_cost: number }>;
}

export async function fetchAdminMenuItems(slug: string): Promise<AdminMenuItem[]> {
    const res = await fetch(`${API_BASE}/api/${slug}/menu`);
    if (!res.ok) return [];
    return res.json();
}

export async function fetchIngredients(slug: string): Promise<Ingredient[]> {
    const res = await fetch(`${API_BASE}/api/admin/${slug}/ingredients`, {
        headers: getAuthHeader()
    });
    if (!res.ok) throw new Error("Failed to fetch ingredients");
    return res.json();
}

export async function createIngredient(slug: string, ingredient: Partial<Ingredient>) {
    return fetch(`${API_BASE}/api/admin/${slug}/ingredients`, {
        method: "POST",
        headers: {
            ...getAuthHeader(),
            "Content-Type": "application/json"
        },
        body: JSON.stringify(ingredient)
    });
}

export async function updateIngredient(slug: string, id: string, ingredient: Partial<Ingredient>) {
    return fetch(`${API_BASE}/api/admin/${slug}/ingredients/${id}`, {
        method: "PUT",
        headers: {
            ...getAuthHeader(),
            "Content-Type": "application/json"
        },
        body: JSON.stringify(ingredient)
    });
}

export async function deleteIngredient(slug: string, id: string) {
    return fetch(`${API_BASE}/api/admin/${slug}/ingredients/${id}`, {
        method: "DELETE",
        headers: getAuthHeader()
    });
}

export async function fetchRecipeForMenuItem(slug: string, menuItemId: number): Promise<{ menu_item: AdminMenuItem; recipe: RecipeIngredient[] }> {
    const res = await fetch(`${API_BASE}/api/admin/${slug}/menu-items/${menuItemId}/recipe`, {
        headers: getAuthHeader()
    });
    if (!res.ok) throw new Error("Failed to fetch recipe");
    return res.json();
}

export async function addIngredientToRecipe(
    slug: string,
    menuItemId: number,
    payload: { ingredient_id: string; quantity_used: number; unit: string }
) {
    return fetch(`${API_BASE}/api/admin/${slug}/menu-items/${menuItemId}/recipe`, {
        method: "POST",
        headers: {
            ...getAuthHeader(),
            "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
    });
}

export async function updateRecipeIngredient(
    slug: string,
    id: string,
    payload: { quantity_used: number; unit: string }
) {
    return fetch(`${API_BASE}/api/admin/${slug}/recipe-ingredients/${id}`, {
        method: "PUT",
        headers: {
            ...getAuthHeader(),
            "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
    });
}

export async function deleteRecipeIngredient(slug: string, id: string) {
    return fetch(`${API_BASE}/api/admin/${slug}/recipe-ingredients/${id}`, {
        method: "DELETE",
        headers: getAuthHeader()
    });
}

export async function fetchMenuItemFoodCosts(slug: string): Promise<Array<{ id: number; name: string; selling_price: number; food_cost: number; food_cost_percentage: number }>> {
    const res = await fetch(`${API_BASE}/api/admin/${slug}/menu-items/food-cost`, {
        headers: getAuthHeader()
    });
    if (!res.ok) throw new Error("Failed to fetch food costs");
    return res.json();
}

export async function fetchInventory(slug: string): Promise<InventorySnapshotRow[]> {
    const res = await fetch(`${API_BASE}/api/admin/${slug}/inventory`, { headers: getAuthHeader() });
    if (!res.ok) throw new Error("Failed to fetch inventory");
    return res.json();
}

export async function fetchInventoryHistory(slug: string, ingredientId: string, days: number): Promise<Array<{ id: string; ingredient_id: string; quantity_on_hand: string | number; recorded_at: string; recorded_by: string | null }>> {
    const res = await fetch(`${API_BASE}/api/admin/${slug}/inventory/history?ingredient_id=${encodeURIComponent(ingredientId)}&days=${days}`, { headers: getAuthHeader() });
    if (!res.ok) throw new Error("Failed to fetch inventory history");
    return res.json();
}

export async function recordInventoryStockTake(slug: string, payload: { items: Array<{ ingredient_id: string; quantity_on_hand: number }>; recorded_by?: string }) {
    return fetch(`${API_BASE}/api/admin/${slug}/inventory`, {
        method: "POST",
        headers: { ...getAuthHeader(), "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });
}

export async function fetchInventoryVariance(slug: string, days: number): Promise<{ days: number; total_variance_cost: number; items: InventoryVarianceRow[] }> {
    const res = await fetch(`${API_BASE}/api/admin/${slug}/inventory/variance?days=${days}`, { headers: getAuthHeader() });
    if (!res.ok) throw new Error("Failed to fetch inventory variance");
    return res.json();
}

export async function fetchWasteLogs(slug: string, days: number): Promise<WasteLogRow[]> {
    const res = await fetch(`${API_BASE}/api/admin/${slug}/waste?days=${days}`, { headers: getAuthHeader() });
    if (!res.ok) throw new Error("Failed to fetch waste logs");
    return res.json();
}

export async function createWasteLog(slug: string, payload: { ingredient_id: string; quantity_wasted: number; reason: WasteLogRow["reason"]; notes?: string; logged_by?: string }) {
    return fetch(`${API_BASE}/api/admin/${slug}/waste`, {
        method: "POST",
        headers: { ...getAuthHeader(), "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });
}

export async function fetchWasteSummary(slug: string, days: number): Promise<WasteSummary> {
    const res = await fetch(`${API_BASE}/api/admin/${slug}/waste/summary?days=${days}`, { headers: getAuthHeader() });
    if (!res.ok) throw new Error("Failed to fetch waste summary");
    return res.json();
}

export type MenuChatMessage = {
    role: "user" | "assistant";
    content: string;
};

export async function chatWithMenuAssistant(
    slug: string,
    message: string,
    history: MenuChatMessage[]
): Promise<{ reply: string }> {
    const res = await fetch(`${API_BASE}/api/menu/${slug}/chat`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            message,
            history
        })
    });

    if (!res.ok) {
        throw new Error("Chat request failed");
    }

    return res.json();
}
