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
const OpenAI = require("openai");
const twilio = require("twilio");
const { Pool } = require("pg");

// --- PostgreSQL Pool ---
console.log("DATABASE_URL exists:", !!process.env.DATABASE_URL);
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// --- DB Startup: Health Check + Migrations ---
(async () => {
    try {
        const test = await pool.query("SELECT NOW()");
        console.log("✅ DB Connected:", test.rows[0]);

        // Idempotent schema migrations
        await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_name VARCHAR(255)`);
        await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_phone VARCHAR(20)`);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS menus (
                id SERIAL PRIMARY KEY,
                restaurant_id INTEGER REFERENCES restaurants(id) ON DELETE CASCADE,
                name VARCHAR(255) NOT NULL,
                description TEXT,
                price NUMERIC(10,2) NOT NULL,
                category VARCHAR(100),
                image_url TEXT,
                is_available BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log("✅ DB Migrations applied (customer_name, customer_phone, menus table)");

        // --- Local Database Seeding ---
        if (
            process.env.NODE_ENV !== "production" &&
            process.env.LOCAL_SEED === "true"
        ) {
            const menuCountRes = await pool.query("SELECT COUNT(*) FROM menus");
            if (parseInt(menuCountRes.rows[0].count, 10) === 0) {
                console.log("🌱 Local Dev: menus table is empty. Seeding test data...");

                // 1. Ensure a test restaurant exists
                let restRes = await pool.query(`SELECT id FROM restaurants WHERE slug = 'test-rest' LIMIT 1`);
                if (restRes.rows.length === 0) {
                    restRes = await pool.query(
                        `INSERT INTO restaurants (name, slug, whatsapp_number, max_tables, config) 
                         VALUES ('Test Restaurant', 'test-rest', '', 20, '{}') RETURNING id`
                    );
                }
                const restaurantId = restRes.rows[0].id;

                // 2. Insert test menu items
                const seedItems = [
                    { name: 'Cold Coffee', price: 180, category: 'Beverages', img: 'https://images.unsplash.com/photo-1578314675249-a6910f80cc4e?w=800' },
                    { name: 'Croissant', price: 150, category: 'Food', img: 'https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=800' },
                    { name: 'Choco Muffin', price: 120, category: 'Dessert', img: 'https://images.unsplash.com/photo-1606890737304-57a1ca8a5b62?w=800' }
                ];

                for (const item of seedItems) {
                    await pool.query(
                        `INSERT INTO menus (restaurant_id, name, description, price, category, image_url, is_available)
                         VALUES ($1, $2, $3, $4, $5, $6, true)`,
                        [restaurantId, item.name, `Delicious test ${item.name}`, item.price, item.category, item.img]
                    );
                }
                console.log("✅ Local Dev: Test menus seeded successfully.");
            }
        }
    } catch (err) {
        console.error("❌ DB Startup Failed:", err);
    }
})();

const app = express();
const PORT = process.env.PORT || 3001;

// --- CORS Configuration (manual middleware for Express 5 reliability) ---
const ALLOWED_ORIGINS = [
    "https://orlena.talk",
    "https://api.orlena.talk",
    "https://qr-menu-upsell.vercel.app",
];

app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (ALLOWED_ORIGINS.includes(origin)) {
        res.setHeader("Access-Control-Allow-Origin", origin);
    }
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Credentials", "true");

    // Handle preflight
    if (req.method === "OPTIONS") {
        return res.sendStatus(204);
    }
    next();
});

