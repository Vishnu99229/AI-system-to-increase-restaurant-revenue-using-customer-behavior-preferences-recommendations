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
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "fallback_secret_for_dev";

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
        await pool.query(`
            CREATE TABLE IF NOT EXISTS restaurants (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                slug VARCHAR(255) UNIQUE NOT NULL,
                domain VARCHAR(255) UNIQUE NOT NULL,
                whatsapp_number VARCHAR(20),
                max_tables INTEGER DEFAULT 10,
                config JSONB DEFAULT '{}',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_name VARCHAR(255)`);
        await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_phone VARCHAR(20)`);
        await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'pending'`);
        await pool.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS admins (
                id SERIAL PRIMARY KEY,
                restaurant_id INTEGER REFERENCES restaurants(id) ON DELETE CASCADE,
                email VARCHAR(255) UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS menus (
                id SERIAL PRIMARY KEY,
                restaurant_id INTEGER REFERENCES restaurants(id) ON DELETE CASCADE,
                name VARCHAR(255) NOT NULL,
                description TEXT,
                price NUMERIC(10,2) NOT NULL,
                category VARCHAR(100),
                sub_category VARCHAR(100),
                tags TEXT[] DEFAULT '{}',
                image_url TEXT,
                is_available BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Additive migration for existing tables
        await pool.query(`ALTER TABLE menus ADD COLUMN IF NOT EXISTS sub_category VARCHAR(100)`);
        await pool.query(`ALTER TABLE menus ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}'`);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS upsell_events (
                id SERIAL PRIMARY KEY,
                restaurant_slug TEXT,
                table_number TEXT,
                item_id INTEGER,
                cart_value INTEGER,
                upsell_value INTEGER,
                event_type TEXT CHECK (event_type IN ('shown','accepted','rejected')),
                gpt_word_count INTEGER,
                upsell_reason TEXT,
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);
        console.log("✅ DB Migrations applied (restaurants, admins, orders, menus, upsell_events)");

        // --- Local Database Seeding ---
        if (
            process.env.NODE_ENV !== "production"
        ) {
            // 1. Ensure a test restaurant exists
            let restRes = await pool.query(`SELECT id FROM restaurants WHERE domain = 'demo-cafe' LIMIT 1`);
            let restaurantId;
            if (restRes.rows.length === 0) {
                console.log("🌱 Seeding test restaurant...");
                const insertRes = await pool.query(
                    `INSERT INTO restaurants (name, slug, domain, whatsapp_number, max_tables, config) 
                     VALUES ('Demo Cafe', 'demo-cafe', 'demo-cafe', '', 20, '{}') RETURNING id`
                );
                restaurantId = insertRes.rows[0].id;
            } else {
                restaurantId = restRes.rows[0].id;
            }

            // 2. Ensure a test admin exists
            const adminRes = await pool.query("SELECT id FROM admins WHERE email = 'admin@demo.cafe'");
            if (adminRes.rows.length === 0) {
                const hashedPassword = await bcrypt.hash("admin123", 10);
                await pool.query(
                    "INSERT INTO admins (restaurant_id, email, password_hash) VALUES ($1, $2, $3)",
                    [restaurantId, "admin@demo.cafe", hashedPassword]
                );
                console.log("🌱 Local Dev: Admin user seeded (admin@demo.cafe / admin123)");
            }

            const menuCountRes = await pool.query("SELECT COUNT(*) FROM menus");
            if (parseInt(menuCountRes.rows[0].count, 10) === 0) {
                console.log("🌱 Local Dev: menus table is empty. Seeding test data...");
                const seedItems = [
                    { name: 'Cold Coffee', price: 180, category: 'Beverages', sub_category: 'coffee', tags: ['coffee', 'cold', 'drink'], img: 'https://images.unsplash.com/photo-1578314675249-a6910f80cc4e?w=800' },
                    { name: 'Cappuccino', price: 200, category: 'Beverages', sub_category: 'coffee', tags: ['coffee', 'hot', 'drink'], img: 'https://images.unsplash.com/photo-1572442388796-11668a67e53d?w=800' },
                    { name: 'Croissant', price: 150, category: 'Food', sub_category: 'pastry', tags: ['bakery', 'pastry', 'breakfast'], img: 'https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=800' },
                    { name: 'Choco Muffin', price: 120, category: 'Dessert', sub_category: 'bakery', tags: ['chocolate', 'bakery', 'sweet'], img: 'https://images.unsplash.com/photo-1606890737304-57a1ca8a5b62?w=800' },
                    { name: 'Chocolate Brownie', price: 160, category: 'Dessert', sub_category: 'bakery', tags: ['chocolate', 'bakery', 'sweet'], img: 'https://images.unsplash.com/photo-1607920591413-4ec007e70023?w=800' },
                    { name: 'Vanilla Ice Cream', price: 140, category: 'Dessert', sub_category: 'ice-cream', tags: ['frozen', 'sweet', 'vanilla'], img: 'https://images.unsplash.com/photo-1570197571499-166b36435e9f?w=800' },
                    { name: 'Paneer Tikka Wrap', price: 220, category: 'Food', sub_category: 'main', tags: ['main', 'savory', 'wrap'], img: 'https://images.unsplash.com/photo-1626700051175-6818013e1d4f?w=800' },
                    { name: 'French Fries', price: 100, category: 'Food', sub_category: 'side', tags: ['side', 'snack', 'fried'], img: 'https://images.unsplash.com/photo-1573080496219-bb080dd4f877?w=800' }
                ];

                for (const item of seedItems) {
                    await pool.query(
                        `INSERT INTO menus (restaurant_id, name, description, price, category, sub_category, tags, image_url, is_available)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)`,
                        [restaurantId, item.name, `Delicious ${item.name}`, item.price, item.category, item.sub_category, item.tags, item.img]
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

// --- Middleware ---
const authenticateAdmin = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(" ")[1];
        if (!token) return res.status(401).json({ error: "Access denied" });

        const decoded = jwt.verify(token, JWT_SECRET);
        req.admin = decoded;
        next();
    } catch (err) {
        res.status(401).json({ error: "Invalid token" });
    }
};

// --- CORS Configuration ---
const ALLOWED_ORIGINS = [
    "https://orlena.talk",
    "https://api.orlena.talk",
    "https://qr-menu-upsell.vercel.app",
    "http://localhost:5173",
    "http://localhost:5174",
];

app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (ALLOWED_ORIGINS.includes(origin) || process.env.NODE_ENV !== "production") {
        res.setHeader("Access-Control-Allow-Origin", origin || "*");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Credentials", "true");

    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
});

app.use(express.json());

// --- Admin Auth ---
app.post("/api/admin/login", async (req, res) => {
    const { email, password } = req.body;
    console.log(`[AdminLogin] Attempt for: ${email}`);
    try {
        const result = await pool.query(
            "SELECT a.*, r.domain as slug FROM admins a JOIN restaurants r ON a.restaurant_id = r.id WHERE a.email = $1",
            [email]
        );
        
        if (result.rows.length === 0) {
            console.log(`[AdminLogin] FAILED: No admin/restaurant record for ${email}`);
            return res.status(401).json({ error: "Invalid credentials" });
        }

        const admin = result.rows[0];
        const valid = await bcrypt.compare(password, admin.password_hash);
        if (!valid) {
            console.log(`[AdminLogin] FAILED: Password mismatch for ${email}`);
            return res.status(401).json({ error: "Invalid credentials" });
        }

        console.log(`[AdminLogin] SUCCESS: ${email} logged in for slug: ${admin.slug}`);
        const token = jwt.sign({ id: admin.id, restaurant_id: admin.restaurant_id, slug: admin.slug }, JWT_SECRET, { expiresIn: "24h" });
        res.json({ token, admin: { email: admin.email, slug: admin.slug } });
    } catch (err) {
        console.error(`[AdminLogin] Error: ${err.message}`);
        res.status(500).json({ error: "Login failed" });
    }
});

// --- Admin Analytics ---
app.get("/api/admin/:slug/analytics", authenticateAdmin, async (req, res) => {
    const { slug } = req.params;
    if (req.admin.slug !== slug) return res.status(403).json({ error: "Forbidden" });

    try {
        const restaurant_id = req.admin.restaurant_id;

        const orderStats = await pool.query(
            "SELECT COUNT(*) as total_orders, COALESCE(SUM(total), 0) as total_revenue FROM orders WHERE restaurant_id = $1",
            [restaurant_id]
        );

        const upsellShown = await pool.query(
            "SELECT COUNT(*) as count FROM upsell_events WHERE restaurant_slug = $1 AND event_type = 'shown'",
            [slug]
        );
        const upsellAccepted = await pool.query(
            "SELECT COUNT(*) as count, COALESCE(SUM(upsell_value), 0) as revenue FROM upsell_events WHERE restaurant_slug = $1 AND event_type = 'accepted'",
            [slug]
        );

        const topUpsells = await pool.query(
            `SELECT m.name, COUNT(*) as count, SUM(u.upsell_value) as revenue 
             FROM upsell_events u 
             JOIN menus m ON u.item_id = m.id 
             WHERE u.restaurant_slug = $1 AND u.event_type = 'accepted'
             GROUP BY m.name ORDER BY count DESC LIMIT 5`,
            [slug]
        );

        const stats = orderStats.rows[0];
        const shownCount = parseInt(upsellShown.rows[0].count);
        const acceptedCount = parseInt(upsellAccepted.rows[0].count);
        const upsellRevenue = parseFloat(upsellAccepted.rows[0].revenue);
        const totalRevenue = parseFloat(stats.total_revenue);
        const totalOrders = parseInt(stats.total_orders);

        res.json({
            totalRevenue,
            totalOrders,
            aov: totalOrders > 0 ? totalRevenue / totalOrders : 0,
            upsellConversionRate: shownCount > 0 ? (acceptedCount / shownCount) * 100 : 0,
            upsellRevenue,
            revenueIncreasePercent: totalRevenue > 0 ? (upsellRevenue / (totalRevenue - upsellRevenue)) * 100 : 0,
            topUpsellItems: topUpsells.rows,
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to fetch analytics" });
    }
});

// --- Admin Orders ---
app.get("/api/admin/:slug/orders", authenticateAdmin, async (req, res) => {
    const { slug } = req.params;
    if (req.admin.slug !== slug) return res.status(403).json({ error: "Forbidden" });

    try {
        const result = await pool.query(
            "SELECT * FROM orders WHERE restaurant_id = $1 ORDER BY created_at DESC",
            [req.admin.restaurant_id]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch orders" });
    }
});

app.put("/api/admin/:slug/orders/:id/status", authenticateAdmin, async (req, res) => {
    const { status } = req.body;
    try {
        await pool.query(
            "UPDATE orders SET status = $1 WHERE id = $2 AND restaurant_id = $3",
            [status, req.params.id, req.admin.restaurant_id]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "Failed to update order status" });
    }
});

// --- Admin Menu Management ---
app.post("/api/admin/:slug/menu", authenticateAdmin, async (req, res) => {
    const { name, description, price, category, image_url } = req.body;
    try {
        const result = await pool.query(
            "INSERT INTO menus (restaurant_id, name, description, price, category, image_url) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
            [req.admin.restaurant_id, name, description, price, category, image_url]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: "Failed to add menu item" });
    }
});

app.put("/api/admin/:slug/menu/:id", authenticateAdmin, async (req, res) => {
    const { name, description, price, category, image_url, is_available } = req.body;
    try {
        const result = await pool.query(
            `UPDATE menus SET name=$1, description=$2, price=$3, category=$4, image_url=$5, is_available=$6 
             WHERE id=$7 AND restaurant_id=$8 RETURNING *`,
            [name, description, price, category, image_url, is_available, req.params.id, req.admin.restaurant_id]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: "Failed to update menu item" });
    }
});

app.delete("/api/admin/:slug/menu/:id", authenticateAdmin, async (req, res) => {
    try {
        await pool.query("DELETE FROM menus WHERE id=$1 AND restaurant_id=$2", [req.params.id, req.admin.restaurant_id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "Failed to delete menu item" });
    }
});

// --- OpenAI Client ---
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- Twilio Client ---
let twilioClient = null;
const TWILIO_FROM = process.env.TWILIO_WHATSAPP_NUMBER ? `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}` : null;
const TWILIO_TO = process.env.RESTAURANT_WHATSAPP_NUMBER ? `whatsapp:${process.env.RESTAURANT_WHATSAPP_NUMBER}` : null;

if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
}

// --- Standard Client Routes ---
app.get("/api/restaurant/:id", async (req, res) => {
    const result = await pool.query("SELECT name, max_tables FROM restaurants WHERE domain = $1", [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: "Restaurant not found" });
    res.json(result.rows[0]);
});

app.get("/api/:slug/menu", async (req, res) => {
    try {
        const resResult = await pool.query("SELECT id FROM restaurants WHERE domain = $1", [req.params.slug]);
        if (resResult.rows.length === 0) return res.status(404).json({ error: "Restaurant not found" });
        const menuResult = await pool.query(
            "SELECT id, name, description, price, category, image_url FROM menus WHERE restaurant_id = $1 AND is_available = true ORDER BY category, name",
            [resResult.rows[0].id]
        );
        res.json(menuResult.rows);
    } catch (err) {
        res.status(500).json({ error: "Menu fetch failed" });
    }
});

app.post("/api/upsell-event", async (req, res) => {
    try {
        const { restaurant_slug, table_number, item_id, cart_value, upsell_value, event_type, gpt_word_count, upsell_reason } = req.body;
        await pool.query(
            "INSERT INTO upsell_events (restaurant_slug, table_number, item_id, cart_value, upsell_value, event_type, gpt_word_count, upsell_reason) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
            [restaurant_slug, table_number, item_id, cart_value, upsell_value, event_type, gpt_word_count, upsell_reason]
        );
        res.json({ success: true });
    } catch (err) {
        console.error("[upsell-event] Error:", err.message);
        res.status(500).json({ error: "Failed to log upsell event" });
    }
});

// --- POST /api/upsell-shown ---
// Tracks when an upsell recommendation is displayed to the customer.
// The frontend calls this as a fire-and-forget POST (may have empty body).
app.post("/api/upsell-shown", async (req, res) => {
    try {
        const {
            restaurant_slug = null,
            table_number = null,
            item_id = null,
            cart_value = null,
            upsell_value = null,
            event_type = "shown",
            upsell_reason = null
        } = req.body || {};

        await pool.query(
            "INSERT INTO upsell_events (restaurant_slug, table_number, item_id, cart_value, upsell_value, event_type, gpt_word_count, upsell_reason) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
            [restaurant_slug, table_number, item_id, cart_value, upsell_value, event_type, 0, upsell_reason]
        );
        console.log("[upsell-shown] Event logged successfully");
        res.json({ success: true });
    } catch (err) {
        console.error("[upsell-shown] Error:", err.message);
        res.status(500).json({ error: "Failed to log upsell-shown event" });
    }
});

app.post("/api/:slug/order-complete", async (req, res) => {
    try {
        const resResult = await pool.query("SELECT id FROM restaurants WHERE domain = $1", [req.params.slug]);
        if (resResult.rows.length === 0) return res.status(404).json({ error: "Restaurant not found" });

        const { items, total, customer_name, customer_phone, upsellAccepted, upsellValue, tableNumber } = req.body;
        const result = await pool.query(
            "INSERT INTO orders (restaurant_id, items, total, customer_name, customer_phone, pairing_accepted) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
            [resResult.rows[0].id, JSON.stringify(items), total, customer_name, customer_phone, upsellAccepted]
        );

        res.json({ success: true, orderId: result.rows[0].id });
    } catch (err) {
        console.error("[order-complete] Error:", err.message);
        res.status(500).json({ success: false });
    }
});

// =============================================================================
// DETERMINISTIC UPSELL SCORING ENGINE
// =============================================================================

/**
 * Category pairing scores: Maps a cart item's category/sub_category keyword
 * to complementary candidate category/sub_category keywords.
 * Higher score = better pairing.
 */
const CATEGORY_PAIR_SCORES = {
    // Drinks pair with food
    'coffee':  { 'pastry': 40, 'bakery': 35, 'dessert': 30, 'sandwich': 25, 'main': 20, 'side': 15 },
    'beverage': { 'pastry': 35, 'bakery': 30, 'dessert': 30, 'sandwich': 25, 'main': 25, 'side': 20 },
    'drink':   { 'pastry': 35, 'bakery': 30, 'dessert': 30, 'main': 25, 'side': 20 },
    'tea':     { 'pastry': 40, 'bakery': 35, 'dessert': 25, 'sandwich': 20 },
    'juice':   { 'pastry': 25, 'bakery': 20, 'sandwich': 25, 'side': 15 },
    'shake':   { 'pastry': 20, 'bakery': 20, 'dessert': 15, 'side': 15 },
    // Food pairs with drinks
    'main':    { 'coffee': 25, 'beverage': 30, 'drink': 30, 'side': 35, 'dessert': 20 },
    'sandwich':{ 'coffee': 35, 'beverage': 30, 'drink': 30, 'side': 25 },
    'wrap':    { 'coffee': 30, 'beverage': 30, 'drink': 30, 'side': 25 },
    'pizza':   { 'beverage': 35, 'drink': 35, 'side': 30, 'dessert': 20 },
    'pasta':   { 'beverage': 30, 'drink': 30, 'side': 25, 'dessert': 20 },
    'burger':  { 'beverage': 35, 'drink': 35, 'side': 40, 'shake': 25 },
    'side':    { 'coffee': 20, 'beverage': 25, 'drink': 25, 'main': 15 },
    // Desserts pair with drinks
    'dessert': { 'coffee': 40, 'beverage': 30, 'drink': 30, 'tea': 25 },
    'bakery':  { 'coffee': 40, 'beverage': 30, 'drink': 30, 'tea': 30 },
    'pastry':  { 'coffee': 40, 'beverage': 30, 'drink': 30, 'tea': 30 },
    'sweet':   { 'coffee': 35, 'beverage': 25, 'drink': 25, 'tea': 25 },
    'cake':    { 'coffee': 40, 'beverage': 25, 'tea': 30 },
    'ice-cream': { 'brownie': 20 },  // Limited pairings for ice cream
};

/**
 * Anti-pairings: combinations that should be penalized.
 * Key = cart keyword, Value = array of candidate keywords to penalize.
 */
const ANTI_PAIRINGS = {
    'coffee':    ['coffee'],           // Don't recommend coffee with coffee
    'drink':     ['drink'],            // Don't recommend drink with drink
    'beverage':  ['beverage', 'drink'],
    'tea':       ['tea', 'coffee'],    // Don't recommend tea with tea or coffee
    'ice-cream': ['coffee', 'hot'],    // Don't recommend ice cream with hot drinks
    'frozen':    ['coffee', 'hot'],
    'dessert':   ['dessert'],          // Don't recommend dessert with dessert
    'sweet':     ['sweet', 'dessert'], // Don't stack sweets
    'main':      ['main'],            // Don't recommend main with main
    'side':      ['side'],            // Don't recommend side with side
};

/**
 * Tag affinity pairs: tags that indicate good pairings.
 * If a cart item and candidate share related tags, boost the score.
 */
const TAG_AFFINITY = {
    'coffee':    ['bakery', 'pastry', 'chocolate', 'sweet'],
    'chocolate': ['coffee', 'bakery'],
    'bakery':    ['coffee', 'tea', 'hot'],
    'pastry':    ['coffee', 'tea'],
    'breakfast': ['coffee', 'tea', 'juice'],
    'savory':    ['drink', 'beverage', 'coffee', 'side'],
    'main':      ['side', 'drink', 'beverage'],
    'snack':     ['drink', 'beverage', 'coffee'],
    'fried':     ['drink', 'beverage', 'shake'],
};

/**
 * Extracts searchable keywords from a candidate/cart item.
 * Combines lowercased category, sub_category, and tags.
 */
function extractKeywords(item) {
    const keywords = new Set();
    if (item.category) keywords.add(item.category.toLowerCase());
    if (item.sub_category) keywords.add(item.sub_category.toLowerCase());
    if (Array.isArray(item.tags)) {
        item.tags.forEach(t => keywords.add(t.toLowerCase()));
    }
    // Also extract keywords from the item name for fallback matching
    if (item.name) {
        const nameLower = item.name.toLowerCase();
        for (const kw of ['coffee', 'tea', 'juice', 'shake', 'pizza', 'pasta', 'burger', 'wrap', 'sandwich', 'brownie', 'muffin', 'croissant', 'cake', 'ice cream', 'fries']) {
            if (nameLower.includes(kw)) keywords.add(kw.replace(' ', '-'));
        }
    }
    return keywords;
}

/**
 * Scores a candidate item against the cart items.
 * Returns a numeric score (higher = better pairing).
 */
function scoreCandidate(candidate, cartItems) {
    let score = 0;
    const candidateKws = extractKeywords(candidate);

    for (const cartItem of cartItems) {
        const cartKws = extractKeywords(cartItem);

        // --- Anti-pairing penalty (-100) ---
        for (const ckw of cartKws) {
            const antiTargets = ANTI_PAIRINGS[ckw];
            if (antiTargets) {
                for (const anti of antiTargets) {
                    if (candidateKws.has(anti)) {
                        score -= 100;
                    }
                }
            }
        }

        // --- Same exact category penalty ---
        if (candidate.category && cartItem.category &&
            candidate.category.toLowerCase() === cartItem.category.toLowerCase()) {
            score -= 50;
        }

        // --- Category pairing score (max 40) ---
        let bestPairScore = 0;
        for (const ckw of cartKws) {
            const pairMap = CATEGORY_PAIR_SCORES[ckw];
            if (pairMap) {
                for (const candKw of candidateKws) {
                    if (pairMap[candKw] && pairMap[candKw] > bestPairScore) {
                        bestPairScore = pairMap[candKw];
                    }
                }
            }
        }
        score += bestPairScore;

        // --- Tag affinity score (up to 20) ---
        let tagScore = 0;
        for (const ckw of cartKws) {
            const affinityTags = TAG_AFFINITY[ckw];
            if (affinityTags) {
                for (const at of affinityTags) {
                    if (candidateKws.has(at)) {
                        tagScore += 5;
                    }
                }
            }
        }
        score += Math.min(tagScore, 20); // Cap tag affinity at 20
    }

    // --- Price proximity bonus (up to 10) ---
    const parsePrice = (p) => parseFloat(String(p).replace(/[^0-9.]/g, '')) || 0;
    const cartAvgPrice = cartItems.reduce((s, i) => s + parsePrice(i.price), 0) / (cartItems.length || 1);
    const candidatePrice = parsePrice(candidate.price);
    if (cartAvgPrice > 0) {
        const ratio = candidatePrice / cartAvgPrice;
        if (ratio >= 0.3 && ratio <= 1.5) {
            score += 10; // Within a reasonable price range
        } else if (ratio >= 0.2 && ratio <= 2.0) {
            score += 5; // Somewhat close in price
        }
    }

    // --- Popularity bonus ---
    if (candidate.popular) {
        score += 5;
    }

    return score;
}

/**
 * Generates a persuasive reason using GPT.
 * Returns fallback text if GPT fails or times out.
 */
async function generateUpsellReason(selectedItem, cartItems) {
    const cartItemName = cartItems?.[0]?.name || "order";
    const cartNames = cartItems.map(i => i.name).filter(Boolean).join(', ') || "order";
    const candName = selectedItem.name;

    const templates = [
        `The ${candName} perfectly complements your ${cartItemName.toLowerCase()} with balanced flavors.`,
        `Guests love pairing ${candName} with ${cartItemName.toLowerCase()} for a richer experience.`,
        `The smooth taste of ${candName} enhances the flavors of your ${cartItemName.toLowerCase()}.`,
        `This pairing of ${cartItemName.toLowerCase()} and ${candName} creates a satisfying flavor balance.`
    ];
    const fallbackReason = templates[Math.floor(Math.random() * templates.length)];

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000); // 8s timeout

        const completion = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            max_tokens: 40,
            temperature: 0.8,
            messages: [
                {
                    role: "system",
                    content: "You generate short, appetizing food pairing recommendations for a restaurant menu."
                },
                {
                    role: "user",
                    content: `Generate a natural sounding food pairing description between 10 and 15 words explaining why ${selectedItem.name} complements the customer's ${cartItemName}. You must explicitly mention both item names.`
                }
            ]
        }, { signal: controller.signal });

        clearTimeout(timeout);

        const reason = completion.choices?.[0]?.message?.content?.trim();
        if (reason && reason.length > 0 && reason.length < 100) {
            console.log(`[rank-upsell] GPT reason: "${reason}"`);
            return reason;
        }

        console.log("[rank-upsell] GPT returned empty/too-long, using fallback");
        return fallbackReason;
    } catch (err) {
        if (err.name === 'AbortError') {
            console.warn("[rank-upsell] GPT timed out after 8s, using fallback");
        } else {
            console.warn("[rank-upsell] GPT failed:", err.message, "— using fallback");
        }
        return fallbackReason;
    }
}

