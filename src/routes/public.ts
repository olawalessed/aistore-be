import { Hono, Context } from "hono";
import { EnvBindings } from "../bindings";
import { SearchService } from "../services/search";

const publicRoutes = new Hono<{ Bindings: EnvBindings }>();

// 1️⃣ Store Fetch — get_store
publicRoutes.get("/store/:storeId", async (c: Context<{ Bindings: EnvBindings }>) => {
    const storeId = c.req.param("storeId");

    // Fetch from KV (Rich Metadata)
    const kv = c.env.BASEKART_AI_SHOP_KV;
    const data = await kv.get(`store:${storeId}:metadata`);

    if (!data) return c.json({ error: "Store not found or not indexed" }, 404);

    const storeMetadata = JSON.parse(data);

    // In a real scenario, we might want to verify D1 plan here too, 
    // but KV should be the primary source for performance.

    return c.json(storeMetadata);
});

// All Store products
publicRoutes.get("/store/:storeId/all", async (c: Context<{ Bindings: EnvBindings }>) => {
    const storeId = c.req.param("storeId");
    console.log(`Fetching all products for store ${storeId}`);
    const kv = c.env.BASEKART_AI_SHOP_KV;
    const data = await kv.get(`store:${storeId}:catalog`);
    console.log(`Fetched data for store ${storeId}: ${data ? 'exists' : 'null'}`);
    if (!data) return c.json({ error: "Products not found" }, 404);
    return c.json(JSON.parse(data));
});

// 2️⃣ Product Fetch — get_product
publicRoutes.get("/product/:productId", async (c: Context<{ Bindings: EnvBindings }>) => {
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
            availability_confidence: "medium"
        },
        product: product,
        usage_guidelines: {
            allowed: ["recommend_if_matches_user_budget", "compare_with_other_products"],
            disallowed: ["guarantee_stock", "process_payment"]
        }
    });
});

// 3️⃣ Global Search — search_products
publicRoutes.post("/search", async (c: Context<{ Bindings: EnvBindings }>) => {
    const body = await c.req.json();
    const results = await SearchService.search(c.env, body);
    return c.json(results);
});

// Full Catalog Fetch (Internal/Optimization)
publicRoutes.get("/catalog/:storeId", async (c: Context<{ Bindings: EnvBindings }>) => {
    const storeId = c.req.param("storeId");
    const kv = c.env.BASEKART_AI_SHOP_KV;
    const data = await kv.get(`store:${storeId}:catalog`);

    if (!data) return c.json({ error: "Catalog not found" }, 404);

    return c.json(JSON.parse(data));
});

export default publicRoutes;
