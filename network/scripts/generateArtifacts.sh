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

NETWORK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_DIR="$(dirname "$NETWORK_DIR")"
CHANNEL_NAME="prescription-channel"
PROFILE="MedLedgerChannel"
PEER_ORGS=(hospitala hospitalb pharmacyx pharmacyy regulator)
MSP_IDS=(OrdererMSP HospitalAMSP HospitalBMSP PharmacyXMSP PharmacyYMSP RegulatorMSP)

# Prefer binaries on PATH; fall back to the repo's install-fabric.sh output.
export PATH="$PATH:$REPO_DIR/bin"
for tool in cryptogen configtxgen; do
  command -v "$tool" >/dev/null || { echo "ERROR: $tool not found (run Phase 0 install)" >&2; exit 1; }
done

cd "$NETWORK_DIR"

echo "Removing previous artifacts..."
rm -rf organizations channel-artifacts

echo "Generating crypto material with cryptogen..."
cryptogen generate --config=./crypto-config.yaml --output=./organizations

echo "Generating ${CHANNEL_NAME} genesis block..."
mkdir -p channel-artifacts
FABRIC_CFG_PATH="$NETWORK_DIR" configtxgen \
  -profile "$PROFILE" \
  -channelID "$CHANNEL_NAME" \
  -outputBlock "./channel-artifacts/${CHANNEL_NAME}.block"

echo "Verifying..."
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

if (( fail )); then
  echo "Verification FAILED" >&2
  exit 1
fi
echo "OK: ${#PEER_ORGS[@]} peer orgs + orderer org generated; ${block} contains all ${#MSP_IDS[@]} MSP IDs."
