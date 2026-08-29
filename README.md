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

Homebase collectors should call the service functions in
`services/integrations/homebase.ts`. User and job mappings use permanent
Homebase IDs, and shifts upsert by the unique Homebase shift ID. Assignment
names and notes are retained verbatim while recognized route numbers are linked
to the route registry.

DRO collectors should call `createDroSnapshot` in
`services/integrations/dro.ts`. Every collection creates a new parent snapshot
and child route rows; previous operational-day snapshots are never replaced.
Collector/browser automation and credentials intentionally remain outside this
application layer.

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
- `POST /api/internal/dro/snapshot` — bearer-authenticated snapshot ingestion
  for the external collector
