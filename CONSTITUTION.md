<!--
SYNC IMPACT REPORT
==================
Version change  : 1.0.0 → 2.0.0
Rationale       : Project stack corrected from Python to Go (chaincode) + JavaScript
                  (API gateway, web UI), matching docs/spec.md, docs/design.md, docs/plan.md.
                  This is a full redefinition of the Coding Standards and Quality Gates
                  principles (MAJOR per own amendment rule), plus a new Fabric-specific
                  determinism principle.
Added sections  : Core Principles III (Chaincode Determinism)
Changed sections: Core Principles I–II (Go/JS coding standards replace PEP 8), Quality Gates,
                  Testing Principles, Assertive Programming, Logging Policy, Security
Removed sections: Python-specific tooling references (pylint, mypy, qa_tools/, build_scripts/)
TODOs           : none — all placeholders resolved
-->

# medledger Constitution

## Core Principles

### I. Coding Standards — Go / Chaincode (NON-NEGOTIABLE)

All chaincode lives under `chaincode/medledger/` and is written in Go, per `docs/design.md` §6.

- Code MUST be `gofmt`-formatted; no unformatted file may be committed.
- Naming follows idiomatic Go: `MixedCaps`/`mixedCaps` (no underscores), exported identifiers
  capitalized only when part of the package's public API.
- Package layout follows `docs/design.md` §9: `contracts/`, `models/`, `rules/`, `utils/`.
- Every returned error MUST be checked; wrap with context using `fmt.Errorf("...: %w", err)`.
  Never discard an error with `_` outside of deferred `Close()`-style calls.
- No package-level mutable state.

### II. Coding Standards — JavaScript (API Gateway & Web UI) (NON-NEGOTIABLE)

The API gateway (`api/`) and web UI (`web/`) are plain JavaScript (ES2022+), per
`docs/design.md` §6 — no TypeScript build step, to keep the stack simple for this project's
short lifespan.

- Code MUST be Prettier-formatted and ESLint-clean (recommended config).
- `camelCase` for variables/functions, `PascalCase` for React components and classes,
  `UPPER_SNAKE_CASE` for constants.
- `async`/`await` only; every promise chain MUST have error handling — no unhandled rejections.
- React components are functional and hook-based; no class components.

### III. Chaincode Determinism (NON-NEGOTIABLE — FABRIC-SPECIFIC)

Endorsing peers execute chaincode independently and MUST produce identical read/write sets, or
the transaction fails validation (`docs/spec.md` NFR-7). This principle is therefore stricter
than ordinary code quality — a violation causes a working-looking transaction to fail at commit.

- NEVER call `time.Now()`, `math/rand`, or `os.Getenv` inside a state-mutating chaincode
  function. Use `ctx.GetStub().GetTxTimestamp()` exclusively for time.
- `GetQueryResult` (CouchDB rich queries) is permitted only in read-only query functions —
  never in a function that also calls `PutState`.
- Before merging any chaincode change, run:
  ```
  grep -rn "time.Now()\|rand\.\|os.Getenv\|math/rand\|GetQueryResult" chaincode/
  ```
  and confirm every hit is inside a read-only query function.

### IV. Quality Gates (NON-NEGOTIABLE)

Every implementation MUST satisfy all of the following before a task is considered complete:

Go (`chaincode/`):
- `gofmt -l .` reports no files.
- `go vet ./...` is clean.
- `golangci-lint run` reports zero warnings.
- `go test ./...` passes in full.

JavaScript (`api/`, `web/`):
- `npm run lint` (ESLint) reports zero errors.
- `npm test` (Jest) passes in full.

No merge is permitted while any gate is red.

### V. Testing Principles

Every code change MUST include tests covering:

- Happy path — expected successful behaviour.
- Error path — rejection and failure handling.
- Edge cases — boundary values and unusual inputs.
- Empty / malformed input — robustness under bad data.

Additional requirements:
- Chaincode: table-driven Go tests using `testify` with a mocked `ChaincodeStub`
  (`docs/plan.md` §4.5), covering every fraud rule (R1–R7) and every derived status value.
- API: Jest tests for each route, including role-rejection cases (doctor calling a
  pharmacist-only endpoint and vice versa).
- Every new code path MUST be exercised by at least one test.

### VI. Refactoring Principles

Modified code MUST be continuously evaluated for:

