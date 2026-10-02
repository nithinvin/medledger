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
| Network lifecycle | `network/scripts/{generateArtifacts,up,createChannel,down}.sh` |
| Point `peer` CLI at an org | `source network/scripts/common.sh && set_peer_env <org>` |

## Gotchas

- Never regenerate crypto material while the network runs — `generateArtifacts.sh` refuses; run `down.sh` first.
- Contract API is pinned to v2.2.1 / `go 1.24.0`. Never `go get …@latest`: v2.2.3 needs a Go newer than `fabric-ccenv:2.5.16` ships.
- Chaincode must be deterministic: no `time.Now`, `math/rand`, `os.Getenv`, `os.ReadFile`; time comes from `GetTxTimestamp()`, reference data from `go:embed`.
- Fabric terms (MSP, NodeOUs, SAN, …) are explained in `docs/glossary.md`.
