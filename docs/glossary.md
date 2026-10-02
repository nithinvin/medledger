# Glossary — MedLedger

Fabric terms used throughout the MedLedger docs, explained in the context of this project.

## Membership Service Provider (MSP)

An **MSP** is how Fabric decides *who belongs to which organization*. It is a folder of certificates, not a running service:

| MSP folder | Contains | Purpose |
|---|---|---|
| `cacerts/` | The org's root CA certificate | Any certificate signed by this CA is a member of the org |
| `tlscacerts/` | The org's TLS root CA certificate | Verifies the org's TLS connections (a separate root from `cacerts/`) |
| `config.yaml` | NodeOU mapping (below) | Classifies members into roles |
| `signcerts/` | This identity's own certificate | Local MSPs only — the identity a node or user signs with |
| `keystore/` | This identity's private key | Local MSPs only — never leaves the owner |

There are two kinds:

- **Channel MSP** — public certificates only (`cacerts`, `tlscacerts`, `config.yaml`), embedded in the channel configuration (`configtx.yaml` `MSPDir`). Every peer uses it to check whether a signature came from a genuine HospitalA member.
- **Local MSP** — a channel MSP plus `signcerts/` and `keystore/`, held by one peer, orderer, or user (e.g. `users/Admin@hospitala.example.com/msp/`).

Each MSP has an **MSP ID** (`HospitalAMSP`, `PharmacyXMSP`, …). Policies name orgs by MSP ID, and chaincode reads the caller's org with `GetMSPID()`. A forged prescription fails here: its signing certificate does not chain to any hospital's `cacerts`.

## NodeOUs (Node Organizational Units)

Being a *member* of an org is not enough — HospitalA's peer and HospitalA's doctor must be told apart. **NodeOUs** classify each certificate into a role using the `OU` (Organizational Unit) field of its subject:

| Role | Certificate OU | MedLedger examples |
|---|---|---|
| `peer` | `OU=peer` | `peer0.hospitala.example.com` |
| `orderer` | `OU=orderer` | `orderer1.example.com` |
| `admin` | `OU=admin` | `Admin@hospitala.example.com` |
| `client` | `OU=client` | `dr.smith`, `pharm.jones`, `auditor.gov` |

The mapping is switched on by `msp/config.yaml` (`cryptogen` writes it when `EnableNodeOUs: true`; Fabric CA sets the OU from `--id.type`). With NodeOUs, policies can say `HospitalAMSP.peer` — "a peer of HospitalA" — which the [endorsement policy](design/architecture.md#endorsement-policy) depends on. Without NodeOUs only `HospitalAMSP.member` exists, and admins must be listed explicitly in `admincerts/` (which is why those folders exist but stay empty here).

NodeOU roles are coarse: they separate peers from people. The finer doctor/pharmacist/regulator distinction is the `role` attribute embedded in each user's certificate by Fabric CA ([plan Phase 3](plan.md#phase-3--identity-enrollment)).

## Subject Alternative Name (SAN)

A **SAN** is an X.509 certificate extension listing every hostname and IP address the certificate is valid for. When a client opens a TLS connection, it checks that the address it dialled appears in the server certificate's SAN list; otherwise the handshake fails with an error like `x509: certificate is valid for peer0.hospitala.example.com, not localhost`.

Inside the Docker network, containers dial each other by name (`peer0.hospitala.example.com:7051`). CLI tools on the host dial the published port instead (`localhost:7051`). The node certificates therefore carry both: their Docker hostname plus `localhost` and `127.0.0.1` (`SANS:` in `crypto-config.yaml`).

## Other terms

| Term | Meaning in MedLedger |
|---|---|
| **Organization** | An independent participant (HospitalA, PharmacyX, …) with its own CA, MSP, and peer |
| **Peer** | A node that holds a copy of the ledger, runs chaincode, and endorses transactions — one per org |
| **Orderer** | A node that puts endorsed transactions into blocks in a single agreed order; three run **Raft** consensus so one can fail |
| **Channel** | A private ledger shared by a set of orgs — here, `prescription-channel` with all five |
| **Channel participation API** | The `osnadmin` admin interface used to make orderers join a channel ([Channel Creation](design/architecture.md#channel-creation)) |
| **Chaincode** | Fabric's term for a smart contract — the Go code enforcing the fraud rules |
| **Endorsement** | A peer executes a transaction proposal and signs the result; it is not yet on the ledger |
| **Endorsement policy** | Which orgs' endorsements a transaction needs before it can commit ([Endorsement Policy](design/architecture.md#endorsement-policy)) |
| **Anchor peer** | A peer that other orgs' peers contact to discover the org's peers (gossip) |
| **World state** | The current value of every key, kept in CouchDB; derived from the blockchain |
| **Private data collection** | Data stored only on member orgs' peers, with just its hash on the shared ledger ([Private Data](design/chaincode.md#private-data)) |
| **Transient data** | Proposal inputs passed to chaincode but never written to the ledger — used for patient fields |
| **Signing CA vs TLS CA** | Each org has two roots: `ca/` signs identities (MSP), `tlsca/` signs TLS certificates |
