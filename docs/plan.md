# Implementation Plan — MedLedger

**Scope:** What to build, in which order, and how each phase is verified. *How* things are designed lives in [design/](design/); how to run them lives in the [runbook](runbook.md); failures and fixes live in [troubleshooting](troubleshooting.md).
**Audience:** An implementing engineer or LLM coding agent.
**Target outcome:** A runnable, demonstrable Hyperledger Fabric network with a working fraud-prevention demo.

---

## Status

| Phase | Name | Milestone | Status | Commit |
|---|---|---|---|---|
| 0 | Environment and Scaffolding | M1 — Network live | ✅ Done | `d63fe85` |
| 1 | Cryptographic Material and Organizations | M1 | ✅ Done | `501e3a1` |
| 2 | Network Bring-Up | M1 | ✅ Done | `badf573` |
| 3 | Identity Enrollment | M1 | ✅ Done | `64667cf` |
| 4 | Chaincode Implementation | M2 — Contract working | ✅ Done | *(next commit)* |
| 5 | Chaincode Deployment | M2 | ⏳ Next | — |
| 6 | API Gateway | M3 — Application layer | — | — |
| 7 | Web UI | M3 | — | — |
| 8 | Demo Scenarios and Documentation | M4 — Demo ready | — | — |

Update this table when a phase's exit gate passes.

**Milestone outcomes:** M1 — five peers on a channel, identities enrolled · M2 — CLI issue + fulfill, fraud rules rejecting · M3 — working UI across three roles · M4 — eleven fraud scenarios, one-command startup.

## How to Use This Plan

- Each phase follows the same template: **Goal → Deliverables → Steps → Exit gate**. Steps say *what* to build and link to the design for the details.
- **Do not advance past a gate that has not passed.** Fabric failures compound badly: a misconfigured MSP at Phase 1 surfaces as an opaque endorsement error at Phase 5.
- Phases 0–3 are infrastructure. Phase 4 is where the business logic lives and deserves the most care. Phases 5–8 are deployment, application, and demo.
- This is a demo project: where a simpler approach does not weaken the fraud-prevention claim, prefer it.
- Every shell script (`network/scripts/*.sh`, `demo/*.sh`, `run-demo.sh`) must pass `shellcheck` with no warnings before a phase's exit gate counts as passed.
- Fabric terms (MSP, NodeOUs, SAN, anchor peer, …) are explained in the [glossary](glossary.md).

---

## Phase 0 — Environment and Scaffolding

**Goal:** A development machine with Fabric tooling, and a repository skeleton.

