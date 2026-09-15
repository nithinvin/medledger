# Implementation Plan — MedLedger

**Companion to:** `spec.md`, `design.md`
**Audience:** An implementing engineer or LLM coding agent
**Target outcome:** A runnable, demonstrable Hyperledger Fabric network with a working fraud-prevention demo

---

## How to Use This Plan

Each phase has entry criteria, concrete steps, and an exit gate. **Do not advance past a gate that has not passed.** Fabric failures compound badly: a misconfigured MSP at Phase 1 surfaces as an opaque endorsement error at Phase 5. Verify at each gate.

Phases 0–3 are infrastructure. Phase 4 is where the actual business logic lives and deserves the most care. Phases 5–7 are application and demo.

---

## Phase 0 — Environment and Scaffolding

**Entry:** Clean development machine.

### Steps

1. Install prerequisites:
   - Docker Engine 24+ and Docker Compose v2
   - Go 1.21+
   - Node.js 20 LTS
   - `jq`, `curl`, `git`
2. Download Fabric binaries and Docker images (version 2.5.x):
   ```
   curl -sSLO https://raw.githubusercontent.com/hyperledger/fabric/main/scripts/install-fabric.sh
   chmod +x install-fabric.sh
   ./install-fabric.sh --fabric-version 2.5.9 binary docker
   ```
3. Add `bin/` to `PATH`; confirm `peer version` and `fabric-ca-client version` respond.
4. Create the repository structure exactly as specified in `design.md` §9.
5. Initialize `chaincode/medledger/go.mod` with module path `github.com/<org>/medledger/chaincode`.
6. Initialize `api/package.json` and `web/package.json`.
7. Commit the skeleton with a `.gitignore` covering `node_modules/`, `network/organizations/`, `wallet/`, `*.log`.

### Exit gate
- `peer version` reports 2.5.x
- `docker images | grep hyperledger` lists peer, orderer, ccenv, ca, and couchdb images
- Repository tree matches `design.md` §9

---

## Phase 1 — Cryptographic Material and Organizations

**Entry:** Phase 0 gate passed.

This phase creates five organizations' identities. Getting MSP directory structure right here prevents most later failures.

### Steps

1. Write `network/crypto-config.yaml` defining five peer organizations (HospitalA, HospitalB, PharmacyX, PharmacyY, Regulator) and one orderer organization with three orderer nodes.
2. Generate crypto material:
   ```
   cryptogen generate --config=./crypto-config.yaml --output=./organizations
   ```
   *(Use `cryptogen` for the demo. Fabric CA is introduced in Phase 3 for runtime user enrollment; cryptogen handles the static network identities.)*
3. Verify each org produced `msp/` with `admincerts`, `cacerts`, `keystore`, `signcerts`, and `tlscacerts`.
4. Write `network/configtx.yaml`:
   - Define five `Organizations` entries with correct `MSPDir` paths and `ID` values matching `design.md` §2.1
   - Define `OrdererOrg` with Raft `EtcdRaft` consenters for all three orderers
   - Define profile `MedLedgerGenesis` (orderer genesis) and `MedLedgerChannel` (application channel with all five orgs)
   - Set channel capabilities to `V2_0`
5. Generate the genesis block and channel transaction:
   ```
   configtxgen -profile MedLedgerGenesis -channelID system-channel -outputBlock ./channel-artifacts/genesis.block
   configtxgen -profile MedLedgerChannel -outputCreateChannelTx ./channel-artifacts/prescription-channel.tx -channelID prescription-channel
   ```

### Common failure
MSP ID mismatch between `crypto-config.yaml` domain names and `configtx.yaml` `ID` fields. The `ID` in configtx must match exactly what chaincode will read from `ctx.GetClientIdentity().GetMSPID()` — e.g. `HospitalAMSP`.

### Exit gate
- `organizations/peerOrganizations/` contains five org directories
- `channel-artifacts/genesis.block` exists and is non-empty
- `configtxgen -inspectBlock` on the genesis block lists all five MSP IDs

---

## Phase 2 — Network Bring-Up

**Entry:** Phase 1 gate passed.

### Steps

1. Write `network/docker-compose.yaml` per `design.md` §8, containing:
   - 3 orderer services (Raft)
   - 5 peer services with TLS enabled
   - 5 CouchDB services, each linked to its peer via `CORE_LEDGER_STATE_STATEDATABASE=CouchDB`
   - 5 Fabric CA services
   - A shared `medledger` Docker network
