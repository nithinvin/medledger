import StatusBadge from './StatusBadge.jsx';

// Public prescription fields. Patient data is never part of this record —
// only its salted hash (docs/spec.md#fr-7--private-patient-data).
export default function PrescriptionDetails({ prescription, status }) {
  const rows = [
    ['Drug', `${prescription.drugName} (${prescription.drugCode})`],
    ['Control class', prescription.controlClass],
    ['Quantity per fill', prescription.quantity],
    ['Refills allowed', prescription.refillsAllowed],
    ['Dosage', prescription.dosageInstructions],
    ['Issued by', `${prescription.doctorId} @ ${prescription.doctorMSP}`],
    ['Issued at', prescription.issuedAt],
    ['Valid for', `${prescription.validityDays} days`],
    ['Patient data hash', prescription.patientDataHash],
  ];
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span className="font-mono text-xs text-slate-500">{prescription.prescriptionId}</span>
        {status && <StatusBadge status={status} />}
      </div>
      <dl className="grid grid-cols-[10rem_1fr] gap-x-3 gap-y-1 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-slate-500">{label}</dt>
            <dd className={label === 'Patient data hash' ? 'font-mono text-xs break-all' : ''}>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
