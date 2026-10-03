import { RULE_STATE, ruleChecklist } from '../rules.js';

const STATE_UI = {
  [RULE_STATE.PASS]: { icon: '✓', className: 'text-green-700', text: 'passed' },
  [RULE_STATE.FAIL]: { icon: '✗', className: 'text-red-700 font-semibold', text: 'failed' },
  [RULE_STATE.NOT_EVALUATED]: { icon: '–', className: 'text-slate-400', text: 'not evaluated' },
  [RULE_STATE.ISSUANCE_ONLY]: { icon: '·', className: 'text-slate-400', text: 'checked at issuance' },
};

export default function RuleChecklist({ eligibility }) {
  return (
    <ul className="space-y-1 text-sm" aria-label="Fraud rule checklist">
      {ruleChecklist(eligibility).map(({ rule, label, state }) => {
        const ui = STATE_UI[state];
        return (
          <li key={rule} className={ui.className} data-rule={rule} data-state={state}>
            <span className="inline-block w-5">{ui.icon}</span>
            <span className="font-mono">{rule}</span> {label} — {ui.text}
          </li>
        );
      })}
      {!eligibility.eligible && eligibility.reason && (
        <li className="pt-1 text-red-700">Reason: {eligibility.reason}</li>
      )}
    </ul>
  );
}
