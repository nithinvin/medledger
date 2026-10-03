import { DEMO_ACCOUNTS, demoPassword } from '../accounts.js';
import { useApi } from '../ApiContext.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import Panel from '../components/Panel.jsx';
import { useAction } from '../useAction.js';

export default function LoginView({ onLogin }) {
  const api = useApi();
  const { run, busy, error } = useAction();
  const login = (username) =>
    run(async () => {
      const session = await api.login(username, demoPassword(username));
      onLogin(session);
    });
  return (
    <div className="mx-auto mt-16 max-w-md">
      <Panel title="Sign in as a demo user">
        <ul className="space-y-2">
          {DEMO_ACCOUNTS.map(({ username, org, role }) => (
            <li key={username}>
              <button
                className="flex w-full justify-between rounded border border-slate-200 px-3 py-2 text-left hover:bg-slate-50 disabled:opacity-50"
                onClick={() => login(username)}
                disabled={busy}
              >
                <span className="font-medium">{username}</span>
                <span className="text-sm text-slate-500">
                  {org} · {role}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <ErrorBanner error={error} />
      </Panel>
    </div>
  );
}
