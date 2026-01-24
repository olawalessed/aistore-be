import { EnvBindings } from "../bindings";
import { aiModels } from "../services/models";
import { callOpenRouter } from "../services/openrouter";

// Helper function to parse user intent
export function parseUserIntent(message: string) {
    const q = message.toLowerCase();
    const intent: any = {};

    // Extract budget
    const budgetMatches = q.match(/(?:under|below|less than|cheaper than|₦|naira)?\s*([0-9,]+(?:k|000))/g);
    if (budgetMatches) {
        const budget = budgetMatches[0].replace(/[^\d]/g, '').replace(/k$/, '000');
        intent.budget_max = parseInt(budget);
    }

    // Extract categories
    const categories = [
        "phone", "laptop", "sneakers", "shoes", "shirt", "dress", "watch", "headphones",
        "camera", "tv", "tablet", "jeans", "jacket", "bag", "perfume", "makeup"
    ];


    for (const category of categories) {
        if (q.includes(category)) {
            intent.category = category;
            break;
        }
    }

    // Extract size
    const sizeMatch = q.match(/size\s*(\d+)/);
    if (sizeMatch) {
        intent.size = sizeMatch[1];
    }

    // Extract color
    const colors = ["black", "white", "red", "blue", "green", "yellow", "pink", "purple", "brown", "gray"];
    for (const color of colors) {
        if (q.includes(color)) {
            intent.color = color;
            break;
        }
    }

    return intent;
}

// Hybrid intent parsing with AI fallback for production-ready accuracy
export async function parseUserIntentHybrid(message: string, env: EnvBindings) {
    // 1. Fast deterministic pass
    const regexIntent = parseUserIntent(message);

    // 2. If confidence is low, escalate to LLM
    const needsAI =
        !regexIntent.category ||
        Object.keys(regexIntent).length <= 1;

    if (!needsAI) return regexIntent;

    try {
        // 3. LLM refinement using Cloudflare Workers AI
        const aiResponse = await env.AI.run(
            "@cf/meta/llama-3-8b-instruct",
            {
                messages: [
                    {
                        role: "system",
                        content: "Extract shopping intent from user messages. Return only valid JSON with these fields: category, brand, budget_max, color, size. Use null for missing values."
                    },
                    {
                        role: "user",
                        content: `Extract shopping intent from: "${message}"`
                    }
                ]
            }
        );

        // Parse AI response
        let aiIntent = {};
        try {
            const aiText = aiResponse.response || aiResponse.response || "";
            console.log(aiText, 'aiText')
            aiIntent = JSON.parse(aiText);
        } catch (parseError) {
            console.warn('[parseUserIntentHybrid] Failed to parse AI response:', parseError);
        }

        // Merge regex and AI results, AI takes precedence
        return {
            ...regexIntent,
            ...aiIntent
        };

    } catch (error) {
        console.warn('[parseUserIntentHybrid] AI fallback failed, using regex only:', error);
        return regexIntent;
    }
}

// Helper function to generate AI response
export async function generateAIResponse(message: string, searchResults: any, conversationHistory: any[] = [], apiKey: string = "") {
    // Format the products array with all required fields
    const products = searchResults.results.map((result: any) => ({
        id: result.product.id,
        name: result.product.name,
        price: `₦${result.product.price.amount.toLocaleString()}`,
        store: result.store.name,
        description: result.product.description,
        whatsapp: result.store.whatsapp || "+2348012345678",
        website: result.store.website || "https://example.com",
        image: result.product.images && result.product.images.length > 0 ? result.product.images[0] : undefined,
        category: result.product.category,
        tags: result.product.tags || [],
        inStock: result.product.inventory?.in_stock !== false,
        currency: result.product.price.currency || 'NGN'
    }));

    // Prepare the system prompt for the LLM
    const systemPrompt = `You are an AI shopping assistant for Basekart, an AI-native commerce platform. Your role is to help users find products and provide helpful recommendations.

Context:
- You have access to search results with product information
- You can see the user's conversation history
- You should be helpful, friendly, and professional
- Focus on the products available in the search results
- If no products are found, suggest ways to improve the search

Response format:
- Provide a natural, conversational response
- Mention the products found and their key features
- Be helpful and suggest follow-up actions
- Keep responses concise but informative`;

    // Prepare the user prompt with all context
    const userPrompt = `User message: "${message}"

Products found: ${JSON.stringify(products, null, 2)}

Conversation history: ${JSON.stringify(conversationHistory, null, 2)}

Please provide a helpful response to the user based on their message and the available products.`;

    try {
        // Call OpenRouter LLM service
        const llmResponse = await callOpenRouter(apiKey, systemPrompt, userPrompt, aiModels.arcee_ai.name);

        // Generate suggestions based on context
        const suggestions = products.length > 0 ? [
            "Show me more details",
            "Compare these options",
            "Looking for something cheaper",
            "What about different colors?"
        ] : [
            "Try a different search",
            "Show me all categories",
            "Help me find alternatives"
        ];

        return {
            message: llmResponse.response,
            products: products,
            suggestions: suggestions
        };

    } catch (error) {
        console.error('[generateAIResponse] OpenRouter call failed:', error);

        // Fallback response if OpenRouter fails
        let fallbackMessage = "";
        if (products.length === 0) {
            fallbackMessage = "I couldn't find any products matching your request. Try being more specific about what you're looking for, or adjust your budget range.";
        } else {
            fallbackMessage = `I found ${products.length} great option${products.length > 1 ? 's' : ''} for you:`;
        }

        return {
            message: fallbackMessage,
            products: products,
            suggestions: ["Try a different search", "Show me all categories"]
        };
    }
}

// Helper function to generate conversation ID
export function generateConversationId() {
    return `conv_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}