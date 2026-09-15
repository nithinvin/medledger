# Specification — MedLedger

**Project:** Prescription issuance and fulfillment tracking on a permissioned blockchain
**Platform:** Hyperledger Fabric
**Document status:** Baseline specification for implementation handoff

---

## 1. Problem Statement

Controlled-substance prescriptions are vulnerable to several classes of fraud that existing record-keeping cannot reliably detect:

| Fraud type | Description | Why current systems miss it |
|---|---|---|
| Forged prescriptions | A prescription is fabricated or altered after issuance | No cryptographic binding between the prescription and the prescribing doctor |
| Doctor shopping | A patient obtains the same prescription from multiple prescribers | Hospital records are siloed; no cross-institution visibility |
| Phantom fulfillment | A pharmacy records a dispense that never happened, or double-dispenses | Pharmacy is the sole author of its own records |
| Post-hoc alteration | A record is edited after the fact to conceal wrongdoing | Mutable database rows leave no tamper evidence |

The deeper structural issue is **absence of mutual trust**. Competing hospital systems and pharmacy chains will not accept one another's server as the authoritative record. A solution must therefore be verifiable without requiring any participant to trust any other participant's infrastructure.

---

## 2. Objectives

### 2.1 Primary Objectives

- **O1 — Non-forgeable issuance.** Every prescription is cryptographically signed by an identity provably issued by a registered hospital organization.
- **O2 — Tamper-evident history.** Once committed, no prescription or fulfillment record can be modified or deleted by any participant, including the organization that created it.
- **O3 — Cross-organization visibility.** A pharmacy can verify, before dispensing, whether a prescription has already been fulfilled anywhere in the network.
- **O4 — Distributed validation.** No single organization can unilaterally commit a record; validity requires independent agreement between organizations.
- **O5 — Role-separated authority.** Doctors may only issue; pharmacies may only record fulfillment. Neither can perform the other's action, and neither can mutate the other's records.

### 2.2 Secondary Objectives

- **O6 — Patient data minimization.** Patient-identifying data is visible only to organizations with a legitimate need; the shared ledger carries only hash references.
- **O7 — Auditability.** A regulator role can reconstruct and verify the full history of any prescription.
- **O8 — Demonstrability.** The system must be runnable end-to-end on a single machine for demonstration purposes.

---

## 3. Scope

### 3.1 In Scope

| ID | Capability |
|---|---|
| S1 | Multi-organization Fabric network (2 hospitals, 2 pharmacies, 1 regulator) |
| S2 | Certificate-based identity issuance per organization via Fabric CA |
| S3 | Chaincode for prescription issuance |
| S4 | Chaincode for fulfillment recording |
| S5 | Chaincode-enforced fraud rules (duplicate fulfillment, refill limits, expiry, quantity bounds) |
| S6 | Derived status query (never a stored mutable field) |
| S7 | Full prescription history query for audit |
| S8 | REST API gateway exposing chaincode to client applications |
| S9 | Web UI with doctor, pharmacist, and regulator views |
| S10 | Private data collection for patient-identifying fields |
| S11 | Single-host Docker Compose deployment for demonstration |

### 3.2 Out of Scope

| ID | Excluded | Rationale |
|---|---|---|
| X1 | DEA EPCS certification | Requires third-party audit and IAL2/AAL2 identity proofing |
| X2 | Full HIPAA compliance program | Organizational/legal process, not a software deliverable |
| X3 | Integration with real EHR or pharmacy management systems | Requires vendor partnerships and HL7/FHIR interface work |
| X4 | Production key custody (HSM) | Demo uses filesystem wallets |
| X5 | Multi-host / cloud-native deployment | Single-host Compose is sufficient for demonstration |
| X6 | Patient-facing mobile application | Not required for the core fraud-prevention claim |

---

## 4. Actors and Roles

