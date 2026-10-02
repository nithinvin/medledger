# MedLedger

Prescription issuance and fulfillment tracking on Hyperledger Fabric: five organizations (two hospitals, two pharmacies, a regulator) share one ledger, and chaincode rejects forged, duplicate, and cross-pharmacy fraudulent prescriptions.

**Documentation:** start at [docs/README.md](docs/README.md) — it maps every question to the file that answers it.

## Quick Start

Install the prerequisites per the [runbook](docs/runbook.md#install), then from the repository root:

```bash
network/scripts/generateArtifacts.sh   # crypto material + channel genesis block
network/scripts/up.sh                  # start the 18 containers
network/scripts/createChannel.sh       # join orderers and peers to prescription-channel
network/scripts/enrollUsers.sh         # enroll the five demo users
network/scripts/deployChaincode.sh     # deploy the chaincode (~2 min)
network/scripts/smokeTest.sh           # end-to-end check: issue, fulfill, fraud, privacy
(cd api && npm ci && npm start)        # REST API on http://127.0.0.1:3000
network/scripts/down.sh                # tear everything down
```

The web UI arrivess in later phases — see [plan status](docs/plan.md#status).
