import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../src/App.jsx';
import { fakeApi } from './helpers.jsx';

beforeEach(() => sessionStorage.clear());

test('login routes to the view for the role; sign out returns to login', async () => {
  const api = fakeApi({
    login: jest
      .fn()
      .mockResolvedValue({ token: 't', user: { username: 'auditor.gov', role: 'regulator', msp: 'RegulatorMSP' } }),
  });
  const apiFactory = jest.fn(() => api);
  render(<App apiFactory={apiFactory} />);

  await userEvent.click(screen.getByRole('button', { name: /auditor\.gov/ }));
  expect(await screen.findByText('Audit a prescription')).toBeInTheDocument();
  expect(apiFactory.mock.calls.at(-1)[0].getToken()).toBe('t');

  await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
  expect(screen.getByText('Sign in as a demo user')).toBeInTheDocument();
  expect(sessionStorage.getItem('medledger.session')).toBeNull();
});

test('restores a saved session', () => {
  sessionStorage.setItem(
    'medledger.session',
    JSON.stringify({ token: 't', user: { username: 'pharm.jones', role: 'pharmacist', msp: 'PharmacyXMSP' } }),
  );
  render(<App apiFactory={() => fakeApi()} />);
  expect(screen.getByText('Look up a prescription')).toBeInTheDocument();
});

test('a corrupt saved session falls back to login', () => {
  sessionStorage.setItem('medledger.session', '{not json');
  render(<App apiFactory={() => fakeApi()} />);
  expect(screen.getByText('Sign in as a demo user')).toBeInTheDocument();
});
