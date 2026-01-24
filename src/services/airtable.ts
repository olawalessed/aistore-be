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

export interface D1ProductRecord {
    id: string; // Composite: storeId:airtableRecordId
    storeId: string;
    airtableRecordId: string;
    name: string;
    brand?: string;
    model?: string;
    category?: string;
    tags?: string; // JSON array
    descriptionShort?: string;
    descriptionLong?: string;
    images?: string; // JSON array
    currency: string;
    amount: number;
    originalAmount?: number;
    discountPercentage?: number;
    inStock: boolean;
    stockStatus?: string;
    quantityRange?: string;
    variantsTracked: boolean;
    variants?: string; // JSON object
    deliveryAvailable: boolean;
    pickupAvailable: boolean;
    deliveryPrice: number;
    deliveryRegions?: string; // JSON array
    deliveryMinHours: number;
    deliveryMaxHours: number;
    returnable: boolean;
    returnWindowDays: number;
    exchangeSupported: boolean;
    condition: string;
    warranty?: string;
    authenticityClaimed: boolean;
    source: string;
    syncedAt: Date;
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
        // Debug: Log all available fields to understand the structure
        console.log('[AirtableService] Available fields in record:', Object.keys(record.fields));
        console.log('[AirtableService] Sample field values:', {
            allFields: record.fields,
            // Check common field name variations
            productName: record.fields['Product Name'],
            name: record.fields.Name,
            name_lower: record.fields.name,
            title: record.fields.Title,
            item: record.fields.Item
        });

        // Map Airtable fields to the rich product schema
        const fields = record.fields;

        return {
            id: record.id,
            store_id: "", // Filled by DO
            store_name: storeName,
            name: fields['Product Name'] || fields.Name || fields.name || fields.Title || fields.Item || "Unknown Product",
            brand: fields.Brand || fields.brand,
            model: fields.Model || fields.model,
            category: fields['Product Category'] || fields.Category || fields.category,
            tags: fields.Tags || fields.tags || [],
            description: {
                short: fields['Product Description'] || fields.ShortDescription || fields.short_description || fields.Description || "",
                long: fields['Product Description'] || fields.LongDescription || fields.long_description || fields.Description || "",
            },
            images: (fields['Product Image'] || fields.Images || fields.images || []).map((img: any) => ({
                url: typeof img === 'string' ? img : img.url,
                alt: img.filename || fields['Product Name'] || "Product Image"
            })),
            pricing: {
                currency: "NGN",
                amount: fields['Current Price'] || fields.Price || fields.amount || 0,
                original_amount: fields.OriginalPrice || fields.original_amount,
                discount_percentage: fields.Discount || 0,
                price_confidence: "high"
            },
            inventory: {
                in_stock: (fields['Available Units'] > 0) || (fields.In_stock === true || fields.In_stock === "Yes" || fields.in_stock === true),
                stock_status: fields.StockStatus || "available",
                quantity_range: fields['Available Units']?.toString() || "unknown",
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

    /**
     * Normalize Airtable record for D1 storage (canonical source)
     */
    normalizeProductForD1(
        record: AirtableRecord, 
        storeId: string, 
        settings?: any
    ): D1ProductRecord {
       

        const fields = record.fields;
        const now = new Date();

        return {
            id: `${storeId}:${record.id}`, // Composite key
            storeId,
            airtableRecordId: record.id,
            name: fields['Product Name'] || fields.Name || fields.name || fields.Title || fields.Item || "Unknown Product",
            brand: fields.Brand || fields.brand,
            model: fields.Model || fields.model,
            category: fields['Product Category'] || fields.Category || fields.category,
            tags: JSON.stringify(fields.Tags || fields.tags || []),
            descriptionShort: fields['Product Description'] || fields.ShortDescription || fields.short_description || fields.Description || "",
            descriptionLong: fields['Product Description'] || fields.LongDescription || fields.long_description || fields.Description || "",
            images: JSON.stringify((fields['Product Image'] || fields.Images || fields.images || []).map((img: any) => ({
                url: typeof img === 'string' ? img : img.url,
                alt: img.filename || fields['Product Name'] || "Product Image"
            }))),
            currency: "NGN",
            amount: parseFloat(fields['Current Price'] || fields.Price || fields.amount || 0),
            originalAmount: fields.OriginalPrice ? parseFloat(fields.OriginalPrice) : undefined,
            discountPercentage: fields.Discount ? parseFloat(fields.Discount) : 0,
            inStock: (fields['Available Units'] > 0) || (fields.In_stock === true || fields.In_stock === "Yes" || fields.in_stock === true),
            stockStatus: fields.StockStatus || "available",
            quantityRange: fields['Available Units']?.toString() || "unknown",
            variantsTracked: !!fields.Variants,
            variants: JSON.stringify(fields.Variants || []),
            deliveryAvailable: settings?.delivery_regions ? settings.delivery_regions.length > 0 : true,
            pickupAvailable: settings?.pickup_available ?? true,
            deliveryPrice: settings?.delivery_price ?? 0,
            deliveryRegions: JSON.stringify(settings?.delivery_regions ?? []),
            deliveryMinHours: fields.DeliveryMin || 4,
            deliveryMaxHours: fields.DeliveryMax || 24,
            returnable: settings?.returnable ?? true,
            returnWindowDays: settings?.return_window_days ?? 7,
            exchangeSupported: settings?.exchange_supported ?? true,
            condition: fields.Condition || "new",
            warranty: settings?.warranty || fields.Warranty || "none",
            authenticityClaimed: settings?.authenticity_claimed ?? true,
            source: "airtable",
            syncedAt: now
        };
    }
}
