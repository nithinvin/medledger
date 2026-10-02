#!/usr/bin/env bash
# down.sh — Phase 2 (docs/plan.md). Stop the network and delete its state:
# containers, ledger/CA/CouchDB volumes, and chaincode (dev-peer*) containers
# and images, which Compose does not manage and would otherwise serve stale
# chaincode on the next run.
#
# Crypto material and the channel block are kept; regenerate them with
# generateArtifacts.sh.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

require_tools docker

log "Stopping containers and removing volumes..."
docker compose -f "$COMPOSE_FILE" down --volumes --remove-orphans

mapfile -t cc_containers < <(docker ps -aq --filter name=dev-peer)
if (( ${#cc_containers[@]} )); then
  log "Removing ${#cc_containers[@]} chaincode container(s)..."
  docker rm -f "${cc_containers[@]}" >/dev/null
fi

mapfile -t cc_images < <(docker images -q --filter reference='dev-peer*')
if (( ${#cc_images[@]} )); then
  log "Removing ${#cc_images[@]} chaincode image(s)..."
  docker rmi -f "${cc_images[@]}" >/dev/null
fi

log "Network down."
