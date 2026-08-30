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

function nextCalendarDate(dateOnly) {
  const date = new Date(`${dateOnly}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

// This one-time-compatible migration mirrors the application helper. It is
// intentionally idempotent: only the operational-date index is corrected;
// snapshot IDs, source timestamps, and immutable route rows stay unchanged.
function operationalDateForCapturedAt(capturedAt) {
  const date = new Date(capturedAt);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const part = type => parts.find(item => item.type === type)?.value || "";
  const localDate = `${part("year")}-${part("month")}-${part("day")}`;
  return Number(part("hour")) >= 20 ? nextCalendarDate(localDate) : localDate;
}
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
  `CREATE TABLE IF NOT EXISTS routes (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    route_number TEXT NOT NULL,
    display_name TEXT,
    description TEXT,
    color TEXT DEFAULT '#087A46' NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS routes_route_number_unique ON routes (route_number)",
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
  `CREATE TABLE IF NOT EXISTS homebase_user_mappings (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    homebase_user_id TEXT NOT NULL,
    team_member_id INTEGER,
    display_name TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    FOREIGN KEY (team_member_id) REFERENCES team_members (id) ON DELETE SET NULL
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS homebase_user_mappings_user_unique ON homebase_user_mappings (homebase_user_id)",
  "CREATE INDEX IF NOT EXISTS homebase_user_mappings_team_member_idx ON homebase_user_mappings (team_member_id)",
  `CREATE TABLE IF NOT EXISTS homebase_job_mappings (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    homebase_job_id TEXT NOT NULL,
    route_id INTEGER,
    display_name TEXT,
    assignment_type TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    FOREIGN KEY (route_id) REFERENCES routes (id) ON DELETE SET NULL
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS homebase_job_mappings_job_unique ON homebase_job_mappings (homebase_job_id)",
  "CREATE INDEX IF NOT EXISTS homebase_job_mappings_route_idx ON homebase_job_mappings (route_id)",
  `CREATE TABLE IF NOT EXISTS homebase_shifts (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    homebase_shift_id TEXT NOT NULL,
    homebase_user_id TEXT NOT NULL,
    homebase_job_id TEXT NOT NULL,
    team_member_id INTEGER,
    employee_display_name TEXT NOT NULL,
    employee_first_name TEXT,
    employee_last_name TEXT,
    schedule_date TEXT NOT NULL,
    start_timestamp TEXT NOT NULL,
    end_timestamp TEXT NOT NULL,
    raw_assignment TEXT NOT NULL,
    raw_note TEXT,
    published_status TEXT NOT NULL,
    route_id INTEGER,
    assignment_type TEXT NOT NULL,
    confidence TEXT,
    imported_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    FOREIGN KEY (team_member_id) REFERENCES team_members (id) ON DELETE SET NULL,
    FOREIGN KEY (route_id) REFERENCES routes (id) ON DELETE SET NULL
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS homebase_shifts_shift_unique ON homebase_shifts (homebase_shift_id)",
  "CREATE INDEX IF NOT EXISTS homebase_shifts_schedule_date_idx ON homebase_shifts (schedule_date)",
  "CREATE INDEX IF NOT EXISTS homebase_shifts_user_idx ON homebase_shifts (homebase_user_id)",
  "CREATE INDEX IF NOT EXISTS homebase_shifts_team_member_idx ON homebase_shifts (team_member_id)",
  "CREATE INDEX IF NOT EXISTS homebase_shifts_route_idx ON homebase_shifts (route_id)",
  `CREATE TABLE IF NOT EXISTS daily_assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    operational_date TEXT NOT NULL,
    team_member_id INTEGER NOT NULL,
    destination_type TEXT NOT NULL,
    route_id INTEGER,
    special_assignment TEXT,
    source TEXT DEFAULT 'homebase' NOT NULL,
    homebase_shift_id INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    FOREIGN KEY (team_member_id) REFERENCES team_members (id) ON DELETE CASCADE,
    FOREIGN KEY (route_id) REFERENCES routes (id) ON DELETE SET NULL,
    FOREIGN KEY (homebase_shift_id) REFERENCES homebase_shifts (id) ON DELETE SET NULL
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS daily_assignments_date_member_unique ON daily_assignments (operational_date, team_member_id)",
  `CREATE UNIQUE INDEX IF NOT EXISTS daily_assignments_date_route_unique
    ON daily_assignments (operational_date, route_id)
    WHERE destination_type = 'route' AND route_id IS NOT NULL`,
  "CREATE INDEX IF NOT EXISTS daily_assignments_date_type_idx ON daily_assignments (operational_date, destination_type)",
  "CREATE INDEX IF NOT EXISTS daily_assignments_homebase_shift_idx ON daily_assignments (homebase_shift_id)",
  `CREATE TABLE IF NOT EXISTS dro_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    operational_date TEXT NOT NULL,
    captured_at TEXT NOT NULL,
    source_timestamp TEXT,
    station_id TEXT NOT NULL,
    service_area_id TEXT NOT NULL,
    status TEXT NOT NULL,
    error_message TEXT,
    imported_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS dro_snapshots_operational_date_idx ON dro_snapshots (operational_date)",
  "CREATE INDEX IF NOT EXISTS dro_snapshots_captured_at_idx ON dro_snapshots (captured_at)",
  "CREATE INDEX IF NOT EXISTS dro_snapshots_operational_date_captured_at_idx ON dro_snapshots (operational_date, captured_at)",
  `CREATE TABLE IF NOT EXISTS dro_route_rows (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    snapshot_id INTEGER NOT NULL,
    route_id INTEGER,
    route_number TEXT,
    raw_wa_number TEXT NOT NULL,
    display_wa_number TEXT,
    delivery_cube REAL DEFAULT 0 NOT NULL,
    pickup_cube REAL DEFAULT 0 NOT NULL,
    combination_cube REAL DEFAULT 0 NOT NULL,
    used_capacity REAL DEFAULT 0 NOT NULL,
    vehicle_capacity REAL DEFAULT 0 NOT NULL,
    delivery_packages INTEGER DEFAULT 0 NOT NULL,
    pickup_packages INTEGER DEFAULT 0 NOT NULL,
    combination_packages INTEGER DEFAULT 0 NOT NULL,
    total_packages INTEGER DEFAULT 0 NOT NULL,
    delivery_stops INTEGER DEFAULT 0 NOT NULL,
    pickup_stops INTEGER DEFAULT 0 NOT NULL,
    combination_stops INTEGER DEFAULT 0 NOT NULL,
    total_stops INTEGER DEFAULT 0 NOT NULL,
    route_type TEXT,
    route_time TEXT,
    distance REAL,
    warning INTEGER DEFAULT 0 NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    FOREIGN KEY (snapshot_id) REFERENCES dro_snapshots (id) ON DELETE CASCADE,
    FOREIGN KEY (route_id) REFERENCES routes (id) ON DELETE SET NULL
  )`,
  `CREATE TABLE IF NOT EXISTS mgba_dsw_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    operational_date TEXT NOT NULL,
    dsw_date TEXT NOT NULL,
    captured_at TEXT NOT NULL,
    source TEXT NOT NULL,
    route_count INTEGER NOT NULL,
    imported_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS mgba_dsw_snapshots_operational_date_idx ON mgba_dsw_snapshots (operational_date)",
  "CREATE INDEX IF NOT EXISTS mgba_dsw_snapshots_captured_at_idx ON mgba_dsw_snapshots (captured_at)",
  "CREATE INDEX IF NOT EXISTS mgba_dsw_snapshots_operational_date_captured_at_idx ON mgba_dsw_snapshots (operational_date, captured_at)",
  `CREATE TABLE IF NOT EXISTS mgba_dsw_route_rows (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    snapshot_id INTEGER NOT NULL REFERENCES mgba_dsw_snapshots(id) ON DELETE CASCADE,
    route_id INTEGER REFERENCES routes(id) ON DELETE SET NULL,
    service_area TEXT,
    wa_name TEXT,
    vehicle_number TEXT,
    driver_name TEXT NOT NULL,
    route_number TEXT,
    raw_route TEXT,
    dst TEXT,
    vscan_pkgs INTEGER,
    del_stops INTEGER,
    pu_stops INTEGER,
    diff INTEGER,
    act_del_stops INTEGER,
    act_del_pkgs INTEGER,
    act_pu_stops INTEGER,
    act_pu_pkgs INTEGER,
    ils_percent REAL,
    all_status_code_pkgs INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS mgba_dsw_route_rows_snapshot_idx ON mgba_dsw_route_rows (snapshot_id)",
  "CREATE INDEX IF NOT EXISTS mgba_dsw_route_rows_route_idx ON mgba_dsw_route_rows (route_id)",
  "CREATE UNIQUE INDEX IF NOT EXISTS dro_route_rows_snapshot_wa_unique ON dro_route_rows (snapshot_id, raw_wa_number)",
  "CREATE INDEX IF NOT EXISTS dro_route_rows_snapshot_idx ON dro_route_rows (snapshot_id)",
  "CREATE INDEX IF NOT EXISTS dro_route_rows_route_idx ON dro_route_rows (route_id)",
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
  const homebaseShiftColumns = await client.execute("PRAGMA table_info(homebase_shifts)");
  for (const [name, definition] of [
    ["employee_first_name", "TEXT"],
    ["employee_last_name", "TEXT"],
    ["confidence", "TEXT"],
  ]) {
    if (!homebaseShiftColumns.rows.some(row => String(row.name) === name)) {
      await client.execute(`ALTER TABLE homebase_shifts ADD COLUMN ${name} ${definition}`);
    }
  }
  const existingSnapshots = await client.execute("SELECT id, operational_date, captured_at FROM dro_snapshots");
  for (const snapshot of existingSnapshots.rows) {
    const correctedOperationalDate = operationalDateForCapturedAt(String(snapshot.captured_at));
    if (correctedOperationalDate && correctedOperationalDate !== String(snapshot.operational_date)) {
      await client.execute({ sql: "UPDATE dro_snapshots SET operational_date = ? WHERE id = ?", args: [correctedOperationalDate, Number(snapshot.id)] });
    }
  }
  await client.execute(`UPDATE dro_route_rows
    SET warning = CASE WHEN vehicle_capacity > 0 AND used_capacity >= vehicle_capacity * 0.5 THEN 1 ELSE 0 END
    WHERE warning <> CASE WHEN vehicle_capacity > 0 AND used_capacity >= vehicle_capacity * 0.5 THEN 1 ELSE 0 END`);
  for (const routeNumber of routeNumbers) {
    await client.execute({
      sql: "INSERT INTO route_settings (route_number, color) VALUES (?, ?) ON CONFLICT (route_number) DO NOTHING",
      args: [routeNumber, "#087A46"],
    });
  }
  await client.execute(`INSERT OR IGNORE INTO routes (route_number, color)
    SELECT route_number, color FROM route_settings WHERE TRIM(route_number) <> ''`);
  await client.execute(`INSERT OR IGNORE INTO routes (route_number)
    SELECT DISTINCT TRIM(route_number) FROM vehicles WHERE route_number IS NOT NULL AND TRIM(route_number) <> ''`);
  await client.execute(`INSERT OR IGNORE INTO routes (route_number)
    SELECT DISTINCT TRIM(regular_route) FROM team_members WHERE regular_route IS NOT NULL AND TRIM(regular_route) <> ''`);
  await client.execute(`INSERT OR IGNORE INTO routes (route_number)
    SELECT DISTINCT TRIM(saturday_route) FROM team_members WHERE saturday_route IS NOT NULL AND TRIM(saturday_route) <> ''`);
  await client.execute(`INSERT OR IGNORE INTO routes (route_number)
    SELECT DISTINCT TRIM(sunday_route) FROM team_members WHERE sunday_route IS NOT NULL AND TRIM(sunday_route) <> ''`);
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
