# Runbook — MedLedger

**Scope:** How to install, start, demonstrate, and tear down MedLedger. For what to *build*, see [plan.md](plan.md); when something fails, see [troubleshooting.md](troubleshooting.md).

---

## Supported Hosts

| Host | Docker | Notes |
|---|---|---|
| openSUSE Leap 16.0 | Docker Engine from the distro repos | Leap 16 defaults to **SELinux** on fresh installs; systems upgraded from 15.x often keep AppArmor. The compose file sets `security_opt: [label=disable]` on every container, so bind mounts and the peers' Docker-socket access work under either, with no `:z` relabelling. |
| Ubuntu 24.04 on Windows 11 WSL2 | Docker Desktop (WSL integration) **or** Docker Engine installed inside WSL | Clone the repo inside the Linux filesystem (`~/…`), never under `/mnt/c` (slow, loses exec bits). `.gitattributes` forces LF on `*.sh`. WSL defaults to half the host RAM (8 GB on a 16 GB machine), which is sufficient; raise it via `%UserProfile%\.wslconfig` if needed. Ports published on `127.0.0.1` in WSL are reachable from Windows browsers. |

Fabric binaries and images are `linux/amd64` and identical on both hosts; the scripts use only `bash`, `jq`, `curl`, `openssl`, and Docker, so no host-specific branches are needed. Docker needs about 8 GB of RAM.

## Install

