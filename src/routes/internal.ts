import { Context, Hono } from "hono";
import { eq } from "drizzle-orm";
import { getDB } from "../db";
import { stores } from "../db/schema";
import { CryptoService } from "../services/crypto";
import { TokenManager } from "../services/token-manager";
import { EnvBindings } from "../bindings";
import {
  authMiddleware,
  SessionData,
  AuthContext,
  generateCodeVerifier,
  generateCodeChallenge,
} from "../middlewares/auth";
import {
  addSampleProducts,
  createShopBase,
  createShopTable,
  fetchBaseInfo,
} from "../helpers/airtable";
import {
  PRODUCT_TABLE_SCHEMA,
  SETTINGS_TABLE_SCHEMA,
} from "../data/airtable/schema";

// Generate email verification token
function generateVerificationToken(): string {
  return crypto.randomUUID();
}

const internalRoutes = new Hono<{ Bindings: EnvBindings }>();

// 1. Email Registration - Send verification link
internalRoutes.post(
  "/register-email",
  async (c: Context<{ Bindings: EnvBindings }>) => {
    const { email } = await c.req.json();

    if (!email || !email.includes("@")) {
      return c.json({ error: "Valid email is required" }, 400);
    }

    const db = getDB(c.env);

    // Check if email already exists and is verified
    const existingStore = await db
      .select()
      .from(stores)
      .where(eq(stores.email, email))
      .limit(1);

    // If email already exists and is verified, just send a new verification link
    // This allows users to get a new magic link if they lost the original
    if (existingStore.length > 0 && existingStore[0].emailVerified) {
      // Generate new verification token and expiry
      const verificationToken = generateVerificationToken();
      const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours from now

      // Update existing store with new verification token
      await db
        .update(stores)
        .set({
          emailVerificationToken: verificationToken,
          emailVerificationExpires: verificationExpires,
        })
        .where(eq(stores.email, email));

      // For now, return the token for development
      const verificationUrl = `${c.env.FRONTEND_URL
        }/verify?token=${verificationToken}&email=${encodeURIComponent(email)}`;

      return c.json({
        status: "verification_sent",
        message: "Verification email sent",
        // Remove this in production - only for development
        verificationUrl,
      });
    }

    // Generate verification token and expiry (24 hours)
    const verificationToken = generateVerificationToken();
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours from now

    // Create or update pending store
    if (existingStore.length > 0) {
      // Update existing pending store
      await db
        .update(stores)
        .set({
          emailVerificationToken: verificationToken,
          emailVerificationExpires: verificationExpires,
        })
        .where(eq(stores.email, email));
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
    const verificationUrl = `${c.env.FRONTEND_URL
      }/verify?token=${verificationToken}&email=${encodeURIComponent(email)}`;

    return c.json({
      status: "verification_sent",
      message: "Verification email sent",
      // Remove this in production - only for development
      verificationUrl:
        c.env.NODE_ENV === "development" ? verificationUrl : undefined,
    });
  }
);

// 2. Verify email and create session
internalRoutes.post(
  "/verify-email",
  async (c: Context<{ Bindings: EnvBindings }>) => {
    const { token, email } = await c.req.json();

    if (!token || !email) {
      return c.json({ error: "Token and email are required" }, 400);
    }

    const db = getDB(c.env);

    const storeResults = await db
      .select()
      .from(stores)
      .where(eq(stores.email, email))
      .limit(1);

    if (storeResults.length === 0) {
      return c.json({ error: "Store not found" }, 404);
    }

    const store = storeResults[0];

    if (store.emailVerified) {
      // Email already verified, just create a session and log them in
      const sessionData = {
        storeId: store.id,
        email: store.email,
        name: store.name || "",
        storeName: store.name || "",
        slug: store.slug || "",
        plan: store.plan || "free",
        city: store.city || "",
        country: store.country || "",
        whatsapp: store.whatsapp || "",
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
        message: "Email already verified - logging you in",
      });
    }

    if (store.emailVerificationToken !== token) {
      return c.json({ error: "Invalid verification token" }, 400);
    }

    if (
      store.emailVerificationExpires &&
      new Date(store.emailVerificationExpires) < new Date()
    ) {
      return c.json({ error: "Verification token expired" }, 400);
    }

    // Mark email as verified
    await db
      .update(stores)
      .set({
        emailVerified: true,
        emailVerificationToken: null,
        emailVerificationExpires: null,
      })
      .where(eq(stores.id, store.id));

    // Create session/token for authenticated access
    const { SignJWT } = await import("jose");
    const sessionToken = await new SignJWT({
      storeId: store.id,
      email: store.email,
      storeName: store.name,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("6w")
      .sign(new TextEncoder().encode(c.env.JWT_AUTH_SECRET));

    // Set session cookie
    const isSecure = c.req.url.startsWith("https://");
    const cookieString = `session=${sessionToken}; HttpOnly; ${isSecure ? "Secure; " : ""
      }SameSite=None; Path=/; Max-Age=${6 * 7 * 24 * 60 * 60}`;
    console.log(
      "🔐 Email Verification - Setting session cookie:",
      cookieString
    );
    c.header("Set-Cookie", cookieString);

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
      message: "Email verified successfully",
    });
  }
);

