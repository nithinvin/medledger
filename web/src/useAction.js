// Runs an async action, tracking busy and error state for the UI.
import { useCallback, useState } from 'react';

export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const run = useCallback(async (action) => {
    setBusy(true);
    setError(null);
    try {
      return await action();
    } catch (err) {
      setError(err);
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);

  return { run, busy, error, clearError: () => setError(null) };
}
