#!/usr/bin/env bash
# run-demo.sh — one-command MedLedger demo (docs/runbook.md#one-command-startup).
#
#   ./run-demo.sh         fresh network, users, chaincode, API, web UI, seed data
#   ./run-demo.sh stop    stop the API and web UI, and tear the network down
#
# The API and web UI run in the background; logs and PIDs go to demo/.run/.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$REPO_DIR/network/scripts/common.sh"
RUN_DIR="$REPO_DIR/demo/.run"
SCRIPTS="$REPO_DIR/network/scripts"
API_PORT=3000
WEB_PORT=5173

stop_servers() {
  local name pid
  for name in api web; do
    if [[ -f "$RUN_DIR/$name.pid" ]]; then
      pid="$(cat "$RUN_DIR/$name.pid")"
      # Started with setsid: the PID is the process-group leader; stop the whole group.
      kill -- "-$pid" 2>/dev/null || true
      rm -f "$RUN_DIR/$name.pid"
    fi
  done
}

port_in_use() { [[ -n "$(ss -ltnH "sport = :$1" 2>/dev/null)" ]]; }

# The subshell redirects its own output (so no process keeps this script's
# stdout open) and execs setsid, so $! is the server itself: a new process-
# group leader whose whole group stop_servers can kill.
start_server() { # <name> <dir> <command...>
  local name="$1" dir="$2"
  shift 2
  (cd "$dir" && exec setsid "$@") >"$RUN_DIR/$name.log" 2>&1 </dev/null &
  echo $! >"$RUN_DIR/$name.pid"
}

if [[ "${1:-}" == "stop" ]]; then
  log "Stopping API and web UI..."
  stop_servers
  "$SCRIPTS/down.sh"
  exit 0
fi

require_tools docker node npm curl jq ss setsid
mkdir -p "$RUN_DIR"
stop_servers
for port in "$API_PORT" "$WEB_PORT"; do
  port_in_use "$port" && die "port $port is in use — stop whatever is listening there (see docs/troubleshooting.md#web-ui)"
done
started=$(date +%s)

log "[1/8] Tearing down any previous network..."
"$SCRIPTS/down.sh"

log "[2/8] Generating crypto material and the channel genesis block..."
"$SCRIPTS/generateArtifacts.sh" >/dev/null

log "[3/8] Starting the Fabric network..."
"$SCRIPTS/up.sh" >/dev/null

log "[4/8] Creating the channel..."
"$SCRIPTS/createChannel.sh" >/dev/null

log "[5/8] Enrolling doctor, pharmacist, and regulator identities..."
"$SCRIPTS/enrollUsers.sh" >/dev/null

log "[6/8] Deploying the chaincode (each peer compiles it; ~2 minutes)..."
"$SCRIPTS/deployChaincode.sh" >/dev/null 2>&1

log "[7/8] Starting the API gateway and web UI..."
for dir in api web; do
  [[ -d "$REPO_DIR/$dir/node_modules" ]] || (cd "$REPO_DIR/$dir" && npm ci --silent)
done
# Fresh JWT secret per demo run: logins stay valid until the next run.
MEDLEDGER_JWT_SECRET="$(openssl rand -hex 32)" start_server api "$REPO_DIR/api" node src/server.js
start_server web "$REPO_DIR/web" npx vite
wait_for "the API on port $API_PORT" 60 curl -sf "http://127.0.0.1:$API_PORT/api/health"
wait_for "the web UI on port $WEB_PORT" 60 curl -sf "http://127.0.0.1:$WEB_PORT/"

log "[8/8] Seeding demo data..."
"$REPO_DIR/demo/seed.sh"

cat <<EOT

$(log "Demo ready in $(($(date +%s) - started))s")
  Web UI:     http://localhost:$WEB_PORT   (sign in with one click per demo account)
  API:        http://127.0.0.1:$API_PORT/api
  CouchDB:    http://localhost:5984/_utils (admin / adminpw)
  Scenarios:  demo/fraud-scenarios.sh [--pause]
  Logs:       demo/.run/api.log, demo/.run/web.log
  Stop:       ./run-demo.sh stop
EOT
