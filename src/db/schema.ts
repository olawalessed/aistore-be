import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

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
  airtableApiKey: text("airtable_api_key"),
  airtableApiKeyIV: text("airtable_api_key_iv"),
  syncInterval: integer("sync_interval").notNull().default(3600),
  status: text("status", { enum: ["setup", "active", "paused", "error"] }).notNull().default("setup"),
  lastSyncAt: integer("last_sync_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
}, (table) => [
  index("store_status_idx").on(table.status),
  index("store_plan_idx").on(table.plan),
  index("store_email_idx").on(table.email),
]);

