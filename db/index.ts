import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

const databaseUrl = process.env.DATABASE_URL || "file:./data/kvc-fleet.db";
const client = createClient({ url: databaseUrl });

await client.execute("PRAGMA foreign_keys = ON");
await client.execute("PRAGMA busy_timeout = 5000");

const database = drizzle(client, { schema });

export function getDb() {
  return database;
}

export async function closeDb() {
  await client.close();
}

export type Database = typeof database;
