import { useState } from 'react';
import { useAction } from '../useAction.js';
import ErrorBanner from './ErrorBanner.jsx';
import Panel from './Panel.jsx';
import { Button } from './fields.jsx';

// Demo panel: deliberately attempts an action this role may not perform. The
// API forwards it; the chaincode rejects it (decision D19).
export default function CrossRoleAttempt({ title, description, buttonLabel, attempt, children }) {
  const { run, busy, error } = useAction();
  const [outcome, setOutcome] = useState(null);
  const onClick = async () => {
    setOutcome(null);
    const result = await run(attempt);
    if (result !== undefined) setOutcome('The action unexpectedly succeeded.');
  };
  return (
    <Panel title={title} tone="warning">
      <p className="mb-2 text-sm text-slate-600">{description}</p>
      {children}
      <Button variant="danger" onClick={onClick} disabled={busy}>
        {buttonLabel}
      </Button>
      <ErrorBanner error={error} />
      {outcome && <p className="mt-2 text-sm text-red-700">{outcome}</p>}
    </Panel>
  );
}
