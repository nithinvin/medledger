# Repository Guidelines & AI Context: medledger

## Governance
- **CONSTITUTION FIRST**: All code, architectural choices, refactoring, and AI responses MUST strictly adhere to `CONSTITUTION.md` located at the root of the repository.

## Documentation Map
All project documentation lives in `./docs/`; `docs/README.md` maps each question to its file and lists the conventions (link-style cross-references, stable IDs, single source of truth).

| File | Holds |
|---|---|
| `spec.md` | Requirements, scope, data fields, acceptance criteria |
| `design/architecture.md` | Network, identity, deployment, pinned versions |
| `design/chaincode.md` | Ledger keys, contract functions, fraud rules, private data |
| `design/application.md` | API routes, auth, web UI |
| `decisions.md` | Decision log (append-only) |
| `glossary.md` | Fabric terms |
| `plan.md` | Build phases, exit gates, status |
| `runbook.md` | Install, ports, credentials, scripts, demo |
| `troubleshooting.md` | Symptom → cause → fix |

## Development Workflow
When the user requests a new feature, enhancement, or fix:
1. Update requirements in `docs/spec.md`.
2. Update the relevant `docs/design/*.md` file; record significant choices in `docs/decisions.md`.
3. Add or update the build steps and exit gate in `docs/plan.md`.
4. Put operational steps in `docs/runbook.md` and diagnosed failures in `docs/troubleshooting.md` — never in the plan.
