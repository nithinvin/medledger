#!/usr/bin/env bash
# enrollUsers.sh — Phase 3 (docs/plan.md). Register and enroll the five demo
# users with each org's Fabric CA, then verify every certificate:
#   - carries the `role` attribute (registered with :ecert)
#   - is classified as a client by NodeOUs (OU=client)
#   - chains to the org root the channel trusts (CA signs with the cryptogen
#     root, docs/design/architecture.md#identity-and-ca-trust)
#   - is accepted by its org's peer (channel query as that user)
#
# Idempotent: registration is skipped when the identity already exists; users
# are always re-enrolled into a fresh MSP directory.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

require_tools fabric-ca-client openssl peer
require_artifacts

# Demo enrollment secret; acceptable only because CAs listen on localhost (spec X9).
user_secret() { echo "${1}pw"; }

ca_root_cert() { echo "$ORG_DIR/peerOrganizations/${1}.example.com/ca/ca.${1}.example.com-cert.pem"; }

# Run quietly; show the command's output only if it fails.
quiet() {
  local out
  if ! out="$("$@" 2>&1)"; then
    printf '%s\n' "$out" >&2
    return 1
  fi
}

# Common flags for talking to an org's CA: ca_args <org>
ca_args() {
  local org="$1"
  CA_ARGS=(--caname "ca-${org}" --tls.certfiles "$(ca_root_cert "$org")")
}

enroll_ca_admin() {
  local org="$1"
  local home="$ORG_DIR/fabric-ca/${org}/admin"
  rm -rf "$home"
  mkdir -p "$home"
  ca_args "$org"
  quiet fabric-ca-client enroll --home "$home" "${CA_ARGS[@]}" \
    -u "https://admin:adminpw@localhost:${CA_PORT[$org]}"
}

register_user() {
  local user="$1" org="${USER_ORG[$1]}"
  local admin_home="$ORG_DIR/fabric-ca/${org}/admin"
  ca_args "$org"
  if fabric-ca-client identity list --id "$user" --home "$admin_home" "${CA_ARGS[@]}" \
    -u "https://localhost:${CA_PORT[$org]}" >/dev/null 2>&1; then
    log "  $user already registered"
    return
  fi
  quiet fabric-ca-client register --home "$admin_home" "${CA_ARGS[@]}" \
    -u "https://localhost:${CA_PORT[$org]}" \
    --id.name "$user" --id.secret "$(user_secret "$user")" --id.type client \
    --id.attrs "role=${USER_ROLE[$user]}:ecert"
  log "  registered $user (role=${USER_ROLE[$user]})"
}

enroll_user() {
  local user="$1" org="${USER_ORG[$1]}"
  local msp home org_msp
  msp="$(user_msp_dir "$org" "$user")"
  home="$ORG_DIR/fabric-ca/${org}/${user}"
  org_msp="$ORG_DIR/peerOrganizations/${org}.example.com/msp"
  rm -rf "$(dirname "$msp")" "$home"
  mkdir -p "$home"
  ca_args "$org"
  quiet fabric-ca-client enroll --home "$home" "${CA_ARGS[@]}" -M "$msp" \
    -u "https://${user}:$(user_secret "$user")@localhost:${CA_PORT[$org]}"

  # NodeOUs: the org's config.yaml names cacerts/ca.<org>.example.com-cert.pem,
  # while enrollment saved the same root as cacerts/localhost-<port>-ca-<org>.pem.
  # Use the org's file so the local MSP loads its OU config without
  # "Failed loading ... OU certificate" warnings. (Peers classify identities
  # with the channel MSP, so this is hygiene, not a correctness fix.)
  rm -f "$msp"/cacerts/*
  cp "$org_msp"/cacerts/* "$msp/cacerts/"
  cp "$org_msp/config.yaml" "$msp/config.yaml"
  log "  enrolled $user -> ${msp#"$REPO_DIR"/}"
}

verify_user() {
  local user="$1" org="${USER_ORG[$1]}" role="${USER_ROLE[$1]}"
  local cert org_msp
  cert="$(user_msp_dir "$org" "$user")/signcerts/cert.pem"
  org_msp="$ORG_DIR/peerOrganizations/${org}.example.com/msp"

  # Capture before grep -q: under pipefail an early grep exit can SIGPIPE openssl.
  local text subject
  text="$(openssl x509 -in "$cert" -noout -text)" || die "$user: cannot read $cert"
  subject="$(openssl x509 -in "$cert" -noout -subject)" || die "$user: cannot read $cert"
  grep -q "\"role\":\"${role}\"" <<<"$text" \
    || die "$user: role=${role} attribute missing from certificate (registered without :ecert?)"
  grep -q "OU *= *client" <<<"$subject" || die "$user: certificate is not OU=client"
  openssl verify -CAfile "$org_msp"/cacerts/*.pem "$cert" >/dev/null \
    || die "$user: certificate does not chain to the ${ORG_MSP[$org]} root"
  ( set_peer_env "$org" "$user" && quiet peer channel getinfo -c "$CHANNEL_NAME" ) \
    || die "$user: rejected by peer0.$org (channel query as this user failed)"
  log "  verified $user: role=${role}, OU=client, chains to ${ORG_MSP[$org]}, accepted by peer0.$org"
}

log "Enrolling CA admins..."
for org in "${PEER_ORGS[@]}"; do
  enroll_ca_admin "$org"
done

log "Registering and enrolling demo users..."
for user in "${DEMO_USERS[@]}"; do
  register_user "$user"
  enroll_user "$user"
done

log "Verifying..."
for user in "${DEMO_USERS[@]}"; do
  verify_user "$user"
done

log "OK: ${#DEMO_USERS[@]} demo users enrolled and verified."