Versions below are pinned in [architecture.md](design/architecture.md#technology-stack-and-versions); change them there first.

1. Install prerequisites:
   - Docker Engine 24+ and Docker Compose v2 (on WSL: Docker Desktop with WSL integration, or Docker Engine installed inside the Ubuntu distro)
   - Go 1.24+ (host toolchain for unit tests; chaincode itself is compiled inside `fabric-ccenv`)
   - Node.js 22 LTS
   - `jq`, `curl`, `openssl`, `git`
   - ShellCheck, to lint the shell scripts:

     | Host | Command |
     |---|---|
     | openSUSE Leap 16.0 | `sudo zypper install ShellCheck` |
     | Ubuntu 24.04 | `sudo apt install shellcheck` |
   - golangci-lint **v2.14.0**, to lint the chaincode. Use the official binary on both hosts — distro packages are too old (openSUSE's `golangci-lint` 1.60.3 fails on Go 1.24 code with `unsupported version: 2`):
     ```
     curl -sSfL https://golangci-lint.run/install.sh | sudo sh -s -- -b /usr/local/bin v2.14.0
     golangci-lint version   # reports 2.14.0
     ```
     No install at all also works: use the Docker command in [Chaincode Development](#chaincode-development).
   - On WSL: clone the repository under `~/`, not `/mnt/c`
2. Download Fabric binaries and Docker images from the repository root (the files are git-ignored):
   ```
   curl -sSLO https://raw.githubusercontent.com/hyperledger/fabric/main/scripts/install-fabric.sh
   chmod +x install-fabric.sh
   ./install-fabric.sh --fabric-version 2.5.16 --ca-version 1.5.22 binary docker
   ```
3. Pull the CouchDB image (`install-fabric.sh` does not fetch it):
   ```
   docker pull couchdb:3.3.3
   ```
4. Add the repository's `bin/` to `PATH` (e.g. in `~/.bashrc`).
5. Verify:
   ```
   peer version                 # reports 2.5.16
   fabric-ca-client version     # reports 1.5.22
   docker images | grep -E 'hyperledger|couchdb'
   ```

## Services, Ports, and Credentials

Every port binds to `127.0.0.1` only. Credentials are fixed demo values ([spec X9](spec.md#out-of-scope)).

| Service | Container | Host port(s) | Credentials |
|---|---|---|---|
| Orderers | `orderer1`–`orderer3.example.com` | 7050 / 8050 / 9050; admin API 7053 / 8053 / 9053 | Mutual TLS (orderer Admin cert) |
| Peers | `peer0.<org>.example.com` | hospitala 7051, hospitalb 8051, pharmacyx 9051, pharmacyy 10051, regulator 11051 | TLS; org Admin MSP for CLI |
| Fabric CAs | `ca.<org>.example.com` | 7054 / 8054 / 9054 / 10054 / 11054 (same org order) | `admin` / `adminpw`; demo users enroll with `<username>pw` |
| CouchDB | `couchdb-a`, `-b`, `-x`, `-y`, `-r` | 5984 / 6984 / 7984 / 8984 / 9984 — UI at `/_utils` | `admin` / `adminpw` |
| API gateway | `node src/server.js` (host process) | 3000 | Demo logins: `<username>` / `<username>pw` |
| Web UI | — | 5173 | Demo logins |

## Network Scripts

Run from the repository root. Each is idempotent unless noted.

| Order | Script | What it does | Available |
|---|---|---|---|
| 1 | `network/scripts/generateArtifacts.sh` | Regenerate crypto material and the channel genesis block. Refuses to run while the network is up. | ✅ |
| 2 | `network/scripts/up.sh` | Start the 18 containers and wait until each answers | ✅ |
| 3 | `network/scripts/createChannel.sh` | Join orderers (`osnadmin`) and peers to `prescription-channel` | ✅ |
| 4 | `network/scripts/enrollUsers.sh` | Register and enroll the five demo users, then verify each certificate and that its peer accepts it | ✅ |
| 5 | `network/scripts/deployChaincode.sh` | Vendor, package, install on 5 peers, approve for 5 orgs, commit (~2 min: each peer compiles the chaincode) | ✅ |
| 6 | `network/scripts/smokeTest.sh` | End-to-end check with the demo users: issue, fulfill, R1 at a second pharmacy, history = 1, privacy (12 checks, repeatable) | ✅ |
| — | `network/scripts/down.sh` | Remove containers, volumes, and `dev-peer*` chaincode containers/images. Keeps crypto material. | ✅ |

**Upgrading chaincode** after a code change: bump the version and the sequence together, e.g. `CC_VERSION=1.1 CC_SEQUENCE=2 network/scripts/deployChaincode.sh`. Rerunning with an already-committed sequence is a no-op. After `down.sh`, start again from `CC_SEQUENCE=1` (the default).

`network/scripts/common.sh` holds shared settings and is sourced by the others. To point the host `peer` CLI at an org's peer as its Admin:

```bash
source network/scripts/common.sh
set_peer_env hospitala            # as the org Admin
set_peer_env hospitala dr.smith   # as a demo user (after enrollUsers.sh)
peer channel list
```

## Chaincode Development

Run from `chaincode/medledger/`:

| Task | Command |
|---|---|
| Unit tests | `go test ./...` (add `-cover` for coverage) |
| Format check | `gofmt -l .` (must print nothing) |
| Vet | `go vet ./...` |
| Lint | `golangci-lint run ./...` (v2.14.0) |
| Lint without a host install | `docker run --rm -v "$PWD":/app -v "$(go env GOMODCACHE)":/go/pkg/mod -w /app golangci/golangci-lint:v2.14.0 golangci-lint run ./...` |
| Determinism grep | `grep -rn "time.Now()\|rand\.\|os.Getenv\|os.ReadFile\|math/rand\|GetQueryResult" --include=*.go . \| grep -v _test.go` |

## API Gateway

Needs the network up with users enrolled and chaincode deployed. From `api/`:

| Task | Command |
|---|---|
| Install dependencies | `npm ci` |
| Start | `npm start` — listens on `http://127.0.0.1:3000` |
| Unit tests (no network) | `npm test` |
| Live tests (real network) | `npm run test:live` — starts its own server on a random port |
| Lint / format check | `npm run lint`, `npm run format:check` |

Environment: `PORT` (default 3000), `LOG_LEVEL` (`debug`/`info`/`warn`/`error`), `MEDLEDGER_JWT_SECRET` (keeps logins valid across restarts; random per process if unset).

Try it:

```bash
TOKEN=$(curl -s localhost:3000/api/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"dr.smith","password":"dr.smithpw"}' | jq -r .token)
curl -s localhost:3000/api/drugs -H "Authorization: Bearer $TOKEN" | jq '.drugs[].drugCode'
```

## One-Command Startup

*Available after Phase 8.* `run-demo.sh` at the repository root runs the whole sequence:

```bash
#!/usr/bin/env bash
set -euo pipefail

echo "[1/7] Tearing down any previous network..."
(cd network && ./scripts/down.sh) || true

echo "[2/7] Generating crypto material and channel artifacts..."
(cd network && ./scripts/generateArtifacts.sh)

echo "[3/7] Starting Fabric network..."
(cd network && ./scripts/up.sh)

echo "[4/7] Creating channel and joining orderers and peers..."
(cd network && ./scripts/createChannel.sh)

echo "[5/7] Enrolling doctor, pharmacist, and regulator identities..."
(cd network && ./scripts/enrollUsers.sh)

echo "[6/7] Packaging and deploying chaincode..."
(cd network && ./scripts/deployChaincode.sh)

echo "[7/7] Starting API gateway and web UI..."
(cd api && npm ci && npm start &)
(cd web && npm ci && npm run dev &)

sleep 10
echo "Seeding demo data..."
./demo/seed.sh

echo ""
echo "Demo ready:"
echo "  Web UI:  http://localhost:5173"
echo "  API:     http://localhost:3000"
echo "  CouchDB: http://localhost:5984/_utils"
```

## Demo Accounts

Enrolled by `enrollUsers.sh`. Each user's MSP (certificate + private key) is at `network/organizations/peerOrganizations/<org>.example.com/users/<username>@<org>.example.com/msp`.

| Username | Org | Role |
|---|---|---|
| `dr.smith` | HospitalA | doctor |
| `dr.patel` | HospitalB | doctor |
| `pharm.jones` | PharmacyX | pharmacist |
| `pharm.lee` | PharmacyY | pharmacist |
| `auditor.gov` | Regulator | regulator |

## Demo Scenarios

*Available after Phase 8.* `demo/fraud-scenarios.sh` runs each attempt and prints the outcome:

| Scenario | Action | Expected |
|---|---|---|
| 1 | Pharmacist attempts issuance | Rejected: unauthorized role |
| 2 | Doctor attempts fulfillment | Rejected: unauthorized role |
| 3 | Second dispense at same pharmacy, zero refills | Rejected: R1 |
| 4 | **Dispense at PharmacyY after PharmacyX already dispensed, zero refills** | Rejected: R1 |
| 5 | Dispense at PharmacyY inside the refill interval of a PharmacyX fill, refills remaining (e.g. `SCHEDULE_H1`) | Rejected: R7 |
| 6 | `NDPS` drug (morphine) issued with refills | Rejected: R6 |
| 7 | Dispense after validity window | Rejected: R3 |
| 8 | Dispense more than prescribed quantity | Rejected: R2 |
| 9 | Dispense after revocation | Rejected: R5 |
| 10 | Prescription history after fulfillment | Exactly one entry — never mutated |
| 11 | Regulator reads patient name | Unavailable — private collection excludes regulator |

## Live Demo Sequence (8–10 minutes)

1. **Show the network** — `docker ps`, point out five independent peers each with its own ledger and CouchDB.
2. **Issue a prescription** as `dr.smith` for an `NDPS` drug (morphine), zero refills.
3. **Show it on a pharmacy peer** — query from PharmacyX, proving cross-org visibility without any data transfer between hospital and pharmacy systems.
4. **Fulfill at PharmacyX** as `pharm.jones`. Status flips to `FULLY_FULFILLED`.
5. **The key moment** — attempt to fulfill the same prescription at PharmacyY as `pharm.lee`. Rejected. Explain that PharmacyY never contacted PharmacyX; it reached this conclusion from its own ledger copy, and HospitalA's peer independently agreed.
6. **Show immutability** — run the history query on the prescription. Exactly one entry. The status changed without the record ever being touched.
7. **Show role separation** — log in as `dr.smith`, attempt a dispense. Rejected by chaincode, not by the UI.
8. **Show privacy** — log in as `auditor.gov`, open the same prescription. Full audit trail visible; patient name is not, and the salted hash cannot be reversed.

## Teardown

```bash
network/scripts/down.sh
```

This removes the containers, their volumes, and the `dev-peer*` chaincode containers and images. Chaincode containers survive a plain `docker compose down` and would serve stale chaincode on the next run, which is why `down.sh` prunes them. Crypto material and the channel block are kept; `generateArtifacts.sh` regenerates them.
