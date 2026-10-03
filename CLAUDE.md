# MedLedger — Claude Code Instructions

Hyperledger Fabric demo: prescription issuance and fulfillment with chaincode-enforced fraud rules. Go chaincode, JavaScript API and web UI. Demo project — prefer the simpler approach wherever it does not weaken the fraud-prevention properties.

The constitution below is binding for all code, architecture, refactoring, and answers:

@CONSTITUTION.md

## Docs

- Start at `docs/README.md` (doc map + conventions). Each fact has one home: versions → `design/architecture.md`; install, ports, credentials → `runbook.md`; API routes → `design/application.md`; failures → `troubleshooting.md`.
- Cross-references are `file#heading` links, never section numbers. After renaming or moving a heading, run the link check.
- Feature workflow: `spec.md` → `design/*.md` (significant choices appended to `decisions.md`) → `plan.md`. Operational steps go in `runbook.md`; diagnosed failures in `troubleshooting.md` — never in the plan.
- Update `plan.md`'s status table when a phase's exit gate passes.

## Commands

| Task | Command |
|---|---|
| Lint shell scripts | `shellcheck network/scripts/*.sh` |
| Check doc links | `node scripts/check-doc-links.mjs` |
| Chaincode tests / lint | `cd chaincode/medledger && go test ./...` — full gate list in `docs/runbook.md#chaincode-development` |
| Network lifecycle | `network/scripts/{generateArtifacts,up,createChannel,enrollUsers,deployChaincode,down}.sh` |
| End-to-end check | `network/scripts/smokeTest.sh` |
| API tests / lint | `cd api && npm test && npm run lint && npm run format:check`; live: `npm run test:live` |
| Web UI tests / lint | `cd web && npm test && npm run lint && npm run format:check && npm run build` |
| Point `peer` CLI at an org | `source network/scripts/common.sh && set_peer_env <org>` |

## Gotchas

- Never regenerate crypto material while the network runs — `generateArtifacts.sh` refuses; run `down.sh` first.
- Contract API is pinned to v2.2.1 / `go 1.24.0`. Never `go get …@latest`: v2.2.3 needs a Go newer than `fabric-ccenv:2.5.16` ships.
- Never hash or byte-compare JSON read back from the ledger: CouchDB re-serializes it with sorted keys. Decode into the struct and re-encode. `internal/mock` models this.
- Shell: never `cmd | grep -q` under `pipefail` — capture into a variable first (SIGPIPE makes the pipeline fail).
- The API does no role checks (D19); authorization lives only in the chaincode.
- Chaincode must be deterministic: no `time.Now`, `math/rand`, `os.Getenv`, `os.ReadFile`; time comes from `GetTxTimestamp()`, reference data from `go:embed`.
- Fabric terms (MSP, NodeOUs, SAN, …) are explained in `docs/glossary.md`.
