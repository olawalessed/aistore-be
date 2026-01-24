import { sqliteTable, text, integer, index, real } from "drizzle-orm/sqlite-core";

export const stores = sqliteTable("stores", {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  slug: text("slug").unique().notNull(),
  email: text("email").unique().notNull(),
  plan: text("plan", { enum: ["free", "pro", "premium", "pending"] }).notNull().default("pending"),
  country: text("country").default("NG"),
  city: text("city"),
  address: text("address"),
  whatsapp: text("whatsapp"),
  phone: text("phone"),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  emailVerificationToken: text("email_verification_token"),
  emailVerificationExpires: integer("email_verification_expires", { mode: "timestamp" }),
  sourceConnected: text("source_connected"), // Single source: "airtable", "notion", "csv", "google-sheet" or null
  airtableBaseId: text("airtable_base_id"),
  airtableProductTable: text("airtable_product_table"),
  airtableSettingsTable: text("airtable_settings_table"),
  // OAuth token storage (encrypted)
  airtableAccessToken: text("airtable_access_token"),
  airtableAccessTokenIV: text("airtable_access_token_iv"),
  airtableRefreshToken: text("airtable_refresh_token"),
  airtableRefreshTokenIV: text("airtable_refresh_token_iv"),
  airtableTokenExpiresAt: integer("airtable_token_expires_at", { mode: "timestamp" }),
  tokenProvider: text("token_provider"),
  syncInterval: integer("sync_interval").notNull().default(3600),
  status: text("status", { enum: ["setup", "active", "connect", "paused", "error"] }).notNull().default("setup"),
  lastSyncAt: integer("last_sync_at", { mode: "timestamp" }),
  lastManualSyncAt: integer("last_manual_sync_at", { mode: "timestamp" }),
  productCount: integer("product_count").default(0),
  syncStatus: text("sync_status", { enum: ["pending", "in_progress", "success", "failed"] }).default("pending"),
  syncError: text("sync_error"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
}, (table) => [
  index("store_status_idx").on(table.status),
  index("store_plan_idx").on(table.plan),
  index("store_email_idx").on(table.email),
  index("store_sync_status_idx").on(table.syncStatus),
]);

// Products table - canonical source of truth
export const products = sqliteTable("products", {
  id: text('id').primaryKey(), // Composite: storeId:airtableRecordId
  storeId: text("store_id").notNull().references(() => stores.id, { onDelete: 'cascade' }),
  airtableRecordId: text("airtable_record_id").notNull(), // Original Airtable record ID
  name: text("name").notNull(),
  brand: text("brand"),
  model: text("model"),
  category: text("category"),
  tags: text("tags"), // JSON array
  descriptionShort: text("description_short"),
  descriptionLong: text("description_long"),
  images: text("images"), // JSON array
  currency: text("currency").default("NGN"),
  amount: real("amount").notNull(),
  originalAmount: real("original_amount"),
  discountPercentage: real("discount_percentage").default(0),
  inStock: integer("in_stock", { mode: "boolean" }).default(true),
  stockStatus: text("stock_status").default("available"),
  quantityRange: text("quantity_range"),
  variantsTracked: integer("variants_tracked", { mode: "boolean" }).default(false),
  variants: text("variants"), // JSON object
  deliveryAvailable: integer("delivery_available", { mode: "boolean" }).default(true),
  pickupAvailable: integer("pickup_available", { mode: "boolean" }).default(true),
  deliveryPrice: real("delivery_price").default(0),
  deliveryRegions: text("delivery_regions"), // JSON array
  deliveryMinHours: integer("delivery_min_hours").default(4),
  deliveryMaxHours: integer("delivery_max_hours").default(24),
  returnable: integer("returnable", { mode: "boolean" }).default(true),
  returnWindowDays: integer("return_window_days").default(7),
  exchangeSupported: integer("exchange_supported", { mode: "boolean" }).default(true),
  condition: text("condition").default("new"),
  warranty: text("warranty"),
  authenticityClaimed: integer("authenticity_claimed", { mode: "boolean" }).default(true),
  source: text("source").default("airtable"), // Data source
  syncedAt: integer("synced_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
}, (table) => [
  index("product_store_id_idx").on(table.storeId),
  index("product_category_idx").on(table.category),
  index("product_source_idx").on(table.source),
  index("product_synced_at_idx").on(table.syncedAt),
  index("product_airtable_record_idx").on(table.airtableRecordId),
]);

