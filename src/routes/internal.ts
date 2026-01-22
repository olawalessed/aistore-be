import { Context, Hono } from "hono";
import { eq } from "drizzle-orm";
import { getDB } from "../db";
import { stores } from "../db/schema";
import { CryptoService } from "../services/crypto";
import { EnvBindings } from "../bindings";
import { authMiddleware, SessionData, AuthContext, generateCodeVerifier, generateCodeChallenge } from "../middlewares/auth";

// Generate email verification token
function generateVerificationToken(): string {
    return crypto.randomUUID();
}

const internalRoutes = new Hono<{ Bindings: EnvBindings }>();

// 1. Email Registration - Send verification link
internalRoutes.post("/register-email", async (c: Context<{ Bindings: EnvBindings }>) => {
    const { email } = await c.req.json();

    if (!email || !email.includes('@')) {
        return c.json({ error: "Valid email is required" }, 400);
    }

    const db = getDB(c.env);

    // Check if email already exists and is verified
    const existingStore = await db.select().from(stores).where(eq(stores.email, email)).limit(1);

    // If email already exists and is verified, just send a new verification link
    // This allows users to get a new magic link if they lost the original
    if (existingStore.length > 0 && existingStore[0].emailVerified) {
        // Generate new verification token and expiry
        const verificationToken = generateVerificationToken();
        const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours from now

        // Update existing store with new verification token
        await db.update(stores).set({
            emailVerificationToken: verificationToken,
            emailVerificationExpires: verificationExpires,
        }).where(eq(stores.email, email));

        // For now, return the token for development
        const verificationUrl = `${c.env.FRONTEND_URL}/verify?token=${verificationToken}&email=${encodeURIComponent(email)}`;

        return c.json({
            status: "verification_sent",
            message: "Verification email sent",
            // Remove this in production - only for development
            verificationUrl
        });
    }

    // Generate verification token and expiry (24 hours)
    const verificationToken = generateVerificationToken();
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours from now
    

    // Create or update pending store
    if (existingStore.length > 0) {
        // Update existing pending store
        await db.update(stores).set({
            emailVerificationToken: verificationToken,
            emailVerificationExpires: verificationExpires,
        }).where(eq(stores.email, email));
    } else {
        // Create new pending store
        await db.insert(stores).values({
            email,
            slug: `store-${Date.now()}`, // Temporary slug, will be updated
            plan: "pending",
            emailVerificationToken: verificationToken,
            emailVerificationExpires: verificationExpires,
        });
    }

    // TODO: Send verification email
    // For now, return the token for development
    const verificationUrl = `${c.env.FRONTEND_URL}/verify?token=${verificationToken}&email=${encodeURIComponent(email)}`;

    return c.json({
        status: "verification_sent",
        message: "Verification email sent",
        // Remove this in production - only for development
        verificationUrl: c.env.NODE_ENV === 'development' ? verificationUrl : undefined
    });
})

// 2. Verify email and create session
internalRoutes.post("/verify-email", async (c: Context<{ Bindings: EnvBindings }>) => {
    const { token, email } = await c.req.json();

    if (!token || !email) {
        return c.json({ error: "Token and email are required" }, 400);
    }

    const db = getDB(c.env);

    const storeResults = await db.select().from(stores).where(eq(stores.email, email)).limit(1);

    if (storeResults.length === 0) {
        return c.json({ error: "Store not found" }, 404);
    }

    const store = storeResults[0];

    if (store.emailVerified) {
        // Email already verified, just create a session and log them in
        const sessionData = {
            storeId: store.id,
            email: store.email,
            name: store.name || '',
            storeName: store.name || '',
            slug: store.slug || '',
            plan: store.plan || 'free',
            city: store.city || '',
            country: store.country || '',
            whatsapp: store.whatsapp || ''
        };

        return c.json({
            status: "verified",
            storeId: store.id,
            email: store.email,
            storeName: store.name,
            slug: store.slug,
            plan: store.plan,
            city: store.city,
            country: store.country,
            whatsapp: store.whatsapp,
            storeStatus: store.status,
            message: "Email already verified - logging you in"
        });
    }

    if (store.emailVerificationToken !== token) {
        return c.json({ error: "Invalid verification token" }, 400);
    }

    if (store.emailVerificationExpires && new Date(store.emailVerificationExpires) < new Date()) {
        return c.json({ error: "Verification token expired" }, 400);
    }

    // Mark email as verified
    await db.update(stores).set({
        emailVerified: true,
        emailVerificationToken: null,
        emailVerificationExpires: null,
    }).where(eq(stores.id, store.id));

    // Create session/token for authenticated access
    const { SignJWT } = await import('jose');
    const sessionToken = await new SignJWT({
        storeId: store.id,
        email: store.email,
        storeName: store.name
    })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('6w')
    .sign(new TextEncoder().encode(c.env.JWT_AUTH_SECRET));
    
    // Set session cookie
    const isSecure = c.req.url.startsWith('https://');
    const cookieString = `session=${sessionToken}; HttpOnly; ${isSecure ? 'Secure; ' : ''}SameSite=None; Path=/; Max-Age=${6 * 7 * 24 * 60 * 60}`;
    console.log('🔐 Email Verification - Setting session cookie:', cookieString);
    c.header('Set-Cookie', cookieString);
    
    return c.json({
        status: "verified",
        storeId: store.id,
        email: store.email,
        storeName: store.name,
        slug: store.slug,
        plan: store.plan,
        city: store.city,
        country: store.country,
        whatsapp: store.whatsapp,
        storeStatus: store.status,
        message: "Email verified successfully"
    });
});