2. Ensure each peer has correct environment: `CORE_PEER_LOCALMSPID`, `CORE_PEER_TLS_ENABLED=true`, `CORE_PEER_GOSSIP_EXTERNALENDPOINT`, and the chaincode-as-external-service settings left at defaults.
3. Write `network/scripts/up.sh` to bring up containers and wait for health.
4. Write `network/scripts/down.sh` to tear down containers, prune chaincode containers, and remove volumes.
5. Start the network; verify all containers reach running state.
6. Write `network/scripts/createChannel.sh`:
   - Create `prescription-channel` via `peer channel create`
   - Join all five peers to the channel
   - Set anchor peers for each organization
7. Execute channel creation.

### Exit gate
- `docker ps` shows 18 running containers (3 orderers, 5 peers, 5 CouchDBs, 5 CAs)
- `peer channel list` from each of the five peers shows `prescription-channel`
- CouchDB UI reachable at each mapped port
- `./scripts/down.sh && ./scripts/up.sh && ./scripts/createChannel.sh` completes cleanly from scratch

---

## Phase 3 — Identity Enrollment

**Entry:** Phase 2 gate passed.

Creates the actual doctor, pharmacist, and regulator identities that chaincode will authorize against.

### Steps

1. For each org's CA, enroll the CA admin.
2. Register users with a **role attribute**, which is what chaincode reads:
   - HospitalA: `dr.smith` with attribute `role=doctor`
   - HospitalB: `dr.patel` with attribute `role=doctor`
   - PharmacyX: `pharm.jones` with attribute `role=pharmacist`
   - PharmacyY: `pharm.lee` with attribute `role=pharmacist`
   - Regulator: `auditor.gov` with attribute `role=regulator`
3. Register each attribute with `:ecert` so it is embedded in the enrollment certificate:
   ```
   fabric-ca-client register --id.name dr.smith --id.secret <pw> --id.type client \
     --id.attrs 'role=doctor:ecert' --tls.certfiles <ca-cert>
   ```
4. Enroll each user, producing their MSP directory.
5. Write `network/scripts/enrollUsers.sh` automating all of the above idempotently.
6. Verify attribute embedding:
   ```
   openssl x509 -in <signcert> -noout -text | grep -A2 "1.2.3.4.5.6.7.8.1"
   ```
   The attribute OID payload should contain `"role":"doctor"`.

### Common failure
Omitting `:ecert` means the attribute is stored in the CA database but **not** in the certificate. `GetAttributeValue("role")` then returns empty, and every chaincode authorization check fails with a confusing "unauthorized" error. Verify with the openssl command above before proceeding.

### Exit gate
- Five user identities enrolled with MSP directories present
- `role` attribute confirmed present in each enrollment certificate
- `enrollUsers.sh` runs cleanly against a freshly created network

---

## Phase 4 — Chaincode Implementation

**Entry:** Phase 3 gate passed.

**This is the core phase.** All business and fraud logic lives here. Build it incrementally with unit tests before deploying to the network.

### 4.1 Models and Utilities

1. `models/prescription.go`, `models/fulfillment.go`, `models/revocation.go` — structs matching `spec.md` §7 with JSON tags.
2. `utils/keys.go` — composite key constructors:
   ```go
   func PrescriptionKey(ctx, id string) (string, error)   // PRESC~{id}
   func FulfillmentKey(ctx, presID string, seq int) (string, error)
   func RevocationKey(ctx, presID string) (string, error)
   ```
3. `utils/identity.go`:
   ```go
   func GetRole(ctx contractapi.TransactionContextInterface) (string, error)
   func GetCallerID(ctx contractapi.TransactionContextInterface) (string, error)
   func GetMSPID(ctx contractapi.TransactionContextInterface) (string, error)
   func RequireRole(ctx contractapi.TransactionContextInterface, role string) error
   ```
4. `utils/timestamp.go`:
   ```go
   func TxTime(ctx contractapi.TransactionContextInterface) (time.Time, error)
   ```
   **Must** use `ctx.GetStub().GetTxTimestamp()`. Never `time.Now()`.

### 4.2 Prescription Contract

1. `IssuePrescription`:
   - `RequireRole(ctx, "doctor")`
   - Reject if `prescriptionId` already exists
   - Validate `deaSchedule` is one of `II`–`V` or `NONE`
   - **Rule R6:** if `deaSchedule == "II"` and `refillsAllowed > 0` → reject
   - Validate `quantity > 0`, `validityDays > 0`
   - Read patient data from `ctx.GetStub().GetTransient()`, compute SHA-256, store hash on public record
   - `PutPrivateData("patientDataCollection", ...)` for the patient payload
   - `PutState` the public prescription record
   - Write doctor index key `DOCIDX~{doctorId}~{prescriptionId}`
