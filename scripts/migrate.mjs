import { createClient } from "@libsql/client";
import { mkdir } from "node:fs/promises";
import { randomBytes, scryptSync } from "node:crypto";
import path from "node:path";

const databaseUrl = process.env.DATABASE_URL || "file:./data/kvc-fleet.db";

if (!databaseUrl.startsWith("file:")) {
  throw new Error("DATABASE_URL must use a local file: URL for the LXC build.");
}

const databasePath = databaseUrl.slice("file:".length).split("?")[0];
await mkdir(path.dirname(path.resolve(databasePath)), { recursive: true });

const client = createClient({ url: databaseUrl });
const routeNumbers = ["613", "614", "617", "618", "621", "622", "625", "626", "629", "630", "633", "634", "637", "638", "641", "642", "645", "1127"];
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
  `CREATE TABLE IF NOT EXISTS route_settings (
    route_number TEXT PRIMARY KEY NOT NULL,
    color TEXT DEFAULT '#087A46' NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS issues (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    vehicle_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    notes TEXT NOT NULL,
    status TEXT DEFAULT 'open' NOT NULL,
    service_scheduled INTEGER DEFAULT 0 NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    resolved_at TEXT,
    FOREIGN KEY (vehicle_id) REFERENCES vehicles (id) ON DELETE CASCADE
  )`,
  "CREATE INDEX IF NOT EXISTS idx_issues_vehicle_status ON issues (vehicle_id, status)",
  `CREATE TABLE IF NOT EXISTS team_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    name TEXT NOT NULL,
    nickname TEXT,
    phone_number TEXT NOT NULL,
    email TEXT,
    availability_days TEXT DEFAULT '[]' NOT NULL,
    regular_route TEXT,
    saturday_route TEXT,
    sunday_route TEXT,
    role TEXT DEFAULT 'Team Member' NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS schedule_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    team_member_id INTEGER NOT NULL,
    week_start TEXT NOT NULL,
    day TEXT NOT NULL,
    route_number TEXT,
    start_time TEXT DEFAULT '08:00' NOT NULL,
    end_time TEXT DEFAULT '17:00' NOT NULL,
    notes TEXT,
    published_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    FOREIGN KEY (team_member_id) REFERENCES team_members (id) ON DELETE CASCADE
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS schedule_entries_member_week_day_unique ON schedule_entries (team_member_id, week_start, day)",
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, team_member_id INTEGER, name TEXT NOT NULL,
    email TEXT NOT NULL, phone_number TEXT NOT NULL, password_hash TEXT NOT NULL,
    role TEXT DEFAULT 'Team Member' NOT NULL, verified_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL, FOREIGN KEY (team_member_id) REFERENCES team_members (id) ON DELETE SET NULL
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users (email)",
  "CREATE UNIQUE INDEX IF NOT EXISTS users_phone_number_unique ON users (phone_number)",
  "CREATE UNIQUE INDEX IF NOT EXISTS users_team_member_unique ON users (team_member_id)",
  `CREATE TABLE IF NOT EXISTS auth_sessions (
    token_hash TEXT PRIMARY KEY NOT NULL, user_id INTEGER NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    last_used_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL, FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS auth_tokens (
    token_hash TEXT PRIMARY KEY NOT NULL, user_id INTEGER NOT NULL, type TEXT NOT NULL, expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL, FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  )`,
];

try {
  for (const sql of statements) await client.execute(sql);
  const teamMemberColumns = await client.execute("PRAGMA table_info(team_members)");
  if (!teamMemberColumns.rows.some(row => String(row.name) === "availability_days")) {
    await client.execute("ALTER TABLE team_members ADD COLUMN availability_days TEXT NOT NULL DEFAULT '[]'");
  }
  for (const [name, definition] of [
    ["email", "TEXT"],
    ["saturday_route", "TEXT"],
    ["sunday_route", "TEXT"],
    ["role", "TEXT NOT NULL DEFAULT 'Team Member'"],
  ]) {
    if (!teamMemberColumns.rows.some(row => String(row.name) === name)) {
      await client.execute(`ALTER TABLE team_members ADD COLUMN ${name} ${definition}`);
    }
  }
  const issueColumns = await client.execute("PRAGMA table_info(issues)");
  if (!issueColumns.rows.some(row => String(row.name) === "service_scheduled")) {
    await client.execute("ALTER TABLE issues ADD COLUMN service_scheduled INTEGER NOT NULL DEFAULT 0");
  }
  const scheduleColumns = await client.execute("PRAGMA table_info(schedule_entries)");
  if (!scheduleColumns.rows.some(row => String(row.name) === "notes")) {
    await client.execute("ALTER TABLE schedule_entries ADD COLUMN notes TEXT");
  }
  for (const routeNumber of routeNumbers) {
    await client.execute({
      sql: "INSERT INTO route_settings (route_number, color) VALUES (?, ?) ON CONFLICT (route_number) DO NOTHING",
      args: [routeNumber, "#087A46"],
    });
  }
  const existingAdmin = await client.execute({ sql: "SELECT id FROM users WHERE email = ?", args: ["admin@admin.com"] });
  if (existingAdmin.rows.length === 0) {
    const phoneNumber = "(000) 000-0000";
    const memberResult = await client.execute({ sql: `INSERT INTO team_members (name, nickname, phone_number, email, availability_days, role)
      VALUES (?, ?, ?, ?, ?, ?)`, args: ["Temporary Admin", "Admin", phoneNumber, "admin@admin.com", "[]", "Fleet Manager"] });
    const salt = randomBytes(16).toString("hex");
    const passwordHash = `${salt}:${scryptSync("AdminAdmin", salt, 64).toString("hex")}`;
    await client.execute({ sql: `INSERT INTO users (team_member_id, name, email, phone_number, password_hash, role, verified_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`, args: [Number(memberResult.lastInsertRowid), "Temporary Admin", "admin@admin.com", phoneNumber, passwordHash, "Fleet Manager", new Date().toISOString()] });
  }
  await client.execute("PRAGMA optimize");
  console.log(`KVC Fleet database is ready at ${databasePath}`);
} finally {
  await client.close();
}
