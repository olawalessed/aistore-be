import { EnvBindings } from "../bindings";
import { getDB } from "../db";
import { stores } from "../db/schema";
import { eq, and, ne } from "drizzle-orm";

export interface SearchQuery {
    query: string;
    intent?: {
        category?: string;
        color?: string;
        budget_max?: number;
        location?: {
            city?: string;
            country?: string;
        };
    };
}

export class SearchService {
    static async search(env: EnvBindings, searchQuery: SearchQuery) {
        const db = getDB(env);
        const kv = env.BASEKART_AI_SHOP_KV;

        // 1. Fetch all active stores that are NOT on the free plan for discovery
        const allStores = await db.select().from(stores).where(
            and(
                eq(stores.status, "active"),
                ne(stores.plan, "free")
            )
        );

        const results: any[] = [];
        const intent = searchQuery.intent || this.mockParseIntent(searchQuery.query);

        // 2. Iterate through stores and their catalogs
        for (const store of allStores) {
            const catalogData = await kv.get(`store:${store.id}:catalog`);
            if (!catalogData) continue;

            const catalog = JSON.parse(catalogData);
            const products = catalog.products;

            for (const product of products) {
                const score = this.calculateRankScore(product, store, intent);
                if (score > 0.4) { // Threshold
                    results.push({
                        rank_score: score,
                        match_reasons: this.getMatchReasons(product, store, intent),
                        product: {
                            id: product.id,
                            name: product.name,
                            category: product.category,
                            price: {
                                currency: product.pricing.currency,
                                amount: product.pricing.amount
                            },
                            inventory: {
                                in_stock: product.inventory.in_stock,
                                availability_confidence: "medium"
                            }
                        },
                        store: {
                            id: store.id,
                            name: store.name,
                            location: store.city || "Unknown",
                            store_plan: store.plan
                        },
                        freshness: {
                            last_synced_at: catalog.updated_at
                        }
                    });
                }
            }
        }

        // 3. Sort and limit
        const sortedResults = results.sort((a, b) => b.rank_score - a.rank_score).slice(0, 10);

        // 4. Assign ranks
        sortedResults.forEach((res, idx) => { res.rank = idx + 1; });

        return {
            type: "search_results",
            query_context: {
                original_query: searchQuery.query,
                parsed_intent: intent
            },
            confidence: {
                data_source: "airtable_snapshots",
                freshness: "hourly",
                last_global_sync_at: new Date().toISOString(),
                result_confidence: sortedResults.length > 0 ? "medium" : "low"
            },
            results: sortedResults,
            result_limits: {
                max_results: 10,
                returned: sortedResults.length,
                excluded_reasons: ["out_of_budget", "low_relevance"]
            },
            usage_guidelines: {
                allowed: ["recommend_top_matches", "explain_ranking", "compare_products"],
                disallowed: ["guarantee_stock", "finalize_purchase"]
            }
        };
    }

    private static calculateRankScore(product: any, store: any, intent: any): number {
        let score = 0.5;

        // Category match
        if (intent.category && product.category?.toLowerCase().includes(intent.category.toLowerCase())) {
            score += 0.2;
        }

        // Budget match
        if (intent.budget_max) {
            if (product.pricing.amount <= intent.budget_max) {
                score += 0.2;
            } else {
                score -= 0.3;
            }
        }

        // Location match
        if (intent.location?.city && store.city?.toLowerCase() === intent.location.city.toLowerCase()) {
            score += 0.1;
        }

        // Plan boost
        if (store.plan === "premium") score += 0.05;
        if (store.plan === "pro") score += 0.02;

        return Math.min(score, 1.0);
    }

    private static getMatchReasons(product: any, store: any, intent: any): string[] {
        const reasons: string[] = [];
        if (intent.budget_max && product.pricing.amount <= intent.budget_max) reasons.push("within_budget");
        if (intent.category && product.category?.toLowerCase().includes(intent.category.toLowerCase())) reasons.push("exact_category_match");
        if (intent.location?.city && store.city?.toLowerCase() === intent.location.city.toLowerCase()) reasons.push("nearby_store");
        if (store.plan === "premium" || store.plan === "pro") reasons.push("verified_partner");
        return reasons;
    }

    private static mockParseIntent(query: string) {
        // Simple heuristic based parsing for demonstration
        const q = query.toLowerCase();
        return {
            category: q.includes("snaker") || q.includes("shoe") ? "sneakers" : undefined,
            budget_max: q.match(/under (\d+)/)?.[1] ? parseInt(q.match(/under (\d+)/)![1]) : undefined,
            location: {
                city: q.includes("ikeja") ? "Ikeja" : undefined
            }
        };
    }
}

