# Specification — MedLedger

**Project:** Prescription issuance and fulfillment tracking on a permissioned blockchain
**Platform:** Hyperledger Fabric
**Document status:** Baseline specification for implementation handoff
**Nature:** Demonstration project — simplify wherever it does not weaken the core fraud-prevention claim
**Terminology:** Fabric terms (MSP, NodeOUs, endorsement, channel, …) are explained in the [glossary](glossary.md)
**Related:** [design/](design/) · [plan](plan.md) · [doc map](README.md)

---

## Problem Statement

Controlled-drug prescriptions are vulnerable to several classes of fraud that existing record-keeping cannot reliably detect:

| Fraud type | Description | Why current systems miss it |
|---|---|---|
| Forged prescriptions | A prescription is fabricated or altered after issuance | No cryptographic binding between the prescription and the prescribing doctor |
| Doctor shopping | A patient obtains the same prescription from multiple prescribers | Hospital records are siloed; no cross-institution visibility |
| Phantom fulfillment | A pharmacy records a dispense that never happened, or double-dispenses | Pharmacy is the sole author of its own records |
| Post-hoc alteration | A record is edited after the fact to conceal wrongdoing | Mutable database rows leave no tamper evidence |

The deeper structural issue is **absence of mutual trust**. Competing hospital systems and pharmacy chains will not accept one another's server as the authoritative record. A solution must therefore be verifiable without requiring any participant to trust any other participant's infrastructure.

### Jurisdiction

