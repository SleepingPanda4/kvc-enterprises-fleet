import { createClient } from "@libsql/client";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const databaseUrl = process.env.DATABASE_URL || "file:./data/kvc-fleet.db";

if (!databaseUrl.startsWith("file:")) {
  throw new Error("DATABASE_URL must use a local file: URL for the LXC build.");
}

const databasePath = databaseUrl.slice("file:".length).split("?")[0];
await mkdir(path.dirname(path.resolve(databasePath)), { recursive: true });

const client = createClient({ url: databaseUrl });
const statements = [
  "PRAGMA foreign_keys = ON",
  "PRAGMA journal_mode = WAL",
  "PRAGMA busy_timeout = 5000",
  `CREATE TABLE IF NOT EXISTS vehicles (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    number TEXT NOT NULL,
    route_number TEXT,
    make_model TEXT NOT NULL,
    year INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS vehicles_number_unique ON vehicles (number)",
  `CREATE UNIQUE INDEX IF NOT EXISTS vehicles_route_number_unique
    ON vehicles (route_number) WHERE route_number IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS vehicle_models (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS vehicle_models_name_unique ON vehicle_models (name)",
  `CREATE TABLE IF NOT EXISTS issues (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    vehicle_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    notes TEXT NOT NULL,
    status TEXT DEFAULT 'open' NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    resolved_at TEXT,
    FOREIGN KEY (vehicle_id) REFERENCES vehicles (id) ON DELETE CASCADE
  )`,
  "CREATE INDEX IF NOT EXISTS idx_issues_vehicle_status ON issues (vehicle_id, status)",
  "PRAGMA optimize",
];

try {
  for (const sql of statements) await client.execute(sql);
  console.log(`KVC Fleet database is ready at ${databasePath}`);
} finally {
  await client.close();
}
