[CmdletBinding()]
param(
    [string] $ServerAddress = "10.10.10.105",
    [string] $RemoteUser = "root",
    [switch] $CheckOnly
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$projectRoot = Split-Path -Parent $PSScriptRoot
$packageFile = Join-Path $projectRoot "package.json"

if (-not (Test-Path -LiteralPath $packageFile -PathType Leaf)) {
    throw "Could not find package.json at $packageFile"
}

$requiredCommands = @("tar")
if (-not $CheckOnly) {
    $requiredCommands += @("ssh", "scp")
}

foreach ($commandName in $requiredCommands) {
    if (-not (Get-Command $commandName -ErrorAction SilentlyContinue)) {
        throw "Required command '$commandName' was not found."
    }
}

$temporaryRoot = [System.IO.Path]::GetTempPath()
$workingDirectory = Join-Path $temporaryRoot ("kvc-fleet-deploy-" + [guid]::NewGuid().ToString("N"))
$archivePath = Join-Path $workingDirectory "kvc-fleet-release.tar.gz"
$installerPath = Join-Path $workingDirectory "install-release.sh"

New-Item -ItemType Directory -Path $workingDirectory | Out-Null

$remoteInstaller = @'
#!/usr/bin/env bash
set -Eeuo pipefail

archive="${1:?Release archive path is required}"
app_dir="/opt/kvc-fleet/app"
data_dir="/var/lib/kvc-fleet"
backup_dir="/var/backups/kvc-fleet"
service_file="/etc/systemd/system/kvc-fleet.service"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
stage="/opt/kvc-fleet/.deploy-${stamp}"
previous_app="/opt/kvc-fleet/app.previous-${stamp}"
db_backup="${backup_dir}/fleet-${stamp}.db"
service_backup="${backup_dir}/kvc-fleet-${stamp}.service"
old_app_moved=0
had_database=0
had_service_file=0

cleanup() {
  rm -f -- "${archive}" "$0"
  if [[ -n "${stage}" && -d "${stage}" && "${stage}" == /opt/kvc-fleet/.deploy-* ]]; then
    rm -rf -- "${stage}"
  fi
}

rollback() {
  local failure_status="$1"
  trap - ERR
  set +e
  echo "Deployment failed; restoring the previous release." >&2

  if (( old_app_moved == 1 )); then
    systemctl stop kvc-fleet >/dev/null 2>&1
    if [[ -d "${app_dir}" ]]; then
      mv -- "${app_dir}" "/opt/kvc-fleet/app.failed-${stamp}"
    fi
    mv -- "${previous_app}" "${app_dir}"

    if (( had_database == 1 )) && [[ -f "${db_backup}" ]]; then
      cp -a -- "${db_backup}" "${data_dir}/fleet.db"
      chown kvcfleet:kvcfleet "${data_dir}/fleet.db"
    fi

    if (( had_service_file == 1 )) && [[ -f "${service_backup}" ]]; then
      cp -a -- "${service_backup}" "${service_file}"
    else
      rm -f -- "${service_file}"
    fi

    systemctl daemon-reload
    systemctl start kvc-fleet
  fi

  exit "${failure_status}"
}

trap cleanup EXIT
trap 'rollback $?' ERR

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Remote deployment must run as root." >&2
  exit 1
fi

command -v node >/dev/null
command -v npm >/dev/null
command -v systemctl >/dev/null
command -v curl >/dev/null

install -d -o kvcfleet -g kvcfleet -m 0750 "${data_dir}" "${backup_dir}"
mkdir -p -- "${stage}"
tar -xzf "${archive}" -C "${stage}"

test -f "${stage}/package.json"
test -f "${stage}/deploy/kvc-fleet.service"
chown -R kvcfleet:kvcfleet "${stage}"

echo "Installing dependencies and building the staged release..."
(
  cd "${stage}"
  runuser -u kvcfleet -- npm install --no-audit --no-fund
  # Keep the staged Vite build within the 2 GB LXC's available memory. This
  # affects only deployment compilation, never the production service.
  runuser -u kvcfleet -- env DATABASE_URL="file:${data_dir}/fleet.db" NODE_OPTIONS="--max-old-space-size=512" npm run build
  runuser -u kvcfleet -- npm prune --omit=dev
)

test -f "${stage}/dist/standalone/server.js"

echo "Backing up data and activating the new release..."
systemctl stop kvc-fleet

if [[ -f "${data_dir}/fleet.db" ]]; then
  had_database=1
  if command -v sqlite3 >/dev/null; then
    sqlite3 "${data_dir}/fleet.db" ".backup '${db_backup}'"
  else
    cp -a -- "${data_dir}/fleet.db" "${db_backup}"
  fi
fi

if [[ -f "${service_file}" ]]; then
  had_service_file=1
  cp -a -- "${service_file}" "${service_backup}"
fi

mv -- "${app_dir}" "${previous_app}"
old_app_moved=1
mv -- "${stage}" "${app_dir}"
stage=""

chown -R kvcfleet:kvcfleet "${app_dir}"
install -o root -g root -m 0644 "${app_dir}/deploy/kvc-fleet.service" "${service_file}"
systemctl daemon-reload

(
  cd "${app_dir}"
  runuser -u kvcfleet -- env DATABASE_URL="file:${data_dir}/fleet.db" npm run db:migrate
)

systemctl start kvc-fleet

healthy=0
for attempt in {1..20}; do
  if curl -fsS -o /dev/null http://127.0.0.1:3000/; then
    healthy=1
    break
  fi
  sleep 1
done

if (( healthy != 1 )); then
  echo "The service did not pass its health check." >&2
  journalctl -u kvc-fleet -n 50 --no-pager >&2
  false
fi

trap - ERR
echo "KVC Fleet deployed successfully."
echo "Database backup: ${db_backup}"
echo "Previous application: ${previous_app}"
systemctl --no-pager --full status kvc-fleet | sed -n '1,12p'
'@

try {
    Write-Host "Packaging KVC Fleet..."
    Push-Location $projectRoot
    try {
        $tarArguments = @(
            "-czf", $archivePath,
            "--exclude=./.git",
            "--exclude=./.next",
            "--exclude=./.openai",
            "--exclude=./.vinext",
            "--exclude=./data",
            "--exclude=./dist",
            "--exclude=./node_modules",
            "--exclude=./outputs",
            "."
        )
        & tar @tarArguments
        if ($LASTEXITCODE -ne 0) {
            throw "Could not create the release archive."
        }
    }
    finally {
        Pop-Location
    }

    $utf8WithoutBom = [System.Text.UTF8Encoding]::new($false)
    $normalizedInstaller = $remoteInstaller -replace "\r\n", "\n"
    [System.IO.File]::WriteAllText($installerPath, $normalizedInstaller, $utf8WithoutBom)

    if ($CheckOnly) {
        Write-Host "Deployment package validation passed. No files were uploaded."
        return
    }

    $remoteTarget = "${RemoteUser}@${ServerAddress}"
    $remoteToken = [guid]::NewGuid().ToString("N")
    $remoteArchivePath = "/tmp/kvc-fleet-${remoteToken}.tar.gz"
    $remoteInstallerPath = "/tmp/kvc-fleet-${remoteToken}.sh"
    $connectionOptions = @(
        "-o", "BatchMode=yes",
        "-o", "ConnectTimeout=10",
        "-o", "StrictHostKeyChecking=accept-new"
    )

    Write-Host "Checking SSH access to $remoteTarget..."
    & ssh @connectionOptions $remoteTarget "true"
    if ($LASTEXITCODE -ne 0) {
        throw "SSH authentication failed. Load your key with ssh-add and try again."
    }

    Write-Host "Uploading the release..."
    & scp @connectionOptions $archivePath "${remoteTarget}:${remoteArchivePath}"
    if ($LASTEXITCODE -ne 0) {
        throw "Could not upload the release archive."
    }

    & scp @connectionOptions $installerPath "${remoteTarget}:${remoteInstallerPath}"
    if ($LASTEXITCODE -ne 0) {
        throw "Could not upload the remote installer."
    }

    Write-Host "Deploying on the LXC..."
    $remoteCommand = "chmod 700 '${remoteInstallerPath}' && bash '${remoteInstallerPath}' '${remoteArchivePath}'"
    & ssh @connectionOptions $remoteTarget $remoteCommand
    if ($LASTEXITCODE -ne 0) {
        throw "The LXC deployment failed. Review the rollback message above."
    }

    Write-Host "Deployment complete."
}
finally {
    $resolvedTemporaryRoot = [System.IO.Path]::GetFullPath($temporaryRoot)
    $resolvedWorkingDirectory = [System.IO.Path]::GetFullPath($workingDirectory)
    if ($resolvedWorkingDirectory.StartsWith($resolvedTemporaryRoot, [System.StringComparison]::OrdinalIgnoreCase) -and
        (Test-Path -LiteralPath $resolvedWorkingDirectory)) {
        Remove-Item -LiteralPath $resolvedWorkingDirectory -Recurse -Force
    }
}