// 3. Update Store Information (Post-Verification)
internalRoutes.post(
  "/update",
  async (c: Context<{ Bindings: EnvBindings }>) => {
    const { storeId, name, slug, country, city, address, whatsapp } =
      await c.req.json();

    if (!storeId || !name || !slug) {
      return c.json(
        { error: "Missing required fields: storeId, name, slug" },
        400
      );
    }

    const db = getDB(c.env);

    // Check if store exists and email is verified
    const storeResults = await db
      .select()
      .from(stores)
      .where(eq(stores.id, storeId))
      .limit(1);

    if (storeResults.length === 0) {
      return c.json({ error: "Store not found" }, 404);
    }

    const store = storeResults[0];

    if (!store.emailVerified) {
      return c.json({ error: "Email not verified" }, 400);
    }

    const phone = whatsapp?.trim();

    // Update store information
    await db
      .update(stores)
      .set({
        name,
        slug,
        plan: "free", // Convert from pending to free
        country,
        city,
        address,
        whatsapp,
        phone,
        status: store.sourceConnected ? "active" : "connect", // Set store to active when details are updated
      })
      .where(eq(stores.id, storeId));

    return c.json({
      status: "success",
      storeId,
      message: "Store information updated successfully",
    });
  }
);

// 4. Get Store Dashboard (for session management)
internalRoutes.get("/dashboard", authMiddleware, async (c: AuthContext) => {
  // Get session from context (set by middleware)
  const session = c.get("session");

  if (!session || !session.storeId) {
    return c.json({ error: "Invalid session" }, 401);
  }

  const db = getDB(c.env);

  // Find store by session storeId
  const storeResults = await db
    .select()
    .from(stores)
    .where(eq(stores.id, session.storeId))
    .limit(1);

  if (storeResults.length === 0) {
    return c.json({ error: "Store not found" }, 404);
  }

  const store = storeResults[0];

  // Calculate if user can sync manually based on plan and time limits
  const canSyncManually =
    store.plan !== "free" &&
    (!store.lastManualSyncAt ||
      Date.now() - new Date(store.lastManualSyncAt).getTime() >=
      8 * 60 * 60 * 1000); // 8 hours in ms

  const userPayload = {
    storeName: store.name,
    slug: store.slug,
    plan: store.plan,
    productCount: store.productCount, // TODO: Get from Airtable sync
    lastSync: store.lastSyncAt?.toISOString() || null,
    sourceConnected: store.sourceConnected, // New field
    lastSettingsSync: null,
    canSyncManually, // New field for frontend sync button logic
    email: store.email,
    id: store.id,
    name: store.name,
    city: store.city,
    country: store.country,
    whatsapp: store.whatsapp,
    status: store.status,
  };

  return c.json({
    // @ts-ignore - userPayload is spread to avoid duplication
    ...userPayload,
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
        whatsapp: store.whatsapp,
      },
      storeId: store.id,
    },
    user: userPayload,
  });
});

