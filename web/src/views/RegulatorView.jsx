import { useState } from 'react';
import { useApi } from '../ApiContext.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import FulfillmentList from '../components/FulfillmentList.jsx';
import Panel from '../components/Panel.jsx';
import PrescriptionDetails from '../components/PrescriptionDetails.jsx';
import PrescriptionLookup from '../components/PrescriptionLookup.jsx';
import { Button } from '../components/fields.jsx';
import { useAction } from '../useAction.js';

export default function RegulatorView() {
  const api = useApi();
  const lookup = useAction();
  const privacy = useAction();
  const [record, setRecord] = useState(null);
  const [patient, setPatient] = useState(null);

  const onLookup = (id) =>
    lookup.run(async () => {
      setPatient(null);
      privacy.clearError();
      const [prescription, { status }, fulfillments, history] = await Promise.all([
        api.prescription(id),
        api.status(id),
        api.fulfillments(id),
        api.history(id),
      ]);
      setRecord({ prescription, status, fulfillments, history: history.entries });
    });

  const tryPatient = () => privacy.run(async () => setPatient(await api.patient(record.prescription.prescriptionId)));

  return (
    <div className="space-y-4">
      <Panel title="Audit a prescription">
        <PrescriptionLookup onLookup={onLookup} busy={lookup.busy} />
        <ErrorBanner error={lookup.error} />
      </Panel>

      {record && (
        <>
          <Panel title="Public record">
            <PrescriptionDetails prescription={record.prescription} status={record.status} />
          </Panel>

          <Panel
            title={`Transaction history (${record.history.length} write${record.history.length === 1 ? '' : 's'})`}
          >
            <p className="mb-2 text-sm text-slate-600">
              Every write to the prescription record. One entry means it was never modified — its status is derived from
              separate fulfillment and revocation events.
            </p>
            <table className="w-full text-left text-sm">
              <thead className="text-slate-500">
                <tr>
                  <th>Transaction ID</th>
                  <th>Timestamp</th>
                  <th>Validation</th>
                  <th>Endorsed by</th>
                </tr>
              </thead>
              <tbody>
                {record.history.map((entry) => (
                  <tr key={entry.txId} className="border-t border-slate-100">
                    <td className="font-mono text-xs" title={entry.txId}>
                      {entry.txId.slice(0, 16)}…
                    </td>
                    <td>{entry.timestamp}</td>
                    <td>{entry.validationCode}</td>
                    <td>{entry.endorsers.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>

          <Panel title="Fulfillments">
            <FulfillmentList fulfillments={record.fulfillments} />
          </Panel>

          <Panel title="Patient data">
            <p className="mb-2 text-sm text-slate-600">
              The regulator sees only the salted hash above. Patient details live in a private collection shared by
              hospitals and pharmacies only.
            </p>
            <Button variant="secondary" onClick={tryPatient} disabled={privacy.busy}>
              Try to read patient data
            </Button>
            <ErrorBanner error={privacy.error} />
            {patient && <p className="mt-2 text-sm text-red-700">Unexpectedly readable: {patient.patientName}</p>}
          </Panel>
        </>
      )}
    </div>
  );
}