2. `RevokePrescription`:
   - `RequireRole(ctx, "doctor")`
   - Verify caller ID matches the original `doctorId`
   - Reject if revocation already exists
   - Append revocation record — **never modify the prescription**
3. `ReadPrescription`, `ReadPatientData`.

### 4.3 Fulfillment Contract

1. `RecordFulfillment` — implement the exact rule order from `design.md` §4.5:
   - `RequireRole(ctx, "pharmacist")`
   - Load prescription; reject if absent
   - R5: reject if revocation record exists
   - R3: reject if `TxTime > issuedAt + validityDays`
   - R1: range-query `FULFILL~{presID}~`; reject if count ≥ `refillsAllowed + 1`
   - R2: reject if `quantityDispensed > quantity`
   - R4: reject if time since last fulfillment < minimum refill interval
   - R7: reject if an existing fulfillment is from a different `pharmacyMSP` within the early-refill window
   - Append fulfillment record at sequence = current count
   - **Assert in review: this function contains no `PutState` call targeting a `PRESC~` key**
2. `GetFulfillments` — deterministic partial composite key range query.

### 4.4 Query Contract

1. `GetPrescriptionStatus` — implement `design.md` §4.4 exactly, preserving evaluation order.
2. `GetPrescriptionHistory` — `GetHistoryForKey` on the prescription key; return transaction IDs, timestamps, and values.
3. `GetPrescriptionsByDoctor` — range query on `DOCIDX~{doctorId}~`.
4. `CheckFulfillmentEligibility` — read-only dry run of the R1–R7 chain, returning a structured reason rather than an error.

### 4.5 Unit Tests

Write table-driven Go tests with a mocked `ChaincodeStub` covering, at minimum:
- Doctor issues successfully; pharmacist issuance rejected
- Pharmacist fulfills successfully; doctor fulfillment rejected
- Second fulfillment on zero-refill prescription rejected
- Schedule II with refills rejected at issuance
- Expired prescription rejected
- Quantity overrun rejected
- Cross-pharmacy duplicate rejected
- Status derivation returns correct value for each of the five states
- Revocation blocks subsequent fulfillment

### 4.6 Determinism Review

Before deploying, grep the chaincode for forbidden patterns:
```
grep -rn "time.Now()\|rand\.\|os.Getenv\|math/rand\|GetQueryResult" chaincode/
```
`GetQueryResult` is acceptable only inside read-only query functions, never in `IssuePrescription`, `RecordFulfillment`, or `RevokePrescription`.

### Exit gate
- All unit tests pass
- Determinism grep returns no violations in state-mutating functions
- Code review confirms `RecordFulfillment` never writes a `PRESC~` key

---

## Phase 5 — Chaincode Deployment

**Entry:** Phase 4 gate passed.

### Steps

1. Write `network/collections_config.json` per `design.md` §7.
2. Write `network/scripts/deployChaincode.sh` performing the Fabric 2.x lifecycle:
   - `peer lifecycle chaincode package medledger.tar.gz --path ../chaincode/medledger --lang golang --label medledger_1.0`
   - `peer lifecycle chaincode install` on all five peers
   - `peer lifecycle chaincode queryinstalled` to capture the package ID
   - `peer lifecycle chaincode approveformyorg` for each of the five orgs, passing:
     - `--signature-policy "AND(OR('HospitalAMSP.peer','HospitalBMSP.peer'),OR('PharmacyXMSP.peer','PharmacyYMSP.peer'))"`
     - `--collections-config ./collections_config.json`
   - `peer lifecycle chaincode checkcommitreadiness` — all five must show `true`
   - `peer lifecycle chaincode commit` with `--peerAddresses` for all endorsing peers
3. Smoke test via CLI:
   ```
   peer chaincode invoke ... -c '{"function":"IssuePrescription","Args":[...]}' \
     --transient '{"patientName":"<base64>","patientDOB":"<base64>","patientRef":"<base64>"}'
   peer chaincode query ... -c '{"function":"GetPrescriptionStatus","Args":["<id>"]}'
   ```

### Common failures
| Symptom | Cause |
|---|---|
| `checkcommitreadiness` shows `false` for an org | That org's approve used different policy, collection config, or sequence number |
| `ENDORSEMENT_POLICY_FAILURE` at commit | `--peerAddresses` omitted a peer required by the policy |
| Empty private data on read | Transient map keys mismatched, or values not base64-encoded |
| `MVCC_READ_CONFLICT` | Two transactions writing the same key in one block — expected under concurrent load, retry |

