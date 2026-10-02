#!/usr/bin/env bash
# deployChaincode.sh — Phase 5 (docs/plan.md). Fabric 2.x chaincode lifecycle:
#   vendor → package → install (5 peers) → approve (5 orgs) → commit → verify.
#
# Idempotent: already-installed packages and existing approvals are skipped;
# an already-committed definition at the requested sequence ends the run.
#
# Upgrades: rerun with a new version and the next sequence, e.g.
#   CC_VERSION=1.1 CC_SEQUENCE=2 network/scripts/deployChaincode.sh
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

require_tools peer go jq
require_artifacts

CC_VERSION="${CC_VERSION:-1.0}"
CC_SEQUENCE="${CC_SEQUENCE:-1}"
CC_LABEL="${CC_NAME}_${CC_VERSION}"
CC_SRC="$REPO_DIR/chaincode/medledger"
BUILD_DIR="$NETWORK_DIR/channel-artifacts/chaincode"
CC_PACKAGE="$BUILD_DIR/${CC_LABEL}.tar.gz"
COLLECTIONS_CONFIG="$NETWORK_DIR/collections_config.json"
# Hospital AND pharmacy must endorse every transaction (docs/design/architecture.md#endorsement-policy).
SIGNATURE_POLICY="AND(OR('HospitalAMSP.peer','HospitalBMSP.peer'),OR('PharmacyXMSP.peer','PharmacyYMSP.peer'))"

# Definition flags shared by approve, checkcommitreadiness, and commit; all
# five orgs must pass identical values or readiness stays false.
DEFINITION_ARGS=(
  --channelID "$CHANNEL_NAME" --name "$CC_NAME"
  --version "$CC_VERSION" --sequence "$CC_SEQUENCE"
  --signature-policy "$SIGNATURE_POLICY"
  --collections-config "$COLLECTIONS_CONFIG"
)

# --peerAddresses/--tlsRootCertFiles for every peer: commit needs a majority
# of orgs to endorse it (LifecycleEndorsement).
all_peer_args() {
  PEER_ARGS=()
  local org
  for org in "${PEER_ORGS[@]}"; do
    PEER_ARGS+=(--peerAddresses "localhost:${PEER_PORT[$org]}"
      --tlsRootCertFiles "$(peer_tls_ca "$org")")
  done
}

committed_sequence() {
  set_peer_env "${PEER_ORGS[0]}"
  peer lifecycle chaincode querycommitted --channelID "$CHANNEL_NAME" --name "$CC_NAME" --output json 2>/dev/null \
    | jq -r '.sequence // empty'
}

if [[ "$(committed_sequence)" == "$CC_SEQUENCE" ]]; then
  log "$CC_NAME sequence $CC_SEQUENCE is already committed on $CHANNEL_NAME — nothing to do"
  exit 0
fi

log "Vendoring Go modules into a build copy (offline peer build, decision D16)..."
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"
cp -r "$CC_SRC" "$BUILD_DIR/src"
(cd "$BUILD_DIR/src" && go mod vendor)

log "Packaging $CC_LABEL..."
peer lifecycle chaincode package "$CC_PACKAGE" --path "$BUILD_DIR/src" --lang golang --label "$CC_LABEL"
PACKAGE_ID="$(peer lifecycle chaincode calculatepackageid "$CC_PACKAGE")"
log "Package ID: $PACKAGE_ID"

for org in "${PEER_ORGS[@]}"; do
  set_peer_env "$org"
  if peer lifecycle chaincode queryinstalled --output json 2>/dev/null \
    | jq -e --arg id "$PACKAGE_ID" '.installed_chaincodes[]? | select(.package_id == $id)' >/dev/null; then
    log "peer0.$org: already installed"
    continue
  fi
  log "peer0.$org: installing (the peer compiles the chaincode; this takes a while)..."
  peer lifecycle chaincode install "$CC_PACKAGE"
done

approvals_json() {
  set_peer_env "${PEER_ORGS[0]}"
  peer lifecycle chaincode checkcommitreadiness "${DEFINITION_ARGS[@]}" --output json
}

approvals="$(approvals_json)"
for org in "${PEER_ORGS[@]}"; do
  msp="${ORG_MSP[$org]}"
  if [[ "$(jq -r --arg m "$msp" '.approvals[$m]' <<<"$approvals")" == "true" ]]; then
    log "$msp: already approved"
    continue
  fi
  log "$msp: approving definition (sequence $CC_SEQUENCE)..."
  set_peer_env "$org"
  peer lifecycle chaincode approveformyorg "${ORDERER_ARGS[@]}" "${DEFINITION_ARGS[@]}" \
    --package-id "$PACKAGE_ID" --waitForEvent
done

approvals="$(approvals_json)"
not_ready="$(jq -r '.approvals | to_entries[] | select(.value != true) | .key' <<<"$approvals")"
[[ -z "$not_ready" ]] || die "commit readiness false for: $not_ready"
log "All ${#PEER_ORGS[@]} orgs approved"

log "Committing $CC_NAME sequence $CC_SEQUENCE..."
all_peer_args
set_peer_env "${PEER_ORGS[0]}"
peer lifecycle chaincode commit "${ORDERER_ARGS[@]}" "${DEFINITION_ARGS[@]}" "${PEER_ARGS[@]}" --waitForEvent

for org in "${PEER_ORGS[@]}"; do
  set_peer_env "$org"
  seq="$(peer lifecycle chaincode querycommitted --channelID "$CHANNEL_NAME" --name "$CC_NAME" --output json | jq -r '.sequence')"
  [[ "$seq" == "$CC_SEQUENCE" ]] || die "peer0.$org reports sequence '$seq', expected $CC_SEQUENCE"
done
log "OK: $CC_NAME $CC_VERSION committed at sequence $CC_SEQUENCE; visible on all ${#PEER_ORGS[@]} peers."
