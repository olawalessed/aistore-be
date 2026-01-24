import { CryptoService } from "./crypto";
import { getDB } from "../db";
import { stores } from "../db/schema";
import { eq } from "drizzle-orm";
import { EnvBindings } from "../bindings";

export interface TokenData {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope?: string;
  token_type?: string;
}

export interface EncryptedTokenData {
  access_token: string;
  access_token_iv: string;
  refresh_token: string;
  refresh_token_iv: string;
  expires_at: number;
  provider: string;
}

export interface RefreshTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope?: string;
  token_type?: string;
}

export class TokenManagerError extends Error {
  constructor(
    message: string,
    public code: 'TOKEN_EXPIRED' | 'REFRESH_FAILED' | 'DECRYPTION_FAILED' | 'STORAGE_FAILED' | 'CONCURRENT_REFRESH'
  ) {
    super(message);
    this.name = 'TokenManagerError';
  }
}

export class TokenManager {
  private static readonly FIVE_MINUTES_SECONDS = 300;
  private static readonly AIRTABLE_TOKEN_URL = 'https://airtable.com/oauth2/v1/token';

  /**
   * Encrypt and prepare token data for storage
   */
  static async encryptTokenData(
    tokenData: TokenData,
    masterKey: CryptoKey,
    provider: string = 'airtable'
  ): Promise<EncryptedTokenData> {
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + (tokenData.expires_in || 3600);

    // Encrypt both tokens
    const [encryptedAccess, encryptedRefresh] = await Promise.all([
      CryptoService.encrypt(tokenData.access_token, masterKey),
      CryptoService.encrypt(tokenData.refresh_token, masterKey)
    ]);

    return {
      access_token: encryptedAccess.ciphertext,
      access_token_iv: encryptedAccess.iv,
      refresh_token: encryptedRefresh.ciphertext,
      refresh_token_iv: encryptedRefresh.iv,
      expires_at: expiresAt,
      provider
    };
  }

  /**
   * Decrypt token data from storage
   */
  static async decryptTokenData(
    encryptedData: EncryptedTokenData,
    masterKey: CryptoKey
  ): Promise<TokenData> {
    try {
      const [accessToken, refreshToken] = await Promise.all([
        CryptoService.decrypt(encryptedData.access_token, encryptedData.access_token_iv, masterKey),
        CryptoService.decrypt(encryptedData.refresh_token, encryptedData.refresh_token_iv, masterKey)
      ]);

      const now = Math.floor(Date.now() / 1000);
      const expiresIn = encryptedData.expires_at - now;

      return {
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: expiresIn,
        scope: undefined, // Not stored in encrypted data
        token_type: 'Bearer'
      };
    } catch (error) {
      console.error('Token decryption failed:', error);
      throw new TokenManagerError('Failed to decrypt tokens', 'DECRYPTION_FAILED');
    }
  }

  /**
   * Check if token is expired or will expire within 5 minutes
   */
  static isTokenExpired(expiresAt: number): boolean {
    const now = Math.floor(Date.now() / 1000);
    return now >= (expiresAt - this.FIVE_MINUTES_SECONDS);
  }