- Small, focused functions (single responsibility).
- Duplicate code elimination (DRY).
- Long method decomposition.
- Long file splitting (files ~400+ lines SHOULD be considered for splitting).
- Better naming.
- Helper extraction.

Refactoring opportunities identified during implementation MUST be reported,
even when not immediately addressed.

### VII. Assertive Programming

- Validate all inputs at system boundaries: chaincode function arguments, transient data
  fields, and API request bodies — immediately and explicitly.
- Enforce role/MSP checks (`RequireRole`) at the top of every chaincode function, before any
  state read or write.
- Validate HTTP/external responses before consuming them.
- Raise specific, descriptive errors — never a bare `Error`/`Exception`.
- Never silently swallow errors.

### VIII. SOLID & Design Principles

- **Single Responsibility**: Every module, contract, and function has exactly one reason to
  change (e.g. fraud rules live in `rules/`, never inline in contract handlers).
- **Open/Closed**: Extend behaviour via new code; avoid modifying stable, tested code.
- **Dependency Inversion**: Contracts depend on the `ChaincodeStub`/context interface, never on
  concrete peer/network details, to keep them testable with a mock stub.
- Avoid God objects — no contract or route module should own too many responsibilities.
- Do not introduce patterns unless they demonstrably simplify maintenance.

## Code Quality

### Code Smells Policy

The following are prohibited and MUST be corrected before completion:

- Duplicate code (DRY violation).
- Dead code (unreachable or unused).
- Magic numbers or magic strings (extract to named constants — e.g. rule IDs `R1`–`R7`).
- Long functions exceeding a single screen of logic.
- Happy-path-only testing.

### Logging Policy

- Go: use the standard `log` package (or the chaincode shim's logger); never `fmt.Println` for
  diagnostics.
- JavaScript: use `console` with explicit levels via a thin wrapper; never leave ad-hoc debug
  `console.log` calls in committed code.
- Apply appropriate levels: debug/trace detail, lifecycle events, recoverable anomalies, and
  failures MUST be distinguishable.
- NEVER log credentials, private keys, JWTs, or patient-identifying data (name, DOB, patient
  reference number) — only their hashes or identifiers.
- Include sufficient diagnostic context (prescription ID, MSP ID, rule ID) so failures are
  actionable without a debugger.

## Security

- Treat ALL external inputs (HTTP request bodies, chaincode arguments, transient data) as
  untrusted; validate before use.
- Never expose secrets, private keys, wallet credentials, or patient-identifying data in source
  code, logs, or error messages.
- Use TLS for all Fabric peer/orderer/gateway connections and HTTPS for the REST API.
- Fraud rules and role checks MUST be enforced in chaincode, never only in the API layer — the
  API layer is convenience, not the security boundary (`docs/design.md` §3.2).
- Patient-identifying fields MUST be sent as transient data, never as ordinary chaincode
  arguments, and stored only in the private data collection (`docs/spec.md` FR-7).
- Follow OWASP Top 10 guidance; review every new code path for injection vulnerabilities.
- Dependency updates (Go modules, npm packages) MUST be evaluated for known CVEs before adoption.

## Non-functional Requirements

Every implementation MUST consider the following dimensions, per `docs/spec.md` §6:

- **Reliability**: Chaincode failures MUST reject cleanly with a specific rule ID; no partial
  writes on failure (Fabric's simulate/endorse/commit model already guarantees atomicity per
  transaction — do not work around it).
- **Performance**: Transaction commit under 5s, queries under 500ms on demo hardware.
- **Scalability**: Design choices MUST not prevent adding organizations or drug-schedule rules
  without a data-model rewrite.

## Governance

This constitution supersedes all other practices and guidelines within the `medledger` project.

Amendment procedure:
1. Propose a change with a written rationale.
2. Update this file, increment `CONSTITUTION_VERSION` per semantic versioning rules
   (MAJOR: incompatible principle removal/redefinition; MINOR: new principle/section;
   PATCH: clarification/wording fix).
3. Update `LAST_AMENDED_DATE` to today's date in ISO 8601 format (YYYY-MM-DD).
4. Commit with message: `docs: amend constitution to vX.Y.Z (<summary>)`.

All pull requests MUST verify compliance with every principle herein before merging.
Complexity or deviation from these principles MUST be explicitly justified in the PR description.

**Version**: 2.0.0 | **Ratified**: 2026-09-15 | **Last Amended**: 2026-09-15