// --- Body Parser ---
app.use(express.json());

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
    console.log("[Twilio] FROM:", TWILIO_FROM || "NOT SET");
    console.log("[Twilio] TO:", TWILIO_TO || "NOT SET");
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
        console.warn(`[Twilio] SKIPPED for order ${orderId} — twilioClient: ${!!twilioClient}, FROM: ${TWILIO_FROM}, TO: ${TWILIO_TO}`);
        return;
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

    console.log(`[Twilio] Sending WhatsApp for order ${orderId}...`);
    console.log(`[Twilio] FROM: ${TWILIO_FROM}, TO: ${TWILIO_TO}`);

    try {
        const result = await twilioClient.messages.create({
            from: TWILIO_FROM,
            to: TWILIO_TO,
            body: message,
        });
        console.log(`[Twilio] ✅ WhatsApp sent for order ${orderId}`);
        console.log(`[Twilio] SID: ${result.sid}, Status: ${result.status}`);
    } catch (err) {
        console.error(`[Twilio] ❌ WhatsApp FAILED for order ${orderId}`);
        console.error(`[Twilio] Error: ${err.message}`);
        console.error(`[Twilio] Code: ${err.code}, Status: ${err.status}`);
        console.error(`[Twilio] More Info: ${err.moreInfo || "N/A"}`);
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
 * GET /api/:slug/menu
 * Returns menu items for a restaurant identified by slug.
 */
app.get("/api/:slug/menu", async (req, res) => {
    try {
        const slug = req.params.slug;

        // Look up restaurant by slug
        const restaurantResult = await pool.query(
            "SELECT id FROM restaurants WHERE domain = $1",
            [slug]
        );

        if (restaurantResult.rows.length === 0) {
            return res.status(404).json({ error: "Restaurant not found" });
        }

        const restaurant_id = restaurantResult.rows[0].id;

        // Fetch available menu items
        const menuResult = await pool.query(
            `SELECT id, name, description, price, category, image_url
             FROM menus
             WHERE restaurant_id = $1 AND is_available = true
             ORDER BY category, name`,
            [restaurant_id]
        );

        res.json(menuResult.rows);
    } catch (error) {
        console.error("Menu fetch failed:", error);
        res.status(500).json({ error: "Internal server error" });
    }
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
 * POST /api/:slug/order-complete
 * Multi-tenant: looks up restaurant by slug, inserts order into PostgreSQL.
 * Input: { items, subtotal, tax, total, pairing_accepted, customer_name, customer_phone,
 *          orderId, totalValue, upsellAccepted, upsellValue, tableNumber }
 */
app.post("/api/:slug/order-complete", async (req, res) => {
    try {
        const slug = req.params.slug;
        console.log("Incoming order payload:", req.body);
        console.log("Restaurant slug:", slug);

        // --- Look up restaurant by slug ---
        const restaurantResult = await pool.query(
            "SELECT id FROM restaurants WHERE domain = $1",
            [slug]
        );

        if (restaurantResult.rows.length === 0) {
            return res.status(404).json({ success: false, error: "Restaurant not found" });
        }

        const restaurant_id = restaurantResult.rows[0].id;

        const {
            items, subtotal, tax, total, pairing_accepted,
            customer_name, customer_phone,
            orderId, totalValue, upsellAccepted, upsellValue,
        } = req.body;

        // --- Validate customer info ---
        if (!customer_name || !customer_phone) {
            return res.status(400).json({ success: false, error: "customer_name and customer_phone are required" });
        }

        // --- PostgreSQL Insert ---
        const result = await pool.query(
            `INSERT INTO orders
             (restaurant_id, items, subtotal, tax, total, pairing_accepted, customer_name, customer_phone)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING id`,
            [
                restaurant_id,
                JSON.stringify(items),
                subtotal,
                tax,
                total,
                pairing_accepted,
                customer_name,
                customer_phone,
            ]
        );

        const insertedId = result.rows[0].id;
        console.log("Inserted order ID:", insertedId);

        // --- Temporary Verification Query (remove after verification) ---
        const verify = await pool.query(
            "SELECT * FROM orders WHERE id = $1",
            [insertedId]
        );
        console.log("Verification row:", verify.rows[0]);

        // --- In-Memory Analytics (preserved) ---
        const effectiveOrderId = orderId || insertedId;
        const effectiveTotalValue = totalValue !== undefined ? parseFloat(totalValue) : parseFloat(total) || 0;
        let validatedUpsellValue = parseFloat(upsellValue) || 0;
        if (!upsellAccepted) {
            validatedUpsellValue = 0;
        }

        analytics.orders.push({
            orderId: effectiveOrderId,
            totalValue: effectiveTotalValue,
            upsellAccepted: !!upsellAccepted,
            upsellValue: validatedUpsellValue,
            timestamp: new Date(),
        });

        if (upsellAccepted) {
            analytics.upsellAccepted++;
        }

        console.log(`[Analytics] Order logged: $${effectiveTotalValue} (Upsell: ${upsellAccepted}, Value: $${validatedUpsellValue})`);

        // Fire-and-forget WhatsApp notification — never blocks response
        sendOrderWhatsApp({
            orderId: effectiveOrderId,
            totalValue: effectiveTotalValue,
            upsellAccepted: !!upsellAccepted,
            upsellValue: validatedUpsellValue,
            items: req.body.items || [],
            restaurantId: slug,
            tableNumber: req.body.tableNumber || "",
        });

        res.json({ success: true, orderId: insertedId });

    } catch (error) {
        console.error("Order insert failed:", error);
        res.status(500).json({ success: false });
    }
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
 *   { baseItem: string, suggestedItem: string }
 *
 * Returns:
 *   { reason: string }
 *
 * Generates ONE short persuasive sentence (20–25 words max) using GPT-4o.
 * On OpenAI failure, returns a safe fallback (200). Never crashes order flow.
 */
app.post("/api/rephrase", async (req, res) => {
    const fallback = (base) => `Pairs well with your ${base}.`;

    try {
        const { baseItem, suggestedItem } = req.body;

        // Validate required fields
        if (!baseItem || !suggestedItem) {
            return res.status(400).json({
                error: "Missing required fields: baseItem, suggestedItem",
            });
        }

        console.log("[Rephrase] GPT call started");

        // Call OpenAI
        try {
            const completion = await openai.chat.completions.create({
                model: "gpt-4o",
                temperature: 0.7,
                max_tokens: 40,
                messages: [
                    {
                        role: "system",
                        content: [
                            "You are a restaurant menu assistant.",
                            "Write ONE short persuasive sentence explaining why a customer should add the suggested item alongside their base item.",
                            "Rules:",
                            "- Maximum 20 to 25 words.",
                            "- Be natural, specific, and non-generic.",
                            "- Vary sentence structure every time — do not repeat the same opening or pattern.",
                            "- No markdown, no quotation marks, no emojis.",
                            "- Return plain text only.",
                        ].join(" "),
                    },
                    {
                        role: "user",
                        content: `Base item: ${baseItem}. Suggested item: ${suggestedItem}.`,
                    },
                ],
            });

            const reason = completion.choices?.[0]?.message?.content?.trim();

            if (reason) {
                console.log("[Rephrase] GPT success");
                return res.json({ reason });
            }

            // No content from API — fallback
            console.warn("[Rephrase] Empty response — GPT fallback used");
            return res.json({ reason: fallback(baseItem) });
        } catch (apiError) {
            console.error("[Rephrase] OpenAI API error:", apiError.message);
            console.log("[Rephrase] GPT fallback used");
            // Return fallback with 200 — never crash
            return res.json({ reason: fallback(baseItem) });
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
