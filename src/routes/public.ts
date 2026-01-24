import { Hono, Context } from "hono";
import { EnvBindings } from "../bindings";
import { SearchService } from "../services/search";
import {
  generateAIResponse,
  parseUserIntent,
} from "../helpers/ai-chat";
import { ChatService } from "../services/chat";

const publicRoutes = new Hono<{ Bindings: EnvBindings }>();

// Chat endpoint - AI-powered shopping assistant
publicRoutes.post("/chat", async (c: Context<{ Bindings: EnvBindings }>) => {
  try {
    const { message, conversation_history = [] } = await c.req.json();

    if (!message) {
      return c.json({ error: "Message is required" }, 400);
    }

    // Parse user intent from message (once)
    const intent = parseUserIntent(message);
    console.log(intent, "Intent from user")

    // Search for products based on intent using new parallel SearchService
    const searchResults = await SearchService.search(c.env, {
      query: message,
      intent, // Pass parsed intent to avoid re-parsing
      resultLimit: 5 // Limit for chat responses
    });

    console.log(JSON.stringify(searchResults, null, 2), "Result from product search")

    // Generate AI response using OpenRouter with real search results
    const response = await generateAIResponse(
      message,
      searchResults,
      conversation_history,
      c.env.OPENROUTER_API_KEY
    );

    console.log(response, "Response from AI")

    return c.json({
      type: "chat_response",
      message: response.message,
      suggestions: response.suggestions,
      products: searchResults.results.map((result: any) => ({
        id: result.product.id,
        name: result.product.name,
        price: `₦${result.product.price.amount.toLocaleString()}`,
        store: result.store.name,
        description: `Found in ${result.store.location} • ${result.match_reasons.join(', ')}`,
        whatsapp: result.store.whatsapp,
        phone: result.store.phone,
        rank: result.rank,
        score: result.rank_score
      })),
      search_metadata: {
        total_results: searchResults.results.length,
        confidence: searchResults.confidence.result_confidence,
        data_source: searchResults.confidence.data_source
      }
    });
  } catch (error) {
    console.error("Chat endpoint error:", error);
    return c.json(
      {
        error: "Failed to process chat message",
        message:
          "I'm having trouble understanding. Could you try rephrasing that?",
      },
      500
    );
  }
});

// NEW: Chat session initialization endpoint
publicRoutes.post("/chat/init", async (c: Context<{ Bindings: EnvBindings }>) => {
  try {
    const { initial_message } = await c.req.json();
    
    const chatService = new ChatService(c.env);
    const result = await chatService.initChat({ initial_message });
    
    return c.json({
      type: "chat_init_response",
      ...result
    });
  } catch (error) {
    console.error("Chat init error:", error);
    return c.json(
      {
        error: "Failed to initialize chat",
        message: "Unable to start conversation. Please try again."
      },
      500
    );
  }
});

// NEW: Chat message endpoint (for existing conversations)
publicRoutes.post("/chat/message", async (c: Context<{ Bindings: EnvBindings }>) => {
  try {
    const { conversation_id, message } = await c.req.json();
    
    if (!conversation_id || !message) {
      return c.json({ error: "conversation_id and message are required" }, 400);
    }
    
    const chatService = new ChatService(c.env);
    const result = await chatService.sendMessage({ conversation_id, message });
    
    return c.json({
      type: "chat_message_response",
      ...result
    });
  } catch (error: any) {
    console.error("Chat message error:", error);
    
    if (error?.message === "Conversation not found or expired") {
      return c.json(
        {
          error: "Conversation expired",
          message: "This conversation has expired. Please start a new one."
        },
        410
      );
    }
    
    return c.json(
      {
        error: "Failed to send message",
        message: "Unable to process your message. Please try again."
      },
      500
    );
  }
});

// NEW: Get conversation endpoint (for page reloads)
publicRoutes.get("/chat/:conversationId", async (c: Context<{ Bindings: EnvBindings }>) => {
  try {
    const conversationId = c.req.param("conversationId");
    
    const chatService = new ChatService(c.env);
    const result = await chatService.getConversation(conversationId);
    
    if (!result) {
      return c.json(
        {
          error: "Conversation not found",
          message: "This conversation doesn't exist or has expired."
        },
        404
      );
    }
    
    return c.json({
      type: "chat_conversation",
      ...result
    });
  } catch (error) {
    console.error("Get conversation error:", error);
    return c.json(
      {
        error: "Failed to load conversation",
        message: "Unable to load this conversation."
      },
      500
    );
  }
});

// 1️⃣ Store Fetch — get_store
publicRoutes.get(
  "/store/:storeId",
  async (c: Context<{ Bindings: EnvBindings }>) => {
    const storeId = c.req.param("storeId");

    // Fetch from KV (Rich Metadata)
    const kv = c.env.BASEKART_AI_SHOP_KV;
    const data = await kv.get(`store:${storeId}:metadata`);

    if (!data) return c.json({ error: "Store not found or not indexed" }, 404);

    const storeMetadata = JSON.parse(data);

    // In a real scenario, we might want to verify D1 plan here too,
    // but KV should be the primary source for performance.

    return c.json(storeMetadata);
  }
);

// All Store products
publicRoutes.get(
  "/store/:storeId/all",
  async (c: Context<{ Bindings: EnvBindings }>) => {
    const storeId = c.req.param("storeId");
    console.log(`Fetching all products for store ${storeId}`);
    const kv = c.env.BASEKART_AI_SHOP_KV;
    const data = await kv.get(`store:${storeId}:catalog`);
    console.log(
      `Fetched data for store ${storeId}: ${data ? "exists" : "null"}`
    );
    if (!data) return c.json({ error: "Products not found" }, 404);
    return c.json(JSON.parse(data));
  }
);

// 2️⃣ Product Fetch — get_product
publicRoutes.get(
  "/product/:productId",
  async (c: Context<{ Bindings: EnvBindings }>) => {
    const productId = c.req.param("productId");
    const kv = c.env.BASEKART_AI_SHOP_KV;

    // Fetch individual product from KV
    const data = await kv.get(`product:${productId}`);

    if (!data) return c.json({ error: "Product not found" }, 404);

    const product = JSON.parse(data);

    // Schema follows the get_product format
    return c.json({
      type: "product",
      confidence: {
        data_source: "airtable",
        freshness: "hourly",
        last_synced_at: product.updated_at,
        confidence_score: 0.91,
        availability_confidence: "medium",
      },
      product: product,
      usage_guidelines: {
        allowed: [
          "recommend_if_matches_user_budget",
          "compare_with_other_products",
        ],
        disallowed: ["guarantee_stock", "process_payment"],
      },
    });
  }
);

// 3️⃣ Global Search — search_products
publicRoutes.post("/search", async (c: Context<{ Bindings: EnvBindings }>) => {
  const body = await c.req.json();
  const results = await SearchService.search(c.env, body);
  return c.json(results);
});

// Full Catalog Fetch (Internal/Optimization)
publicRoutes.get(
  "/catalog/:storeId",
  async (c: Context<{ Bindings: EnvBindings }>) => {
    const storeId = c.req.param("storeId");
    const kv = c.env.BASEKART_AI_SHOP_KV;
    const data = await kv.get(`store:${storeId}:catalog`);

    if (!data) return c.json({ error: "Catalog not found" }, 404);

    return c.json(JSON.parse(data));
  }
);

export default publicRoutes;
