const path = require("path");
// Override because OPENAI_API_KEY might be stale in shell env
require("dotenv").config({ path: path.join(__dirname, ".env"), override: true });

if (!process.env.OPENAI_API_KEY) {
    console.error("CRITICAL ERROR: OPENAI_API_KEY is missing from environment variables.");
    process.exit(1);
}

// Log loaded key (masked) for debugging
console.log("Loaded API Key:", process.env.OPENAI_API_KEY.substring(0, 15) + "..." + process.env.OPENAI_API_KEY.slice(-4));

const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");
const twilio = require("twilio");

const app = express();
const PORT = process.env.PORT || 3001;

// --- Middleware ---
app.use(express.json());
app.use(
    cors({
        origin: [
            "http://localhost:5173",
            "https://qr-menu-upsell.vercel.app",
        ],
    })
);

// --- Health Check ---
app.get("/", (req, res) => {
    res.json({ status: "ok", service: "goschedule-qr-backend" });
});

// --- OpenAI Client ---
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// --- Twilio Client (WhatsApp) ---
let twilioClient = null;
const TWILIO_FROM = process.env.TWILIO_WHATSAPP_NUMBER
    ? `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`
    : null;
const TWILIO_TO = process.env.RESTAURANT_WHATSAPP_NUMBER
    ? `whatsapp:${process.env.RESTAURANT_WHATSAPP_NUMBER}`
    : null;

if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    console.log("[Twilio] Client initialized for WhatsApp notifications.");
} else {
    console.warn("[Twilio] Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN — WhatsApp notifications disabled.");
}

// --- Multi-Restaurant Config ---
const restaurants = {
    "thirdwave-koramangala": {
        name: "Thirdwave Koramangala",
        whatsappNumber: process.env.RESTAURANT_WHATSAPP_NUMBER,
        maxTables: 20,
    },
};

// --- Analytics Store (In-Memory) ---
let analytics = {
    orders: [],
    upsellShown: 0,
    upsellAccepted: 0,
};

// --- WhatsApp Notification Helper ---

/**
 * Sends a WhatsApp message to the restaurant for a completed order.
 * Fire-and-forget: errors are logged but never propagated.
 */
async function sendOrderWhatsApp({ orderId, totalValue, upsellAccepted, upsellValue, items, restaurantId, tableNumber }) {
    if (!twilioClient || !TWILIO_FROM || !TWILIO_TO) {
        return; // Silently skip if Twilio is not configured
    }

    const now = new Date();
    const timeStr = now.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true });

    // Resolve restaurant name from config
    const restaurantConfig = restaurants[restaurantId];
    const restaurantName = restaurantConfig ? restaurantConfig.name : (restaurantId || "Not Specified");

    // Format items list
    let itemList = "(not available)";
    if (Array.isArray(items) && items.length > 0) {
        const grouped = {};
        for (const item of items) {
            const name = item.name || "Unknown";
            const price = item.price || "";
            if (grouped[name]) {
                grouped[name].qty += 1;
            } else {
                grouped[name] = { qty: 1, price };
            }
        }
        itemList = Object.entries(grouped)
            .map(([name, { qty, price }]) => `\u2022 ${name} \u00d7${qty} \u2014 ${price}`)
            .join("\n");
    }

    // Upsell line
    const upsellLine = upsellAccepted
        ? `Upsell Added: Yes (+\u20b9${parseFloat(upsellValue || 0).toFixed(2)})`
        : `Upsell Added: No`;

    const message = [
        `\ud83c\udd95 New Order`,
        ``,
        `Restaurant: ${restaurantName}`,
        `Table: ${tableNumber || "Not Specified"}`,
        ``,
        `Items:`,
        itemList,
        ``,
        `Total: \u20b9${parseFloat(totalValue).toFixed(2)}`,
        upsellLine,
        ``,
        `Time: ${timeStr}`,
    ].join("\n");

    try {
        await twilioClient.messages.create({
            from: TWILIO_FROM,
            to: TWILIO_TO,
            body: message,
        });
        console.log(`[Twilio] WhatsApp sent for order ${orderId}`);
    } catch (err) {
        console.error(`[Twilio] WhatsApp failed for order ${orderId}:`, err.message);
        // Never throw — order flow must not be affected
    }
}

// --- Routes ---

/**
 * GET /api/restaurant/:id
 * Returns restaurant config (name, maxTables) or 404.
 */
app.get("/api/restaurant/:id", (req, res) => {
    const config = restaurants[req.params.id];
    if (!config) {
        return res.status(404).json({ error: "Restaurant not found" });
    }
    res.json({ name: config.name, maxTables: config.maxTables });
});

/**
 * POST /api/upsell-shown
 * Increments the upsell shown counter.
 */
app.post("/api/upsell-shown", (req, res) => {
    analytics.upsellShown++;
    // console.log("[Analytics] Upsell shown");
    res.status(200).send("OK");
});

/**
 * POST /api/order-complete
 * Tracks a completed order.
 * Input: { orderId, totalValue, upsellAccepted, upsellValue }
 */
