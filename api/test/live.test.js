// Live end-to-end test against the running network (Phase 6 exit gate).
// Skipped unless MEDLEDGER_LIVE=1: `npm run test:live` after
// up.sh, createChannel.sh, enrollUsers.sh, and deployChaincode.sh.
//
// It starts the real server (src/server.js) as a child process and talks
// HTTP to it. That exercises the actual entry point, and keeps
// @hyperledger/fabric-gateway (whose ESM-only dependencies Jest cannot load
// on Node 22) out of the Jest process.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import request from 'supertest';

const live = process.env.MEDLEDGER_LIVE === '1';
const describeLive = live ? describe : describe.skip;
const PORT = 3100 + Math.floor(Math.random() * 800);
const BASE = `http://127.0.0.1:${PORT}`;
const SERVER = fileURLToPath(new URL('../src/server.js', import.meta.url));

async function waitForHealth(server) {
  for (let i = 0; i < 50; i++) {
    if (server.exitCode !== null) throw new Error(`server exited with code ${server.exitCode}`);
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('server did not become healthy');
}

describeLive('API against the live network', () => {
  let server;
  const app = BASE;
  const token = {};
  const as = (user) => ({ Authorization: `Bearer ${token[user]}` });
  const issueBody = (overrides = {}) => ({
    patientName: 'Priya Sharma',
    patientDOB: '1985-03-12',
    patientRef: 'PT-4471',
    drugCode: 'IN-MORPH-10',
    quantity: 30,
    dosageInstructions: '1 tablet every 12 hours',
    refillsAllowed: 0,
    validityDays: 30,
    ...overrides,
  });

  beforeAll(async () => {
    server = spawn(process.execPath, [SERVER], {
      env: {
        ...process.env,
        PORT: String(PORT),
        LOG_LEVEL: 'warn',
        MEDLEDGER_JWT_SECRET: randomBytes(16).toString('hex'),
      },
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    await waitForHealth(server);
    for (const user of ['dr.smith', 'dr.patel', 'pharm.jones', 'pharm.lee', 'auditor.gov']) {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ username: user, password: `${user}pw` });
      expect(res.status).toBe(200);
      token[user] = res.body.token;
    }
  }, 30_000);

  afterAll(() => server?.kill('SIGTERM'));

  test('drug reference is readable by every role', async () => {
    for (const user of ['dr.smith', 'pharm.lee', 'auditor.gov']) {
      const res = await request(app).get('/api/drugs').set(as(user));
      expect(res.status).toBe(200);
      expect(res.body.jurisdiction).toBe('IN');
    }
  });

  test('full prescription lifecycle with fraud and privacy checks', async () => {
    // Issue (AC-1)
    const issued = await request(app).post('/api/prescriptions').set(as('dr.smith')).send(issueBody());
    expect(issued.status).toBe(201);
    const id = issued.body.prescriptionId;
    expect(issued.body).toMatchObject({ doctorMSP: 'HospitalAMSP', controlClass: 'NDPS' });

    // Cross-role attempts are rejected (exit gate)
    expect((await request(app).post('/api/prescriptions').set(as('pharm.jones')).send(issueBody())).status).toBe(403);
    expect(
      (
        await request(app)
          .post(`/api/prescriptions/${id}/fulfillments`)
          .set(as('dr.smith'))
          .send({ quantityDispensed: 30 })
      ).status,
    ).toBe(403);

    // Visible from a pharmacy; eligible
    expect((await request(app).get(`/api/prescriptions/${id}`).set(as('pharm.jones'))).body.prescriptionId).toBe(id);
    const eligible = await request(app).get(`/api/prescriptions/${id}/eligibility?quantity=30`).set(as('pharm.jones'));
    expect(eligible.body).toEqual({ eligible: true, status: 'ISSUED' });

    // Fulfill at PharmacyX
    const filled = await request(app)
      .post(`/api/prescriptions/${id}/fulfillments`)
      .set(as('pharm.jones'))
      .send({ quantityDispensed: 30 });
    expect(filled.status).toBe(201);
    expect((await request(app).get(`/api/prescriptions/${id}/status`).set(as('dr.smith'))).body.status).toBe(
      'FULLY_FULFILLED',
    );

    // The key moment: PharmacyY is refused — rule ID surfaces (exit gate)
    const second = await request(app)
      .post(`/api/prescriptions/${id}/fulfillments`)
      .set(as('pharm.lee'))
      .send({ quantityDispensed: 30 });
    expect(second.status).toBe(403);
    expect(second.body).toMatchObject({ error: 'R1', rule: 'R1' });
    const ineligible = await request(app).get(`/api/prescriptions/${id}/eligibility?quantity=1`).set(as('pharm.lee'));
    expect(ineligible.body).toMatchObject({ eligible: false, rule: 'R1', status: 'FULLY_FULFILLED' });

    // Fulfillments list
    const fills = await request(app).get(`/api/prescriptions/${id}/fulfillments`).set(as('auditor.gov'));
    expect(fills.body).toHaveLength(1);

    // Audit: one write, endorsed by a hospital AND a pharmacy (AC-7, AC-9, NFR-3)
    const audit = await request(app).get(`/api/audit/${id}/history`).set(as('auditor.gov'));
    expect(audit.status).toBe(200);
    expect(audit.body.entries).toHaveLength(1);
    const [entry] = audit.body.entries;
    expect(entry.validationCode).toBe('VALID');
    expect(entry.endorsers.some((m) => m.startsWith('Hospital'))).toBe(true);
    expect(entry.endorsers.some((m) => m.startsWith('Pharmacy'))).toBe(true);

    // Privacy (AC-10)
    expect((await request(app).get(`/api/prescriptions/${id}/patient`).set(as('pharm.lee'))).body.patientName).toBe(
      'Priya Sharma',
    );
    expect((await request(app).get(`/api/prescriptions/${id}/patient`).set(as('auditor.gov'))).status).toBe(403);

    // Doctor's own list
    const mine = await request(app).get('/api/doctors/me/prescriptions').set(as('dr.smith'));
    expect(mine.body.map((p) => p.prescriptionId)).toContain(id);
    const others = await request(app).get('/api/doctors/me/prescriptions').set(as('dr.patel'));
    expect(others.body.map((p) => p.prescriptionId)).not.toContain(id);
  }, 60_000);

  test('fraud rules and revocation through the API', async () => {
    // R6: NDPS with refills
    const r6 = await request(app)
      .post('/api/prescriptions')
      .set(as('dr.smith'))
      .send(issueBody({ refillsAllowed: 1 }));
    expect(r6.status).toBe(403);
    expect(r6.body.rule).toBe('R6');

    // Unknown drug (AC-13)
    const unknown = await request(app)
      .post('/api/prescriptions')
      .set(as('dr.smith'))
      .send(issueBody({ drugCode: 'XX-NOPE' }));
    expect(unknown.status).toBe(400);

    // R2 overrun, then revoke → R5; only the issuer may revoke
    const { body: p } = await request(app).post('/api/prescriptions').set(as('dr.patel')).send(issueBody());
    const r2 = await request(app)
      .post(`/api/prescriptions/${p.prescriptionId}/fulfillments`)
      .set(as('pharm.lee'))
      .send({ quantityDispensed: 31 });
    expect(r2.body.rule).toBe('R2');
    expect(
      (
        await request(app)
          .post(`/api/prescriptions/${p.prescriptionId}/revoke`)
          .set(as('dr.smith'))
          .send({ reason: 'x' })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post(`/api/prescriptions/${p.prescriptionId}/revoke`)
          .set(as('dr.patel'))
          .send({ reason: 'issued in error' })
      ).status,
    ).toBe(201);
    const r5 = await request(app)
      .post(`/api/prescriptions/${p.prescriptionId}/fulfillments`)
      .set(as('pharm.lee'))
      .send({ quantityDispensed: 1 });
    expect(r5.body.rule).toBe('R5');
    expect(
      (await request(app).get(`/api/prescriptions/${p.prescriptionId}/status`).set(as('pharm.lee'))).body.status,
    ).toBe('REVOKED');

    // Missing prescription → 404
    expect(
      (await request(app).get('/api/prescriptions/00000000-0000-4000-8000-000000000000').set(as('pharm.lee'))).status,
    ).toBe(404);
  }, 60_000);
});
