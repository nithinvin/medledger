#!/usr/bin/env bash
# seed.sh — Phase 8 (docs/plan.md). Creates a baseline dataset through the
# API: prescriptions from both hospitals, every control class, and every
# status. Also records a 1-day prescription so fraud-scenarios.sh can show
# R3 (expired) live once a day has passed. Safe to rerun: adds new records.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

require_api
login_all
mkdir -p "$RUN_DIR"

log "Seeding demo prescriptions..."
morphine="$(issue dr.smith "Asha Rao" IN-MORPH-10 20 0 30)"
fulfill pharm.jones "$morphine" 20

cefixime="$(issue dr.smith "Vikram Iyer" IN-CEFX-200 10 2 90)"
fulfill pharm.lee "$cefixime" 10

amoxicillin="$(issue dr.patel "Meera Nair" IN-AMOX-500 21 3 60)"

paracetamol="$(issue dr.patel "Rahul Das" IN-PARA-500 10 5 30)"
fulfill pharm.jones "$paracetamol" 10
fulfill pharm.lee "$paracetamol" 10

methylphenidate="$(issue dr.patel "Kiran Shah" IN-MPH-10 30 0 30)"
api dr.patel POST "/prescriptions/$methylphenidate/revoke" '{"reason":"Dose changed; reissued"}'
[[ "$HTTP_STATUS" == 201 ]] || die "revoke failed ($HTTP_STATUS): $BODY"

aging="$(issue dr.smith "Neha Gupta" IN-AMOX-500 10 0 1)"

jq -n --arg seededAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg aging "$aging" \
  '{seededAt:$seededAt, expiringPrescription:$aging}' >"$SEED_STATE"

printf '\n%-38s %-12s %-26s %-20s %s\n' "PRESCRIPTION ID" "DOCTOR" "DRUG" "STATUS" "NOTE"
row() { printf '%-38s %-12s %-26s %-20s %s\n' "$1" "$2" "$3" "$(status_of "$1")" "$4"; }
row "$morphine" dr.smith "Morphine (NDPS)" "filled at PharmacyX"
row "$cefixime" dr.smith "Cefixime (Schedule H1)" "1 of 3 fills, PharmacyY"
row "$amoxicillin" dr.patel "Amoxicillin (Schedule H)" "not yet filled"
row "$paracetamol" dr.patel "Paracetamol (none)" "2 of 6 fills"
row "$methylphenidate" dr.patel "Methylphenidate (Sch. X)" "revoked by dr.patel"
row "$aging" dr.smith "Amoxicillin (Schedule H)" "valid 1 day — expires tomorrow (R3 demo)"
echo
log "OK: 6 prescriptions seeded. Look them up in the web UI by ID."