// 3. Update Store Information (Post-Verification)
internalRoutes.post("/update", async (c: Context<{ Bindings: EnvBindings }>) => {
    const {
        storeId,
        name, slug, country, city, address, whatsapp
    } = await c.req.json();

    if (!storeId || !name || !slug) {
        return c.json({ error: "Missing required fields: storeId, name, slug" }, 400);
    }

    const db = getDB(c.env);

    // Check if store exists and email is verified
    const storeResults = await db.select().from(stores).where(eq(stores.id, storeId)).limit(1);

    if (storeResults.length === 0) {
        return c.json({ error: "Store not found" }, 404);
    }

    const store = storeResults[0];

    if (!store.emailVerified) {
        return c.json({ error: "Email not verified" }, 400);
    }

    const phone = whatsapp?.trim();

    // Update store information
    await db.update(stores).set({
        name,
        slug,
        plan: "free", // Convert from pending to free
        country,
        city,
        address,
        whatsapp,
        phone,
        status: "active" // Set store to active when details are updated
    }).where(eq(stores.id, storeId));

    return c.json({
        status: "success",
        storeId,
        message: "Store information updated successfully"
    });
});

// 4. Get Store Dashboard (for session management)
internalRoutes.get("/dashboard", authMiddleware, async (c: AuthContext) => {
    // Get session from context (set by middleware)
    const session = c.get('session');

    if (!session || !session.storeId) {
        return c.json({ error: "Invalid session" }, 401);
    }

    const db = getDB(c.env);

    // Find store by session storeId
    const storeResults = await db.select().from(stores).where(eq(stores.id, session.storeId)).limit(1);

    if (storeResults.length === 0) {
        return c.json({ error: "Store not found" }, 404);
    }

    const store = storeResults[0];

    return c.json({
        storeName: store.name,
        slug: store.slug,
        plan: store.plan,
        productCount: 0, // TODO: Get from Airtable sync
        lastSync: store.lastSyncAt?.toISOString() || null,
        isAirtableConnected: !!store.airtableBaseId,
        sourceConnected: store.sourceConnected, // New field
        airtableBaseId: store.airtableBaseId,
        airtableTable: store.airtableProductTable,
        settingsTable: store.airtableSettingsTable,
        lastSettingsSync: null,
        session: {
            user: {
                email: store.email,
                id: store.id,
                name: store.name,
                storeName: store.name,
                slug: store.slug,
                plan: store.plan,
                city: store.city,
                country: store.country,
                whatsapp: store.whatsapp
            },
            storeId: store.id
        },
        user: {
            email: store.email,
            id: store.id,
            name: store.name,
            storeName: store.name,
            slug: store.slug,
            plan: store.plan,
            city: store.city,
            country: store.country,
            whatsapp: store.whatsapp
        }
    });
});

