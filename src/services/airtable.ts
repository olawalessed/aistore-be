export interface AirtableConfig {
    baseId: string;
    table: string;
    apiKey: string;
}

export interface AirtableRecord {
    id: string;
    fields: Record<string, any>;
    createdTime: string;
}

export class AirtableService {
    private baseUrl = "https://api.airtable.com/v0";

    async fetchRecords(config: AirtableConfig): Promise<AirtableRecord[]> {
        let allRecords: AirtableRecord[] = [];
        let offset: string | undefined = undefined;

        do {
            const url = new URL(`${this.baseUrl}/${config.baseId}/${encodeURIComponent(config.table)}`);
            if (offset) url.searchParams.set("offset", offset);

            const response = await fetch(url.toString(), {
                headers: {
                    Authorization: `Bearer ${config.apiKey}`,
                },
            });

            if (response.status === 429) {
                // Simple backoff for rate limits
                await new Promise(resolve => setTimeout(resolve, 2000));
                continue;
            }

            if (!response.ok) {
                const error = await response.text();
                throw new Error(`Airtable API error: ${response.status} ${error}`);
            }

            const data = (await response.json()) as { records: AirtableRecord[], offset?: string };
            allRecords = [...allRecords, ...data.records];
            offset = data.offset;

        } while (offset);

        return allRecords;
    }

    normalizeProduct(record: AirtableRecord, storeName: string, settings?: any) {
        // Map Airtable fields to the rich product schema
        const fields = record.fields;

        return {
            id: record.id,
            store_id: "", // Filled by DO
            store_name: storeName,
            name: fields.Name || fields.name || "Unknown Product",
            brand: fields.Brand || fields.brand,
            model: fields.Model || fields.model,
            category: fields.Category || fields.category,
            tags: fields.Tags || fields.tags || [],
            description: {
                short: fields.ShortDescription || fields.short_description || fields.Description || "",
                long: fields.LongDescription || fields.long_description || fields.Description || "",
            },
            images: (fields.Images || fields.images || []).map((img: any) => ({
                url: typeof img === 'string' ? img : img.url,
                alt: img.filename || fields.Name || "Product Image"
            })),
            pricing: {
                currency: fields.Currency || "NGN",
                amount: fields.Price || fields.amount || 0,
                original_amount: fields.OriginalPrice || fields.original_amount,
                discount_percentage: fields.Discount || 0,
                price_confidence: "high"
            },
            inventory: {
                in_stock: (fields.In_stock === true || fields.In_stock === "Yes" || fields.in_stock === true),
                stock_status: fields.StockStatus || "available",
                quantity_range: fields.QuantityRange || "unknown",
                variants_tracked: !!fields.Variants
            },
            variants: fields.Variants || [],
            fulfillment: {
                delivery_available: settings?.delivery_regions ? settings.delivery_regions.length > 0 : true,
                pickup_available: settings?.pickup_available ?? true,
                delivery_price: settings?.delivery_price ?? 0,
                delivery_regions: settings?.delivery_regions ?? [],
                estimated_delivery_hours: {
                    min: fields.DeliveryMin || 4,
                    max: fields.DeliveryMax || 24
                }
            },
            policies: {
                returnable: settings?.returnable ?? true,
                return_window_days: settings?.return_window_days ?? 7,
                exchange_supported: settings?.exchange_supported ?? true
            },
            compliance: {
                condition: fields.Condition || "new",
                warranty: settings?.warranty || fields.Warranty || "none",
                authenticity_claimed: settings?.authenticity_claimed ?? true
            },
            updated_at: new Date().toISOString()
        };
    }
}
