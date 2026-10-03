import { useState } from 'react';
import { useApi } from '../ApiContext.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import { Button, TextField } from '../components/fields.jsx';
import { useAction } from '../useAction.js';

const EMPTY = {
  patientName: '',
  patientDOB: '',
  patientRef: '',
  drugCode: '',
  quantity: '30',
  dosageInstructions: '',
  refillsAllowed: '0',
  validityDays: '30',
};

// Issue form. Patient fields go to the API, which sends them to the chaincode
// only as transient data (docs/design/application.md#transient-data-and-salt).
export default function IssueForm({ profile, onIssued }) {
  const api = useApi();
  const { run, busy, error } = useAction();
  const [form, setForm] = useState(EMPTY);
  const set = (field) => (event) => setForm({ ...form, [field]: event.target.value });
  const limits = profile?.controlClasses ?? {};
  const selected = profile?.drugs.find((d) => d.drugCode === form.drugCode);

  const submit = (event) => {
    event.preventDefault();
    run(async () => {
      const prescription = await api.issue({
        ...form,
        quantity: Number(form.quantity),
        refillsAllowed: Number(form.refillsAllowed),
        validityDays: Number(form.validityDays),
      });
      setForm(EMPTY);
      onIssued(prescription);
    });
  };

  return (
    <form onSubmit={submit} className="grid grid-cols-2 gap-3">
      <TextField label="Patient name" value={form.patientName} onChange={set('patientName')} required />
      <TextField label="Date of birth" type="date" value={form.patientDOB} onChange={set('patientDOB')} required />
      <TextField label="Patient reference" value={form.patientRef} onChange={set('patientRef')} required />
      <label className="block text-sm">
        <span className="text-slate-600">Drug</span>
        <select
          className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5"
          value={form.drugCode}
          onChange={set('drugCode')}
          required
        >
          <option value="">Select…</option>
          {profile?.drugs.map((d) => (
            <option key={d.drugCode} value={d.drugCode}>
              {d.drugName} — {d.controlClass} (max {limits[d.controlClass]?.maxRefills} refills)
            </option>
          ))}
        </select>
      </label>
      <TextField label="Quantity per fill" type="number" min="1" value={form.quantity} onChange={set('quantity')} />
      <TextField label="Refills" type="number" min="0" value={form.refillsAllowed} onChange={set('refillsAllowed')} />
      <TextField
        label="Valid for (days)"
        type="number"
        min="1"
        value={form.validityDays}
        onChange={set('validityDays')}
      />
      <TextField
        label="Dosage instructions"
        value={form.dosageInstructions}
        onChange={set('dosageInstructions')}
        required
      />
      <div className="col-span-2 flex items-center gap-3">
        <Button type="submit" disabled={busy}>
          Issue prescription
        </Button>
        {selected && <span className="text-xs text-slate-500">{limits[selected.controlClass]?.legalBasis}</span>}
      </div>
      <div className="col-span-2">
        <ErrorBanner error={error} />
      </div>
    </form>
  );
}