### Exit gate
- Chaincode committed on `prescription-channel` at sequence 1
- CLI invoke of `IssuePrescription` commits successfully
- CLI query of `GetPrescriptionStatus` returns `ISSUED`
- CLI invoke of `RecordFulfillment` as a pharmacist commits
- Status now returns `FULLY_FULFILLED`
- `GetPrescriptionHistory` on the prescription key returns exactly **one** entry, proving the prescription record was never modified

---

## Phase 6 — API Gateway

**Entry:** Phase 5 gate passed.

### Steps

1. `api/src/wallet.js` — load the five enrolled identities from Phase 3 into a filesystem wallet.
2. `api/src/gateway.js` — connect using `@hyperledger/fabric-gateway`:
   - gRPC connection to a peer with TLS
   - Identity and signer from the wallet
   - Expose `submit(fn, args, transient)` and `evaluate(fn, args)` helpers
3. `api/src/middleware/auth.js` — map a login (username/password for the demo) to a wallet identity; issue a JWT carrying the identity label and role.
4. Routes:

| Method | Path | Role | Chaincode function |
|---|---|---|---|
| POST | `/api/auth/login` | — | — |
| POST | `/api/prescriptions` | doctor | `IssuePrescription` |
| GET | `/api/prescriptions/:id` | any | `ReadPrescription` |
| GET | `/api/prescriptions/:id/status` | any | `GetPrescriptionStatus` |
| GET | `/api/prescriptions/:id/patient` | doctor, pharmacist | `ReadPatientData` |
| GET | `/api/prescriptions/:id/eligibility` | pharmacist | `CheckFulfillmentEligibility` |
| POST | `/api/prescriptions/:id/fulfillments` | pharmacist | `RecordFulfillment` |
| GET | `/api/prescriptions/:id/fulfillments` | any | `GetFulfillments` |
| POST | `/api/prescriptions/:id/revoke` | doctor | `RevokePrescription` |
| GET | `/api/doctors/:id/prescriptions` | doctor | `GetPrescriptionsByDoctor` |
| GET | `/api/audit/:id/history` | regulator | `GetPrescriptionHistory` |

5. Error mapping: chaincode rejections carry the rule ID (e.g. `R1: fulfillment limit reached`). Map these to HTTP 403 with the rule ID in the response body so the UI can display which fraud rule fired.
6. Patient fields must be sent as **transient data**, base64-encoded, never as regular chaincode arguments.

### Exit gate
- All endpoints respond correctly against the live network
- A doctor JWT calling `POST /fulfillments` receives 403
- A pharmacist JWT calling `POST /prescriptions` receives 403
- Rule IDs surface in error responses

---

## Phase 7 — Web UI

**Entry:** Phase 6 gate passed.

### Steps

1. Login screen with five demo accounts selectable.
2. **Doctor view:** issue prescription form (patient fields, drug, schedule, quantity, refills, validity); list of own prescriptions with derived status badges; revoke action.
3. **Pharmacist view:** prescription lookup by ID; eligibility check panel showing pass/fail per rule R1–R7; dispense form enabled only when eligible; fulfillment history.
4. **Regulator view:** prescription lookup; full transaction history table with transaction IDs, timestamps, and committing org; patient fields shown as hash only, demonstrating private-data exclusion.
5. Status badge colors: `ISSUED` neutral, `PARTIALLY_FULFILLED` amber, `FULLY_FULFILLED` green, `EXPIRED` grey, `REVOKED` red.

### Exit gate
- All three role views function end-to-end
- Attempting a cross-role action is visibly blocked with the rule reason displayed

---

## Phase 8 — Demo Scenarios and Documentation

**Entry:** Phase 7 gate passed.

### Steps

1. Write `demo/seed.sh` creating a baseline dataset: several prescriptions across both hospitals, mixed schedules, some already fulfilled.
2. Write `demo/fraud-scenarios.sh` executing each fraud attempt and printing the rejection, formatted for live presentation:

| Scenario | Action | Expected |
|---|---|---|
| 1 | Pharmacist attempts issuance | Rejected: unauthorized role |
| 2 | Doctor attempts fulfillment | Rejected: unauthorized role |
| 3 | Second dispense at same pharmacy, zero refills | Rejected: R1 |
| 4 | **Dispense at PharmacyY after PharmacyX already dispensed** | Rejected: R1/R7 |
| 5 | Schedule II issued with refills | Rejected: R6 |
| 6 | Dispense after validity window | Rejected: R3 |
| 7 | Dispense more than prescribed quantity | Rejected: R2 |
| 8 | Dispense after revocation | Rejected: R5 |
| 9 | Prescription history after fulfillment | Exactly one entry — never mutated |
| 10 | Regulator reads patient name | Unavailable — private collection excludes regulator |

