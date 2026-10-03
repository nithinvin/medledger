import { render } from '@testing-library/react';
import { ApiError } from '../src/api.js';
import { ApiContext } from '../src/ApiContext.jsx';

export const RX = '11111111-2222-4333-8444-555555555555';

export const PROFILE = {
  jurisdiction: 'IN',
  controlClasses: {
    NDPS: { legalBasis: 'NDPS Act 1985', maxRefills: 0, minRefillIntervalDays: 0 },
    NONE: { legalBasis: 'Not controlled', maxRefills: 11, minRefillIntervalDays: 0 },
  },
  drugs: [
    { drugCode: 'IN-MORPH-10', drugName: 'Morphine sulfate 10 mg tablet', controlClass: 'NDPS' },
    { drugCode: 'IN-PARA-500', drugName: 'Paracetamol 500 mg tablet', controlClass: 'NONE' },
  ],
};

export const PRESCRIPTION = {
  prescriptionId: RX,
  patientDataHash: 'ab12'.repeat(16),
  doctorId: 'dr.smith',
  doctorMSP: 'HospitalAMSP',
  drugCode: 'IN-MORPH-10',
  drugName: 'Morphine sulfate 10 mg tablet',
  controlClass: 'NDPS',
  quantity: 30,
  dosageInstructions: '1 tablet every 12 hours',
  refillsAllowed: 0,
  validityDays: 30,
  issuedAt: '2026-10-03T09:00:00Z',
  docType: 'prescription',
};

export const chaincodeRejection = (code, message, status = 403) =>
  new ApiError(status, { error: code, rule: /^R[1-7]$/.test(code) ? code : undefined, message });

// Every API method as a jest.fn; override per test.
export function fakeApi(overrides = {}) {
  return {
    login: jest.fn(),
    drugs: jest.fn().mockResolvedValue(PROFILE),
    issue: jest.fn(),
    prescription: jest.fn().mockResolvedValue(PRESCRIPTION),
    status: jest.fn().mockResolvedValue({ prescriptionId: RX, status: 'ISSUED' }),
    patient: jest
      .fn()
      .mockResolvedValue({ patientName: 'Priya Sharma', patientDOB: '1985-03-12', patientRef: 'PT-4471' }),
    eligibility: jest.fn(),
    fulfill: jest.fn(),
    fulfillments: jest.fn().mockResolvedValue([]),
    revoke: jest.fn(),
    myPrescriptions: jest.fn().mockResolvedValue([]),
    history: jest.fn(),
    ...overrides,
  };
}

export function renderWithApi(ui, api) {
  return render(<ApiContext.Provider value={api}>{ui}</ApiContext.Provider>);
}
