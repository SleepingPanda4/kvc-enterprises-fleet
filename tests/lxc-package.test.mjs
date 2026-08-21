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
  await readFile(new URL("../dist/standalone/server.js", import.meta.url));
  assert.equal(packageJson.scripts.start, "node dist/standalone/server.js");
  assert.equal(packageJson.scripts["db:migrate"], "node scripts/migrate.mjs");
});

test("local SQLite migration is repeatable and creates required indexes", async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "kvc-fleet-"));
  const databasePath = path.join(temporaryDirectory, "fleet.db");
  const databaseUrl = `file:${databasePath.replaceAll("\\", "/")}`;

  try {
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
      "issues",
      "vehicles_number_unique",
      "vehicles_route_number_unique",
      "vehicle_models_name_unique",
      "idx_issues_vehicle_status",
    ]) assert.ok(names.has(name), `Missing ${name}`);
    await client.close();
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
