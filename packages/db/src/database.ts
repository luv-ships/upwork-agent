import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";

import * as schema from "./schema.js";

export type Database = PostgresJsDatabase<typeof schema>;

const clients = new WeakMap<Database, Sql>();

export interface CreateDatabaseOptions {
  readonly maxConnections?: number;
  readonly applicationName?: string;
}

/**
 * Creates a server-only Postgres connection. `prepare: false` keeps this
 * compatible with Supabase's transaction pooler as well as direct Postgres.
 */
export function createDatabase(
  databaseUrl: string,
  options: CreateDatabaseOptions = {},
): Database {
  if (databaseUrl.trim().length === 0) {
    throw new Error("A non-empty database URL is required");
  }

  const client = postgres(databaseUrl, {
    max: options.maxConnections ?? 5,
    prepare: false,
    connection: {
      application_name: options.applicationName ?? "upwork-agent",
    },
  });
  const database = drizzle(client, { schema });
  clients.set(database, client);
  return database;
}

export async function closeDatabase(database: Database): Promise<void> {
  const client = clients.get(database);
  if (client === undefined) {
    return;
  }

  clients.delete(database);
  await client.end({ timeout: 5 });
}
