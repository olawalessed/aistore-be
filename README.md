# Basekart AI Shop — V0

An AI-native commerce data platform that exposes store-consented Airtable data to LLMs via optimized, machine-first JSON schemas.

## 🎯 V0 Objective
Provide a read-only, high-performance data access layer for LLM discovery and reasoning.

### What it is NOT
- ❌ A marketplace UI
- ❌ A checkout or payment system
- ❌ Real-time inventory (it uses hourly snapshots)

## 📡 API Reference (Public / LLM)

All public endpoints are under `/llm/*` and are protected by rate limiting.

### 1. Store Discovery
`GET /llm/store/:storeId`  
Returns high-level store metadata, capabilities, and location.

### 2. Global Search
`POST /llm/search`  
Returns ranked product candidates across all **Pro** and **Premium** stores.

**Example Payload:**
```json
{
  "query": "white sneakers under 30000 in ikeja"
}
```

### 3. Product Details
`GET /llm/product/:productId`  
Returns rich, detailed product data including pricing, policy, and reasoning context.  
*Note: `productId` is namespaced as `storeId:airtableRecordId`.*

## 🛠 Internal Management

### Register a Store
`POST /stores/register`  
Registers a store in D1 and initializes its sync Durable Object.

```bash
curl -X POST https://api.basekart.shop/stores/register \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <internal_token>" \
  -d '{
    "id": "kolo-sneakers",
    "name": "Kolo Sneakers",
    "slug": "kolo-sneakers-ikeja",
    "airtableBaseId": "appXXXXX",
    "airtableTable": "Products",
    "airtableApiKey": "keyXXXXX",
    "plan": "pro",
    "city": "Ikeja"
  }'
```

---
Built with Cloudflare Workers, Hono, Durable Objects, D1, and KV.
