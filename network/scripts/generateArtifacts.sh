#!/usr/bin/env bash
# generateArtifacts.sh — Phase 1 (docs/plan.md).
#
# Regenerates, from scratch:
#   network/organizations/        cryptogen identities (orderers, peers, org admins, org CAs)
#   network/channel-artifacts/    prescription-channel genesis block
#
# Idempotent: deletes previous output first. Both directories are git-ignored
# because they contain private keys.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

PROFILE="MedLedgerChannel"
MSP_IDS=(OrdererMSP "${ORG_MSP[@]}")

require_tools cryptogen configtxgen

# Regenerating identities under running containers leaves them holding the old
# certificates while the disk has new ones — every later step then fails oddly.
if command -v docker >/dev/null && [[ -n "$(docker compose -f "$COMPOSE_FILE" ps -q 2>/dev/null)" ]]; then
  die "network is running — run network/scripts/down.sh first"
fi

cd "$NETWORK_DIR"

log "Removing previous artifacts..."
rm -rf organizations channel-artifacts

log "Generating crypto material with cryptogen..."
cryptogen generate --config=./crypto-config.yaml --output=./organizations

log "Generating ${CHANNEL_NAME} genesis block..."
mkdir -p channel-artifacts
FABRIC_CFG_PATH="$NETWORK_DIR" configtxgen \
  -profile "$PROFILE" \
  -channelID "$CHANNEL_NAME" \
  -outputBlock "./channel-artifacts/${CHANNEL_NAME}.block"

log "Verifying..."
fail=0
for org in "${PEER_ORGS[@]}"; do
  dir="organizations/peerOrganizations/${org}.example.com"
  for f in msp/config.yaml msp/cacerts msp/tlscacerts ca; do
    [[ -e "$dir/$f" ]] || { echo "  MISSING: $dir/$f" >&2; fail=1; }
  done
done
[[ -e organizations/ordererOrganizations/example.com/msp/config.yaml ]] \
  || { echo "  MISSING: orderer msp/config.yaml" >&2; fail=1; }

block="channel-artifacts/${CHANNEL_NAME}.block"
[[ -s "$block" ]] || { echo "  MISSING or empty: $block" >&2; fail=1; }
inspected="$(FABRIC_CFG_PATH="$NETWORK_DIR" configtxgen -inspectBlock "$block" 2>/dev/null)"
for msp in "${MSP_IDS[@]}"; do
  grep -q "\"$msp\"" <<<"$inspected" || { echo "  MSP ID not in block: $msp" >&2; fail=1; }
done

(( fail )) && die "verification failed"
log "OK: ${#PEER_ORGS[@]} peer orgs + orderer org generated; ${block} contains all ${#MSP_IDS[@]} MSP IDs."
