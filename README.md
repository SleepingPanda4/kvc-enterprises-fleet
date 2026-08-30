# KVC Fleet — LXC installation

This archive is the self-hosted edition of the KVC Enterprises fleet site. It
runs as a standalone Node.js service and stores its data in a local SQLite file.
It does not contain the records from the currently hosted Cloudflare D1
database; a new installation starts with an empty fleet.

## Requirements

- An unprivileged Debian 12 or Ubuntu 24.04 LXC
- Node.js 22.13 or newer (Node.js 24 LTS recommended)
- 2 CPU cores, 2 GB RAM, and 8 GB disk are sufficient for normal use
- Root access during installation

## Install

Install operating-system prerequisites:

```bash
apt update
apt install -y ca-certificates curl sqlite3 xz-utils
```

On an x86-64 LXC, install Node.js 24 LTS from the official binary:

```bash
cd /tmp
NODE_VERSION=24.19.0
curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz"
curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt"
grep " node-v${NODE_VERSION}-linux-x64.tar.xz$" SHASUMS256.txt | sha256sum -c -
tar -xJf "node-v${NODE_VERSION}-linux-x64.tar.xz"
cp -a "node-v${NODE_VERSION}-linux-x64"/{bin,include,lib,share} /usr/local/
node --version
npm --version
```

For an ARM64 LXC, replace `linux-x64` with `linux-arm64` in those commands.

Upload this archive to the LXC, then extract it:

```bash
mkdir -p /opt/kvc-fleet/app
tar -xzf /tmp/kvc-fleet-lxc.tar.gz \
  -C /opt/kvc-fleet/app --strip-components=1
cd /opt/kvc-fleet/app
chmod +x deploy/install.sh
./deploy/install.sh
```

Confirm the service is healthy:

```bash
systemctl status kvc-fleet
curl -I http://127.0.0.1:3000
journalctl -u kvc-fleet -n 100 --no-pager
```

## Remote access

The service listens on the LXC network interfaces. From another device on the
same private network, open `http://10.10.10.105:3000`.

The application requires an authenticated account for every operational page.
`deploy/Caddyfile.example` configures Caddy to terminate HTTPS for
`fleet.sleepingpandaind.com` and proxy to the local app. Keep port 3000 private;
only Caddy should be exposed to the internet.

## Data and backups

The database is stored at `/var/lib/kvc-fleet/fleet.db`. Back it up with the
SQLite online backup command:

```bash
mkdir -p /var/backups/kvc-fleet
sqlite3 /var/lib/kvc-fleet/fleet.db \
  ".backup '/var/backups/kvc-fleet/fleet-$(date +%F-%H%M).db'"
```

Database migrations run automatically before the service starts. To run them
manually:

```bash
cd /opt/kvc-fleet/app
sudo -u kvcfleet env DATABASE_URL=file:/var/lib/kvc-fleet/fleet.db npm run db:migrate
```

## Updating later

From Windows PowerShell, first make sure the SSH key is loaded in your agent:

```powershell
ssh-add -l
```

Then deploy the current project to the KVC Fleet LXC with one command:

```powershell
.\deploy\deploy-to-lxc.ps1
```

The script packages only the application source, connects to
`root@10.10.10.105` through your SSH agent, and builds the update in a staging
directory. Before switching releases, it stops the service and creates a
timestamped database backup in `/var/backups/kvc-fleet`. It automatically
restores the previous application and database if migration, startup, or the
health check fails.

To validate packaging locally without connecting to the LXC:

```powershell
.\deploy\deploy-to-lxc.ps1 -CheckOnly
```

To use a different server or SSH account:

```powershell
.\deploy\deploy-to-lxc.ps1 -ServerAddress 10.10.10.105 -RemoteUser root
```

## Homebase and DRO integration storage

The migration creates a canonical `routes` registry while retaining the
existing vehicle and team route columns for compatibility. Existing route
settings, vehicle assignments, and regular/Saturday/Sunday team routes are
backfilled automatically with `INSERT OR IGNORE`, so deployments are safe to
repeat.

The external Homebase collector submits a complete collected range to
`POST /api/internal/homebase/schedule`. Fleet Manager identifies people with
stable Homebase user IDs, initially auto-matches an exact normalized Team name,
and persists that mapping. Shifts upsert by Homebase shift ID, and shifts that
disappear from a later complete range are reconciled without deleting manual
Fleet assignment overrides.

The endpoint requires `Authorization: Bearer <token>` matching
`HOMEBASE_INGEST_TOKEN`. Store it in `/etc/kvc-fleet/homebase.env`; never place
the token, Homebase credentials, cookies, or browser profiles in this repository.
Recommended permissions are:

```bash
install -d -o root -g kvcfleet -m 0750 /etc/kvc-fleet
printf '%s\n' 'HOMEBASE_INGEST_TOKEN=replace-with-a-long-random-token' \
  > /etc/kvc-fleet/homebase.env
chown root:kvcfleet /etc/kvc-fleet/homebase.env
chmod 0640 /etc/kvc-fleet/homebase.env
systemctl restart kvc-fleet
```

Fleet Managers can use **Refetch Assignments** from the DRO page. This asks a
separate localhost-only Homebase collector control service to collect a fresh
schedule using its already-running authenticated Chrome/CDP session; Fleet
Manager never starts or restarts Chrome itself. The request includes the selected
operational date; the collector must return a range containing that day (normally
the current and next week). Configure the matching control token in the protected
same file:

```text
HOMEBASE_COLLECTOR_URL=http://127.0.0.1:3102/collect
HOMEBASE_COLLECTOR_TOKEN=the-same-secret-configured-in-the-external-collector
```