  /**
   * Refresh Airtable tokens atomically
   */
  static async refreshAirtableToken(
    refreshToken: string,
    clientId: string,
    clientSecret: string
  ): Promise<RefreshTokenResponse> {

    if (!clientId || !clientSecret) {
      throw new TokenManagerError(
        'Airtable client credentials are missing',
        'REFRESH_FAILED'
      );
    }

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });

    // Use Basic Auth with client_id:client_secret as per Airtable docs
    const credentials = btoa(`${clientId}:${clientSecret}`);
    
    // Additional validation for Airtable-specific formats
    if (!clientId.startsWith('app')) {
      console.warn('[TokenManager] Warning: Client ID should start with "app" for Airtable');
    }
    
    if (clientSecret.length < 20) {
      console.warn('[TokenManager] Warning: Client Secret seems too short for Airtable');
    }

    const response = await fetch(this.AIRTABLE_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${credentials}`,
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      
      throw new TokenManagerError(
        `Token refresh failed: ${response.status} ${errorText}`,
        'REFRESH_FAILED'
      );
    }

    const tokenData = await response.json() as RefreshTokenResponse;
    
    if (!tokenData.access_token || !tokenData.refresh_token) {
      throw new TokenManagerError(
        'Invalid token response from Airtable',
        'REFRESH_FAILED'
      );
    }

    return tokenData;
  }

  /**
   * Get time until token expires (in seconds)
   */
  static getTimeUntilExpiry(expiresAt: number): number {
    const now = Math.floor(Date.now() / 1000);
    return Math.max(0, expiresAt - now);
  }

  /**
   * Validate token data structure
   */
  static validateTokenData(data: any): data is TokenData {
    return (
      data &&
      typeof data.access_token === 'string' &&
      typeof data.refresh_token === 'string' &&
      (typeof data.expires_in === 'number' || typeof data.expires_in === 'string')
    );
  }

  /**
   * Validate encrypted token data structure
   */
  static validateEncryptedTokenData(data: any): data is EncryptedTokenData {
    return (
      data &&
      typeof data.access_token === 'string' &&
      typeof data.access_token_iv === 'string' &&
      typeof data.refresh_token === 'string' &&
      typeof data.refresh_token_iv === 'string' &&
      typeof data.expires_at === 'number' &&
      typeof data.provider === 'string'
    );
  }

  /**
   * Store encrypted tokens in D1 for a store
   */
  static async storeTokensInD1(
    env: EnvBindings,
    storeId: string,
    encryptedTokens: EncryptedTokenData
  ): Promise<void> {
    const db = getDB(env);
    
    await db.update(stores)
      .set({
        airtableAccessToken: encryptedTokens.access_token,
        airtableAccessTokenIV: encryptedTokens.access_token_iv,
        airtableRefreshToken: encryptedTokens.refresh_token,
        airtableRefreshTokenIV: encryptedTokens.refresh_token_iv,
        airtableTokenExpiresAt: new Date(encryptedTokens.expires_at * 1000),
        tokenProvider: encryptedTokens.provider,
      })
      .where(eq(stores.id, storeId));
  }

  /**
   * Retrieve encrypted tokens from D1 for a store
   */
  static async getTokensFromD1(
    env: EnvBindings,
    storeId: string
  ): Promise<EncryptedTokenData | null> {
    const db = getDB(env);
    
    const store = await db
      .select({
        airtableAccessToken: stores.airtableAccessToken,
        airtableAccessTokenIV: stores.airtableAccessTokenIV,
        airtableRefreshToken: stores.airtableRefreshToken,
        airtableRefreshTokenIV: stores.airtableRefreshTokenIV,
        airtableTokenExpiresAt: stores.airtableTokenExpiresAt,
        tokenProvider: stores.tokenProvider,
      })
      .from(stores)
      .where(eq(stores.id, storeId))
      .limit(1);

    if (!store[0] || !store[0].airtableAccessToken) {
      return null;
    }

    const tokenData = store[0];
    return {
      access_token: tokenData.airtableAccessToken!,
      access_token_iv: tokenData.airtableAccessTokenIV!,
      refresh_token: tokenData.airtableRefreshToken!,
      refresh_token_iv: tokenData.airtableRefreshTokenIV!,
      expires_at: Math.floor(new Date(tokenData.airtableTokenExpiresAt!).getTime() / 1000),
      provider: tokenData.tokenProvider || 'airtable',
    };
  }

  /**
   * Get valid access token with auto-refresh from D1 storage
   */
  static async getValidAccessTokenFromD1(
    env: EnvBindings,
    storeId: string
  ): Promise<string> {
    const encryptedTokens = await this.getTokensFromD1(env, storeId);
    
    if (!encryptedTokens) {
      throw new TokenManagerError('No tokens found in D1', 'TOKEN_EXPIRED');
    }

    // Check if token needs refresh
    if (this.isTokenExpired(encryptedTokens.expires_at)) {
      console.log(`[TokenManager] Token expired for store ${storeId}, refreshing...`);
      
      // Decrypt current refresh token
      const masterKey = await CryptoService.getMasterKey(env.AIRTABLE_MASTER_KEY);
      const currentTokens = await this.decryptTokenData(encryptedTokens, masterKey);
      
      // Refresh with Airtable
      const newTokens = await this.refreshAirtableToken(
        currentTokens.refresh_token,
        env.AIRTABLE_CLIENT_ID,
        env.AIRTABLE_CLIENT_SECRET
      );
      
      // Encrypt and store new tokens
      const encryptedNewTokens = await this.encryptTokenData(
        newTokens,
        masterKey,
        'airtable'
      );
      
      await this.storeTokensInD1(env, storeId, encryptedNewTokens);
      
      return newTokens.access_token;
    }
    
    // Decrypt and return current access token
    const masterKey = await CryptoService.getMasterKey(env.AIRTABLE_MASTER_KEY);
    const tokenData = await this.decryptTokenData(encryptedTokens, masterKey);
    return tokenData.access_token;
  }

}
