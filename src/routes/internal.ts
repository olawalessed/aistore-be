import { Hono, Context } from "hono";
import { EnvBindings } from "../bindings";
import { getDB } from "../db";
import { stores } from "../db/schema";
import { eq } from "drizzle-orm";

import { CryptoService } from "../services/crypto";

const internalRoutes = new Hono<{ Bindings: EnvBindings }>();

// 1. Register / Update Store (Account Creation Only)
internalRoutes.post("/register", async (c: Context<{ Bindings: EnvBindings }>) => {
    const {
        name, slug, plan, country, city, address, whatsapp, phone
    } = await c.req.json();

    if (!name || !slug) {
        return c.json({ error: "Missing required fields: name, slug" }, 400);
    }

    const db = getDB(c.env);

    // Upsert into D1
    const [result] = await db.insert(stores).values({
        name: name,
        slug: slug,
        plan: plan || "free",
        country,
        city,
        address,
        whatsapp,
        phone
    }).onConflictDoUpdate({
        target: stores.slug, // Use slug as identifier for upsert if id isn't sent
        set: {
            name: name,
            plan: plan || "free",
            country,
            city,
            address,
            whatsapp,
            phone
        }
    }).returning();

    const storeId = result.id;

    return c.json({ status: "success", storeId });
});

// 2. Connect Airtable (Post-Registration)
internalRoutes.post("/connect-airtable", async (c: Context<{ Bindings: EnvBindings }>) => {
    // Usually we'd get storeId from a session/auth header, but for simplicity in internal proxy:
    // We expect the store to be identified somehow. Let's assume the payload or a previous session.
    // However, the frontend currently sends it without ID. We need to handle store identification.
    // For V0, we might need to send the storeId or slug in the payload.

    const {
        storeId, slug,
        airtableBaseId, airtableTable, airtableApiKey, settingsTable
    } = await c.req.json();

    if (!airtableBaseId || !airtableTable || !airtableApiKey) {
        return c.json({ error: "Missing required fields: airtableBaseId, airtableTable, airtableApiKey" }, 400);
    }

    const db = getDB(c.env);

    // Find store by id or slug
    let s;
    if (storeId) {
        const results = await db.select().from(stores).where(eq(stores.id, storeId)).limit(1);
        s = results[0];
    } else if (slug) {
        const results = await db.select().from(stores).where(eq(stores.slug, slug)).limit(1);
        s = results[0];
    }

    if (!s) {
        return c.json({ error: "Store not found" }, 404);
    }

    // Encrypt Airtable API Key
    const masterKey = await CryptoService.getMasterKey(c.env.AIRTABLE_MASTER_KEY);
    const { ciphertext, iv } = await CryptoService.encrypt(airtableApiKey, masterKey);

    // Update D1
    await db.update(stores).set({
        airtableBaseId,
        airtableProductTable: airtableTable,
        airtableSettingsTable: settingsTable,
        airtableApiKey: ciphertext,
        airtableApiKeyIV: iv
    }).where(eq(stores.id, s.id));

    // Initialize/Update Durable Object
    const storeDOId = c.env.STORE_DO.idFromName(s.id);
    const storeDO = c.env.STORE_DO.get(storeDOId);

    await storeDO.init({
        storeId: s.id,
        name: s.name,
        slug: s.slug,
        baseId: airtableBaseId,
        productTable: airtableTable,
        settingsTable: settingsTable || "",
        apiKey: airtableApiKey,
        country: s.country || undefined,
        city: s.city || undefined,
        address: s.address || undefined,
        whatsapp: s.whatsapp || undefined,
        phone: s.phone || undefined
    });

    return c.json({ status: "success", storeId: s.id });
});

// Manually trigger sync
internalRoutes.post("/:id/sync", async (c: Context<{ Bindings: EnvBindings }>) => {
    const id = c.req.param("id");
    const doId = c.env.STORE_DO.idFromName(id);
    const storeDO = c.env.STORE_DO.get(doId);

    const resp = await storeDO.triggerSync();
    return c.json(resp);
});

// 3. Rotate Airtable API Key
internalRoutes.post("/:id/rotate-key", async (c: Context<{ Bindings: EnvBindings }>) => {
    const id = c.req.param("id");
    const { airtableApiKey } = await c.req.json();

    if (!airtableApiKey) return c.json({ error: "airtableApiKey is required" }, 400);

    const db = getDB(c.env);

    // Encrypt
    const masterKey = await CryptoService.getMasterKey(c.env.AIRTABLE_MASTER_KEY);
    const { ciphertext, iv } = await CryptoService.encrypt(airtableApiKey, masterKey);

    await db.update(stores).set({
        airtableApiKey: ciphertext,
        airtableApiKeyIV: iv
    }).where(eq(stores.id, id));

    // Update DO
    const storeDO = c.env.STORE_DO.getByName(id);

    // This assumes we need a way to update config in DO without full re-init 
    // or we just call init again with partially updated config.
    // Since init overwrites config, we need to get current config first or just re-init with new key.
    // For V0, we'll re-init (which also resets the alarm).

    const storeDetails = await db.select().from(stores).where(eq(stores.id, id)).limit(1);
    if (storeDetails.length > 0) {
        const s = storeDetails[0];
        await storeDO.init({
            storeId: s.id,
            name: s.name,
            slug: s.slug,
            baseId: s.airtableBaseId ?? "",
            productTable: s.airtableProductTable ?? "",
            settingsTable: s.airtableSettingsTable ?? "",
            apiKey: airtableApiKey, // Raw key
            country: s.country || undefined,
            city: s.city || undefined,
            address: s.address || undefined,
            whatsapp: s.whatsapp || undefined,
            phone: s.phone || undefined
        });
    }

    return c.json({ status: "success", storeId: id });
});

export default internalRoutes;
