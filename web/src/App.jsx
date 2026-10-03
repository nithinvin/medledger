import { useMemo, useState } from 'react';
import { createApiClient } from './api.js';
import { ApiContext } from './ApiContext.jsx';
import DoctorView from './views/DoctorView.jsx';
import LoginView from './views/LoginView.jsx';
import PharmacistView from './views/PharmacistView.jsx';
import RegulatorView from './views/RegulatorView.jsx';

const SESSION_KEY = 'medledger.session';
const VIEWS = { doctor: DoctorView, pharmacist: PharmacistView, regulator: RegulatorView };

function loadSession() {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY)) ?? null;
  } catch {
    return null;
  }
}

function saveSession(session) {
  try {
    if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // storage unavailable (private mode): session lives in memory only
  }
}

export default function App({ apiFactory = createApiClient }) {
  const [session, setSession] = useState(loadSession);
  const token = session?.token;
  const api = useMemo(() => apiFactory({ getToken: () => token }), [apiFactory, token]);

  const changeSession = (next) => {
    saveSession(next);
    setSession(next);
  };

  const View = session ? VIEWS[session.user.role] : null;

  return (
    <ApiContext.Provider value={api}>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <h1 className="text-lg font-bold text-slate-800">MedLedger</h1>
          {session && (
            <div className="flex items-center gap-3 text-sm">
              <span>
                <span className="font-medium">{session.user.username}</span>{' '}
                <span className="text-slate-500">
                  {session.user.msp} · {session.user.role}
                </span>
              </span>
              <button className="text-blue-600 hover:underline" onClick={() => changeSession(null)}>
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-6">
        {View ? <View key={session.user.username} /> : <LoginView onLogin={changeSession} />}
      </main>
    </ApiContext.Provider>
  );
}
