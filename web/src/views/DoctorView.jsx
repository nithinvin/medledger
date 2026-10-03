import { useCallback, useEffect, useState } from 'react';
import { useApi } from '../ApiContext.jsx';
import CrossRoleAttempt from '../components/CrossRoleAttempt.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import Panel from '../components/Panel.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import { Button, TextField } from '../components/fields.jsx';
import { useAction } from '../useAction.js';
import IssueForm from './IssueForm.jsx';

export default function DoctorView() {
  const api = useApi();
  const load = useAction();
  const revoke = useAction();
  const [profile, setProfile] = useState(null);
  const [mine, setMine] = useState([]);
  const [lastIssued, setLastIssued] = useState(null);
  const [revoking, setRevoking] = useState(null);
  const [reason, setReason] = useState('');
  const [attemptId, setAttemptId] = useState('');

  const refresh = useCallback(async () => {
    const list = await api.myPrescriptions();
    const withStatus = await Promise.all(
      list.map(async (p) => ({ prescription: p, status: (await api.status(p.prescriptionId)).status })),
    );
    setMine(withStatus);
  }, [api]);

  const { run: runLoad } = load;
  useEffect(() => {
    runLoad(async () => {
      setProfile(await api.drugs());
      await refresh();
    });
  }, [api, refresh, runLoad]);

  const onIssued = async (prescription) => {
    setLastIssued(prescription);
    setAttemptId(prescription.prescriptionId);
    await load.run(refresh);
  };

  const confirmRevoke = (event) => {
    event.preventDefault();
    revoke.run(async () => {
      await api.revoke(revoking, reason);
      setRevoking(null);
      setReason('');
      await refresh();
    });
  };

  return (
    <div className="space-y-4">
      <Panel title="Issue a prescription">
        <IssueForm profile={profile} onIssued={onIssued} />
        {lastIssued && (
          <p className="mt-3 text-sm text-green-700">
            Issued <span className="font-mono">{lastIssued.prescriptionId}</span> — give this ID to the pharmacy.
          </p>
        )}
      </Panel>

      <Panel title="My prescriptions">
        <ErrorBanner error={load.error} />
        {mine.length === 0 && !load.busy && <p className="text-sm text-slate-500">None yet.</p>}
        <ul className="divide-y divide-slate-100">
          {mine.map(({ prescription: p, status }) => (
            <li key={p.prescriptionId} className="flex items-center justify-between py-2 text-sm">
              <div>
                <div className="font-medium">
                  {p.drugName} · {p.quantity} units · {p.refillsAllowed} refills
                </div>
                <div className="font-mono text-xs text-slate-500">{p.prescriptionId}</div>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={status} />
                {status !== 'REVOKED' && (
                  <Button variant="secondary" onClick={() => setRevoking(p.prescriptionId)}>
                    Revoke
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
        {revoking && (
          <form onSubmit={confirmRevoke} className="mt-3 flex items-end gap-2">
            <div className="flex-1">
              <TextField
                label={`Reason for revoking ${revoking}`}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                required
              />
            </div>
            <Button variant="danger" type="submit" disabled={revoke.busy}>
              Confirm revoke
            </Button>
            <Button variant="secondary" type="button" onClick={() => setRevoking(null)}>
              Cancel
            </Button>
          </form>
        )}
        <ErrorBanner error={revoke.error} />
      </Panel>

      <CrossRoleAttempt
        title="Fraud attempt: dispense as a doctor"
        description="Doctors may only issue. The API forwards this request; the chaincode refuses it."
        buttonLabel="Attempt dispense"
        attempt={() => api.fulfill(attemptId, 1)}
      >
        <div className="mb-2">
          <TextField label="Prescription ID" value={attemptId} onChange={(e) => setAttemptId(e.target.value)} />
        </div>
      </CrossRoleAttempt>
    </div>
  );
}
