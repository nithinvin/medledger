#!/usr/bin/env bash
# up.sh — Phase 2 (docs/plan.md). Start the 18 network containers and wait
# until every orderer, peer, CA, and CouchDB answers on its published port.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

require_tools docker curl openssl
require_artifacts

log "Starting containers..."
docker compose -f "$COMPOSE_FILE" up -d

# A full TLS handshake, not a bare TCP connect: a connect-and-close makes
# Fabric log a misleading "TLS handshake failed" error.
tls_ready() { openssl s_client -connect "127.0.0.1:$1" </dev/null >/dev/null 2>&1; }

log "Waiting for services..."
for o in "${ORDERERS[@]}"; do
  wait_for "$o" 60 tls_ready "${ORDERER_PORT[$o]}"
  wait_for "$o admin API" 60 tls_ready "${ORDERER_ADMIN_PORT[$o]}"
done
for org in "${PEER_ORGS[@]}"; do
  wait_for "couchdb ($org)" 90 curl -sf "http://127.0.0.1:${COUCHDB_PORT[$org]}/_up"
  wait_for "peer0.$org" 60 tls_ready "${PEER_PORT[$org]}"
  # -k: readiness probe only; Phase 3 verifies the CA's TLS certificate properly
  wait_for "ca.$org" 60 curl -skf "https://127.0.0.1:${CA_PORT[$org]}/cainfo"
done

running="$(docker compose -f "$COMPOSE_FILE" ps --status running -q | wc -l)"
(( running == 18 )) || die "expected 18 running containers, found $running (see: docker compose -f $COMPOSE_FILE ps -a)"
log "Network up: $running containers running."
