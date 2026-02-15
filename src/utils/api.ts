export interface RephraseRequest {
    baseItem: string;
    suggestedItem: string;
    deterministicReason: string;
}

export interface RephraseResponse {
    reason: string;
}

/**
 * Call the backend rephrase API.
 * Returns the rephrased reason or null if the call fails.
 */
export async function rephraseReason(
    baseItem: string,
    suggestedItem: string,
    deterministicReason: string
): Promise<string | null> {
    try {
        const response = await fetch("http://localhost:3001/api/rephrase", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                baseItem,
                suggestedItem,
                deterministicReason,
            }),
        });

        if (!response.ok) {
            console.warn("Rephrase API failed with status:", response.status);
            return null;
        }

        const data: RephraseResponse = await response.json();
        return data.reason;
    } catch (error) {
        console.warn("Rephrase API network error:", error);
        return null;
    }
}

/**
 * Tracks when an upsell suggestion is displayed.
 */
export async function trackUpsellShown(): Promise<void> {
    try {
        await fetch("http://localhost:3001/api/upsell-shown", { method: "POST" });
    } catch (error) {
        // Analytics should not block app flow
        console.warn("Analytics error (upsell-shown):", error);
    }
}

/**
 * Tracks when an order is completed.
 */
export async function trackOrderComplete(
    orderId: string,
    totalValue: number,
    upsellAccepted: boolean,
    upsellValue: number = 0,
    items: { name: string; price: string }[] = [],
    restaurantId: string = "",
    tableNumber: string = ""
): Promise<void> {
    try {
        await fetch("http://localhost:3001/api/order-complete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                orderId,
                totalValue,
                upsellAccepted,
                upsellValue,
                items: items.map(i => ({ name: i.name, price: i.price })),
                restaurantId,
                tableNumber,
            }),
        });
    } catch (error) {
        console.warn("Analytics error (order-complete):", error);
    }
}
