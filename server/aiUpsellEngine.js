const { OpenAI } = require("openai");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Track the last recommended item globally to prevent repetitive suggestions
let lastRecommendedItemName = null;

/**
 * Uses GPT to select the best complementary upsell item.
 *
 * @param {Object[]} candidates - Items GPT is allowed to recommend
 * @param {Object[]} cartItems  - The customer's current cart items
 * @param {Object[]} fullMenu   - The entire available menu
 * @returns {Object} { item, reason, copy }
 */
async function generateUpsell(candidates, cartItems, fullMenu = []) {
    const primaryItem = cartItems?.[0] || {};

    // 1. Candidate Filtering & Explicit Blocking
    // - Not in cart (handled by index.js before calling this)
    // - Not in same category (handled by index.js before calling this)
    // - Available (handled by index.js before calling this)
    // - AND NOT the last recommended item (to prevent repetitive defaults like Vanilla Ice Cream)
    let filteredCandidates = candidates;
    if (lastRecommendedItemName) {
        filteredCandidates = candidates.filter(
            c => c.name.toLowerCase() !== lastRecommendedItemName.toLowerCase()
        );
    }

    // If we blocked the last one and now we have nothing, fall back to the original candidates
    if (filteredCandidates.length === 0 && candidates.length > 0) {
         filteredCandidates = candidates;
    } else if (filteredCandidates.length === 0) {
        throw new Error("No candidates available for recommendation.");
    }

    // 2. Format Context and Candidates for GPT
    const candidateList = filteredCandidates.map(c => c.name).join('\n');

    // 3. Fallback Setup
    const fallbackIndex = Math.floor(Math.random() * filteredCandidates.length);
    const fallbackItem = filteredCandidates[fallbackIndex];
    const fallbackResult = {
         item: fallbackItem,
         reason: `${fallbackItem.name} makes a great addition to your order.`,
         copy: `Add ${fallbackItem.name} to complete your meal!`
    };

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);

        // 4. GPT Prompt Construction
        const completion = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            max_tokens: 150,
            temperature: 0.7,
            messages: [
                {
                    role: "system",
                    content: `You are a restaurant upsell engine. Your job is to pick the ONE item from the allowed list that best COMPLETES the customer's meal.

Rules:
- A main dish (burger, wrap, breakfast, fish & chips) should be paired with a DRINK or DESSERT. Never pair main + main.
- A beverage (coffee, juice, smoothie, lemon drink) should be paired with a FOOD ITEM or DESSERT. Never pair drink + drink.
- A dessert (brownie, muffin, ice cream) should be paired with a BEVERAGE. Never pair dessert + dessert.
- Think about what a real customer would naturally order together.
- Pick the item that makes the overall meal feel complete.

Good pairings:
- Vegetable Burger + Cold Coffee (main + drink)
- Cold Coffee + Croissant (drink + snack)
- Fish & Chips + Fresh Lime Soda (main + drink)
- Pancake + Cappuccino (breakfast + hot drink)
- Chocolate Brownie + Cappuccino (dessert + hot drink)

Bad pairings (NEVER do this):
- Burger + English Breakfast (main + main)
- Cold Coffee + Pineapple Juice (drink + drink)
- Ice Cream + Chocolate Brownie (dessert + dessert)

Output exact JSON:
{
  "recommended_item": "<exact item name from allowed list>",
  "reason": "<one sentence why this completes the meal>",
  "upsell_copy": "<short friendly nudge, max 10 words>"
}`
                },
                {
                    role: "user",
                    content: `Primary item ordered:
${primaryItem.name || 'Unknown'}

Allowed recommendation items (choose exactly one):
${candidateList}

Choose the ONE item that best complements the primary item.
Focus on taste pairing, meal timing, and balance.

Return JSON:`
                }
            ],
            response_format: { type: "json_object" }
        }, { signal: controller.signal });

        clearTimeout(timeout);

        const raw = completion.choices?.[0]?.message?.content?.trim();
        console.log(`[aiUpsellEngine] GPT raw response: ${raw}`);

        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch (e) {
            console.error("[aiUpsellEngine] Failed to parse GPT response as JSON:", raw);
            return fallbackResult;
        }

        const recommendedName = parsed.recommended_item?.trim();
        const reason = parsed.reason?.trim();
        const copy = parsed.upsell_copy?.trim();

        // 5. Backend Validation
        if (recommendedName && reason && copy) {
            // match the item name against the candidate list
            const matchedItem = filteredCandidates.find(
                c => c.name.toLowerCase() === recommendedName.toLowerCase()
            );

            if (matchedItem) {
                console.log(`[aiUpsellEngine] GPT successfully picked: ${matchedItem.name}`);
                
                // Track last recommended item
                lastRecommendedItemName = matchedItem.name;
                
                return { item: matchedItem, reason, copy };
            } else {
                 console.warn(`[aiUpsellEngine] GPT recommended missing item name "${recommendedName}". Falling back.`);
            }
        } else {
             console.warn("[aiUpsellEngine] GPT response missing required fields. Falling back.");
        }

        // Fallback if not matched or missing fields
        // Update track even on fallback to ensure variety
        lastRecommendedItemName = fallbackItem.name;
        return fallbackResult;

    } catch (err) {
        if (err.name === 'AbortError') {
            console.warn("[aiUpsellEngine] GPT timed out. Falling back.");
        } else {
            console.warn("[aiUpsellEngine] GPT error:", err.message);
        }
        
        lastRecommendedItemName = fallbackItem.name;
        return fallbackResult;
    }
}

module.exports = {
    generateUpsell
};