Controlled-drug law differs by country. The chaincode is **jurisdiction-neutral**: it enforces limits attached to a generic *control class*, and the mapping from drugs to control classes and from classes to limits comes from a **jurisdiction profile** (a static reference file, see [Jurisdiction Profile](#jurisdiction-profile-compiled-into-chaincode)).

The demo ships with an **India** profile, reflecting the NDPS Act, 1985 (enforced by the Narcotics Control Bureau) and Schedules X, H1 and H of the Drugs and Cosmetics Rules, 1945 (regulated by CDSCO and state drug controllers). Another country, such as the US with DEA Schedules II–V, is supported by supplying a different profile — no chaincode logic changes.

> The India profile's drug classifications and limits are **illustrative demo data**, not legal guidance. Verify against current official lists before any real-world use.

---

## Objectives

### Primary Objectives

- **O1 — Non-forgeable issuance.** Every prescription is cryptographically signed by an identity provably issued by a registered hospital organization.
- **O2 — Tamper-evident history.** Once committed, no prescription or fulfillment record can be modified or deleted by any participant, including the organization that created it.
- **O3 — Cross-organization visibility.** A pharmacy can verify, before dispensing, whether a prescription has already been fulfilled anywhere in the network.
- **O4 — Distributed validation.** No single organization can unilaterally commit a record; validity requires independent agreement between organizations.
- **O5 — Role-separated authority.** Doctors may only issue; pharmacies may only record fulfillment. Neither can perform the other's action, and neither can mutate the other's records.

### Secondary Objectives

- **O6 — Patient data minimization.** Patient-identifying data is visible only to organizations with a legitimate need; the shared ledger carries only salted hash references.
- **O7 — Auditability.** A regulator role can reconstruct and verify the full history of any prescription.
- **O8 — Demonstrability.** The system must be runnable end-to-end on a single machine for demonstration purposes.

---

## Scope

### In Scope

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
| S12 | Jurisdiction profile (drug reference list + control-class limits); India profile as the default |

### Out of Scope

| ID | Excluded | Rationale |
|---|---|---|
| X1 | Regulatory e-prescription certification (e.g. India NDPS/CDSCO record-keeping compliance, US DEA EPCS) | Requires legal review, third-party audit, and formal identity proofing |
| X2 | Full data-protection compliance program (e.g. India DPDP Act 2023, US HIPAA) | Organizational/legal process, not a software deliverable |
| X3 | Integration with real hospital or pharmacy management systems | Requires vendor partnerships and HL7/FHIR interface work |
| X4 | Production key custody (HSM) | Demo uses key files on disk |
| X5 | Multi-host / cloud deployment | Single-host Compose is sufficient for demonstration |
| X6 | Patient-facing mobile application | Not required for the core fraud-prevention claim |
| X7 | HTTPS for the REST API and web UI | Demo is served on `http://localhost` only; all Fabric connections still use TLS |
| X8 | Live national drug databases | A static profile file is sufficient for the demo |
| X9 | Secret management for infrastructure credentials | CouchDB and Fabric CA bootstrap admins use fixed, well-known demo passwords (`admin`/`adminpw`); acceptable only because every port binds to `127.0.0.1` |

---

## Actors and Roles

| Actor | Organization type | Permitted actions |
|---|---|---|
| **Doctor** | Hospital | Issue prescription; revoke own prescription; query own issuance history; query prescription status |
| **Pharmacist** | Pharmacy | Query prescription and status; record fulfillment |
| **Regulator/Auditor** | Regulator | Read-only across all public records; retrieve full transaction history |
| **Network Administrator** | Any org | Enroll and register identities within own org; manage own peer |

**Authority separation rule (hard requirement):** A doctor identity invoking a fulfillment function must be rejected by chaincode. A pharmacist identity invoking an issuance function must be rejected by chaincode. Rejection occurs at endorsement time, before any ledger write.

**Identity uniqueness:** A person is identified by the pair *(MSP ID, certificate common name)*. A common name alone is not unique — `dr.smith` may exist at both hospitals.

---

## Functional Requirements

### FR-1 — Prescription Issuance
A doctor submits a prescription containing drug code, quantity, dosage instructions, refills allowed, and validity window. Chaincode validates the submitter's role and organization, rejects duplicate prescription IDs, looks up the drug code in the jurisdiction profile (rejecting unknown codes), copies the drug name and control class from the profile onto the record, enforces the control class's refill limit (R6), and writes an immutable record.

### FR-2 — Fulfillment Recording
A pharmacist submits a fulfillment referencing an existing prescription ID and the quantity dispensed. Chaincode validates role, verifies the prescription exists, evaluates all fraud rules (FR-4), and appends a fulfillment record. **Chaincode must not modify the prescription record.**

Each fulfillment is one *fill*. A prescription allows `refillsAllowed + 1` fills; each fill may dispense at most the prescribed `quantity`.

### FR-3 — Derived Status
Status is computed at query time from the prescription record plus all associated fulfillment and revocation records. Permitted values: `ISSUED`, `PARTIALLY_FULFILLED`, `FULLY_FULFILLED`, `EXPIRED`, `REVOKED`.

> **Design constraint (non-negotiable):** `status` must never exist as a stored, mutable field on the prescription record. The prescription is authored and signed by the doctor; a pharmacy cannot alter it without invalidating that authorship. Status is a projection over an append-only event stream, not a column.

### FR-4 — Fraud Rules
Enforced inside chaincode at endorsement time. "Refill interval" means the control class's `minRefillIntervalDays` from the [jurisdiction profile](#jurisdiction-profile-compiled-into-chaincode); an interval of 0 disables R4 and R7.

| Rule | Condition | Outcome |
|---|---|---|
| R1 Fill limit reached | Fulfillment count already equals `refillsAllowed + 1` | Reject |
| R2 Quantity overrun | `quantityDispensed` exceeds prescribed `quantity` (per fill) | Reject |
| R3 Expiry | Current time exceeds `issuedAt + validityDays` | Reject |
| R4 Early refill, same pharmacy | Last fulfillment was by the **same** pharmacy MSP, less than the refill interval ago | Reject, flag |
| R5 Revoked | Prescription has a revocation record | Reject |
| R6 Class refill limit | `refillsAllowed` exceeds the control class's `maxRefills` (e.g. 0 for NDPS drugs) | Reject at issuance |
| R7 Early refill, different pharmacy | Last fulfillment was by a **different** pharmacy MSP, less than the refill interval ago (pharmacy shopping) | Reject, flag |

R4 and R7 are mutually exclusive by construction (same vs. different pharmacy). Rules are evaluated in the order given in [Fraud Rule Evaluation Order](design/chaincode.md#fraud-rule-evaluation-order); the first failing rule is reported.

### FR-5 — Revocation
A doctor may append a revocation record for a prescription they issued (same MSP ID and common name as the issuer). The original record remains on the ledger unchanged; revocation is a separate appended event that the status derivation accounts for.

### FR-6 — Audit Query
A regulator identity may retrieve the complete history of any prescription: for each transaction touching its keys, the transaction ID, timestamp, and value written. For each transaction ID, the API can additionally show which organizations endorsed it (read from the block via the `qscc` system chaincode).

### FR-7 — Private Patient Data
Patient identifiers (name, date of birth, patient reference number) plus a random **salt** are written to a private data collection accessible only to hospital and pharmacy orgs. The public ledger stores only the SHA-256 hash of the private payload. The salt (at least 16 random bytes, generated by the API per prescription) prevents anyone holding only the hash — including the regulator — from recovering the patient by guessing name/DOB combinations.

### FR-8 — Jurisdiction Profile
The drug reference list and control-class limits are compiled into the chaincode package (not read from the peer's filesystem or environment), so every endorsing peer evaluates identical rules. Changing the profile is a chaincode upgrade, which requires approval by the channel's organizations — a governance property, not a limitation.

---

## Non-Functional Requirements

| ID | Requirement | Target |
|---|---|---|
| NFR-1 | Transaction commit latency | Under 5 seconds on demo hardware |
| NFR-2 | Query latency | Under 500 ms for status and history queries |
| NFR-3 | Endorsement policy | Requires signatures from at least one hospital org AND one pharmacy org |
| NFR-4 | Ledger immutability | No chaincode function may delete or overwrite a committed record |
| NFR-5 | Identity traceability | Every committed transaction resolves to a certificate and its issuing org |
| NFR-6 | Demo startup | Full network up from a clean checkout via a single script, under 10 minutes |
| NFR-7 | Determinism | Chaincode must produce identical read/write sets across endorsing peers (no wall-clock reads inside state-mutating logic; timestamps come from the transaction context) |
| NFR-8 | Demo hosts | Runs on openSUSE Leap 16.0 and on Ubuntu 24.04 under Windows 11 WSL2, with 8 GB RAM available to Docker |

> **NFR-7 is a common implementation trap.** Calling `time.Now()` inside chaincode produces different values on different endorsing peers, causing read/write set mismatch and transaction failure. Always use `ctx.GetStub().GetTxTimestamp()`.

---

## Data Specification

### Prescription (public ledger)

| Field | Type | Notes |
|---|---|---|
| `prescriptionId` | string (UUID) | Composite key: `PRESC~<uuid>` |
| `patientDataHash` | string | SHA-256 of the salted private collection payload |
| `doctorId` | string | Certificate common name |
| `doctorMSP` | string | Issuing organization MSP ID; `(doctorMSP, doctorId)` identifies the doctor |
| `drugCode` | string | Code from the jurisdiction profile |
| `drugName` | string | Copied from the profile at issuance |
| `controlClass` | string | Copied from the profile at issuance (India: `NDPS`, `SCHEDULE_X`, `SCHEDULE_H1`, `SCHEDULE_H`, `NONE`) |
| `quantity` | number | Units per fill |
| `dosageInstructions` | string | Free text |
| `refillsAllowed` | number | ≤ control class `maxRefills` |
| `validityDays` | number | Days from issuance |
| `issuedAt` | string (ISO-8601) | From transaction timestamp |
| `docType` | string | Literal `"prescription"` |

### Fulfillment (public ledger)

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

### Revocation (public ledger)

| Field | Type | Notes |
|---|---|---|
| `revocationId` | string | Composite key: `REVOKE~<prescriptionId>` |
| `prescriptionId` | string | Reference to prescription |
| `revokedBy` | string | Must match original `doctorId` |
| `revokedByMSP` | string | Must match original `doctorMSP` |
| `reason` | string | Free text |
| `revokedAt` | string (ISO-8601) | From transaction timestamp |
| `docType` | string | Literal `"revocation"` |

### PatientData (private data collection)

| Field | Type |
|---|---|
| `prescriptionId` | string |
| `patientName` | string |
| `patientDOB` | string |
| `patientRef` | string |
| `salt` | string (hex, ≥ 32 hex chars) |

Collection name: `patientDataCollection`. Members: hospital and pharmacy org MSPs. Not the ordering service, not the regulator by default.

### Jurisdiction Profile (compiled into chaincode)

**Control classes** — India profile (illustrative demo limits):

| `controlClass` | Legal basis (India) | `maxRefills` | `minRefillIntervalDays` |
|---|---|---|---|
| `NDPS` | Narcotic drugs & psychotropic substances, NDPS Act 1985 | 0 | 0 |
| `SCHEDULE_X` | Schedule X, Drugs and Cosmetics Rules 1945 | 0 | 0 |
| `SCHEDULE_H1` | Schedule H1 | 2 | 20 |
| `SCHEDULE_H` | Schedule H (prescription-only) | 5 | 15 |
| `NONE` | Not prescription-controlled | 11 | 0 |

**Drug reference list** — a small static list of entries `{drugCode, drugName, controlClass}`; the demo codes are local identifiers (e.g. `IN-MORPH-10`), not a national coding standard.

A US profile would instead define classes such as `DEA_II` (`maxRefills` 0) through `DEA_V`, with RxNorm/NDC drug codes.

---

## Acceptance Criteria

The implementation is complete when all of the following pass:

| # | Criterion |
|---|---|
| AC-1 | A doctor identity issues a prescription; it commits and is queryable from a pharmacy peer |
| AC-2 | A pharmacist identity attempting to issue a prescription is rejected by chaincode |
| AC-3 | A doctor identity attempting to record fulfillment is rejected by chaincode |
| AC-4 | A second fulfillment attempt on a zero-refill prescription is rejected (R1) |
| AC-5 | Cross-pharmacy duplicates are rejected: on a zero-refill prescription already filled at PharmacyX, a PharmacyY fill is rejected (R1); on a prescription with refills remaining, a PharmacyY fill inside the refill interval is rejected (R7) |
| AC-6 | Issuing an `NDPS`-class drug with `refillsAllowed > 0` is rejected (R6) |
| AC-7 | Status transitions `ISSUED` → `FULLY_FULFILLED` after fulfillment, without any prescription record mutation (verified by comparing the prescription's transaction history length, which must remain 1) |
| AC-8 | A prescription past its validity window returns `EXPIRED` and rejects fulfillment (R3) |
| AC-9 | The regulator retrieves complete transaction history including transaction IDs |
| AC-10 | Patient name is retrievable by hospital and pharmacy peers, and absent from the public ledger state |
| AC-11 | The full network starts from a clean checkout with one command |
| AC-12 | Chaincode contains no non-deterministic calls (verified by inspection and repeated endorsement) |
| AC-13 | Issuing a prescription with a drug code absent from the jurisdiction profile is rejected |

---

## Assumptions and Constraints

- All participating organizations are known and admitted at network-configuration time; this is a permissioned, not public, network.
- Drug validation uses the static [jurisdiction profile](#jurisdiction-profile-compiled-into-chaincode), not a live national drug database.
- Clock skew between organizations is handled by using transaction timestamps from the transaction proposal rather than local peer clocks.
- The demo runs on a single host; organizational separation is logical (separate MSPs, separate containers) rather than physical.
- The demo host is a developer workstation (openSUSE Leap 16.0, or Ubuntu 24.04 on WSL2); services are reachable on `localhost` only.
