# Decision Log — MedLedger

Architectural decisions and the alternatives rejected. Append new decisions with the next `D` number; never renumber or delete — mark superseded ones instead.

| # | Decision | Alternative rejected | Reason |
|---|---|---|---|
| D1 | Status derived at query time | Stored mutable `status` field | A pharmacy cannot modify a doctor-signed record without invalidating it; append-only ledgers have no update primitive |
| D2 | Endorsement policy spans hospital AND pharmacy | Single-org endorsement | Cross-boundary agreement is the entire point of using a blockchain here |
| D3 | Go for chaincode | JavaScript | Determinism safety; mature contract API |
| D4 | Patient data in private collection | Full patient data on ledger | Every org would otherwise hold PHI for every patient in the network |
| D5 | Transient data for patient fields | Regular chaincode arguments | Regular arguments are written to the blockchain of every org |
| D6 | Composite keys with range queries | CouchDB rich queries for core paths | Rich queries are not re-executed deterministically during validation |
| D7 | Fraud rules only in chaincode | Duplicated in API as enforcement | API can be bypassed by direct chaincode invocation |
| D8 | Regulator excluded from private collection | Regulator included | Demonstrates data minimization; regulator can be granted access via governance if needed |
| D9 | Fabric CA signs with the cryptogen CA key per org | Separate CA roots; or Fabric CA for all identities | One root of trust per org with the least setup; cryptogen stays for static node identities |
| D10 | Channel participation API (`osnadmin`) | Orderer system channel | System channel is deprecated in 2.5 and removed in 3.x |
| D11 | Generic control classes + embedded jurisdiction profile (India default) | Hard-coded US DEA schedules | Same rules serve any country; profile changes go through chaincode-upgrade governance |
| D12 | API-generated salt in private payload | Plain hash of patient fields | Prevents dictionary reversal of the public hash; randomness stays out of chaincode |
| D13 | R4/R7 split by same vs. different pharmacy | Two overlapping time windows | Makes both rules reachable and gives pharmacy shopping its own rule ID |
| D14 | Each role is accepted only from its org type (doctor ← hospitals, pharmacist ← pharmacies, regulator ← Regulator) | Trust the `role` attribute alone | Every org runs its own CA, so the attribute is self-asserted; a pharmacy's CA could otherwise mint a "doctor" |
| D15 | Fraud rules and status as pure functions in `rules/`; contracts only gather state | Rules inline in contract handlers | Every rule unit-tested without a ledger; one state-gathering path for the real check and the eligibility dry run |
| D16 | Vendor Go modules before packaging chaincode | Let the peer's build container download modules | Containers may have no working DNS (e.g. Docker configured with unreachable resolvers); vendoring makes the build offline and reproducible |
| D17 | The API generates prescription IDs (UUID) and salts | Client-supplied IDs and salts | Clients cannot pick colliding IDs or weak salts; the chaincode still validates both |
| D18 | Live API test starts the real `server.js` as a child process | Import the Fabric gateway into Jest | Tests the real entry point; Jest on Node 22 cannot load the gateway's ESM-only dependencies |
| D19 | The API forwards every authenticated call; only the chaincode checks roles | API-level role checks duplicating the chaincode's | One enforcement point instead of two; cross-role attempts in the UI show the chaincode's real rejection, which is what the demo claims |
| D20 | Demo scripts drive the REST API; R3 is shown live via a seeded 1-day prescription, otherwise skipped | Peer CLI scripts; forging backdated transaction timestamps | Exercises the same path as the web UI; time cannot honestly be fast-forwarded on a ledger, and the unit tests already prove R3 |

> **On D6:** CouchDB rich queries (`GetQueryResult`) are evaluated during simulation but **not** re-evaluated at validation time, so results can be stale by commit time. They are safe for read-only query functions, and unsafe inside functions that write state based on their results. Core fraud checks therefore use deterministic composite-key range queries.