// --- POST /api/rank-upsell ---
// Deterministic scoring engine with optional GPT reason generation.
// Input:  { candidates: Item[], cartItems: Item[] }
// Output: { item: Item, reason: string }
app.post("/api/rank-upsell", async (req, res) => {
    try {
        const { candidates, cartItems } = req.body;

        if (!candidates || candidates.length === 0) {
            console.log("[rank-upsell] No candidates provided");
            return res.status(400).json({ error: "No candidates" });
        }

        const safeCartItems = Array.isArray(cartItems) ? cartItems : [];
        console.log(`[rank-upsell] Scoring ${candidates.length} candidates against ${safeCartItems.length} cart items`);

        // --- Enrich candidates with DB metadata if available ---
        let enrichedCandidates = candidates;
        try {
            const ids = candidates.map(c => c.id).filter(Boolean);
            if (ids.length > 0) {
                const dbResult = await pool.query(
                    "SELECT id, sub_category, tags FROM menus WHERE id = ANY($1)",
                    [ids]
                );
                const dbMap = {};
                for (const row of dbResult.rows) {
                    dbMap[row.id] = row;
                }
                enrichedCandidates = candidates.map(c => ({
                    ...c,
                    sub_category: c.sub_category || dbMap[c.id]?.sub_category || null,
                    tags: c.tags || dbMap[c.id]?.tags || []
                }));
            }
        } catch (dbErr) {
            console.warn("[rank-upsell] DB enrichment failed, using raw candidates:", dbErr.message);
        }

        // --- Enrich cart items with DB metadata if available ---
        let enrichedCartItems = safeCartItems;
        try {
            const cartIds = safeCartItems.map(c => c.id).filter(Boolean);
            if (cartIds.length > 0) {
                const dbResult = await pool.query(
                    "SELECT id, sub_category, tags FROM menus WHERE id = ANY($1)",
                    [cartIds]
                );
                const dbMap = {};
                for (const row of dbResult.rows) {
                    dbMap[row.id] = row;
                }
                enrichedCartItems = safeCartItems.map(c => ({
                    ...c,
                    sub_category: c.sub_category || dbMap[c.id]?.sub_category || null,
                    tags: c.tags || dbMap[c.id]?.tags || []
                }));
            }
        } catch (dbErr) {
            console.warn("[rank-upsell] Cart DB enrichment failed:", dbErr.message);
        }

        // --- Score and rank ---
        const scored = enrichedCandidates.map(candidate => ({
            candidate,
            score: scoreCandidate(candidate, enrichedCartItems)
        }));

        scored.sort((a, b) => b.score - a.score);

        // Log scores for debugging
        for (const s of scored) {
            console.log(`[rank-upsell]   ${s.candidate.name}: score=${s.score}`);
        }

        const best = scored[0];
        console.log(`[rank-upsell] Winner: ${best.candidate.name} (score: ${best.score})`);

        // --- Generate reason (GPT with fallback) ---
        const reason = await generateUpsellReason(best.candidate, enrichedCartItems);

        res.json({
            item: best.candidate,
            reason
        });
    } catch (err) {
        console.error("[rank-upsell] Unexpected error:", err.message);
        // Emergency fallback: return first candidate with generic reason
        try {
            const { candidates } = req.body;
            if (candidates && candidates.length > 0) {
                return res.json({
                    item: candidates[0],
                    reason: "A perfect addition to your order."
                });
            }
        } catch (_) { /* ignore */ }
        res.status(500).json({ error: "Internal error" });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
