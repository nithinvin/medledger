# Runbook — MedLedger

**Scope:** How to install, start, demonstrate, and tear down MedLedger. For what to *build*, see [plan.md](plan.md); when something fails, see [troubleshooting.md](troubleshooting.md).

---

## Supported Hosts

| Host | Docker | Notes |
|---|---|---|
| openSUSE Leap 16.0 | Docker Engine from the distro repos | Leap 16 defaults to **SELinux** on fresh installs; systems upgraded from 15.x often keep AppArmor. The compose file sets `security_opt: [label=disable]` on every container, so bind mounts and the peers' Docker-socket access work under either, with no `:z` relabelling. |
| Ubuntu 24.04 on Windows 11 WSL2 | Docker Engine installed inside WSL **or** Docker Desktop with WSL integration — pick one | Clone the repo inside the Linux filesystem (`~/…`), never under `/mnt/c` (slow, loses exec bits). Ports bound to `127.0.0.1` in WSL open from Windows browsers as `localhost`. WSL gets half the host RAM by default (8 GB on a 16 GB machine), which is enough. |

The host needs Docker, Go (for `go mod vendor` when deploying chaincode, and for chaincode tests), Node.js (API and web UI), and `bash`, `git`, `jq`, `curl`, `openssl`. Fabric binaries and images are `linux/amd64` on both hosts, so the scripts have no host-specific branches. First-time downloads total about 2.5 GB (Fabric images ~1.5 GB, Go, npm packages).

## Install