// 6. Manually trigger sync
internalRoutes.post("/:id/sync", authMiddleware, async (c: AuthContext) => {
  const id = c.req.param("id");

  // Get store data to validate sync permissions
  const db = getDB(c.env);
  const storeResults = await db
    .select()
    .from(stores)
    .where(eq(stores.id, id))
    .limit(1);

  if (storeResults.length === 0) {
    return c.json({ error: "Store not found" }, 404);
  }

  const store = storeResults[0];

  // Check if user can sync manually
  const canSyncManually =
    store.plan !== "free" &&
    (!store.lastManualSyncAt ||
      Date.now() - new Date(store.lastManualSyncAt).getTime() >=
      8 * 60 * 60 * 1000); // 8 hours in ms

  // if (!canSyncManually) {
  //   const reason =
  //     store.plan === "free"
  //       ? "Manual sync is not available on free plan"
  //       : "Manual sync can only be done once every 8 hours";
  //   return c.json({ error: reason }, 429);
  // }

  // Record the manual sync time
  await db
    .update(stores)
    .set({ lastManualSyncAt: new Date() })
    .where(eq(stores.id, id));

  // Trigger the sync
  const storeDO = c.env.STORE_DO.getByName(id);

  const resp = await storeDO.triggerSync();
  return c.json(resp);
});

//@TODO: Simple in-memory cache for OAuth data (development only)
const oauthCache = new Map<
  string,
  { codeVerifier: string; session: SessionData; timestamp: number }
>();

// 8. Airtable OAuth - Initiate OAuth flow with PKCE
internalRoutes.get(
  "/connect/airtable",
  authMiddleware,
  async (c: AuthContext) => {
    console.log("🔗 OAuth - Starting Airtable OAuth flow with PKCE");

    const clientId = c.env.AIRTABLE_CLIENT_ID;
    const redirectUri = c.env.OAUTH_REDIRECT_URI;
    const scopes = [
      "data.records:read",
      "data.records:write",
      "schema.bases:read",
      "schema.bases:write",
      "webhook:manage",
    ];

    // Generate PKCE verifier and challenge
    const codeVerifier = generateCodeVerifier(); // 43-128 char string
    const codeChallenge = await generateCodeChallenge(codeVerifier); // Base64URL-encoded SHA256

    const state = Array.from(
      crypto.getRandomValues(new Uint8Array(16)),
      (byte) => byte.toString(36).padStart(2, "0")
    )
      .join("")
      .substring(0, 32); // 32-char cryptographically secure string

    // Get current user session and store it with OAuth data
    const session = c.get("session");
    if (!session) {
      return c.json({ error: "User session required for OAuth" }, 401);
    }

    // Store codeVerifier and session data in cache with state as key (10 minute expiry)
    oauthCache.set(state, {
      codeVerifier,
      session: session, // Store user session data
      timestamp: Date.now(),
    });

    console.log(
      "🔗 OAuth - Stored codeVerifier and session in cache with state:",
      state
    );

    const authUrl =
      `https://airtable.com/oauth2/v1/authorize?` +
      new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: scopes.join(" "),
        state: state,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
      }).toString();

    console.log("🔗 OAuth - Created OAuth flow");

    return c.redirect(authUrl);
  }
);

