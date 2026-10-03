#!/usr/bin/env bash
# createChannel.sh — Phase 2 (docs/plan.md). Create prescription-channel with
# the channel participation API (docs/design/architecture.md#channel-creation):
#   1. osnadmin channel join  — each of the 3 orderers
#   2. peer channel join      — each of the 5 peers
# Anchor peers are already in the genesis block. Idempotent: members that
# already joined are skipped.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

require_tools osnadmin peer jq
require_artifacts

# Sets ADMIN_ARGS: connection flags for an orderer's admin API (mutual TLS).
set_admin_args() {
  local orderer="$1"
  ADMIN_ARGS=(
    -o "localhost:${ORDERER_ADMIN_PORT[$orderer]}"
    --ca-file "$ORDERER_TLS_CA"
    --client-cert "$ORDERER_ADMIN_TLS_DIR/client.crt"
    --client-key "$ORDERER_ADMIN_TLS_DIR/client.key"
  )
}

# Prints the orderer's status for the channel ("active", "onboarding", ...), or nothing if not joined.
orderer_status() {
  set_admin_args "$1"
  osnadmin channel list --channelID "$CHANNEL_NAME" "${ADMIN_ARGS[@]}" 2>/dev/null \
    | sed -n '/^{/,$p' | jq -r '.status // empty'
}

orderer_active() { [[ "$(orderer_status "$1")" == "active" ]]; }

for orderer in "${ORDERERS[@]}"; do
  if [[ -n "$(orderer_status "$orderer")" ]]; then
    log "$orderer already joined $CHANNEL_NAME"
    continue
  fi
  log "Joining $orderer to $CHANNEL_NAME..."
  set_admin_args "$orderer"
  osnadmin channel join --channelID "$CHANNEL_NAME" --config-block "$CHANNEL_BLOCK" "${ADMIN_ARGS[@]}" >/dev/null
done

# Raft needs a majority of consenters before the channel becomes active.
for orderer in "${ORDERERS[@]}"; do
  wait_for "$orderer to report $CHANNEL_NAME active" 60 orderer_active "$orderer"
done
log "All orderers active on $CHANNEL_NAME"

# Capture before grep -q: under pipefail an early grep exit can SIGPIPE the writer.
peer_joined() {
  local channels
  channels="$(peer channel list 2>/dev/null)" && grep -qx "$CHANNEL_NAME" <<<"$channels"
}

for org in "${PEER_ORGS[@]}"; do
  set_peer_env "$org"
  if peer_joined; then
    log "peer0.$org already joined $CHANNEL_NAME"
    continue
  fi
  log "Joining peer0.$org to $CHANNEL_NAME..."
  # The peer may still be starting; retry briefly.
  wait_for "peer0.$org to join" 30 peer channel join -b "$CHANNEL_BLOCK"
  peer_joined || die "peer0.$org did not join $CHANNEL_NAME"
done

log "Channel $CHANNEL_NAME ready: ${#ORDERERS[@]} orderers, ${#PEER_ORGS[@]} peers."