| Actor | Organization type | Permitted actions |
|---|---|---|
| **Doctor** | Hospital | Issue prescription; query own issuance history; query prescription status |
| **Pharmacist** | Pharmacy | Query prescription and status; record fulfillment |
| **Regulator/Auditor** | Regulator | Read-only across all records; retrieve full transaction history |
| **Network Administrator** | Any org | Enroll and register identities within own org; manage own peer |

**Authority separation rule (hard requirement):** A doctor identity invoking a fulfillment function must be rejected by chaincode. A pharmacist identity invoking an issuance function must be rejected by chaincode. Rejection occurs at endorsement time, before any ledger write.

---

## 5. Functional Requirements

### FR-1 — Prescription Issuance
A doctor submits a prescription containing drug code, quantity, dosage instructions, refills allowed, and validity window. Chaincode validates the submitter's role and organization, rejects duplicate prescription IDs, validates the drug code and controlled-substance schedule, and writes an immutable record.

### FR-2 — Fulfillment Recording
A pharmacist submits a fulfillment referencing an existing prescription ID and the quantity dispensed. Chaincode validates role, verifies the prescription exists, evaluates all fraud rules (FR-4), and appends a fulfillment record. **Chaincode must not modify the prescription record.**

### FR-3 — Derived Status
Status is computed at query time from the prescription record plus all associated fulfillment records. Permitted values: `ISSUED`, `PARTIALLY_FULFILLED`, `FULLY_FULFILLED`, `EXPIRED`, `REVOKED`.

> **Design constraint (non-negotiable):** `status` must never exist as a stored, mutable field on the prescription record. The prescription is authored and signed by the doctor; a pharmacy cannot alter it without invalidating that authorship. Status is a projection over an append-only event stream, not a column.

### FR-4 — Fraud Rules
Enforced inside chaincode at endorsement time:

| Rule | Condition | Outcome |
|---|---|---|
| R1 Duplicate fulfillment | Fulfillment count already equals `refillsAllowed + 1` | Reject |
| R2 Quantity overrun | `quantityDispensed` exceeds prescribed `quantity` | Reject |
| R3 Expiry | Current time exceeds `issuedAt + validityDays` | Reject |
| R4 Early refill | Time since last fulfillment is less than the minimum refill interval for the drug | Reject, flag |
| R5 Revoked | Prescription has a revocation record | Reject |
| R6 Schedule II refill | Drug is DEA Schedule II and `refillsAllowed > 0` | Reject at issuance |
| R7 Cross-pharmacy duplicate | A fulfillment for this prescription exists from a different pharmacy within the early-refill window | Reject, flag |

### FR-5 — Revocation
A doctor may append a revocation record for a prescription they issued. The original record remains on the ledger unchanged; revocation is a separate appended event that the status derivation accounts for.

### FR-6 — Audit Query
A regulator identity may retrieve the complete transaction history for any prescription ID, including every endorsement and the committing transaction ID.

### FR-7 — Private Patient Data
Patient identifiers (name, date of birth, patient reference number) are written to a private data collection accessible only to the issuing hospital org and pharmacy orgs. The public ledger stores only the SHA-256 hash of the private payload.

---

## 6. Non-Functional Requirements

| ID | Requirement | Target |
|---|---|---|
| NFR-1 | Transaction commit latency | Under 5 seconds on demo hardware |
| NFR-2 | Query latency | Under 500 ms for status and history queries |
| NFR-3 | Endorsement policy | Requires signatures from at least one hospital org AND one pharmacy org |
| NFR-4 | Ledger immutability | No chaincode function may delete or overwrite a committed record |
| NFR-5 | Identity traceability | Every committed transaction resolves to a certificate and its issuing org |
| NFR-6 | Demo startup | Full network up from a clean checkout via a single script, under 10 minutes |
| NFR-7 | Determinism | Chaincode must produce identical read/write sets across endorsing peers (no wall-clock reads inside state-mutating logic; timestamps come from the transaction context) |

> **NFR-7 is a common implementation trap.** Calling `new Date()` or `time.Now()` inside chaincode produces different values on different endorsing peers, causing read/write set mismatch and transaction failure. Always use `ctx.stub.getTxTimestamp()`.

