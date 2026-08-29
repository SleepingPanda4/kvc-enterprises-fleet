import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createClient } from "@libsql/client";

const projectRoot = new URL("../", import.meta.url);

function runMigration(databaseUrl) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/migrate.mjs"], {
      cwd: projectRoot,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", code => code === 0 ? resolve() : reject(new Error(`Migration exited ${code}`)));
  });
}

test("package emits a standalone Node server", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const serviceFile = await readFile(new URL("../deploy/kvc-fleet.service", import.meta.url), "utf8");
  await readFile(new URL("../dist/standalone/server.js", import.meta.url));
  assert.equal(packageJson.scripts.start, "node dist/standalone/server.js");
  assert.equal(packageJson.scripts["db:migrate"], "node scripts/migrate.mjs");
  assert.match(serviceFile, /^EnvironmentFile=-\/etc\/kvc-fleet\/dro\.env$/m);
  assert.match(serviceFile, /^EnvironmentFile=-\/etc\/kvc-fleet\/homebase\.env$/m);
});

test("local SQLite migration is repeatable and creates required indexes", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "kvc-fleet-"));
  const databasePath = path.join(temporaryDirectory, "fleet.db");
  const databaseUrl = `file:${databasePath.replaceAll("\\", "/")}`;

  try {
    const legacyClient = createClient({ url: databaseUrl });
    await legacyClient.execute(`CREATE TABLE team_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      name TEXT NOT NULL,
      nickname TEXT,
      phone_number TEXT NOT NULL,
      regular_route TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`);
    await legacyClient.execute("INSERT INTO team_members (name, phone_number, regular_route) VALUES ('Legacy Driver', '5555550100', '777')");
    await legacyClient.execute(`CREATE TABLE vehicles (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      number TEXT NOT NULL,
      route_number TEXT,
      make_model TEXT NOT NULL,
      year INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
    )`);
    await legacyClient.execute("INSERT INTO vehicles (number, route_number, make_model) VALUES ('V-LEGACY', '888', 'Legacy Truck')");
    await legacyClient.close();
    await runMigration(databaseUrl);
    await runMigration(databaseUrl);
    const client = createClient({ url: databaseUrl });
    const result = await client.execute(
      "SELECT name FROM sqlite_schema WHERE type IN ('table','index') ORDER BY name",
    );
    const names = new Set(result.rows.map(row => String(row.name)));
    for (const name of [
      "vehicles",
      "vehicle_models",
      "route_settings",
      "routes",
      "issues",
      "team_members",
      "homebase_user_mappings",
      "homebase_job_mappings",
      "homebase_shifts",
      "daily_assignments",
      "dro_snapshots",
      "dro_route_rows",
      "vehicles_number_unique",
      "vehicles_route_number_unique",
      "vehicle_models_name_unique",
      "idx_issues_vehicle_status",
      "routes_route_number_unique",
      "homebase_shifts_shift_unique",
      "daily_assignments_date_member_unique",
      "daily_assignments_date_route_unique",
      "dro_route_rows_snapshot_wa_unique",
      "dro_snapshots_operational_date_captured_at_idx",
    ]) assert.ok(names.has(name), `Missing ${name}`);
    const homebaseShiftColumns = await client.execute("PRAGMA table_info(homebase_shifts)");
    for (const column of ["employee_first_name", "employee_last_name", "confidence"]) {
      assert.ok(homebaseShiftColumns.rows.some(row => String(row.name) === column), `Missing homebase_shifts.${column}`);
    }
    const teamColumns = await client.execute("PRAGMA table_info(team_members)");
    assert.ok(
      teamColumns.rows.some(row => String(row.name) === "availability_days"),
      "Missing team_members.availability_days",
    );
    const scheduleColumns = await client.execute("PRAGMA table_info(schedule_entries)");
    assert.ok(scheduleColumns.rows.some(row => String(row.name) === "notes"), "Missing schedule_entries.notes");
    const routeSettings = await client.execute("SELECT route_number, color FROM route_settings ORDER BY route_number");
    assert.equal(routeSettings.rows.length, 18, "Expected every KVC route to have a color setting");
    assert.ok(routeSettings.rows.every(row => /^#[0-9A-F]{6}$/i.test(String(row.color))), "Route colors must use hex values");
    const routeRows = await client.execute("SELECT route_number FROM routes ORDER BY route_number");
    const registeredRoutes = new Set(routeRows.rows.map(row => String(row.route_number)));
    assert.ok(registeredRoutes.has("777"), "Expected a legacy team route to be backfilled");
    assert.ok(registeredRoutes.has("888"), "Expected a legacy vehicle route to be backfilled");
    await client.execute("INSERT INTO routes (route_number, display_name, color) VALUES ('JUMPER', 'Custom role', '#16A34A')");
    const customRole = await client.execute("SELECT route_number, display_name FROM routes WHERE route_number = 'JUMPER'");
    assert.equal(customRole.rows.length, 1, "Standalone custom roles must not require a vehicle assignment");
    assert.equal(customRole.rows[0].display_name, "Custom role");
    await assert.rejects(
      () => client.execute("INSERT INTO routes (route_number) VALUES ('613')"),
      /UNIQUE|constraint/i,
      "Route numbers must remain unique",
    );
    await client.close();
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