// 9. Airtable OAuth - Handle callback with PKCE
internalRoutes.get("/callback", async (c: AuthContext) => {
  console.log("🔗 OAuth Callback - Received request");

  const code = c.req.query("code");
  const state = c.req.query("state");

  if (!code) {
    return c.json({ error: "Authorization code is required" }, 400);
  }

  if (!state) {
    return c.json({ error: "State parameter is missing" }, 400);
  }

  // -----------------------------
  // Retrieve PKCE + session data
  // -----------------------------
  const cachedData = oauthCache.get(state);
  if (!cachedData) {
    return c.json({ error: "State not found or expired" }, 400);
  }

  if (Date.now() - cachedData.timestamp > 10 * 60 * 1000) {
    oauthCache.delete(state);
    return c.json({ error: "State expired" }, 400);
  }

  const { codeVerifier, session } = cachedData;
  oauthCache.delete(state);

  try {
    // -----------------------------
    // Exchange code for access token
    // -----------------------------
    const body = new URLSearchParams({
      client_id: c.env.AIRTABLE_CLIENT_ID,
      grant_type: "authorization_code",
      code,
      redirect_uri: c.env.OAUTH_REDIRECT_URI,
      code_verifier: codeVerifier,
    });

    const basicAuth = btoa(
      `${c.env.AIRTABLE_CLIENT_ID}:${c.env.AIRTABLE_CLIENT_SECRET}`
    );

    const tokenResponse = await fetch("https://airtable.com/oauth2/v1/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basicAuth}`,
      },
      body: body.toString(),
    });

    if (!tokenResponse.ok) {
      const error = await tokenResponse.text();
      return c.json({ error: "Token exchange failed", details: error }, 400);
    }

    const tokenData = (await tokenResponse.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };

    console.log("🔑 Airtable access token acquired", tokenData);

    // Validate token data
    if (!TokenManager.validateTokenData(tokenData)) {
      return c.json({ error: "Invalid token response from Airtable" }, 400);
    }

    // -----------------------------
    // Create Basekart-controlled base
    // -----------------------------

    const base = await fetchBaseInfo(tokenData.access_token);

    const baseId = base.bases[0].id;

    console.log(baseId, "Extracted user base Id");

    let productTableId;
    let settingsTableId;

    // -----------------------------
    // Create required tables
    // -----------------------------

    const [productTable, settingsTable] = await Promise.all([
      createShopTable(baseId, PRODUCT_TABLE_SCHEMA, tokenData.access_token),
      createShopTable(baseId, SETTINGS_TABLE_SCHEMA, tokenData.access_token),
    ]);

    productTableId = productTable?.id;
    settingsTableId = settingsTable?.id;

    addSampleProducts(baseId, productTableId, tokenData.access_token);

    console.log("📦Base tables created", productTable, settingsTable);

    // -----------------------------
    // Encrypt tokens using new token management
    // -----------------------------
    const masterKey = await CryptoService.getMasterKey(
      c.env.AIRTABLE_MASTER_KEY
    );

    const encryptedTokens = await TokenManager.encryptTokenData(
      tokenData,
      masterKey,
      'airtable'
    );

    console.log("🔐 Tokens encrypted successfully");

    // -----------------------------
    // Persist connection with new token fields
    // -----------------------------
    const db = getDB(c.env);

    await db
      .update(stores)
      .set({
        airtableBaseId: baseId,
        airtableProductTable: productTableId,
        airtableSettingsTable: settingsTableId,
        // OAuth token fields
        airtableAccessToken: encryptedTokens.access_token,
        airtableAccessTokenIV: encryptedTokens.access_token_iv,
        airtableRefreshToken: encryptedTokens.refresh_token,
        airtableRefreshTokenIV: encryptedTokens.refresh_token_iv,
        airtableTokenExpiresAt: new Date(encryptedTokens.expires_at * 1000),
        tokenProvider: encryptedTokens.provider,
        sourceConnected: "airtable"
      })
      .where(eq(stores.id, session.storeId));

    // Initialize Store DO with basic config (tokens are now in D1)
    const storeDO = c.env.STORE_DO.getByName(session.storeId);
    await storeDO.init({
      storeId: session.storeId,
      name: session.storeName || "",
      slug: session.storeId, // Use storeId as slug fallback
      baseId: baseId,
      productTableId,
      settingsTableId,
      country: session.country || undefined,
      city: session.city || undefined,
      whatsapp: session.whatsapp || undefined,
    });

    // -----------------------------
    // Redirect back to dashboard
    // -----------------------------
    const frontendUrl = c.env.FRONTEND_URL;

    return c.redirect(`${frontendUrl}/dashboard?airtable=connected`);
  } catch (error) {
    console.error("❌ OAuth callback error:", error);
    return c.json({ error: "OAuth callback failed" }, 500);
  }
});

export default internalRoutes;

// 8. Get Token Status
internalRoutes.get(
  "/:id/token-status",
  authMiddleware,
  async (c: AuthContext) => {
    const id = c.req.param("id");
    const db = getDB(c.env);

    const storeDetails = await db
      .select()
      .from(stores)
      .where(eq(stores.id, id))
      .limit(1);

    if (storeDetails.length === 0) {
      return c.json({ error: "Store not found" }, 404);
    }

    const store = storeDetails[0];

    // Check if using OAuth tokens
    if (store.tokenProvider === 'airtable' && store.airtableTokenExpiresAt) {
      const expiresAt = new Date(store.airtableTokenExpiresAt).getTime();
      const now = Date.now();
      const timeUntilExpiry = Math.max(0, expiresAt - now);
      const isExpired = timeUntilExpiry <= 300000; // 5 minutes in ms

      return c.json({
        provider: store.tokenProvider,
        expiresAt: new Date(store.airtableTokenExpiresAt).toISOString(),
        timeUntilExpiry: Math.floor(timeUntilExpiry / 1000), // seconds
        isExpired,
        needsRefresh: isExpired,
        status: isExpired ? "expired" : "valid"
      });
    }

    // Legacy API key - no expiry info
    return c.json({
      provider: "legacy_api_key",
      status: "valid",
      note: "Legacy API key - consider migrating to OAuth for better security"
    });
  }
);