---

## 7. Data Specification

### 7.1 Prescription (public ledger)

| Field | Type | Notes |
|---|---|---|
| `prescriptionId` | string (UUID) | Composite key: `PRESC~<uuid>` |
| `patientDataHash` | string | SHA-256 of the private collection payload |
| `doctorId` | string | Certificate common name |
| `doctorMSP` | string | Issuing organization MSP ID |
| `drugCode` | string | RxNorm or NDC code |
| `drugName` | string | Human-readable |
| `deaSchedule` | string | `II`–`V`, or `NONE` |
| `quantity` | number | Units prescribed |
| `dosageInstructions` | string | Free text |
| `refillsAllowed` | number | 0 for Schedule II |
| `validityDays` | number | Days from issuance |
| `issuedAt` | string (ISO-8601) | From transaction timestamp |
| `docType` | string | Literal `"prescription"` |

### 7.2 Fulfillment (public ledger)

| Field | Type | Notes |
|---|---|---|
| `fulfillmentId` | string | Composite key: `FULFILL~<prescriptionId>~<seq>` |
| `prescriptionId` | string | Reference to prescription |
| `pharmacistId` | string | Certificate common name |
| `pharmacyMSP` | string | Fulfilling organization MSP ID |
| `quantityDispensed` | number | Units dispensed |
| `fulfilledAt` | string (ISO-8601) | From transaction timestamp |
| `sequence` | number | 0-indexed fulfillment number |
| `docType` | string | Literal `"fulfillment"` |

### 7.3 Revocation (public ledger)

| Field | Type | Notes |
|---|---|---|
| `revocationId` | string | Composite key: `REVOKE~<prescriptionId>` |
| `prescriptionId` | string | Reference to prescription |
| `revokedBy` | string | Must match original `doctorId` |
| `reason` | string | Free text |
| `revokedAt` | string (ISO-8601) | From transaction timestamp |
| `docType` | string | Literal `"revocation"` |

### 7.4 PatientData (private data collection)

| Field | Type |
|---|---|
| `prescriptionId` | string |
| `patientName` | string |
| `patientDOB` | string |
| `patientRef` | string |

Collection name: `patientDataCollection`. Members: hospital and pharmacy org MSPs. Not the ordering service, not the regulator by default.

---

## 8. Acceptance Criteria

The implementation is complete when all of the following pass:

| # | Criterion |
|---|---|
| AC-1 | A doctor identity issues a prescription; it commits and is queryable from a pharmacy peer |
| AC-2 | A pharmacist identity attempting to issue a prescription is rejected by chaincode |
| AC-3 | A doctor identity attempting to record fulfillment is rejected by chaincode |
| AC-4 | A second fulfillment attempt on a zero-refill prescription is rejected (R1) |
| AC-5 | A fulfillment attempt from a second pharmacy on an already-fulfilled prescription is rejected (R7) |
| AC-6 | Issuing a Schedule II drug with `refillsAllowed > 0` is rejected (R6) |
| AC-7 | Status transitions `ISSUED` → `FULLY_FULFILLED` after fulfillment, without any prescription record mutation (verified by comparing the prescription's transaction history length, which must remain 1) |
| AC-8 | A prescription past its validity window returns `EXPIRED` and rejects fulfillment (R3) |
| AC-9 | The regulator retrieves complete transaction history including transaction IDs |
| AC-10 | Patient name is retrievable by hospital and pharmacy peers, and absent from the public ledger state |
| AC-11 | The full network starts from a clean checkout with one command |
| AC-12 | Chaincode contains no non-deterministic calls (verified by inspection and repeated endorsement) |

---

## 9. Assumptions and Constraints

- All participating organizations are known and admitted at network-configuration time; this is a permissioned, not public, network.
- Drug code validation uses a static local reference list for the demo, not a live RxNorm service.
- Clock skew between organizations is handled by using transaction timestamps from the ordering service rather than local peer clocks.
- The demo runs on a single host; organizational separation is logical (separate MSPs, separate containers) rather than physical.
