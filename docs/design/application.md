# Application Design — MedLedger

**Scope:** REST API gateway (identities, Fabric connections, authentication, routes, error mapping) and web UI views.
**Related:** [architecture.md](architecture.md) · [chaincode.md](chaincode.md) · [spec](../spec.md)

---

## Overview

The API serves plain HTTP on `localhost:3000` and the web UI on `localhost:5173` ([spec X7](../spec.md#out-of-scope)); all Fabric connections use TLS. The API is a convenience layer, not the security boundary: every rule is enforced in chaincode ([Layer Responsibilities](architecture.md#layer-responsibilities)).

## API Gateway

### Identities

`api/src/identities.js` — for each of the five enrolled users (`plan.md` Phase 3), load the signing certificate and private key from their MSP directory. `@hyperledger/fabric-gateway` has no wallet object.

### Gateway Connections

`api/src/gateway.js` — connect using `@hyperledger/fabric-gateway`:

- One gRPC connection with TLS **per org peer**; each user connects through their own org's peer, as Fabric Gateway expects. The gateway peer then collects the other endorsements the policy needs.
- Identity and signer from `identities.js`
- Expose `submit(fn, args, transient)` and `evaluate(fn, args)` helpers

### Authentication

`api/src/middleware/auth.js` — map a login (username/password for the demo) to an enrolled identity; issue a JWT carrying the identity label, MSP ID, and role.

### API Routes

| Method | Path | Role | Chaincode function |
|---|---|---|---|
| POST | `/api/auth/login` | — | — |
| GET | `/api/drugs` | any | `GetDrugReference` |
| POST | `/api/prescriptions` | doctor | `IssuePrescription` |
| GET | `/api/prescriptions/:id` | any | `ReadPrescription` |
| GET | `/api/prescriptions/:id/status` | any | `GetPrescriptionStatus` |
| GET | `/api/prescriptions/:id/patient` | doctor, pharmacist | `ReadPatientData` |
| GET | `/api/prescriptions/:id/eligibility` | pharmacist | `CheckFulfillmentEligibility` |
| POST | `/api/prescriptions/:id/fulfillments` | pharmacist | `RecordFulfillment` |
| GET | `/api/prescriptions/:id/fulfillments` | any | `GetFulfillments` |
| POST | `/api/prescriptions/:id/revoke` | doctor | `RevokePrescription` |
| GET | `/api/doctors/me/prescriptions` | doctor | `GetPrescriptionsByDoctor` (MSP + ID from the JWT) |
| GET | `/api/audit/:id/history` | regulator | `GetPrescriptionHistory` + `qscc` `GetTransactionByID` per entry for endorsing orgs |

### Error Mapping

Chaincode rejections carry the rule ID (e.g. `R1: fulfillment limit reached`). Map these to HTTP 403 with the rule ID in the response body so the UI can display which fraud rule fired.

### Transient Data and Salt

Patient fields must be sent as **transient data**, base64-encoded, never as regular chaincode arguments. The API generates the salt per prescription with `crypto.randomBytes(32)` and adds it to the transient map ([Private Data](chaincode.md#private-data)).

## Web UI

- **Login screen** with the five demo accounts selectable ([runbook](../runbook.md#demo-accounts)).
- **Doctor view:** issue prescription form (patient fields, drug picked from `/api/drugs` showing its control class, quantity, refills, validity); list of own prescriptions with derived status badges; revoke action.
- **Pharmacist view:** prescription lookup by ID; eligibility check panel showing pass/fail per rule R1–R7; dispense form enabled only when eligible; fulfillment history.
- **Regulator view:** prescription lookup; full transaction history table with transaction IDs, timestamps, and endorsing orgs; patient fields shown as hash only, demonstrating private-data exclusion.
- **Status badge colors:** `ISSUED` neutral, `PARTIALLY_FULFILLED` amber, `FULLY_FULFILLED` green, `EXPIRED` grey, `REVOKED` red.
