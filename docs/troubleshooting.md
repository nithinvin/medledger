# Troubleshooting — MedLedger

Symptom → cause → fix, grouped by area. Add new entries to the matching table when a failure is diagnosed. Fabric terms are explained in the [glossary](glossary.md).

---

## Setup and Toolchain

| Symptom | Cause | Fix |
|---|---|---|
| Chaincode build fails with a Go toolchain/version error | `go.mod` `go` directive is newer than `fabric-ccenv`'s Go | Keep the pins in [architecture.md](design/architecture.md#technology-stack-and-versions); never `go get …@latest` for the contract API |
| `golangci-lint` fails with `could not load export data ... unsupported version: 2` | Linter older than the Go toolchain (e.g. openSUSE's 1.60.3 package) | Install v2.14.0 per the [runbook](runbook.md#install), or use its Docker command |
| Bind mounts or Docker socket denied on openSUSE | SELinux enforcing | Every compose service already sets `label=disable`; check it was not removed |
| Chaincode build fails with `lookup proxy.golang.org: i/o timeout` | Containers cannot resolve internet names — e.g. `/etc/docker/daemon.json` lists DNS servers unreachable from the current network (work/VPN resolvers) | Vendor modules before packaging (`go mod vendor`); `deployChaincode.sh` does this ([D16](decisions.md)) |

## Windows / WSL

| Symptom | Cause | Fix |
|---|---|---|
| `permission denied while trying to connect to the Docker daemon socket` | Your user joined the `docker` group in a shell opened earlier | Close and reopen the Ubuntu terminal (or `wsl --shutdown` in PowerShell, then reopen) |
| `docker: command not found` inside Ubuntu with Docker Desktop installed | WSL integration not enabled for the distro | Docker Desktop → *Settings → Resources → WSL integration* → enable **Ubuntu-24.04**, then reopen the terminal |
| `Cannot connect to the Docker daemon` with Docker Engine in WSL | systemd off, so the daemon did not start | Enable systemd in `/etc/wsl.conf` ([runbook](runbook.md#1-wsl-windows-11-only)), `wsl --shutdown`, reopen; then `sudo systemctl enable --now docker` |
| Windows browser cannot open `http://localhost:5173` though `curl http://127.0.0.1:5173` works inside WSL | WSL localhost forwarding disabled or broken (e.g. by VPN software) | Check `%UserProfile%\.wslconfig` does not set `localhostForwarding=false`; `wsl --shutdown` and start again. On Windows 11 22H2+, `networkingMode=mirrored` under `[wsl2]` also works |
| Statuses, expiry, or refill intervals look off after the laptop slept; TLS errors such as `certificate is not yet valid` | The WSL clock drifted behind Windows during sleep | `sudo hwclock -s`, or `wsl --shutdown` and reopen; then rerun `./run-demo.sh` if certificates were generated with the wrong time |
| `./run-demo.sh` stops with `timed out after 60s waiting for peer0.hospitala`; `docker logs peer0.hospitala.example.com` shows `dial tcp …:5984: i/o timeout` though CouchDB is up | Containers cannot reach each other on the `medledger` Docker network (host → container still works). The WSL/Docker networking state is stale, seen after a PC reboot; rerunning the scripts does not clear it | `wsl --shutdown` in PowerShell, reopen Ubuntu, rerun `./run-demo.sh`. Check with `docker exec couchdb-b curl -s -m5 http://couchdb-a:5984/_up`: a timeout confirms it |
| Scripts fail with `$'\r': command not found` | Repository cloned on the Windows side (CRLF line endings) | Clone inside WSL under `~/` ([runbook](runbook.md#4-clone-the-repository)) |
| Everything is very slow; file permission errors | Repository is under `/mnt/c/...` | Clone inside WSL under `~/` |

## Crypto Material and Channel

| Symptom | Cause | Fix |
|---|---|---|
| Every endorsement fails the `.peer` policy, though everything before chaincode commit worked | `EnableNodeOUs` off for an org | Set `EnableNodeOUs: true` for every org in `crypto-config.yaml`; regenerate |
| Chaincode authorization fails with the wrong org, or `GetMSPID()` returns an unexpected value | MSP ID mismatch between `crypto-config.yaml` domain names and `configtx.yaml` `ID` fields | `ID` must be exactly the value in [Organizations and Hostnames](design/architecture.md#organizations-and-hostnames), e.g. `HospitalAMSP` |
| Strange TLS/identity errors after regenerating artifacts | Containers still hold the old certificates | `down.sh`, then `generateArtifacts.sh`, `up.sh`, `createChannel.sh` (the script now refuses to regenerate while the network is up) |
| `x509: certificate is valid for …, not localhost` | Connecting by a name missing from the certificate's SAN list | Use `localhost` / the Docker hostname; both are in the node certificates' SANs |

## Identities (Fabric CA)

| Symptom | Cause | Fix |
|---|---|---|
| Every chaincode call fails with a confusing "unauthorized"; `GetAttributeValue("role")` is empty | Attribute registered without `:ecert`, so it is in the CA database but not the certificate | Re-register with `--id.attrs 'role=<role>:ecert'`, re-enroll; verify with `openssl x509 -text` |
| Every transaction from a user is rejected as an unknown identity; `openssl verify` against the org `cacerts` fails | The CA generated its own root instead of using cryptogen's `ca/` key | Start the CA with `FABRIC_CA_SERVER_CA_CERTFILE` / `_KEYFILE` pointing at the org's cryptogen `ca/` ([Identity and CA Trust](design/architecture.md#identity-and-ca-trust)) |

## Chaincode Deployment

| Symptom | Cause | Fix |
|---|---|---|
| `checkcommitreadiness` shows `false` for an org | That org's approve used a different policy, collection config, or sequence number | Re-approve with identical arguments |
| `ENDORSEMENT_POLICY_FAILURE` at commit | `--peerAddresses` omitted a peer required by the policy, or NodeOUs not enabled | Pass a hospital and a pharmacy peer; check NodeOUs |
| Empty private data on read | Transient map keys mismatched, or values not base64-encoded | Match the keys in [Function Behaviour](design/chaincode.md#function-behaviour); base64-encode values |
| `MVCC_READ_CONFLICT` | Two transactions writing the same key in one block | Expected under concurrent load; retry |
| Old chaincode behaviour after redeploying | Stale `dev-peer*` containers | `down.sh` prunes them |
| Hash or byte comparison of stored JSON fails on the network but passes in unit tests | CouchDB returns JSON re-serialized with sorted keys | Decode, then re-encode via the Go struct before hashing or comparing; the test mock now re-serializes JSON the same way |
| `deployChaincode.sh` says the sequence is already committed, but the code changed | Same `CC_SEQUENCE` as the committed definition | Bump `CC_VERSION` and `CC_SEQUENCE` ([runbook](runbook.md#network-scripts)) |

## API Gateway

| Symptom | Cause | Fix |
|---|---|---|
| Jest: `Must use import to load ES Module: …/@noble/curves/…` | A Jest test imported `@hyperledger/fabric-gateway`; Jest on Node 22 cannot load its ESM-only dependency | Don't import `gateway.js` in Jest tests: inject a fake service, or start the real server like `test/live.test.js` ([D18](decisions.md)) |
| API returns `500` and logs `14 UNAVAILABLE` | The network is down, or the peer for that user's org is not running | `network/scripts/up.sh` (and redeploy chaincode after `down.sh`) |
| `server.js` exits at start: `expected one private key …` or file not found | Demo users not enrolled | `network/scripts/enrollUsers.sh` |
| Logins stop working after restarting the API | Random per-process JWT secret | Set `MEDLEDGER_JWT_SECRET` |

## Web UI

| Symptom | Cause | Fix |
|---|---|---|
| Banner: `NETWORK: cannot reach the MedLedger API` | API not running on port 3000 | `cd api && npm start` |
| `npm run dev` fails: `Port 5173 is already in use` | Another dev server is running (`strictPort` is on) | Stop the other process, e.g. `pkill -f vite` |
| Signed out after restarting the API | Random per-process JWT secret | Set `MEDLEDGER_JWT_SECRET`, or sign in again |
| `run-demo.sh` stops with `port 3000 is in use` (or 5173) | An API or Vite started by hand is still running | `./run-demo.sh stop`, or stop the process listening on that port |
| `fraud-scenarios.sh` reports scenario 8 *skipped* | The seeded 1-day prescription has not expired yet | Expected; rerun more than a day after `seed.sh`. R3 is proven by the chaincode unit tests ([runbook](runbook.md#demo-scenarios)) |

## Shell Scripts

| Symptom | Cause | Fix |
|---|---|---|
| A `cmd \| grep -q` check fails intermittently, more often as output grows | Under `set -o pipefail`, `grep -q` exits on the first match and the writer dies of SIGPIPE, failing the pipeline | Capture first, then search: `out="$(cmd)" && grep -q pattern <<<"$out"` |

## Expected Log Noise

These look like errors but are normal:

| Log line | When | Why it is harmless |
|---|---|---|
| `gossip.comm ... Authentication failed: failed classifying identity` | During `createChannel.sh`, for a second or two | A peer gossips with peers not yet on the channel, whose MSPs it cannot classify yet. Persistent occurrences after all peers joined mean an MSP problem. |
| CouchDB messages about missing `_users` database | CouchDB start-up | Single-node CouchDB without system databases; Fabric does not need them |
| `WARN [msp] loadCertificateAt -> Failed loading ...OU certificate` | Host CLI using a user MSP whose `cacerts/` filename differs from `config.yaml` | Peers classify identities with the channel MSP, so requests still succeed. `enrollUsers.sh` renames the file to avoid the warning. |
| `core.comm ... Server TLS handshake failed ... remote error: tls: bad certificate` between peers | A few seconds after the containers restart (e.g. after a reboot) | A peer has not loaded the channel's TLS roots for the other orgs yet and briefly rejects their certificates. Persistent occurrences mean a TLS/MSP problem. |
| `enrollUsers.sh` registers every user again | After `down.sh` | `down.sh` deletes the CA databases with the volumes; re-registration is expected |