Do these once per machine. Versions are pinned in [architecture.md](design/architecture.md#technology-stack-and-versions); change them there first.

### 1. WSL (Windows 11 only)

In **PowerShell as Administrator**, install Ubuntu 24.04, reboot if asked, then open "Ubuntu 24.04" from the Start menu and create your Linux user:

```powershell
wsl --install -d Ubuntu-24.04
```

Inside Ubuntu, make sure systemd is on (needed for Docker Engine; Ubuntu 24.04 enables it by default):

```bash
systemctl is-system-running   # "running" or "degraded" is fine; an error means systemd is off
```

If it is off, add the following to `/etc/wsl.conf`, then run `wsl --shutdown` in PowerShell and reopen Ubuntu:

```ini
[boot]
systemd=true
```

### 2. Docker

**Ubuntu / WSL — option A (recommended): Docker Engine inside WSL.** Use Docker's own repository, not Ubuntu's `docker.io` package:

```bash
sudo apt-get update && sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"
```

Then run `wsl --shutdown` in PowerShell and reopen Ubuntu so the `docker` group applies. Closing and reopening the terminal is not enough.

**Ubuntu / WSL — option B: Docker Desktop.** Install Docker Desktop on Windows; in *Settings → Resources → WSL integration*, enable **Ubuntu-24.04**. Do not also install Docker Engine inside WSL.

**openSUSE Leap 16.0:**

```bash
sudo zypper install docker docker-compose
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"   # then log out and back in
```

Check, on either host:

```bash
docker run --rm hello-world && docker compose version   # Compose v2.x
```

### 3. Go, Node.js, and tools

**Ubuntu 24.04.** Its own `golang` (1.22) and `nodejs` (18) packages are too old; install from the upstream sources:

```bash
sudo apt-get install -y git jq curl openssl

# Go: latest release from go.dev (any 1.24+ works)
GO_VERSION="$(curl -fsSL 'https://go.dev/VERSION?m=text' | head -1)"
curl -fsSL "https://go.dev/dl/${GO_VERSION}.linux-amd64.tar.gz" -o /tmp/go.tgz
sudo rm -rf /usr/local/go && sudo tar -C /usr/local -xzf /tmp/go.tgz && rm /tmp/go.tgz
echo 'export PATH="$PATH:/usr/local/go/bin"' >> ~/.bashrc && source ~/.bashrc

# Node.js 22 LTS from NodeSource
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

**openSUSE Leap 16.0:**

```bash
sudo zypper install go1.24 nodejs22 git jq curl openssl
```

Check: `go version` (1.24 or newer) and `node --version` (v22.12 or newer).

**For development only** (not needed to run the demo):

| Tool | Ubuntu 24.04 | openSUSE Leap 16.0 |
|---|---|---|
| ShellCheck | `sudo apt-get install -y shellcheck` | `sudo zypper install ShellCheck` |
| golangci-lint v2.14.0 | `curl -sSfL https://golangci-lint.run/install.sh \| sudo sh -s -- -b /usr/local/bin v2.14.0` | same command |

Use the official golangci-lint binary on both hosts — distro packages are too old (openSUSE's `golangci-lint` 1.60.3 fails on Go 1.24 code with `unsupported version: 2`). No install also works: use the Docker command in [Chaincode Development](#chaincode-development).

### 4. Clone the repository

On WSL, clone into your Linux home directory — never under `/mnt/c`:

```bash
cd ~
git clone https://github.com/nithinvin/medledger.git   # or the SSH URL, with a key set up inside WSL
cd medledger
```

### 5. Fabric binaries and images

From the repository root (the downloads are git-ignored):

```bash
curl -sSLO https://raw.githubusercontent.com/hyperledger/fabric/main/scripts/install-fabric.sh
chmod +x install-fabric.sh
./install-fabric.sh --fabric-version 2.5.16 --ca-version 1.5.22 binary docker
docker pull couchdb:3.3.3   # install-fabric.sh does not fetch CouchDB
```

The network scripts find `bin/` by themselves. Add it to `PATH` only if you want to run `peer` and friends by hand: `echo "export PATH=\"\$PATH:$PWD/bin\"" >> ~/.bashrc`.

### 6. Verify

```bash
./bin/peer version | grep Version               # v2.5.16
./bin/fabric-ca-client version | grep Version   # v1.5.22
docker images | grep -E 'hyperledger|couchdb'   # peer, orderer, ccenv, baseos, ca, couchdb
```

You are ready: run `./run-demo.sh` ([One-Command Startup](#one-command-startup)). The first run takes a few minutes longer while `npm ci` installs the API and web UI packages.

## Services, Ports, and Credentials

Every port binds to `127.0.0.1` only. Credentials are fixed demo values ([spec X9](spec.md#out-of-scope)).

| Service | Container | Host port(s) | Credentials |
|---|---|---|---|
| Orderers | `orderer1`–`orderer3.example.com` | 7050 / 8050 / 9050; admin API 7053 / 8053 / 9053 | Mutual TLS (orderer Admin cert) |
| Peers | `peer0.<org>.example.com` | hospitala 7051, hospitalb 8051, pharmacyx 9051, pharmacyy 10051, regulator 11051 | TLS; org Admin MSP for CLI |
| Fabric CAs | `ca.<org>.example.com` | 7054 / 8054 / 9054 / 10054 / 11054 (same org order) | `admin` / `adminpw`; demo users enroll with `<username>pw` |
| CouchDB | `couchdb-a`, `-b`, `-x`, `-y`, `-r` | 5984 / 6984 / 7984 / 8984 / 9984 — UI at `/_utils` | `admin` / `adminpw` |
| API gateway | `node src/server.js` (host process) | 3000 | Demo logins: `<username>` / `<username>pw` |
| Web UI | `npx vite` dev server (host process) | 5173 — `/api` proxied to 3000 | Demo logins (one click per account) |

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

## Web UI

Needs the API running. From `web/`:

| Task | Command |
|---|---|
| Install dependencies | `npm ci` |
| Start | `npm run dev` — open `http://localhost:5173` |
| Tests | `npm test` |
| Lint / format check | `npm run lint`, `npm run format:check` |
| Production build check | `npm run build` |

The dev server binds to `127.0.0.1:5173` and proxies `/api` to the API on port 3000.

## One-Command Startup

From the repository root, after [Install](#install):

```bash
./run-demo.sh          # fresh network → users → chaincode → API + web UI → seed data (~2–3 min)
./run-demo.sh stop     # stop the API and web UI, and tear the network down
```

`run-demo.sh` always starts from scratch: it runs `down.sh`, `generateArtifacts.sh`, `up.sh`, `createChannel.sh`, `enrollUsers.sh`, and `deployChaincode.sh`, then starts the API and web UI in the background (running `npm ci` first if `node_modules/` is missing) with a fresh JWT secret, and finally `demo/seed.sh`. It prints the URLs and the seeded prescription IDs. Logs and PIDs go to `demo/.run/` (git-ignored).

| Script | What it does |
|---|---|
| `demo/seed.sh` | Six prescriptions through the API, covering both hospitals, every control class, and every status; one is valid for only 1 day, for the R3 scenario. Safe to rerun |
| `demo/fraud-scenarios.sh [--pause]` | The [demo scenarios](#demo-scenarios), each on fresh prescriptions, with ✓/✗ per scenario; `--pause` waits for Enter between them. Repeatable |

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

`demo/fraud-scenarios.sh` runs these through the API; every rejection comes from the chaincode:

| Scenario | Action | Expected |
|---|---|---|
| 1 | Pharmacist attempts issuance | Rejected: `UNAUTHORIZED` |
| 2 | Doctor attempts fulfillment | Rejected: `UNAUTHORIZED` |
| 3 | Second dispense at same pharmacy, zero refills | Rejected: R1 |
| 4 | **Dispense at PharmacyY after PharmacyX already dispensed, zero refills** | Rejected: R1 |
| 5 | Dispense at PharmacyY inside the 20-day interval of a PharmacyX fill (`SCHEDULE_H1`, refills remaining) | Rejected: R7 |
| 6 | Refill at the same pharmacy inside that interval | Rejected: R4 |
| 7 | `NDPS` drug (morphine) issued with refills | Rejected: R6 |
| 8 | Dispense after the validity window | Rejected: R3 — *live only once the seeded 1-day prescription has expired* |
| 9 | Dispense more than prescribed quantity | Rejected: R2 |
| 10 | Dispense after revocation | Rejected: R5 |
| 11 | Prescription history after fulfillment | Exactly one write — never mutated |
| 12 | Regulator reads patient data | Rejected: `UNAUTHORIZED` — private collection excludes regulator |

**About scenario 8.** Transaction time comes from the real clock, so expiry cannot be fast-forwarded on a live ledger. `seed.sh` issues a 1-day prescription; when `fraud-scenarios.sh` runs more than a day later, scenario 8 runs live. Until then it is reported as *skipped*, and R3 remains proven by the chaincode unit tests (AC-8).

## Live Demo Sequence (8–10 minutes)

Start with `./run-demo.sh` (before the audience arrives — it takes ~2–3 minutes), then use the web UI:

1. **Show the network** — `docker ps`, point out five independent peers each with its own ledger and CouchDB.
2. **Issue a prescription** as `dr.smith` for an `NDPS` drug (morphine), zero refills.
3. **Show it on a pharmacy peer** — query from PharmacyX, proving cross-org visibility without any data transfer between hospital and pharmacy systems.
4. **Fulfill at PharmacyX** as `pharm.jones`. Status flips to `FULLY_FULFILLED`.
5. **The key moment** — attempt to fulfill the same prescription at PharmacyY as `pharm.lee`. Rejected. Explain that PharmacyY never contacted PharmacyX; it reached this conclusion from its own ledger copy, and HospitalA's peer independently agreed.
6. **Show immutability** — run the history query on the prescription. Exactly one entry. The status changed without the record ever being touched.
7. **Show role separation** — log in as `dr.smith`, attempt a dispense. Rejected by chaincode, not by the UI.
8. **Show privacy** — log in as `auditor.gov`, open the same prescription. Full audit trail visible; patient name is not, and the salted hash cannot be reversed.
9. **Wrap up** — run `demo/fraud-scenarios.sh --pause` in a terminal to walk through every fraud rule.

## Teardown

```bash
./run-demo.sh stop      # or, network only: network/scripts/down.sh
```

This removes the containers, their volumes, and the `dev-peer*` chaincode containers and images. Chaincode containers survive a plain `docker compose down` and would serve stale chaincode on the next run, which is why `down.sh` prunes them. Crypto material and the channel block are kept; `generateArtifacts.sh` regenerates them.
