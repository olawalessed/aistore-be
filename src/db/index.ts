import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";
import { EnvBindings } from "../bindings";


// Conditionally import dotenv only in Node.js runtime
export const getDB = (env: EnvBindings) => drizzle(env.BASEKART_AI_SHOP, { schema });

// Export types
export type Database = typeof getDB;
