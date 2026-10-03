#!/usr/bin/env bash
# smokeTest.sh — Phase 5 exit gate (docs/plan.md). Exercises the committed
# chaincode end to end through the real network with the demo identities:
# issue → read from a pharmacy → fulfill → status → history = 1 entry, plus
# role, fraud-rule, and privacy rejections. Each run uses a fresh
# prescription ID, so it can be repeated.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

require_tools peer jq openssl curl base64

RX_ID="$(cat /proc/sys/kernel/random/uuid)"
PATIENT_NAME="Priya Sharma"
passed=0

pass() { log "  PASS: $*"; passed=$((passed + 1)); }
fail() { die "FAIL: $*"; }

b64() { printf '%s' "$1" | base64 -w0; }

# Endorsing peers for a transaction: --peerAddresses/--tlsRootCertFiles per org.
endorsers() {
  ENDORSER_ARGS=()
  local org
  for org in "$@"; do
    ENDORSER_ARGS+=(--peerAddresses "localhost:${PEER_PORT[$org]}" --tlsRootCertFiles "$(peer_tls_ca "$org")")
  done
}

# invoke <org> <user> <ctor-json> <endorser orgs...>  — prints peer output; returns its status.
invoke() {
  local org="$1" user="$2" ctor="$3"
  shift 3
  endorsers "$@"
  (
    set_peer_env "$org" "$user"
    peer chaincode invoke "${ORDERER_ARGS[@]}" -C "$CHANNEL_NAME" -n "$CC_NAME" \
      "${ENDORSER_ARGS[@]}" -c "$ctor" ${TRANSIENT:+--transient "$TRANSIENT"} --waitForEvent 2>&1
  )
}

# query <org> <user> <ctor-json>  — prints the result payload.
query() {
  local org="$1" user="$2" ctor="$3"
  (
    set_peer_env "$org" "$user"
    peer chaincode query -C "$CHANNEL_NAME" -n "$CC_NAME" -c "$ctor" 2>&1
  )
}

expect_rejected() { # <description> <expected code> <command...>
  local description="$1" code="$2" out
  shift 2
  if out="$("$@")"; then
    fail "$description: expected rejection with $code, but it succeeded"
  fi
  grep -q "${code}:" <<<"$out" || fail "$description: expected $code, got: $(grep -m1 -o 'Error:.*' <<<"$out")"
  pass "$description → rejected with $code"
}

log "Smoke test on $CHANNEL_NAME / $CC_NAME, prescription $RX_ID"

# 1. Issue: dr.smith (HospitalA); hospital AND pharmacy endorse; patient data via transient map.
TRANSIENT="$(jq -nc --arg n "$(b64 "$PATIENT_NAME")" --arg d "$(b64 1985-03-12)" \
  --arg r "$(b64 PT-4471)" --arg s "$(b64 "$(openssl rand -hex 32)")" \
  '{patientName:$n, patientDOB:$d, patientRef:$r, salt:$s}')"
ISSUE="{\"function\":\"IssuePrescription\",\"Args\":[\"$RX_ID\",\"IN-MORPH-10\",\"30\",\"1 tablet every 12 hours\",\"0\",\"30\"]}"
out="$(invoke hospitala dr.smith "$ISSUE" hospitala pharmacyx)" || fail "IssuePrescription: $out"
grep -q "status:200" <<<"$out" || fail "IssuePrescription: $out"
pass "dr.smith issued an NDPS prescription (AC-1)"
unset TRANSIENT

# 2. Cross-org visibility: read from PharmacyX's peer.
p="$(query pharmacyx pharm.jones "{\"function\":\"ReadPrescription\",\"Args\":[\"$RX_ID\"]}")" || fail "ReadPrescription: $p"
[[ "$(jq -r .doctorMSP <<<"$p")" == "HospitalAMSP" ]] || fail "ReadPrescription from PharmacyX: $p"
pass "PharmacyX peer reads the prescription issued at HospitalA"

STATUS="{\"function\":\"QueryContract:GetPrescriptionStatus\",\"Args\":[\"$RX_ID\"]}"
s="$(query pharmacyx pharm.jones "$STATUS")" || fail "GetPrescriptionStatus: $s"
[[ "$s" == "ISSUED" ]] || fail "status before fulfillment: $s"
pass "status is ISSUED"

