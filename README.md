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

The application itself does not yet have user authentication. Do not expose
port 3000 directly to the internet. Place it behind a private VPN, Cloudflare
Access, or Caddy with authentication. `deploy/Caddyfile.example` is a starting
point. Generate its password hash with `caddy hash-password`, replace the
placeholder and domain, then validate and reload Caddy.

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

Stop the service, back up the database, replace the application files with the
new archive, and rerun `deploy/install.sh`. Application updates do not overwrite
the database in `/var/lib/kvc-fleet`.