3. Write `README.md` with prerequisites, one-command startup, demo account table, and scenario walkthrough.

### Exit gate
- All ten scenarios produce their expected outcomes
- `README.md` allows a fresh machine to reach a working demo

---

## Deployment and Demo Runbook

### One-command startup

Create `run-demo.sh` at repository root:

```bash
#!/usr/bin/env bash
set -euo pipefail

echo "[1/7] Tearing down any previous network..."
(cd network && ./scripts/down.sh) || true

echo "[2/7] Generating crypto material and channel artifacts..."
(cd network && ./scripts/generateArtifacts.sh)

echo "[3/7] Starting Fabric network..."
(cd network && ./scripts/up.sh)

echo "[4/7] Creating channel and joining peers..."
(cd network && ./scripts/createChannel.sh)

echo "[5/7] Enrolling doctor, pharmacist, and regulator identities..."
(cd network && ./scripts/enrollUsers.sh)

echo "[6/7] Packaging and deploying chaincode..."
(cd network && ./scripts/deployChaincode.sh)

echo "[7/7] Starting API gateway and web UI..."
(cd api && npm ci && npm start &)
(cd web && npm ci && npm run dev &)

sleep 10
echo "Seeding demo data..."
./demo/seed.sh

echo ""
echo "Demo ready:"
echo "  Web UI:  http://localhost:5173"
echo "  API:     http://localhost:3000"
echo "  CouchDB: http://localhost:5984/_utils"
```

### Demo accounts

| Username | Org | Role |
|---|---|---|
| `dr.smith` | HospitalA | doctor |
| `dr.patel` | HospitalB | doctor |
| `pharm.jones` | PharmacyX | pharmacist |
| `pharm.lee` | PharmacyY | pharmacist |
| `auditor.gov` | Regulator | regulator |

### Suggested live demo sequence (8–10 minutes)

1. **Show the network** — `docker ps`, point out five independent peers each with its own ledger and CouchDB.
2. **Issue a prescription** as `dr.smith` for a Schedule II drug, zero refills.
3. **Show it on a pharmacy peer** — query from PharmacyX, proving cross-org visibility without any data transfer between hospital and pharmacy systems.
4. **Fulfill at PharmacyX** as `pharm.jones`. Status flips to `FULLY_FULFILLED`.
5. **The key moment** — attempt to fulfill the same prescription at PharmacyY as `pharm.lee`. Rejected. Explain that PharmacyY never contacted PharmacyX; it reached this conclusion from its own ledger copy, and HospitalA's peer independently agreed.
6. **Show immutability** — run the history query on the prescription. Exactly one entry. The status changed without the record ever being touched.
7. **Show role separation** — log in as `dr.smith`, attempt a dispense. Rejected by chaincode, not by the UI.
8. **Show privacy** — log in as `auditor.gov`, open the same prescription. Full audit trail visible; patient name is not.

### Teardown

```bash
(cd network && ./scripts/down.sh)
docker volume prune -f
docker rm -f $(docker ps -aq --filter name=dev-peer) 2>/dev/null || true
```

Chaincode containers (`dev-peer*`) survive a normal Compose teardown and will serve stale chaincode on the next run. Always prune them between iterations.

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Non-deterministic chaincode causes endorsement mismatch | Medium | High | Phase 4.6 determinism grep; use `GetTxTimestamp()` exclusively |
| Role attribute missing from certificate | Medium | High | Phase 3 openssl verification before proceeding |
| Endorsement policy misconfigured at approve time | Medium | Medium | `checkcommitreadiness` must show `true` for all five orgs |
| Private data not propagating | Low | Medium | Verify `requiredPeerCount` ≥ 1 and gossip endpoints set |
| Stale chaincode containers between runs | High | Low | Teardown prunes `dev-peer*` containers |
| Demo host resource exhaustion (18 containers) | Medium | Medium | Require 8 GB RAM minimum; document in README |
| Scope creep into EHR integration | Medium | Medium | `spec.md` §3.2 exclusions are binding |

---

## Suggested Milestones

| Milestone | Phases | Demonstrable outcome |
|---|---|---|
| M1 — Network live | 0–3 | Five peers on a channel, identities enrolled |
| M2 — Contract working | 4–5 | CLI issue + fulfill, fraud rules rejecting |
| M3 — Application layer | 6–7 | Working UI across three roles |
| M4 — Demo ready | 8 | Ten fraud scenarios, one-command startup |
