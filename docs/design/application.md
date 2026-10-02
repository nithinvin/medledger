# Application Design — MedLedger

**Scope:** REST API gateway (identities, Fabric connections, authentication, routes, error mapping) and web UI views.
**Related:** [architecture.md](architecture.md) · [chaincode.md](chaincode.md) · [spec](../spec.md)

---

## Overview

The API serves plain HTTP on `localhost:3000` and the web UI on `localhost:5173` ([spec X7](../spec.md#out-of-scope)); all Fabric connections use TLS. The API is a convenience layer, not the security boundary: every rule is enforced in chaincode ([Layer Responsibilities](architecture.md#layer-responsibilities)).

## API Gateway

### Structure

`app.js` builds the Express app from an injected **Fabric service** (`submit`, `evaluate`, `transactionEndorsers`, `close`). `server.js` injects the real one from `gateway.js`; unit tests inject a fake, so every route is tested without a network. The API binds to `127.0.0.1` only. The web UI reaches it through the Vite dev-server proxy (`/api` → `localhost:3000`), so no CORS configuration is needed.

### Identities

`api/src/identities.js` — for each of the five enrolled users (`plan.md` Phase 3), load the signing certificate and private key from their MSP directory. `@hyperledger/fabric-gateway` has no wallet object.

### Gateway Connections

`api/src/gateway.js` — connect using `@hyperledger/fabric-gateway`:

- One gRPC connection with TLS **per org peer**; each user connects through their own org's peer, as Fabric Gateway expects. The gateway peer then collects the other endorsements the policy needs.
- Identity and signer from `identities.js`
- Contract handles per [Invoking Functions](chaincode.md#invoking-functions): default contract for `PrescriptionContract`, named contracts for the others
- Expose `submit(fn, args, transient)` and `evaluate(fn, args)` helpers

### Authentication

`api/src/middleware/auth.js` — map a login to an enrolled identity and issue a JWT (HS256, 8 h) carrying the username, MSP ID, org, and role.

- Demo passwords are `<username>pw`, compared in constant time ([spec X9](../spec.md#out-of-scope)).
- The signing secret comes from `MEDLEDGER_JWT_SECRET`; if unset, a random per-process secret is used and tokens stop working when the API restarts. No secret is stored in the source.
- Identity for chaincode calls always comes from the JWT, never from request parameters (e.g. `/api/doctors/me/prescriptions` uses the token's MSP and username).
- Missing, tampered, or expired tokens → `401 UNAUTHENTICATED`. Role checks here are UX only; the chaincode enforces them ([D7](../decisions.md)).

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

### Request and Response Shapes

| Route | Body / query | Response |
|---|---|---|
| `POST /api/auth/login` | `{ username, password }` | `{ token, user: { username, role, msp, org } }` |
| `POST /api/prescriptions` | `{ patientName, patientDOB, patientRef, drugCode, quantity, dosageInstructions, refillsAllowed, validityDays }` | `201` prescription record. The API generates the `prescriptionId` (UUID) and the salt |
| `GET /api/prescriptions/:id/status` | — | `{ prescriptionId, status }` |
| `GET /api/prescriptions/:id/eligibility` | `?quantity=<n>` | `{ eligible, status, rule?, reason? }` |
| `POST /api/prescriptions/:id/fulfillments` | `{ quantityDispensed }` | `201` fulfillment record |
| `POST /api/prescriptions/:id/revoke` | `{ reason }` | `201` revocation record |
| `GET /api/audit/:id/history` | — | `{ prescriptionId, entries: [{ txId, timestamp, isDelete, value, validationCode, endorsers: [msp…] }] }` |
| `GET /api/health` | — | `{ status: "ok" }` (no auth) |

Other routes return the chaincode result as JSON. Errors are always `{ error, rule?, message }`: `rule` is set for R1–R7, and 500s never expose internal details.

### Error Mapping

Chaincode rejections start with a code ([Error Codes](chaincode.md#error-codes)), e.g. `R1: fulfillment limit reached`. Map the code to an HTTP status and return it in the response body so the UI can show which rule fired:

| Code | HTTP |
|---|---|
| `R1`–`R7`, `UNAUTHORIZED` | 403 |
| `INVALID_ARGUMENT` | 400 |
| `NOT_FOUND` | 404 |
| `ALREADY_EXISTS` | 409 |
| `INTERNAL`, anything unrecognized | 500 |

### Transient Data and Salt

Patient fields must be sent as **transient data**, base64-encoded, never as regular chaincode arguments. The API generates the salt per prescription with `crypto.randomBytes(32).toString('hex')` (64 hex characters; chaincode requires ≥ 32) and adds it to the transient map ([Private Data](chaincode.md#private-data)).

## Web UI

- **Login screen** with the five demo accounts selectable ([runbook](../runbook.md#demo-accounts)).
- **Doctor view:** issue prescription form (patient fields, drug picked from `/api/drugs` showing its control class, quantity, refills, validity); list of own prescriptions with derived status badges; revoke action.
- **Pharmacist view:** prescription lookup by ID; eligibility check panel showing pass/fail per rule R1–R7; dispense form enabled only when eligible; fulfillment history.
- **Regulator view:** prescription lookup; full transaction history table with transaction IDs, timestamps, and endorsing orgs; patient fields shown as hash only, demonstrating private-data exclusion.
- **Status badge colors:** `ISSUED` neutral, `PARTIALLY_FULFILLED` amber, `FULLY_FULFILLED` green, `EXPIRED` grey, `REVOKED` red.
