import { defineConfig, type Config } from 'drizzle-kit'
import fs from 'node:fs';
import path from 'node:path';
import * as dotenv from 'dotenv'
dotenv.config()


function getLocalDBPath() {
    const basePath = path.resolve('.wrangler/state/v3/d1/miniflare-D1DatabaseObject');
    const files = fs.readdirSync(basePath);
    const dbFile = files.find((f) => f.endsWith('.sqlite'));
    if (!dbFile) throw new Error('Local SQLite file not found');
    return path.resolve(basePath, dbFile);
}
export default defineConfig({
    schema: "./src/db/schema.ts",
    out: "./drizzle",
    dialect: "sqlite",
    ...(process.env.NODE_ENV === 'production'
        ? {
            driver: 'd1-http',
            dbCredentials: {
                accountId: process.env.CLOUDFLARE_ACCOUNT_ID!,
                databaseId: process.env.CLOUDFLARE_DATABASE_ID!,
                token: process.env.CLOUDFLARE_API_TOKEN!,
            }
        }
        : {
            dbCredentials: {
                url: getLocalDBPath(),
            },
        }),
}) satisfies Config
