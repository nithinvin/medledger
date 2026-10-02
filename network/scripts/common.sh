#!/usr/bin/env bash
# common.sh — shared settings for network scripts. Source it; do not execute.
#
#   source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
#   set_peer_env hospitala      # point the host `peer` CLI at peer0.hospitala as its Admin

# shellcheck disable=SC2034  # variables are used by the scripts that source this file

NETWORK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_DIR="$(dirname "$NETWORK_DIR")"
ORG_DIR="$NETWORK_DIR/organizations"
COMPOSE_FILE="$NETWORK_DIR/docker-compose.yaml"
CHANNEL_NAME="prescription-channel"
CHANNEL_BLOCK="$NETWORK_DIR/channel-artifacts/${CHANNEL_NAME}.block"

PEER_ORGS=(hospitala hospitalb pharmacyx pharmacyy regulator)
declare -A ORG_MSP=(
  [hospitala]=HospitalAMSP [hospitalb]=HospitalBMSP
  [pharmacyx]=PharmacyXMSP [pharmacyy]=PharmacyYMSP
  [regulator]=RegulatorMSP
)
declare -A PEER_PORT=(
  [hospitala]=7051 [hospitalb]=8051 [pharmacyx]=9051 [pharmacyy]=10051 [regulator]=11051
)
declare -A COUCHDB_PORT=(
  [hospitala]=5984 [hospitalb]=6984 [pharmacyx]=7984 [pharmacyy]=8984 [regulator]=9984
)
declare -A CA_PORT=(
  [hospitala]=7054 [hospitalb]=8054 [pharmacyx]=9054 [pharmacyy]=10054 [regulator]=11054
)

# Demo users (docs/runbook.md#demo-accounts): enrolled from each org's Fabric CA
# with a `role` attribute embedded in the certificate (Phase 3).
DEMO_USERS=(dr.smith dr.patel pharm.jones pharm.lee auditor.gov)
declare -A USER_ORG=(
  [dr.smith]=hospitala [dr.patel]=hospitalb
  [pharm.jones]=pharmacyx [pharm.lee]=pharmacyy
  [auditor.gov]=regulator
)
declare -A USER_ROLE=(
  [dr.smith]=doctor [dr.patel]=doctor
  [pharm.jones]=pharmacist [pharm.lee]=pharmacist
  [auditor.gov]=regulator
)

ORDERERS=(orderer1 orderer2 orderer3)
declare -A ORDERER_PORT=([orderer1]=7050 [orderer2]=8050 [orderer3]=9050)
declare -A ORDERER_ADMIN_PORT=([orderer1]=7053 [orderer2]=8053 [orderer3]=9053)
ORDERER_TLS_CA="$ORG_DIR/ordererOrganizations/example.com/tlsca/tlsca.example.com-cert.pem"
ORDERER_ADMIN_TLS_DIR="$ORG_DIR/ordererOrganizations/example.com/users/Admin@example.com/tls"

# Host-side Fabric CLIs: binaries from install-fabric.sh, core.yaml from its config/.
export PATH="$PATH:$REPO_DIR/bin"
export FABRIC_CFG_PATH="$REPO_DIR/config"

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

require_tools() {
  local tool
  for tool in "$@"; do
    command -v "$tool" >/dev/null || die "$tool not found (see docs/plan.md Phase 0)"
  done
}

require_artifacts() {
  [[ -d "$ORG_DIR" && -s "$CHANNEL_BLOCK" ]] \
    || die "crypto material or channel block missing — run network/scripts/generateArtifacts.sh"
}

# MSP directory of an org user: user_msp_dir <org> <user>  (user: Admin, dr.smith, ...)
user_msp_dir() {
  echo "$ORG_DIR/peerOrganizations/${1}.example.com/users/${2}@${1}.example.com/msp"
}

# Point the host `peer` CLI at an org's peer, acting as that org's Admin, or as
# a demo user when given: set_peer_env <org> [user]
set_peer_env() {
  local org="$1" user="${2:-Admin}"
  local org_path="$ORG_DIR/peerOrganizations/${org}.example.com"
  export CORE_PEER_TLS_ENABLED=true
  export CORE_PEER_LOCALMSPID="${ORG_MSP[$org]}"
  export CORE_PEER_TLS_ROOTCERT_FILE="$org_path/tlsca/tlsca.${org}.example.com-cert.pem"
  CORE_PEER_MSPCONFIGPATH="$(user_msp_dir "$org" "$user")"
  export CORE_PEER_MSPCONFIGPATH
  export CORE_PEER_ADDRESS="localhost:${PEER_PORT[$org]}"
}

# Poll a command until it succeeds or the timeout (seconds) expires.
wait_for() {
  local description="$1" timeout="$2"
  shift 2
  local waited=0
  until "$@" >/dev/null 2>&1; do
    (( waited >= timeout )) && die "timed out after ${timeout}s waiting for $description"
    sleep 2
    (( waited += 2 ))
  done
}
