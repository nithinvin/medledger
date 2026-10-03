#!/usr/bin/env bash
# fraud-scenarios.sh — Phase 8 (docs/plan.md, docs/runbook.md#demo-scenarios).
# Runs each fraud attempt through the API and prints the outcome for a live
# presentation. Every scenario uses fresh prescriptions, so the script can be
# rerun at any time.
#
#   demo/fraud-scenarios.sh            run all scenarios
#   demo/fraud-scenarios.sh --pause    wait for Enter between scenarios
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

PAUSE=false
[[ "${1:-}" == "--pause" ]] && PAUSE=true

passed=0 failed=0 skipped=0
GREEN=$'\033[1;32m' RED=$'\033[1;31m' YELLOW=$'\033[1;33m' BOLD=$'\033[1m' RESET=$'\033[0m'

scenario() { # <number> <description>
  printf '\n%s[%s] %s%s\n' "$BOLD" "$1" "$2" "$RESET"
}

# expect_rejection <expected code> — checks the last api call.
expect_rejection() {
  local expected="$1" code message
  code="$(jq -r '.error // empty' <<<"$BODY" 2>/dev/null || true)"
  message="$(jq -r '.message // empty' <<<"$BODY" 2>/dev/null || true)"
  if [[ "$code" == "$expected" ]]; then
    printf '    %s✓ rejected: %s%s — %s\n' "$GREEN" "$code" "$RESET" "$message"
    passed=$((passed + 1))
  else
    printf '    %s✗ expected %s, got HTTP %s: %s%s\n' "$RED" "$expected" "$HTTP_STATUS" "$BODY" "$RESET"
    failed=$((failed + 1))
  fi
  pause
}

expect_true() { # <description> <condition-result: 0/1>
  if [[ "$2" == 0 ]]; then
    printf '    %s✓ %s%s\n' "$GREEN" "$1" "$RESET"
    passed=$((passed + 1))
  else
    printf '    %s✗ %s%s\n' "$RED" "$1" "$RESET"
    failed=$((failed + 1))
  fi
  pause
}

skip() {
  printf '    %s– skipped: %s%s\n' "$YELLOW" "$1" "$RESET"
  skipped=$((skipped + 1))
  pause
}

pause() {
  if $PAUSE; then
    read -r -p "    (Enter for next) " _
  fi
  return 0
}

qty() { jq -nc --argjson q "$1" '{quantityDispensed:$q}'; }

require_api
login_all
log "Running fraud scenarios against $API_URL"

scenario 1 "Pharmacist attempts to issue a prescription"
api pharm.jones POST /prescriptions "$(issue_body "Test Patient" IN-PARA-500 10 0 10)"
expect_rejection UNAUTHORIZED

rx="$(issue dr.smith "Asha Rao" IN-MORPH-10 20 0 30)"
scenario 2 "Doctor attempts to dispense"
api dr.smith POST "/prescriptions/$rx/fulfillments" "$(qty 20)"
expect_rejection UNAUTHORIZED

fulfill pharm.jones "$rx" 20
scenario 3 "Second dispense at the same pharmacy, zero refills"
api pharm.jones POST "/prescriptions/$rx/fulfillments" "$(qty 20)"
expect_rejection R1

scenario 4 "Dispense at PharmacyY after PharmacyX already dispensed, zero refills — PharmacyY never contacted PharmacyX"
api pharm.lee POST "/prescriptions/$rx/fulfillments" "$(qty 20)"
expect_rejection R1

h1="$(issue dr.smith "Vikram Iyer" IN-CEFX-200 10 2 90)"
fulfill pharm.jones "$h1" 10
scenario 5 "Refill at PharmacyY inside the 20-day Schedule H1 interval (pharmacy shopping)"
api pharm.lee POST "/prescriptions/$h1/fulfillments" "$(qty 10)"
expect_rejection R7

scenario 6 "Refill at the same pharmacy inside the refill interval"
api pharm.jones POST "/prescriptions/$h1/fulfillments" "$(qty 10)"
expect_rejection R4

scenario 7 "NDPS drug (morphine) issued with refills"
api dr.smith POST /prescriptions "$(issue_body "Kiran Shah" IN-MORPH-10 20 1 30)"
expect_rejection R6

scenario 8 "Dispense after the validity window"
expiring=""
[[ -f "$SEED_STATE" ]] && expiring="$(jq -r '.expiringPrescription // empty' "$SEED_STATE")"
if [[ -z "$expiring" ]]; then
  skip "no seeded 1-day prescription (run demo/seed.sh). R3 is proven by the chaincode unit tests (AC-8)."
else
  api auditor.gov GET "/prescriptions/$expiring"
  issued_at="$(jq -r .issuedAt <<<"$BODY")"
  if (($(date -u +%s) > $(date -u -d "$issued_at" +%s) + 86400)); then
    api pharm.jones POST "/prescriptions/$expiring/fulfillments" "$(qty 1)"
    expect_rejection R3
  else
    skip "the seeded 1-day prescription (issued $issued_at) has not expired yet — rerun after $(date -d "$issued_at + 1 day" '+%Y-%m-%d %H:%M'). R3 is proven by the chaincode unit tests (AC-8)."
  fi
fi

big="$(issue dr.patel "Meera Nair" IN-AMOX-500 21 3 60)"
scenario 9 "Dispense more than the prescribed quantity"
api pharm.lee POST "/prescriptions/$big/fulfillments" "$(qty 22)"
expect_rejection R2

revoked="$(issue dr.patel "Rahul Das" IN-MPH-10 30 0 30)"
api dr.patel POST "/prescriptions/$revoked/revoke" '{"reason":"Issued in error"}'
scenario 10 "Dispense after revocation"
api pharm.jones POST "/prescriptions/$revoked/fulfillments" "$(qty 30)"
expect_rejection R5

scenario 11 "Prescription history after fulfillment — the record was never modified"
api auditor.gov GET "/audit/$rx/history"
writes="$(jq '.entries | length' <<<"$BODY")"
endorsers="$(jq -r '.entries[0].endorsers | join(" + ")' <<<"$BODY")"
printf '    status %s, %s write(s) to the prescription record, endorsed by %s\n' "$(status_of "$rx")" "$writes" "$endorsers"
one_write=1
[[ "$writes" == 1 ]] && one_write=0
expect_true "exactly one write: status changed through separate fulfillment events" "$one_write"

scenario 12 "Regulator attempts to read patient data"
api auditor.gov GET "/prescriptions/$rx/patient"
expect_rejection UNAUTHORIZED

printf '\n%sResult:%s %s%d passed%s, %s%d failed%s, %s%d skipped%s\n' "$BOLD" "$RESET" \
  "$GREEN" "$passed" "$RESET" "$RED" "$failed" "$RESET" "$YELLOW" "$skipped" "$RESET"
((failed == 0)) || exit 1
