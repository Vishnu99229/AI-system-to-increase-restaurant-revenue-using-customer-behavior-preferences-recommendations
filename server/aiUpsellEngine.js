const { OpenAI } = require("openai");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Track the last recommended item globally removed to prevent cross-customer bleeding

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
    let filteredCandidates = candidates;

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
            model: "gpt-4o-mini",
            max_tokens: 150,
            temperature: 0.4,
            messages: [
                {
                    role: "system",
                    content: `You are an expert restaurant menu pairing assistant for an Indian cafe. Your job is to pick the ONE item from the allowed list that most naturally completes the customer's order.

CORE PAIRING PRINCIPLES (in priority order):

1. FLAVOR CONTRAST over flavor overlap.
   - Sweet drink pairs with savory food (latte + croissant, not latte + brownie)
   - Savory food pairs with dessert or drink (burger + cold coffee, not burger + fries)
   - Hot item pairs with cold item when possible (hot coffee + cold cheesecake is fine; hot coffee + hot tea is wrong)

2. NO FLAVOR DOUBLE-STACKING. Never pair two items with overlapping primary flavors:
   - Chocolate + Chocolate (brownie + chocolate shake = BAD)
   - Coffee + Coffee (latte + cold brew = BAD)
   - Sweet + Sweet (mocha + ice cream = BAD)
   - Fried + Fried (fries + pakoda = BAD)

3. MEAL COMPLETENESS. Pair items that a real guest in Bangalore would order together in one sitting:
   - Morning: coffee + breakfast item (croissant, sandwich, eggs)
   - Afternoon: meal + refreshing drink (biryani + lassi, burger + cold coffee)
   - Evening: snack + light drink, or drink + dessert

4. AVOID REDUNDANCY. If the primary item is already indulgent or rich (mocha, milkshake, heavy dessert), pair with something lighter and contrasting (a savory snack, a plain pastry, a refreshing item).

EXAMPLES OF GOOD PAIRINGS:
- Cappuccino + Croissant (hot drink + buttery pastry — classic, contrasting)
- Veg Burger + Cold Coffee (savory + sweet drink)
- Fish and Chips + Fresh Lime Soda (rich + refreshing)
- Chocolate Brownie + Espresso (sweet dessert + strong bitter drink)
- Masala Dosa + Filter Coffee (savory breakfast + hot beverage)

EXAMPLES OF BAD PAIRINGS (never do these):
- Peppermint Mocha + Chocolate Brownie (chocolate + chocolate, sweet + sweet)
- Cold Coffee + Iced Mocha (coffee + coffee)
- Vanilla Ice Cream + Cheesecake (dessert + dessert)
- Masala Fries + Aloo Tikki (fried + fried)
- Green Smoothie + Fresh Juice (drink + drink, both healthy)

OUTPUT FORMAT (return EXACTLY this JSON, no other text):
{
  "recommended_item": "<exact item name from the allowed list>",
  "reason": "<one sentence explaining the pairing, focus on contrast>",
  "upsell_copy": "<short, warm nudge under 10 words>"
}`
                },
                {
                    role: "user",
                    content: `Primary item ordered: ${primaryItem.name || 'Unknown'}
Primary item category: ${primaryItem.category || 'Unknown'}

Allowed recommendation items (pick exactly ONE):
${candidateList}

Apply the CORE PAIRING PRINCIPLES. Prioritize flavor CONTRAST. Never double-stack the same flavor family as the primary item.

Return the JSON now:`
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
                
                return { item: matchedItem, reason, copy };
            } else {
                 console.warn(`[aiUpsellEngine] GPT recommended missing item name "${recommendedName}". Falling back.`);
            }
        } else {
             console.warn("[aiUpsellEngine] GPT response missing required fields. Falling back.");
        }

        // Fallback if not matched or missing fields
        return fallbackResult;

    } catch (err) {
        if (err.name === 'AbortError') {
            console.warn("[aiUpsellEngine] GPT timed out. Falling back.");
        } else {
            console.warn("[aiUpsellEngine] GPT error:", err.message);
        }
        return fallbackResult;
    }
}

module.exports = {
    generateUpsell
};
