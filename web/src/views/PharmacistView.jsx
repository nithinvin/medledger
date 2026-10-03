import { useState } from 'react';
import { useApi } from '../ApiContext.jsx';
import CrossRoleAttempt from '../components/CrossRoleAttempt.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import FulfillmentList from '../components/FulfillmentList.jsx';
import Panel from '../components/Panel.jsx';
import PrescriptionDetails from '../components/PrescriptionDetails.jsx';
import PrescriptionLookup from '../components/PrescriptionLookup.jsx';
import RuleChecklist from '../components/RuleChecklist.jsx';
import { Button, TextField } from '../components/fields.jsx';
import { useAction } from '../useAction.js';

const SAMPLE_ISSUE = {
  patientName: 'Test Patient',
  patientDOB: '1990-01-01',
  patientRef: 'PT-0000',
  drugCode: 'IN-PARA-500',
  quantity: 10,
  dosageInstructions: '1 tablet as needed',
  refillsAllowed: 0,
  validityDays: 10,
};

export default function PharmacistView() {
  const api = useApi();
  const lookup = useAction();
  const check = useAction();
  const dispense = useAction();
  const [record, setRecord] = useState(null);
  const [quantity, setQuantity] = useState('');
  const [eligibility, setEligibility] = useState(null);
  const [dispensed, setDispensed] = useState(null);

  const load = async (id) => {
    const [prescription, { status }, fulfillments, patient] = await Promise.all([
      api.prescription(id),
      api.status(id),
      api.fulfillments(id),
      api.patient(id),
    ]);
    setRecord({ prescription, status, fulfillments, patient });
    return prescription;
  };

  const onLookup = (id) =>
    lookup.run(async () => {
      setEligibility(null);
      setDispensed(null);
      const prescription = await load(id);
      setQuantity(String(prescription.quantity));
    });

  const onCheck = () =>
    check.run(async () => {
      const result = await api.eligibility(record.prescription.prescriptionId, quantity);
      setEligibility({ ...result, quantity });
    });

  const onDispense = () =>
    dispense.run(async () => {
      const id = record.prescription.prescriptionId;
      setDispensed(await api.fulfill(id, Number(quantity)));
      setEligibility(null);
      await load(id);
    });

  const canDispense = eligibility?.eligible && eligibility.quantity === quantity && !dispense.busy;

  return (
    <div className="space-y-4">
      <Panel title="Look up a prescription">
        <PrescriptionLookup onLookup={onLookup} busy={lookup.busy} />
        <ErrorBanner error={lookup.error} />
      </Panel>

      {record && (
        <>
          <Panel title="Prescription">
            <PrescriptionDetails prescription={record.prescription} status={record.status} />
            <p className="mt-3 text-sm">
              <span className="text-slate-500">Patient (private collection): </span>
              {record.patient.patientName}, born {record.patient.patientDOB}, ref {record.patient.patientRef}
            </p>
          </Panel>

          <Panel title="Check eligibility and dispense">
            <div className="flex items-end gap-2">
              <TextField
                label="Quantity"
                type="number"
                min="1"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
              <Button onClick={onCheck} disabled={check.busy}>
                Check rules
              </Button>
              <Button onClick={onDispense} disabled={!canDispense}>
                Dispense
              </Button>
            </div>
            <ErrorBanner error={check.error} />
            {eligibility && (
              <div className="mt-3">
                <p className={`mb-1 text-sm font-semibold ${eligibility.eligible ? 'text-green-700' : 'text-red-700'}`}>
                  {eligibility.eligible ? 'Eligible to dispense' : 'Not eligible'}
                </p>
                <RuleChecklist eligibility={eligibility} />
              </div>
            )}
            <ErrorBanner error={dispense.error} />
            {dispensed && <p className="mt-2 text-sm text-green-700">Dispensed fill #{dispensed.sequence + 1}.</p>}
          </Panel>

          <Panel title="Fulfillment history">
            <FulfillmentList fulfillments={record.fulfillments} />
          </Panel>
        </>
      )}

      <CrossRoleAttempt
        title="Fraud attempt: issue as a pharmacist"
        description="Pharmacies may only dispense. The API forwards this request; the chaincode refuses it."
        buttonLabel="Attempt to issue"
        attempt={() => api.issue(SAMPLE_ISSUE)}
      />
    </div>
  );
}