app.post("/api/order-complete", (req, res) => {
    const { orderId, totalValue, upsellAccepted, upsellValue } = req.body;

    if (!orderId || totalValue === undefined || upsellAccepted === undefined) {
        return res.status(400).json({ error: "Missing required fields" });
    }

    // Validation: upsellValue must be 0 if upsellAccepted is false
    let validatedUpsellValue = parseFloat(upsellValue) || 0;
    if (!upsellAccepted) {
        validatedUpsellValue = 0;
    }

    analytics.orders.push({
        orderId,
        totalValue: parseFloat(totalValue),
        upsellAccepted: !!upsellAccepted,
        upsellValue: validatedUpsellValue,
        timestamp: new Date(),
    });

    if (upsellAccepted) {
        analytics.upsellAccepted++;
    }

    console.log(`[Analytics] Order logged: $${totalValue} (Upsell: ${upsellAccepted}, Value: $${validatedUpsellValue})`);

    // Fire-and-forget WhatsApp notification — never blocks response
    sendOrderWhatsApp({
        orderId,
        totalValue,
        upsellAccepted: !!upsellAccepted,
        upsellValue: validatedUpsellValue,
        items: req.body.items || [],
        restaurantId: req.body.restaurantId || "",
        tableNumber: req.body.tableNumber || "",
    });

    res.status(200).send("OK");
});

/**
 * GET /api/analytics
 * Computes and returns revenue metrics (Internal & Sales layers).
 */
app.get("/api/analytics", (req, res) => {
    const totalOrders = analytics.orders.length;
    const ordersWithUpsell = analytics.orders.filter(o => o.upsellAccepted);
    const ordersWithoutUpsell = analytics.orders.filter(o => !o.upsellAccepted);

    const sumTotal = (orders) => orders.reduce((sum, o) => sum + o.totalValue, 0);

    const totalRevenue = sumTotal(analytics.orders);
    const totalRevenueWith = sumTotal(ordersWithUpsell);
    const totalRevenueWithout = sumTotal(ordersWithoutUpsell);

    // --- Internal Metrics (Scientific) ---
    const countWith = ordersWithUpsell.length;
    const countWithout = ordersWithoutUpsell.length;

    const AOV_with_upsell = countWith > 0 ? totalRevenueWith / countWith : 0;
    const AOV_without_upsell = countWithout > 0 ? totalRevenueWithout / countWithout : 0;

    // Revenue Lift % = (AOV_with - AOV_without) / AOV_without
    // Can be negative.
    let revenueLiftPercent = 0;
    if (AOV_without_upsell > 0) {
        revenueLiftPercent = (AOV_with_upsell - AOV_without_upsell) / AOV_without_upsell;
    }

    // --- Sales Metrics (Presentation) ---
    const totalUpsellRevenue = analytics.orders.reduce((sum, o) => sum + o.upsellValue, 0);

    // Average Upsell Value = Total Upsell Revenue / Count Accepted
    const averageUpsellValue = analytics.upsellAccepted > 0
        ? totalUpsellRevenue / analytics.upsellAccepted
        : 0;

    // Incremental Revenue % = (Total Upsell Revenue / Total Revenue) * 100
    // Must be non-negative.
    const incrementalRevenuePercent = totalRevenue > 0
        ? (totalUpsellRevenue / totalRevenue) * 100
        : 0;

    const conversionRate = analytics.upsellShown > 0
        ? analytics.upsellAccepted / analytics.upsellShown
        : 0;

    res.json({
        internalMetrics: {
            totalOrders,
            upsellShown: analytics.upsellShown,
            upsellAccepted: analytics.upsellAccepted,
            conversionRate,
            AOV_with_upsell,
            AOV_without_upsell,
            revenueLiftPercent,
        },
        salesMetrics: {
            totalOrders,
            upsellAccepted: analytics.upsellAccepted,
            conversionRate,
            totalUpsellRevenue,
            averageUpsellValue,
            incrementalRevenuePercent,
            dataStatus: totalOrders >= 20 ? "ready" : "collecting",
            dataMessage: totalOrders >= 20
                ? null
                : "Collecting sufficient data for reliable AOV comparison.",
        }
    });
});

/**
 * POST /api/rephrase
 *
 * Input JSON:
 *   { baseItem: string, suggestedItem: string, deterministicReason: string }
 *
 * Returns:
 *   { reason: string }
 *
 * On OpenAI failure, returns deterministicReason as fallback (200).
 */
app.post("/api/rephrase", async (req, res) => {
    try {
        const { baseItem, suggestedItem, deterministicReason } = req.body;

        // Validate required fields
        if (!baseItem || !suggestedItem || !deterministicReason) {
            return res.status(400).json({
                error: "Missing required fields: baseItem, suggestedItem, deterministicReason",
            });
        }

        // Call OpenAI
        try {
            const completion = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                temperature: 0.3,
                max_tokens: 60,
                messages: [
                    {
                        role: "system",
                        content:
                            "Rephrase the given reason into one persuasive sentence under 20 words. Do not invent ingredients. Do not exaggerate. Return plain text only.",
                    },
                    {
                        role: "user",
                        content: `Base item: ${baseItem}. Suggested item: ${suggestedItem}. Reason: ${deterministicReason}`,
                    },
                ],
            });

            const rephrased = completion.choices?.[0]?.message?.content?.trim();

            if (rephrased) {
                console.log(`[Rephrase] "${deterministicReason}" → "${rephrased}"`);
                return res.json({ reason: rephrased });
            }

            // No content from API — fallback
            console.warn("[Rephrase] Empty response from OpenAI, using fallback");
            return res.json({ reason: deterministicReason });
        } catch (apiError) {
            console.error("[Rephrase] OpenAI API error:", apiError.message);
            // Return fallback with 200 — never crash
            return res.json({ reason: deterministicReason });
        }
    } catch (err) {
        console.error("[Rephrase] Unexpected error:", err.message);
        return res.status(500).json({ error: "Internal server error" });
    }
});

// --- Start ---
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
