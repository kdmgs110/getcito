import { databaseConnection, positiveIntegerEnv } from "@workspace/config/runtime";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

/**
 * Connection ceiling per process. node-postgres defaults to 10, which the worker
 * outgrew: a single prompt cycle writes a run and its citations for every model
 * at once, so ten prompts in flight queue their writes behind the pool rather
 * than behind the database. Sized against the worker's localConcurrency; raise
 * both together, and keep the total across every web and worker process under
 * the server's `max_connections`.
 */
const POOL_MAX = positiveIntegerEnv("DB_POOL_MAX", 20);

export const db = drizzle(new Pool({ ...databaseConnection(), max: POOL_MAX }), { schema });