# 3. Role separation (AC-2, AC-3).
TRANSIENT="$(jq -nc '{}')"
expect_rejected "pharmacist issuing" UNAUTHORIZED \
  invoke pharmacyx pharm.jones "{\"function\":\"IssuePrescription\",\"Args\":[\"$(cat /proc/sys/kernel/random/uuid)\",\"IN-PARA-500\",\"10\",\"x\",\"0\",\"10\"]}" hospitala pharmacyx
unset TRANSIENT
expect_rejected "doctor fulfilling" UNAUTHORIZED \
  invoke hospitala dr.smith "{\"function\":\"FulfillmentContract:RecordFulfillment\",\"Args\":[\"$RX_ID\",\"30\"]}" hospitala pharmacyx

# 4. Fulfill at PharmacyX.
FULFILL="{\"function\":\"FulfillmentContract:RecordFulfillment\",\"Args\":[\"$RX_ID\",\"30\"]}"
out="$(invoke pharmacyx pharm.jones "$FULFILL" pharmacyx hospitala)" || fail "RecordFulfillment: $out"
pass "pharm.jones fulfilled at PharmacyX"

s="$(query hospitala dr.smith "$STATUS")" || fail "GetPrescriptionStatus: $s"
[[ "$s" == "FULLY_FULFILLED" ]] || fail "status after fulfillment: $s"
pass "status is FULLY_FULFILLED"

# 5. The key moment: PharmacyY never talked to PharmacyX, yet its own ledger rejects a second fill (AC-4/AC-5).
expect_rejected "second fill at PharmacyY" R1 \
  invoke pharmacyy pharm.lee "{\"function\":\"FulfillmentContract:RecordFulfillment\",\"Args\":[\"$RX_ID\",\"30\"]}" pharmacyy hospitalb

# 6. Immutability (AC-7, AC-9): exactly one write to the prescription key.
h="$(query regulator auditor.gov "{\"function\":\"QueryContract:GetPrescriptionHistory\",\"Args\":[\"$RX_ID\"]}")" || fail "GetPrescriptionHistory: $h"
[[ "$(jq length <<<"$h")" == "1" ]] || fail "history: $h"
[[ -n "$(jq -r '.[0].txId' <<<"$h")" ]] || fail "history entry has no txId: $h"
pass "regulator sees exactly 1 history entry (txId $(jq -r '.[0].txId' <<<"$h" | cut -c1-12)…) — status changed, record never touched"

# 7. Privacy (AC-10).
pd="$(query pharmacyx pharm.jones "{\"function\":\"ReadPatientData\",\"Args\":[\"$RX_ID\"]}")" || fail "ReadPatientData at PharmacyX: $pd"
[[ "$(jq -r .patientName <<<"$pd")" == "$PATIENT_NAME" ]] || fail "ReadPatientData at PharmacyX: $pd"
pass "pharmacist reads patient data from the private collection"

if out="$(query regulator auditor.gov "{\"function\":\"ReadPatientData\",\"Args\":[\"$RX_ID\"]}")"; then
  fail "regulator read patient data: $out"
fi
pass "regulator cannot read patient data"

db="${CHANNEL_NAME}_${CC_NAME}"
regulator_docs() { curl -sf -u admin:adminpw "http://127.0.0.1:${COUCHDB_PORT[regulator]}/${db}/_all_docs?include_docs=true"; }
# Capture before searching: under pipefail, `curl | grep -q` fails whenever
# grep exits on its first match before curl finishes writing (SIGPIPE).
regulator_has_rx() {
  local docs
  docs="$(regulator_docs)" && grep -q "$RX_ID" <<<"$docs"
}
# --waitForEvent only waits for the submitting peer; the regulator's peer may
# commit the block a moment later (seconds after a cold restart).
wait_for "the regulator's peer to commit $RX_ID" 30 regulator_has_rx
docs="$(regulator_docs)" || fail "could not read the regulator's state database"
if grep -q "$PATIENT_NAME" <<<"$docs"; then
  fail "patient name found in the regulator's public state database"
fi
pass "patient name absent from the regulator's world state, though the prescription is there"

log "OK: smoke test passed ($passed checks)."