**Deliverables:** Repository tree per [docs/README.md](README.md#repository-structure); `chaincode/medledger/go.mod`; `api/package.json`; `web/package.json`; `.gitignore`.

**Steps:**
1. Install prerequisites, Fabric binaries and images, and CouchDB per the [runbook's Install section](runbook.md#install).
2. Create the repository structure as specified in [docs/README.md](README.md#repository-structure).
3. Initialize `chaincode/medledger/go.mod`, pinning the contract API to a release whose Go requirement `fabric-ccenv` can build ([Technology Stack and Versions](design/architecture.md#technology-stack-and-versions)):
   ```
   go mod init github.com/nithinvin/medledger/chaincode
   go get github.com/hyperledger/fabric-contract-api-go/v2@v2.2.1   # not @latest: v2.2.3 needs Go 1.26.7
   go mod edit -go=1.24.0 -toolchain=none
   ```
4. Initialize `api/package.json` and `web/package.json`.
5. `.gitignore` must cover the Fabric downloads (`/bin/`, `/builders/`, `/config/`, `/install-fabric.sh`), `node_modules/`, `network/organizations/`, `network/channel-artifacts/`, `*.tar.gz`, and `*.log`.

**Exit gate:**
- `peer version` reports 2.5.16
- `docker images | grep -E 'hyperledger|couchdb'` lists peer, orderer, ccenv, baseos, ca, and couchdb images
- Repository tree matches [docs/README.md](README.md#repository-structure)
- `git status` shows no Fabric binaries or images as untracked files

---

## Phase 1 — Cryptographic Material and Organizations

**Goal:** Static identities for five organizations plus the orderer org, and the channel's genesis block. Getting the MSP directory structure right here prevents most later failures.

**Deliverables:** `network/crypto-config.yaml`, `network/configtx.yaml`, `network/scripts/generateArtifacts.sh`.

**Steps:**
1. Write `network/crypto-config.yaml` defining five peer organizations (HospitalA, HospitalB, PharmacyX, PharmacyY, Regulator) and one orderer organization with three orderer nodes, using the [hostnames](design/architecture.md#organizations-and-hostnames). Set **`EnableNodeOUs: true`** on every organization — the `.peer` endorsement policy and the `client` user type depend on it ([Endorsement Policy](design/architecture.md#endorsement-policy)).
2. Generate crypto material with `cryptogen generate --config=./crypto-config.yaml --output=./organizations`. Each org's `ca/` directory becomes that org's Fabric CA signing root in Phase 2 ([Identity and CA Trust](design/architecture.md#identity-and-ca-trust)).
3. Verify each org produced `ca/` (CA cert + key) and `msp/` with `cacerts`, `tlscacerts`, and `config.yaml` (NodeOUs). With NodeOUs enabled, `admincerts/` directories are created but stay **empty** — that is expected; admin status comes from the `OU=admin` in the certificate.
4. Write `network/configtx.yaml`:
   - Five `Organizations` entries with `MSPDir` paths and `ID` values matching [Organizations and Hostnames](design/architecture.md#organizations-and-hostnames), each with `AnchorPeers` set to its `peer0` (no separate anchor-peer update needed)
   - `OrdererOrg` with Raft `EtcdRaft` consenters for all three orderers
   - **One** profile, `MedLedgerChannel`, containing both the `Orderer` and `Application` sections. No system-channel profile ([Channel Creation](design/architecture.md#channel-creation))
   - Capabilities: Channel `V2_0`, Orderer `V2_0`, Application `V2_5`
5. Generate the channel's genesis block:
   ```
   configtxgen -profile MedLedgerChannel -channelID prescription-channel \
     -outputBlock ./channel-artifacts/prescription-channel.block
   ```
6. Write `network/scripts/generateArtifacts.sh` wrapping steps 2 and 5 (idempotent: delete and regenerate).

**Exit gate:**
- `organizations/peerOrganizations/` contains five org directories, each with `msp/config.yaml`
- `channel-artifacts/prescription-channel.block` exists and is non-empty
- `configtxgen -inspectBlock channel-artifacts/prescription-channel.block` lists all five peer-org MSP IDs plus the orderer MSP

---

## Phase 2 — Network Bring-Up

**Goal:** 18 running containers and `prescription-channel` joined by all orderers and peers.

**Deliverables:** `network/docker-compose.yaml`; `network/scripts/common.sh`, `up.sh`, `down.sh`, `createChannel.sh`.

**Steps:**
1. Write `network/docker-compose.yaml` per [Deployment](design/architecture.md#deployment):
   - 3 orderer services (Raft) with `ORDERER_GENERAL_BOOTSTRAPMETHOD=none`, `ORDERER_CHANNELPARTICIPATION_ENABLED=true`, and admin listeners on 7053/8053/9053 (TLS)
   - 5 peer services with TLS enabled, each mounting `/var/run/docker.sock`; `CORE_PEER_LOCALMSPID`, `CORE_PEER_GOSSIP_EXTERNALENDPOINT` set; chaincode-as-external-service settings left at defaults
   - 5 CouchDB services (`couchdb:3.3.3`), each linked to its peer via `CORE_LEDGER_STATE_STATEDATABASE=CouchDB`
   - 5 Fabric CA services (`hyperledger/fabric-ca:1.5.22`), each mounting its org's cryptogen `ca/` directory and setting `FABRIC_CA_SERVER_CA_CERTFILE` / `FABRIC_CA_SERVER_CA_KEYFILE` to it
   - A shared `medledger` Docker network; every published port bound to `127.0.0.1`; `security_opt: [label=disable]` on every service
2. Put shared settings (org list, ports, MSP IDs, the `set_peer_env <org>` helper) in `network/scripts/common.sh`, sourced by every network script.
3. Write `network/scripts/up.sh` to bring up containers and wait for each to answer.
4. Write `network/scripts/down.sh` to tear down containers, prune chaincode containers and images (`dev-peer*`), and remove volumes.
5. Write `network/scripts/createChannel.sh`:
   - `osnadmin channel join` for each of the three orderers (mutual TLS with the orderer Admin certificate)
   - `peer channel join -b ./channel-artifacts/prescription-channel.block` for each of the five peers
   - Anchor peers are already in the genesis block (Phase 1 step 4)
6. Start the network and create the channel.

**Exit gate:**
- `docker ps` shows 18 running containers (3 orderers, 5 peers, 5 CouchDBs, 5 CAs)
- `osnadmin channel list` on each orderer shows `prescription-channel` with status `active`
- `peer channel list` from each of the five peers shows `prescription-channel`
- CouchDB UI reachable at each mapped port on `localhost`
- `down.sh && up.sh && createChannel.sh` completes cleanly from scratch

---

## Phase 3 — Identity Enrollment

**Goal:** The doctor, pharmacist, and regulator identities that chaincode authorizes against.

**Deliverables:** `network/scripts/enrollUsers.sh`; five enrolled user MSP directories.

**Steps:**
1. For each org's CA, enroll the CA bootstrap admin.
2. Register the [demo users](runbook.md#demo-accounts) with a **role attribute**, which is what chaincode reads:
   - HospitalA: `dr.smith` with `role=doctor`
   - HospitalB: `dr.patel` with `role=doctor`
   - PharmacyX: `pharm.jones` with `role=pharmacist`
   - PharmacyY: `pharm.lee` with `role=pharmacist`
   - Regulator: `auditor.gov` with `role=regulator`
3. Register each attribute with `:ecert` so it is embedded in the enrollment certificate, and use `--id.type client` so NodeOUs classify the identity as a client:
   ```
   fabric-ca-client register --id.name dr.smith --id.secret <pw> --id.type client \
     --id.attrs 'role=doctor:ecert' --tls.certfiles <ca-tls-cert>
   ```
4. Enroll each user into `organizations/peerOrganizations/<org>/users/<user>@<org>/msp`. Copy in the org's `msp/config.yaml` (NodeOUs) and replace `cacerts/` with the org's `msp/cacerts/` file — the same root, but under the filename `config.yaml` references.
5. Write `network/scripts/enrollUsers.sh` automating all of the above idempotently.
6. Verify attribute embedding — the attribute OID payload should contain `"role":"doctor"`:
   ```
   openssl x509 -in <signcert> -noout -text | grep -A2 "1.2.3.4.5.6.7.8.1"
   ```
7. Verify the user chains to the org root the channel trusts:
   ```
   openssl verify -CAfile organizations/peerOrganizations/<org>/msp/cacerts/*.pem <signcert>
   ```

**Exit gate:**
- Five user identities enrolled with MSP directories present
- `role` attribute confirmed present in each enrollment certificate
- `openssl verify` succeeds for each user against its org MSP's `cacerts`
- Each user is accepted by its org's peer (`peer channel getinfo` as that user)
- `enrollUsers.sh` runs cleanly against a freshly created network

---

## Phase 4 — Chaincode Implementation

**Goal:** All business and fraud logic, unit-tested before it touches the network. **This is the core phase.**

**Deliverables:** Everything under `chaincode/medledger/` — `models/`, `reference/`, `utils/`, `errs/`, `rules/`, `contracts/`, `main.go`, `internal/mock/` (test-only in-memory ledger), and `*_test.go`.

**Steps:**
1. Implement models, the embedded jurisdiction profile, and utilities per [Models, Reference Data, and Utilities](design/chaincode.md#models-reference-data-and-utilities).
2. Implement `PrescriptionContract` per [PrescriptionContract](design/chaincode.md#prescriptioncontract).
3. Implement `FulfillmentContract` per [FulfillmentContract](design/chaincode.md#fulfillmentcontract), in the exact [rule order](design/chaincode.md#fraud-rule-evaluation-order).
4. Implement `QueryContract` per [QueryContract](design/chaincode.md#querycontract).
5. Write table-driven Go tests with a mocked `ChaincodeStub` covering, at minimum:
   - Doctor issues successfully; pharmacist issuance rejected
   - Unknown drug code rejected
   - Missing or short salt rejected
   - Pharmacist fulfills successfully; doctor fulfillment rejected
   - Second fulfillment on zero-refill prescription rejected (R1)
   - `NDPS` drug with refills rejected at issuance (R6)
   - Expired prescription rejected (R3)
   - Quantity overrun rejected (R2)
   - Early refill at same pharmacy rejected (R4)
   - Early refill at a different pharmacy rejected (R7)
   - Revocation blocks subsequent fulfillment (R5); revocation by a same-named doctor from the other hospital rejected
   - Status derivation returns correct value for each of the five states
6. Determinism review — grep for forbidden patterns:
   ```
   grep -rn "time.Now()\|rand\.\|os.Getenv\|os.ReadFile\|math/rand\|GetQueryResult" chaincode/
   ```
   `GetQueryResult` is acceptable only inside read-only query functions, never in `IssuePrescription`, `RecordFulfillment`, or `RevokePrescription`. Reference data must come from `go:embed`, never `os.ReadFile`.

**Exit gate:**
- All unit tests pass; `gofmt`, `go vet`, `golangci-lint` clean (`CONSTITUTION.md` Quality Gates; commands in the [runbook](runbook.md#chaincode-development))
- `contractapi.NewChaincode` accepts every contract (metadata test), so deployment will not fail on signatures
- Determinism grep returns no violations in state-mutating functions
- Code review confirms `RecordFulfillment` never writes a `PRESC~` key

---

## Phase 5 — Chaincode Deployment

**Goal:** Chaincode committed on `prescription-channel` and proven end to end from the CLI.

**Deliverables:** `network/collections_config.json`, `network/scripts/deployChaincode.sh`.

**Steps:**
1. Write `network/collections_config.json` per [Private Data](design/chaincode.md#private-data).
2. Write `network/scripts/deployChaincode.sh` performing the Fabric 2.x lifecycle:
   - `go mod vendor` in `chaincode/medledger` — **required**: the peer's build container may have no network access ([D16](decisions.md)); a vendored build was verified offline in `fabric-ccenv:2.5.16` during Phase 4
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
     --transient '{"patientName":"<base64>","patientDOB":"<base64>","patientRef":"<base64>","salt":"<base64>"}'
   peer chaincode query ... -c '{"function":"GetPrescriptionStatus","Args":["<id>"]}'
   ```

**Exit gate:**
- Chaincode committed on `prescription-channel` at sequence 1
- CLI invoke of `IssuePrescription` commits successfully
- CLI query of `GetPrescriptionStatus` returns `ISSUED`
- CLI invoke of `RecordFulfillment` as a pharmacist commits
- Status now returns `FULLY_FULFILLED`
- `GetPrescriptionHistory` on the prescription key returns exactly **one** entry, proving the prescription record was never modified

---

## Phase 6 — API Gateway

**Goal:** A REST API that maps logged-in users to their Fabric identities and exposes the chaincode.

**Deliverables:** `api/src/` (`server.js`, `identities.js`, `gateway.js`, `middleware/auth.js`, `routes/*.js`), `api/test/`.

**Steps:**
1. Implement identity loading, per-org gateway connections, and JWT authentication per [API Gateway](design/application.md#api-gateway).
2. Implement every route in [API Routes](design/application.md#api-routes).
3. Implement [Error Mapping](design/application.md#error-mapping) and [Transient Data and Salt](design/application.md#transient-data-and-salt).
4. Write Jest tests for each route, including role-rejection cases.

**Exit gate:**
- All endpoints respond correctly against the live network
- A doctor JWT calling `POST /fulfillments` receives 403
- A pharmacist JWT calling `POST /prescriptions` receives 403
- Rule IDs surface in error responses
- `npm run lint` and `npm test` clean

---

## Phase 7 — Web UI

**Goal:** Role-specific views for doctor, pharmacist, and regulator.

**Deliverables:** `web/src/` (`App.jsx`, `views/*.jsx`).

**Steps:**
1. Implement the login screen and the three views per [Web UI](design/application.md#web-ui).

**Exit gate:**
- All three role views function end-to-end
- Attempting a cross-role action is visibly blocked with the rule reason displayed

---

## Phase 8 — Demo Scenarios and Documentation

**Goal:** A one-command demo and scripted fraud scenarios.

**Deliverables:** `demo/seed.sh`, `demo/fraud-scenarios.sh`, `run-demo.sh`, `README.md`.

**Steps:**
1. Write `demo/seed.sh` creating a baseline dataset: several prescriptions across both hospitals, mixed control classes, some already fulfilled.
2. Write `demo/fraud-scenarios.sh` executing each [demo scenario](runbook.md#demo-scenarios) and printing the outcome, formatted for live presentation.
3. Write `run-demo.sh` per [One-Command Startup](runbook.md#one-command-startup).
4. Update the root `README.md` quick start; mark the runbook's "Available after" notes as done.

**Exit gate:**
- All eleven scenarios produce their expected outcomes
- `run-demo.sh` takes a fresh checkout to a working demo (NFR-6, AC-11)
- `README.md` plus the runbook let a fresh machine reach a working demo

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Non-deterministic chaincode causes endorsement mismatch | Medium | High | Phase 4 determinism grep; use `GetTxTimestamp()` exclusively; reference data via `go:embed` |
| Role attribute missing from certificate | Medium | High | Phase 3 openssl verification before proceeding |
| Fabric CA users not trusted by channel | Medium | High | CA signs with cryptogen root ([Identity and CA Trust](design/architecture.md#identity-and-ca-trust)); Phase 3 `openssl verify` |
| `go.mod` newer than `fabric-ccenv` Go | Low | Medium | Pin contract API v2.2.1 / `go 1.24.0`; never `@latest` (Phase 0 step 3) |
| Endorsement policy misconfigured at approve time | Medium | Medium | `checkcommitreadiness` must show `true` for all five orgs |
| Private data not propagating | Low | Medium | Verify `requiredPeerCount` ≥ 1 and gossip endpoints set |
| Stale chaincode containers between runs | High | Low | `down.sh` prunes `dev-peer*` containers |
| Demo host resource exhaustion (18 containers + 5 chaincode) | Medium | Medium | 8 GB RAM available to Docker (WSL default on a 16 GB host is sufficient) |
| SELinux blocks bind mounts on a fresh openSUSE Leap 16 | Medium | Medium | `security_opt: [label=disable]` on every compose service |
| CRLF line endings break scripts on Windows checkouts | Low | Medium | `.gitattributes` forces LF; clone inside WSL filesystem |
| Scope creep into EHR integration | Medium | Medium | [Out of Scope](spec.md#out-of-scope) exclusions are binding |
