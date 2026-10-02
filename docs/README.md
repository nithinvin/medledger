# MedLedger Documentation

Start here. Each fact lives in exactly one file; other files link to it rather than repeat it.

## Which File Answers Which Question

| Question | File |
|---|---|
| What must the system do, and why? Requirements, scope, data fields, acceptance criteria | [spec.md](spec.md) |
| How is the network built? Orgs, identity and trust, channel, deployment, **pinned versions** | [design/architecture.md](design/architecture.md) |
| How does the chaincode work? Keys, functions, fraud-rule order, status, private data, transaction flows | [design/chaincode.md](design/chaincode.md) |
| How do the API and web UI work? Routes, auth, gateway connections, views | [design/application.md](design/application.md) |
| Why was it designed this way? Decisions and rejected alternatives | [decisions.md](decisions.md) |
| What do Fabric terms mean? MSP, NodeOUs, SAN, … | [glossary.md](glossary.md) |
| What do we build next, and is it done? Phases, exit gates, status, risks | [plan.md](plan.md) |
| How do I install, run, demo, and tear it down? Ports, credentials, scripts | [runbook.md](runbook.md) |
| Something failed — what now? | [troubleshooting.md](troubleshooting.md) |
| Coding and quality rules | [../CONSTITUTION.md](../CONSTITUTION.md) |

## Conventions

- **Cross-references are links** to a file and heading (e.g. `design/chaincode.md#fraud-rule-evaluation-order`), never section numbers. Renaming a heading means updating its links — search the repo for the old anchor.
- **Stable IDs** never change meaning: requirements `FR-n`, `NFR-n`, `AC-n`, scope `Sn` / `Xn`, fraud rules `R1`–`R7`, decisions `Dn`.
- **Single source of truth:** versions → architecture; install steps, ports, credentials → runbook; API routes → application; failures → troubleshooting.
- New decisions are appended to `decisions.md`; diagnosed failures are added to `troubleshooting.md`; `plan.md`'s status table is updated when a phase's exit gate passes.

## Repository Structure

```
medledger/
├── README.md
├── CONSTITUTION.md
├── run-demo.sh
├── docs/
│   ├── README.md                # this doc map
│   ├── spec.md
│   ├── design/
│   │   ├── architecture.md
│   │   ├── chaincode.md
│   │   └── application.md
│   ├── plan.md
│   ├── runbook.md
│   ├── troubleshooting.md
│   ├── decisions.md
│   └── glossary.md
├── network/
│   ├── docker-compose.yaml
│   ├── configtx.yaml
│   ├── crypto-config.yaml
│   ├── collections_config.json
│   └── scripts/
│       ├── common.sh            # shared org/port settings, sourced by the others
│       ├── generateArtifacts.sh
│       ├── up.sh
│       ├── down.sh
│       ├── createChannel.sh
│       ├── deployChaincode.sh
│       └── enrollUsers.sh
├── chaincode/
│   └── medledger/
│       ├── go.mod
│       ├── main.go
│       ├── contracts/
│       │   ├── prescription.go
│       │   ├── fulfillment.go
│       │   └── query.go
│       ├── models/
│       │   ├── prescription.go
│       │   ├── fulfillment.go
│       │   └── revocation.go
│       ├── rules/
│       │   └── fraud.go
│       ├── reference/
│       │   ├── profile.go          # go:embed loader
│       │   └── profile.json        # jurisdiction profile (India default)
│       ├── utils/
│       │   ├── keys.go
│       │   ├── identity.go
│       │   └── timestamp.go
│       └── contracts/*_test.go
├── api/
│   ├── package.json
│   ├── src/
│   │   ├── server.js
│   │   ├── gateway.js
│   │   ├── identities.js
│   │   ├── middleware/auth.js
│   │   └── routes/
│   │       ├── prescriptions.js
│   │       ├── fulfillments.js
│   │       └── audit.js
│   └── test/
├── web/
│   ├── package.json
│   └── src/
│       ├── App.jsx
│       └── views/
│           ├── DoctorView.jsx
│           ├── PharmacistView.jsx
│           └── RegulatorView.jsx
└── demo/
    ├── seed.sh
    └── fraud-scenarios.sh
```
