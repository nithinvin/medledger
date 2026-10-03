# MedLedger

Prescription issuance and fulfillment tracking on Hyperledger Fabric: five organizations (two hospitals, two pharmacies, a regulator) share one ledger, and chaincode rejects forged, duplicate, and cross-pharmacy fraudulent prescriptions — without any organization having to trust another's servers.

A demonstration project. The controlled-drug rules use an India jurisdiction profile (NDPS Act, Schedules X / H1 / H) as illustrative data, not legal guidance.

**Documentation:** start at [docs/README.md](docs/README.md) — it maps every question to the file that answers it.

## Run the Demo

1. **Prerequisites** (openSUSE Leap 16 or Ubuntu 24.04 on WSL2, ~8 GB RAM for Docker): Docker with Compose v2, Go 1.24+, Node.js 22, `jq`, `curl`, `openssl`, and the Fabric 2.5.16 binaries and images. Exact install commands: [runbook → Install](docs/runbook.md#install).
2. **Start everything** from the repository root (~2–3 minutes):
   ```bash
   ./run-demo.sh
   ```
3. **Open the web UI** at **http://localhost:5173** and sign in with one click:

   | Account | Organization | Can |
   |---|---|---|
   | `dr.smith`, `dr.patel` | HospitalA, HospitalB | issue and revoke prescriptions |
   | `pharm.jones`, `pharm.lee` | PharmacyX, PharmacyY | check eligibility and dispense |
   | `auditor.gov` | Regulator | audit history; sees patient data only as a hash |

4. **Try the key moment:** issue a zero-refill prescription as `dr.smith`, dispense it as `pharm.jones`, then try to dispense it again as `pharm.lee`. PharmacyY's own copy of the ledger refuses (rule R1) — it never had to ask PharmacyX. The full 8–10 minute walkthrough: [runbook → Live Demo Sequence](docs/runbook.md#live-demo-sequence-810-minutes).
5. **Run every fraud scenario** in a terminal:
   ```bash
   demo/fraud-scenarios.sh --pause
   ```
6. **Stop** when done:
   ```bash
   ./run-demo.sh stop
   ```

Running the pieces individually (network scripts, API, web UI, tests) is described in the [runbook](docs/runbook.md#network-scripts).
