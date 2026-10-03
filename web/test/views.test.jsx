import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DoctorView from '../src/views/DoctorView.jsx';
import LoginView from '../src/views/LoginView.jsx';
import PharmacistView from '../src/views/PharmacistView.jsx';
import RegulatorView from '../src/views/RegulatorView.jsx';
import { PRESCRIPTION, RX, chaincodeRejection, fakeApi, renderWithApi } from './helpers.jsx';

describe('LoginView', () => {
  test('signs in with the demo password for the chosen account', async () => {
    const session = { token: 't', user: { username: 'pharm.lee', role: 'pharmacist' } };
    const api = fakeApi({ login: jest.fn().mockResolvedValue(session) });
    const onLogin = jest.fn();
    renderWithApi(<LoginView onLogin={onLogin} />, api);
    await userEvent.click(screen.getByRole('button', { name: /pharm\.lee/ }));
    expect(api.login).toHaveBeenCalledWith('pharm.lee', 'pharm.leepw');
    expect(onLogin).toHaveBeenCalledWith(session);
  });

  test('shows a login failure', async () => {
    const api = fakeApi({ login: jest.fn().mockRejectedValue(chaincodeRejection('UNAUTHENTICATED', 'invalid', 401)) });
    renderWithApi(<LoginView onLogin={jest.fn()} />, api);
    await userEvent.click(screen.getByRole('button', { name: /dr\.smith/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('UNAUTHENTICATED');
  });
});

describe('DoctorView', () => {
  test('lists own prescriptions with derived status', async () => {
    const api = fakeApi({
      myPrescriptions: jest.fn().mockResolvedValue([PRESCRIPTION]),
      status: jest.fn().mockResolvedValue({ status: 'FULLY_FULFILLED' }),
    });
    renderWithApi(<DoctorView />, api);
    expect(await screen.findByText('FULLY_FULFILLED')).toBeInTheDocument();
    expect(screen.getByText(RX)).toBeInTheDocument();
  });

  test('issues a prescription with numeric fields and shows the new ID', async () => {
    const api = fakeApi({ issue: jest.fn().mockResolvedValue({ ...PRESCRIPTION, prescriptionId: 'new-id' }) });
    renderWithApi(<DoctorView />, api);
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText('Drug'), 'IN-MORPH-10');
    await user.type(screen.getByLabelText('Patient name'), 'Priya Sharma');
    await user.type(screen.getByLabelText('Date of birth'), '1985-03-12');
    await user.type(screen.getByLabelText('Patient reference'), 'PT-4471');
    await user.type(screen.getByLabelText('Dosage instructions'), '1 tablet every 12 hours');
    await user.click(screen.getByRole('button', { name: 'Issue prescription' }));

    expect(api.issue).toHaveBeenCalledWith({
      patientName: 'Priya Sharma',
      patientDOB: '1985-03-12',
      patientRef: 'PT-4471',
      drugCode: 'IN-MORPH-10',
      quantity: 30,
      dosageInstructions: '1 tablet every 12 hours',
      refillsAllowed: 0,
      validityDays: 30,
    });
    expect(await screen.findByText('new-id')).toBeInTheDocument();
  });

  test('shows R6 when the chaincode rejects refills for an NDPS drug', async () => {
    const api = fakeApi({
      issue: jest.fn().mockRejectedValue(chaincodeRejection('R6', 'NDPS allows at most 0 refills')),
    });
    renderWithApi(<DoctorView />, api);
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText('Drug'), 'IN-MORPH-10');
    for (const [label, value] of [
      ['Patient name', 'P'],
      ['Date of birth', '1985-03-12'],
      ['Patient reference', 'R'],
      ['Dosage instructions', 'D'],
    ]) {
      await user.type(screen.getByLabelText(label), value);
    }
    await user.click(screen.getByRole('button', { name: 'Issue prescription' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('R6 — Refills exceed the control-class limit');
  });

  test('revokes with a reason and refreshes', async () => {
    const api = fakeApi({
      myPrescriptions: jest.fn().mockResolvedValue([PRESCRIPTION]),
      revoke: jest.fn().mockResolvedValue({}),
    });
    renderWithApi(<DoctorView />, api);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Revoke' }));
    await user.type(screen.getByLabelText(/Reason for revoking/), 'issued in error');
    await user.click(screen.getByRole('button', { name: 'Confirm revoke' }));
    expect(api.revoke).toHaveBeenCalledWith(RX, 'issued in error');
    await waitFor(() => expect(api.myPrescriptions).toHaveBeenCalledTimes(2));
  });

  test('cross-role attempt: dispensing as a doctor is shown as a chaincode rejection', async () => {
    const api = fakeApi({
      fulfill: jest
        .fn()
        .mockRejectedValue(chaincodeRejection('UNAUTHORIZED', 'role "doctor" may not call this function')),
    });
    renderWithApi(<DoctorView />, api);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Prescription ID'), RX);
    await user.click(screen.getByRole('button', { name: 'Attempt dispense' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Rejected by the chaincode');
    expect(alert).toHaveTextContent('may not call this function');
    expect(api.fulfill).toHaveBeenCalledWith(RX, 1);
  });
});

describe('PharmacistView', () => {
  async function lookUp(api) {
    renderWithApi(<PharmacistView />, api);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Prescription ID'), RX);
    await user.click(screen.getByRole('button', { name: 'Look up' }));
    await screen.findByText(/Priya Sharma/);
    return user;
  }

  test('lookup shows the record, status, and private patient data', async () => {
    await lookUp(fakeApi());
    expect(screen.getByText('ISSUED')).toBeInTheDocument();
    expect(screen.getByText(/born 1985-03-12/)).toBeInTheDocument();
  });

  test('dispense stays disabled until the rules pass for that quantity', async () => {
    const api = fakeApi({
      eligibility: jest.fn().mockResolvedValue({ eligible: true, status: 'ISSUED' }),
      fulfill: jest.fn().mockResolvedValue({ sequence: 0 }),
    });
    const user = await lookUp(api);
    const dispense = screen.getByRole('button', { name: 'Dispense' });
    expect(dispense).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Check rules' }));
    await waitFor(() => expect(dispense).toBeEnabled());
    expect(api.eligibility).toHaveBeenCalledWith(RX, '30');

    await user.clear(screen.getByLabelText('Quantity'));
    await user.type(screen.getByLabelText('Quantity'), '5');
    expect(dispense).toBeDisabled(); // quantity changed since the check

    await user.click(screen.getByRole('button', { name: 'Check rules' }));
    await waitFor(() => expect(dispense).toBeEnabled());
    await user.click(dispense);
    expect(api.fulfill).toHaveBeenCalledWith(RX, 5);
    expect(await screen.findByText('Dispensed fill #1.')).toBeInTheDocument();
  });

  test('ineligible: checklist shows R1 failed and dispense stays disabled', async () => {
    const api = fakeApi({
      eligibility: jest
        .fn()
        .mockResolvedValue({ eligible: false, status: 'FULLY_FULFILLED', rule: 'R1', reason: '1 of 1 fills used' }),
    });
    const user = await lookUp(api);
    await user.click(screen.getByRole('button', { name: 'Check rules' }));
    expect(await screen.findByText('Not eligible')).toBeInTheDocument();
    const checklist = screen.getByRole('list', { name: 'Fraud rule checklist' });
    expect(within(checklist).getByText('R1').closest('li')).toHaveAttribute('data-state', 'fail');
    expect(screen.getByRole('button', { name: 'Dispense' })).toBeDisabled();
  });

  test('a rejected dispense surfaces the rule ID', async () => {
    const api = fakeApi({
      eligibility: jest.fn().mockResolvedValue({ eligible: true, status: 'ISSUED' }),
      fulfill: jest.fn().mockRejectedValue(chaincodeRejection('R7', 'early refill at a different pharmacy')),
    });
    const user = await lookUp(api);
    await user.click(screen.getByRole('button', { name: 'Check rules' }));
    await user.click(await screen.findByRole('button', { name: 'Dispense' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('R7 — Early refill at a different pharmacy');
  });

  test('unknown prescription → NOT_FOUND banner', async () => {
    const api = fakeApi({
      prescription: jest.fn().mockRejectedValue(chaincodeRejection('NOT_FOUND', 'does not exist', 404)),
    });
    renderWithApi(<PharmacistView />, api);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Prescription ID'), RX);
    await user.click(screen.getByRole('button', { name: 'Look up' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('NOT_FOUND');
  });

  test('cross-role attempt: issuing as a pharmacist is rejected', async () => {
    const api = fakeApi({
      issue: jest
        .fn()
        .mockRejectedValue(chaincodeRejection('UNAUTHORIZED', 'role "pharmacist" may not call this function')),
    });
    renderWithApi(<PharmacistView />, api);
    await userEvent.click(screen.getByRole('button', { name: 'Attempt to issue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Rejected by the chaincode');
  });
});

describe('RegulatorView', () => {
  const history = {
    prescriptionId: RX,
    entries: [
      {
        txId: 'abcdef0123456789abcdef',
        timestamp: '2026-10-03T09:00:00Z',
        validationCode: 'VALID',
        endorsers: ['HospitalAMSP', 'PharmacyXMSP'],
      },
    ],
  };

  async function audit(api) {
    renderWithApi(<RegulatorView />, api);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Prescription ID'), RX);
    await user.click(screen.getByRole('button', { name: 'Look up' }));
    await screen.findByText(/Transaction history/);
    return user;
  }

  test('shows the single-write history with endorsing orgs and only the patient hash', async () => {
    const api = fakeApi({ history: jest.fn().mockResolvedValue(history) });
    await audit(api);
    expect(screen.getByText('Transaction history (1 write)')).toBeInTheDocument();
    expect(screen.getByText('HospitalAMSP, PharmacyXMSP')).toBeInTheDocument();
    expect(screen.getByText(PRESCRIPTION.patientDataHash)).toBeInTheDocument();
    expect(screen.queryByText(/Priya/)).not.toBeInTheDocument();
    expect(api.patient).not.toHaveBeenCalled();
  });

  test('reading patient data is refused by the chaincode', async () => {
    const api = fakeApi({
      history: jest.fn().mockResolvedValue(history),
      patient: jest
        .fn()
        .mockRejectedValue(chaincodeRejection('UNAUTHORIZED', 'role "regulator" may not call this function')),
    });
    const user = await audit(api);
    await user.click(screen.getByRole('button', { name: 'Try to read patient data' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Rejected by the chaincode');
    expect(screen.queryByText(/Unexpectedly readable/)).not.toBeInTheDocument();
  });
});
