#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/kvc-fleet/app"
DATA_DIR="/var/lib/kvc-fleet"
BACKUP_DIR="/var/backups/kvc-fleet"
SERVICE_FILE="/etc/systemd/system/kvc-fleet.service"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this installer as root." >&2
  exit 1
fi

if [[ "$(pwd)" != "${APP_DIR}" ]]; then
  echo "Extract the archive into ${APP_DIR}, then run deploy/install.sh there." >&2
  exit 1
fi

command -v node >/dev/null || { echo "Node.js 22.13 or newer is required." >&2; exit 1; }
command -v npm >/dev/null || { echo "npm is required." >&2; exit 1; }

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
NODE_MINOR="$(node -p 'process.versions.node.split(".")[1]')"
if (( NODE_MAJOR < 22 || (NODE_MAJOR == 22 && NODE_MINOR < 13) )); then
  echo "Node.js 22.13 or newer is required; Node 24 LTS is recommended." >&2
  exit 1
fi

if ! id kvcfleet >/dev/null 2>&1; then
  useradd --system --home /opt/kvc-fleet --shell /usr/sbin/nologin kvcfleet
fi

install -d -o kvcfleet -g kvcfleet -m 0750 "${APP_DIR}" "${DATA_DIR}" "${BACKUP_DIR}"
chown -R kvcfleet:kvcfleet "${APP_DIR}"

runuser -u kvcfleet -- npm install --no-audit --no-fund
runuser -u kvcfleet -- env DATABASE_URL="file:${DATA_DIR}/fleet.db" npm run db:migrate
runuser -u kvcfleet -- npm run build
runuser -u kvcfleet -- npm prune --omit=dev

install -o root -g root -m 0644 deploy/kvc-fleet.service "${SERVICE_FILE}"
systemctl daemon-reload
systemctl enable --now kvc-fleet

echo "KVC Fleet is running on http://127.0.0.1:3000"
echo "Next: configure Caddy or a private tunnel before allowing remote access."