// 5. Connect Airtable (Post-Registration)
internalRoutes.post("/connect-airtable", async (c: Context<{ Bindings: EnvBindings }>) => {
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

    if (!s.emailVerified) {
        return c.json({ error: "Email not verified" }, 400);
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
        airtableApiKeyIV: iv,
        sourceConnected: "airtable" // Set source connected
    }).where(eq(stores.id, s.id));

    // Initialize/Update Durable Object
    const storeDOId = c.env.STORE_DO.idFromName(s.id);
    const storeDO = c.env.STORE_DO.get(storeDOId);

    await storeDO.init({
        storeId: s.id,
        name: s.name || "",
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

// 6. Manually trigger sync
internalRoutes.post("/:id/sync", async (c: Context<{ Bindings: EnvBindings }>) => {
    const id = c.req.param("id");
    const doId = c.env.STORE_DO.idFromName(id);
    const storeDO = c.env.STORE_DO.get(doId);

    const resp = await storeDO.triggerSync();
    return c.json(resp);
});

// Simple in-memory cache for OAuth data (development only)
const oauthCache = new Map<string, { codeVerifier: string; session: SessionData; timestamp: number }>();

// 8. Airtable OAuth - Initiate OAuth flow with PKCE
internalRoutes.get("/connect/airtable", authMiddleware, async (c: AuthContext) => {
    console.log('🔗 OAuth - Starting Airtable OAuth flow with PKCE');
    
    const clientId = c.env.AIRTABLE_CLIENT_ID;
    const redirectUri = c.env.OAUTH_REDIRECT_URI;
    const scopes = ["data.records:read", "data.records:write", "schema.bases:read"];
    
    // Generate PKCE verifier and challenge
    const codeVerifier = generateCodeVerifier(); // 43-128 char string
    const codeChallenge = await generateCodeChallenge(codeVerifier); // Base64URL-encoded SHA256
    
    const state = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(36).padStart(2, '0')).join('').substring(0, 32); // 32-char cryptographically secure string
    
    // Get current user session and store it with OAuth data
    const session = c.get('session');
    if (!session) {
        return c.json({ error: "User session required for OAuth" }, 401);
    }
    
    // Store codeVerifier and session data in cache with state as key (10 minute expiry)
    oauthCache.set(state, {
        codeVerifier,
        session: session, // Store user session data
        timestamp: Date.now()
    });
    
    console.log('🔗 OAuth - Stored codeVerifier and session in cache with state:', state);
    
    const authUrl = `https://airtable.com/oauth2/v1/authorize?` + 
        new URLSearchParams({
            client_id: clientId,
            redirect_uri: redirectUri,
            response_type: "code",
            scope: scopes.join(" "),
            state: state,
            code_challenge: codeChallenge,
            code_challenge_method: "S256"
        }).toString();
    
    console.log('🔗 OAuth - Created OAuth flow');
    
    return c.redirect(authUrl);
});

// 9. Airtable OAuth - Handle callback with PKCE
internalRoutes.get("/callback", async (c: AuthContext) => {
    console.log('🔗 OAuth Callback - Received request');
    
    const code = c.req.query("code");
    const state = c.req.query("state");
    
    console.log('🔗 OAuth Callback - Received state:', state);
    
    if (!code) {
        return c.json({ error: "Authorization code is required" }, 400);
    }
    
    if (!state) {
        return c.json({ error: "State parameter is missing" }, 400);
    }
    
    // Retrieve codeVerifier and session from cache
    const cachedData = oauthCache.get(state);
    if (!cachedData) {
        return c.json({ error: "State not found or expired" }, 400);
    }
    
    // Check if cache entry is expired (10 minutes)
    if (Date.now() - cachedData.timestamp > 10 * 60 * 1000) {
        oauthCache.delete(state);
        return c.json({ error: "State expired" }, 400);
    }
    
    const codeVerifier = cachedData.codeVerifier;
    const session = cachedData.session; // Get session from cache
    
    // Clean up cache entry
    oauthCache.delete(state);
    
    console.log('🔗 OAuth Callback - Retrieved codeVerifier and session from cache');
    console.log('🔗 OAuth Callback - Session storeId:', session.storeId);
    
    console.log('🔗 OAuth Callback - Retrieved codeVerifier from cache, length:', codeVerifier.length);
    
    console.log('🔗 OAuth Callback - Received code, exchanging for token...');
    
    try {
        // Debug: Log the exact request being sent
        const requestBody = new URLSearchParams({
            client_id: c.env.AIRTABLE_CLIENT_ID,
            grant_type: "authorization_code",
            code: code,
            redirect_uri: c.env.OAUTH_REDIRECT_URI,
            code_verifier: codeVerifier
        });
        
        console.log('🔗 OAuth Callback - Request body (without secret):');
        console.log('  client_id:', c.env.AIRTABLE_CLIENT_ID);
        console.log('  grant_type: authorization_code');
        console.log('  code length:', code.length);
        console.log('  redirect_uri:', c.env.OAUTH_REDIRECT_URI);
        console.log('  code_verifier length:', codeVerifier.length);
        
        // Create Basic Auth header (using btoa - available and working in Workers)
        const credentials = `${c.env.AIRTABLE_CLIENT_ID}:${c.env.AIRTABLE_CLIENT_SECRET}`;
        const base64 = btoa(credentials);
        console.log('🔗 OAuth Callback - Basic Auth header length:', base64.length);
        
        // Exchange authorization code for access token with PKCE using Basic Auth
        const tokenResponse = await fetch("https://airtable.com/oauth2/v1/token", {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "Authorization": `Basic ${base64}`,
            },
            body: requestBody.toString()
        });
        
        if (!tokenResponse.ok) {
            const errorText = await tokenResponse.text();
            console.log('🔗 OAuth Callback - Token exchange failed:');
            console.log('  Status:', tokenResponse.status, tokenResponse.statusText);
            console.log('  Response:', errorText);
            console.log('  Request URL: https://airtable.com/oauth2/v1/token');
            return c.json({ error: "Failed to exchange authorization code", details: errorText }, 400);
        }
        
        const tokenData = await tokenResponse.json() as {
            access_token: string;
            refresh_token?: string;
            expires_in?: number;
        };
        console.log('🔗 OAuth Callback - Token received successfully');
        
        // Get user info from Airtable API
        const userInfoResponse = await fetch("https://api.airtable.com/v0/meta/whoami", {
            headers: {
                "Authorization": `Bearer ${tokenData.access_token}`
            }
        });
        
        if (!userInfoResponse.ok) {
            return c.json({ error: "Failed to fetch user info" }, 400);
        }
        
        const userInfo = await userInfoResponse.json() as { id: string; email: string; name: string };
        console.log('🔗 OAuth Callback - User info:', userInfo);
        
        // Find the base and tables from the user's accessible bases
        const basesResponse = await fetch("https://api.airtable.com/v0/meta/bases", {
            headers: {
                "Authorization": `Bearer ${tokenData.access_token}`
            }
        });
        
        if (!basesResponse.ok) {
            return c.json({ error: "Failed to fetch bases" }, 400);
        }
        
        const basesData = await basesResponse.json() as { bases: Array<{ id: string; name: string }> };
        const firstBase = basesData.bases[0]; // Use first base for simplicity
        
        if (!firstBase) {
            return c.json({ error: "No Airtable bases found" }, 400);
        }
        
        // Get tables from the base
        const tablesResponse = await fetch(`https://api.airtable.com/v0/meta/bases/${firstBase.id}/tables`, {
            headers: {
                "Authorization": `Bearer ${tokenData.access_token}`
            }
        });
        
        if (!tablesResponse.ok) {
            return c.json({ error: "Failed to fetch tables" }, 400);
        }
        
        const tablesData = await tablesResponse.json() as { tables: Array<{ id: string; name: string }> };
        const productTable = tablesData.tables.find((table: { name: string }) => 
            table.name.toLowerCase().includes('product') || table.name.toLowerCase().includes('item')
        );
        const settingsTable = tablesData.tables.find((table: { name: string }) => 
            table.name.toLowerCase().includes('setting') || table.name.toLowerCase().includes('config')
        );
        
        console.log('🔗 OAuth Callback - Base:', firstBase.name, 'Tables:', tablesData.tables.length);
        
        // Use session from cache (already retrieved above)
        console.log('🔗 OAuth Callback - Using session from cache, storeId:', session.storeId);
        
        // Encrypt and store Airtable access token
        const masterKey = await CryptoService.getMasterKey(c.env.AIRTABLE_MASTER_KEY);
        const { ciphertext, iv } = await CryptoService.encrypt(tokenData.access_token, masterKey);
        
        // Update store with Airtable connection info
        const db = getDB(c.env);
        await db.update(stores).set({
            airtableBaseId: firstBase.id,
            airtableProductTable: productTable?.name || '',
            airtableSettingsTable: settingsTable?.name || '',
            airtableApiKey: ciphertext,
            airtableApiKeyIV: iv,
            sourceConnected: "airtable"
        }).where(eq(stores.id, session.storeId));
        
        console.log('🔗 OAuth Callback - Store updated successfully');
        
        // Redirect to frontend with success
        const frontendUrl = c.env.FRONTEND_URL || "http://localhost:3000";
        return c.redirect(`${frontendUrl}/dashboard?airtable=success`);
        
    } catch (error) {
        console.log('🔗 OAuth Callback - Error:', error);
        return c.json({ error: "OAuth callback failed" }, 500);
    }
});

export default internalRoutes;

// 7. Rotate Airtable API Key
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

    const storeDetails = await db.select().from(stores).where(eq(stores.id, id)).limit(1);
    if (storeDetails.length > 0) {
        const s = storeDetails[0];
        await storeDO.init({
            storeId: s.id,
            name: s.name || "",
            slug: s.slug,
            baseId: s.airtableBaseId || "",
            productTable: s.airtableProductTable || "",
            settingsTable: s.airtableSettingsTable || "",
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
