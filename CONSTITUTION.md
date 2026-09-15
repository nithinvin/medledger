<!--
SYNC IMPACT REPORT
==================
Version change  : (template) → 1.0.0
Added sections  : Core Principles (I–VII), Code Quality, Security,
                  Non-functional Requirements, Governance
Removed sections: n/a (first ratification of template)
TODOs           : none — all placeholders resolved
-->

# medledger Constitution

## Core Principles

### I. Coding Standards (NON-NEGOTIABLE)

All Python source MUST conform to PEP 8 with a maximum line length of 100 characters.

Naming conventions:
- `snake_case` for functions, variables, and modules.
- `PascalCase` for classes.
- `UPPER_SNAKE_CASE` for constants.
- Prefix private helpers with `_`.

Imports MUST be grouped in this order, separated by a blank line:
1. Standard library
2. Third-party
3. Local

Use descriptive names. Avoid single-letter variables except simple loop counters (`i`, `j`).

### II. Quality Gates (NON-NEGOTIABLE)

Every implementation MUST satisfy all of the following before a task is considered complete:

- Zero `pylint` warnings (configuration in `qa_tools/static_analysis/pylintrc`).
- Zero `mypy` errors (configuration in `qa_tools/static_analysis/mypy_config`).
- All unit tests passing (verified via `qa_tools/check_sanity.sh`).
- Build succeeds via `build_scripts/build.sh`.

No merge is permitted while any gate is red.

### III. Testing Principles

Every code change MUST include tests covering:

- Happy path — expected successful behaviour.
- Error path — failure and exception handling.
- Edge cases — boundary values and unusual inputs.
- Empty / malformed input — robustness under bad data.

Additional requirements:
- New CLI options require component tests.
- Every new code path MUST be exercised by at least one test.
- Branch coverage is preferred over simple line coverage.

### IV. Refactoring Principles

Modified code MUST be continuously evaluated for:

- Small, focused functions (single responsibility).
- Duplicate code elimination (DRY).
- Long method decomposition.
- Long file splitting (files ~400+ lines SHOULD be considered for splitting).
- Better naming.
- Helper extraction.

Refactoring opportunities identified during implementation MUST be reported,
even when not immediately addressed.

### V. Assertive Programming

- Validate all inputs at system boundaries, immediately and explicitly.
- Validate configuration on startup before any processing begins.
- Validate HTTP/external responses before consuming them.
- Raise specific, descriptive exceptions — never `Exception` bare.
- Never silently swallow exceptions.
- Use `assert` only for internal invariants that MUST never be false in correct code.

### VI. SOLID

- **Single Responsibility**: Every module, class, and function has exactly one reason to change.
- **Open/Closed**: Extend behaviour via new code; avoid modifying stable, tested code.
- **Liskov Substitution**: Subtypes MUST be substitutable for their base types without altering
  correctness.
- **Interface Segregation**: Clients MUST NOT be forced to depend on interfaces they do not use;
  prefer narrow, focused abstractions.
- **Dependency Inversion**: High-level modules MUST NOT depend on low-level modules; both MUST
  depend on abstractions.

### VII. Design Principles

- Prefer factory functions over direct constructors where creation logic is non-trivial.
- Use the Command pattern for CLI dispatch.
- Avoid God classes — no class should own too many responsibilities.
- Do not introduce patterns unless they demonstrably simplify maintenance.

## Code Quality

### Code Smells Policy

The following are prohibited and MUST be corrected before completion:

- Duplicate code (DRY violation).
- Dead code (unreachable or unused).
- Magic numbers or magic strings (extract to named constants).
- Long functions exceeding a single screen of logic.
- Happy-path-only testing.

### Logging Policy

- Use the standard `logging` module; NEVER use `print` for diagnostics.
- Apply appropriate log levels: `DEBUG` for trace detail, `INFO` for lifecycle events,
  `WARNING` for recoverable anomalies, `ERROR`/`CRITICAL` for failures.
- Never log credentials, tokens, passwords, or other sensitive values.
- Include sufficient diagnostic context (e.g. entity IDs, operation names) so failures are
  actionable without a debugger.

## Security

- Treat ALL external inputs (CLI arguments, environment variables, network
  responses) as untrusted; validate before use.
- Never expose secrets, keys, or credentials in source code, logs, or error messages.
- Use HTTPS exclusively for any external service communication.
- Follow OWASP Top 10 guidance; review every new code path for injection vulnerabilities
  (command injection, path traversal etc).
- Dependency updates MUST be evaluated for known CVEs before adoption.

## Non-functional Requirements

Every implementation MUST consider the following dimensions:

- **Reliability**: Failures MUST be handled gracefully with clear error reporting; the tool
  MUST never corrupt data on partial failure.
- **Performance**: GET and POST APIs should perform better. DB operations should perform better.
- **Scalability**: Design choices MUST not prevent future support or
  high-volume import pipelines.

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

**Version**: 1.0.0 | **Ratified**: 2026-09-15 | **Last Amended**: 2026-09-15
