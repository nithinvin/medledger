# MedLedger

Prescription issuance and fulfillment tracking on Hyperledger Fabric: five organizations (two hospitals, two pharmacies, a regulator) share one ledger, and chaincode rejects forged, duplicate, and cross-pharmacy fraudulent prescriptions.

**Documentation:** start at [docs/README.md](docs/README.md) — it maps every question to the file that answers it.

## Quick Start

Install the prerequisites per the [runbook](docs/runbook.md#install), then from the repository root:

```bash
network/scripts/generateArtifacts.sh   # crypto material + channel genesis block
network/scripts/up.sh                  # start the 18 containers
network/scripts/createChannel.sh       # join orderers and peers to prescription-channel
network/scripts/down.sh                # tear everything down
```

The full demo (users, chaincode, API, web UI) arrives in later phases — see [plan status](docs/plan.md#status).