The external collector's `POST /collect` control endpoint must only listen on
`127.0.0.1`, require `Authorization: Bearer <HOMEBASE_COLLECTOR_TOKEN>`, reject
overlapping requests with `409` and `{"error":"collection_in_progress"}`, reuse
its persistent Homebase Chrome session, post the collected schedule to Fleet
Manager's existing internal ingestion endpoint, then return:

```json
{
  "ok": true,
  "rangeStart": "2026-08-24",
  "rangeEnd": "2026-08-30",
  "collectedAt": "2026-08-29T01:00:00.000Z",
  "imported": 0,
  "updated": 0,
  "unchanged": 0,
  "removed": 0,
  "dates": ["2026-08-29"],
  "routeAssignments": 0,
  "specialAssignments": 0
}
```

Fleet Manager exposes `POST /api/homebase/refresh` to Fleet Managers only. It
is a server-side proxy to that local control service and never sends tokens to
the browser. This operation refreshes Homebase staffing only; it never creates
or refreshes a DRO snapshot.

Manual **Refresh DRO** is available only from 8:00 PM through 11:59 PM Central
Time. The button and server endpoint both enforce this window; outside it the
endpoint returns `403` and does not call the collector.

Safe example request body:

```json
{
  "rangeStart": "2026-08-24",
  "rangeEnd": "2026-08-30",
  "collectedAt": "2026-08-23T23:15:00.000Z",
  "shifts": [
    {
      "homebaseShiftId": "fake-shift-1001",
      "homebaseUserId": "fake-user-2001",
      "homebaseJobId": "fake-job-621",
      "date": "2026-08-29",
      "employee": "JOSHUA EXAMPLE",
      "firstName": "JOSHUA",
      "lastName": "EXAMPLE",
      "startAt": "2026-08-29T13:00:00.000Z",
      "endAt": "2026-08-29T22:00:00.000Z",
      "assignment": "621",
      "route": "621",
      "type": "route",
      "confidence": "high",
      "note": "Safe fake example",
      "publishedStatus": "published"
    }
  ]
}
```

`homebaseJobId`, `firstName`, `lastName`, `route`, `type`, `confidence`, `note`,
and `publishedStatus` are optional. Stable shift/user IDs, date, employee,
timestamps, and raw assignment are required. A successful response reports
`imported`, `updated`, `unchanged`, `removed`, `dates`, `routeAssignments`, and
`specialAssignments`.

DRO operational dates are based on the capture time in `America/Chicago`.
Captures from 8:00 PM through 11:59:59 PM are assigned to the following calendar
day, so Saturday-evening preparation belongs to Sunday staffing. The capture
timestamp remains unchanged. The migration corrects existing snapshot date
indexes from their stored capture timestamps without changing snapshot IDs or
route-row history.

Snapshots stay immutable; the existing after-11-PM (through 11:59:59 PM)
deduplication may reuse the newest identical snapshot rather than creating
duplicate database rows. Capacity warnings are calculated from each route's
actual vehicle capacity and appear at 50% utilization or higher. Collector/browser
automation and credentials intentionally remain outside this application layer.

The external Playwright/PurpleID collector is not stored in this repository.
Configure that collector to run at `20:00`, `20:30`, `21:00`, `21:30`, `22:00`,
`22:30`, and `23:00` in `America/Chicago`. Each run must create a new immutable
snapshot; it must never update or replace an earlier collection. Do not copy
collector credentials, cookies, profiles, passwords, tokens, or browser state
into this repository.

The collector submits snapshots to `POST /api/internal/dro/snapshot` with an
`Authorization: Bearer <token>` header. Fleet Manager reads the matching
`DRO_INGEST_TOKEN` from `/etc/kvc-fleet/dro.env`; this endpoint deliberately
does not use an interactive user session. Cube usage, package totals, stop
totals, and capacity warnings are calculated by Fleet Manager rather than
trusted from collector-provided totals.

The systemd unit treats `/etc/kvc-fleet/dro.env` as an optional protected
environment file. Preserve every existing credential in that file and add or
update only the `DRO_INGEST_TOKEN` entry. The deployment package and deployment
script never copy that file. Recommended ownership and permissions are:

```bash
chown root:kvcfleet /etc/kvc-fleet/dro.env
chmod 0640 /etc/kvc-fleet/dro.env
systemctl daemon-reload
systemctl restart kvc-fleet
```

Authenticated read endpoints are available at:

- `GET /api/routes` — route registry with current vehicle plus available driver
  and latest DRO details
- `GET /api/homebase/assignments` — tomorrow's assignments; add
  `?date=YYYY-MM-DD` for a specific date
- `GET /api/dro/latest` — latest snapshot and all of its route rows
- `GET /api/dro/dates` — available operational dates with snapshot counts
- `GET /api/dro/date?date=YYYY-MM-DD` — snapshots plus previous/next available
  dates for an operational day
- `GET /api/dro/snapshot?id=123` — one immutable snapshot and its route rows
- `GET /api/dro/assignments?date=YYYY-MM-DD` — the effective daily staffing board
- `POST /api/dro/assignments/swap` — Fleet Manager assignment swap
- `POST /api/dro/assignments/reset` — reset one date to imported Homebase
- `POST /api/dro/assignments/restore` — restore one person to Homebase
- `POST /api/internal/dro/snapshot` — bearer-authenticated snapshot ingestion
- `POST /api/internal/homebase/schedule` — bearer-authenticated weekly schedule ingestion
  for the external collector
