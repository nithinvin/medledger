#!/usr/bin/env bash
# lib.sh — helpers for the demo scripts, which drive the REST API (the same
# path as the web UI). Source it; do not execute.

# shellcheck disable=SC2034  # variables are used by the scripts that source this file

DEMO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DEMO_DIR/../network/scripts/common.sh"

RUN_DIR="$DEMO_DIR/.run"
SEED_STATE="$RUN_DIR/seed.json"
API_URL="${MEDLEDGER_API:-http://127.0.0.1:3000/api}"

declare -A TOKEN

require_api() {
  require_tools curl jq
  curl -sf "$API_URL/health" >/dev/null \
    || die "MedLedger API not reachable at $API_URL — start it (cd api && npm start) or use ./run-demo.sh"
}

login_all() {
  local user
  for user in "${DEMO_USERS[@]}"; do
    TOKEN[$user]="$(curl -sf "$API_URL/auth/login" -H 'Content-Type: application/json' \
      -d "$(jq -nc --arg u "$user" '{username:$u, password:($u + "pw")}')" | jq -r '.token // empty')"
    [[ -n "${TOKEN[$user]}" ]] || die "login failed for $user"
  done
}

# api <user> <METHOD> <path> [json-body] — sets HTTP_STATUS and BODY.
api() {
  local user="$1" method="$2" path="$3" data="${4:-}" out
  local args=(-s -w '\n%{http_code}' -X "$method" "$API_URL$path" -H "Authorization: Bearer ${TOKEN[$user]}")
  [[ -n "$data" ]] && args+=(-H 'Content-Type: application/json' -d "$data")
  out="$(curl "${args[@]}")" || die "request failed: $method $path"
  HTTP_STATUS="${out##*$'\n'}"
  BODY="${out%$'\n'*}"
}

# issue_body <patientName> <drugCode> <quantity> <refills> <validityDays>
issue_body() {
  jq -nc --arg n "$1" --arg d "$2" --argjson q "$3" --argjson r "$4" --argjson v "$5" \
    '{patientName:$n, patientDOB:"1985-03-12", patientRef:("PT-" + ($n | length | tostring)),
      drugCode:$d, quantity:$q, dosageInstructions:"As directed", refillsAllowed:$r, validityDays:$v}'
}

# issue <doctor> <patientName> <drugCode> <quantity> <refills> <validityDays> — prints the new ID.
issue() {
  local doctor="$1"
  shift
  api "$doctor" POST /prescriptions "$(issue_body "$@")"
  [[ "$HTTP_STATUS" == 201 ]] || die "issue failed ($HTTP_STATUS): $BODY"
  jq -r .prescriptionId <<<"$BODY"
}

# fulfill <pharmacist> <id> <quantity> — fails the script unless accepted.
fulfill() {
  api "$1" POST "/prescriptions/$2/fulfillments" "$(jq -nc --argjson q "$3" '{quantityDispensed:$q}')"
  [[ "$HTTP_STATUS" == 201 ]] || die "fulfill failed ($HTTP_STATUS): $BODY"
}

status_of() {
  api auditor.gov GET "/prescriptions/$1/status"
  jq -r .status <<<"$BODY"
}
