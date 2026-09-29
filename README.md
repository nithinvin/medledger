# MedLedger

Prescription issuance and fulfillment tracking on Hyperledger Fabric.

- Specification: [docs/spec.md](docs/spec.md)
- Design: [docs/design.md](docs/design.md)
- Implementation plan: [docs/plan.md](docs/plan.md)
- Engineering rules: [CONSTITUTION.md](CONSTITUTION.md)

## Prerequisites (Phase 0)

Fabric binaries and images are **not** committed. From the repo root:

```bash
curl -sSLO https://raw.githubusercontent.com/hyperledger/fabric/main/scripts/install-fabric.sh
chmod +x install-fabric.sh
./install-fabric.sh --fabric-version 2.5.16 --ca-version 1.5.22 binary docker
docker pull couchdb:3.3.3
export PATH="$PWD/bin:$PATH"
```

Full setup and one-command demo instructions arrive in Phase 8.
