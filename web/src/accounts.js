// Demo accounts (docs/runbook.md#demo-accounts). Passwords are "<username>pw".
export const DEMO_ACCOUNTS = Object.freeze([
  { username: 'dr.smith', org: 'HospitalA', role: 'doctor' },
  { username: 'dr.patel', org: 'HospitalB', role: 'doctor' },
  { username: 'pharm.jones', org: 'PharmacyX', role: 'pharmacist' },
  { username: 'pharm.lee', org: 'PharmacyY', role: 'pharmacist' },
  { username: 'auditor.gov', org: 'Regulator', role: 'regulator' },
]);

export const demoPassword = (username) => `${username}pw`;
