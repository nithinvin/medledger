// Static configuration: demo users, their organizations, and peer endpoints
// (docs/runbook.md#demo-accounts, docs/runbook.md#services-ports-and-credentials).
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ORG_DIR = fileURLToPath(new URL('../../network/organizations/', import.meta.url));

export const CHANNEL_NAME = 'prescription-channel';
export const CHAINCODE_NAME = 'medledger';

// Contract names (docs/design/chaincode.md#invoking-functions).
export const CONTRACTS = Object.freeze({
  PRESCRIPTION: 'PrescriptionContract',
  FULFILLMENT: 'FulfillmentContract',
  QUERY: 'QueryContract',
});

export const ROLES = Object.freeze({
  DOCTOR: 'doctor',
  PHARMACIST: 'pharmacist',
  REGULATOR: 'regulator',
});

export const ORGS = Object.freeze({
  hospitala: { msp: 'HospitalAMSP', peerPort: 7051 },
  hospitalb: { msp: 'HospitalBMSP', peerPort: 8051 },
  pharmacyx: { msp: 'PharmacyXMSP', peerPort: 9051 },
  pharmacyy: { msp: 'PharmacyYMSP', peerPort: 10051 },
  regulator: { msp: 'RegulatorMSP', peerPort: 11051 },
});

// The chaincode enforces roles; these are only for API-level UX checks (D7).
export const USERS = Object.freeze({
  'dr.smith': { org: 'hospitala', role: ROLES.DOCTOR },
  'dr.patel': { org: 'hospitalb', role: ROLES.DOCTOR },
  'pharm.jones': { org: 'pharmacyx', role: ROLES.PHARMACIST },
  'pharm.lee': { org: 'pharmacyy', role: ROLES.PHARMACIST },
  'auditor.gov': { org: 'regulator', role: ROLES.REGULATOR },
});

export function userMspDir(username) {
  const { org } = USERS[username];
  return path.join(
    ORG_DIR,
    'peerOrganizations',
    `${org}.example.com`,
    'users',
    `${username}@${org}.example.com`,
    'msp',
  );
}

export function peerTlsCaPath(org) {
  return path.join(ORG_DIR, 'peerOrganizations', `${org}.example.com`, 'tlsca', `tlsca.${org}.example.com-cert.pem`);
}

export function peerEndpoint(org) {
  return `localhost:${ORGS[org].peerPort}`;
}

// The API listens on localhost only (CONSTITUTION.md Security, spec X7).
export const HTTP_HOST = '127.0.0.1';
export const HTTP_PORT = Number(process.env.PORT ?? 3000);
export const JWT_TTL = '8h';
