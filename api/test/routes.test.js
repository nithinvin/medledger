import request from 'supertest';
import { createApp } from '../src/app.js';
import { CONTRACTS } from '../src/config.js';

const SECRET = new TextEncoder().encode('test-secret');
const RX = '11111111-2222-4333-8444-555555555555';

// Fake Fabric service recording calls; responses are configured per test.
function fakeFabric() {
  const calls = [];
  const fabric = {
    calls,
    result: undefined,
    error: undefined,
    endorsers: { validationCode: 'VALID', endorsers: ['HospitalAMSP', 'PharmacyXMSP'] },
    async submit(user, contract, fn, args, transient) {
      calls.push({ kind: 'submit', user, contract, fn, args, transient });
      if (fabric.error) throw fabric.error;
      return fabric.result;
    },
    async evaluate(user, contract, fn, args) {
      calls.push({ kind: 'evaluate', user, contract, fn, args });
      if (fabric.error) throw fabric.error;
      return fabric.result;
    },
    async transactionEndorsers(user, txId) {
      calls.push({ kind: 'endorsers', user, txId });
      return fabric.endorsers;
    },
  };
  return fabric;
}

let fabric;
let app;
const tokens = {};

beforeAll(async () => {
  const setup = createApp({ fabric: fakeFabric(), jwtSecret: SECRET });
  for (const username of ['dr.smith', 'pharm.jones', 'auditor.gov']) {
    const res = await request(setup)
      .post('/api/auth/login')
      .send({ username, password: `${username}pw` });
    tokens[username] = res.body.token;
  }
});

beforeEach(() => {
  fabric = fakeFabric();
  app = createApp({ fabric, jwtSecret: SECRET });
});

const as = (user) => ({ Authorization: `Bearer ${tokens[user]}` });

const validIssue = {
  patientName: 'Priya Sharma',
  patientDOB: '1985-03-12',
  patientRef: 'PT-4471',
  drugCode: 'IN-MORPH-10',
  quantity: 30,
  dosageInstructions: '1 tablet every 12 hours',
  refillsAllowed: 0,
  validityDays: 30,
};

describe('auth', () => {
  test('login returns a token and the user profile', async () => {
    const res = await request(app).post('/api/auth/login').send({ username: 'dr.smith', password: 'dr.smithpw' });
    expect(res.status).toBe(200);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.user).toEqual({ username: 'dr.smith', role: 'doctor', msp: 'HospitalAMSP', org: 'hospitala' });
  });

  test.each([[{ username: 'dr.smith', password: 'wrong' }], [{ username: 'nobody', password: 'nobodypw' }], [{}]])(
    'bad credentials → 401 %#',
    async (body) => {
      const res = await request(app).post('/api/auth/login').send(body);
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('UNAUTHENTICATED');
    },
  );

  test('protected endpoint without token → 401', async () => {
    expect((await request(app).get('/api/drugs')).status).toBe(401);
  });

  test('tampered token → 401', async () => {
    const res = await request(app)
      .get('/api/drugs')
      .set({ Authorization: `Bearer ${tokens['dr.smith']}x` });
    expect(res.status).toBe(401);
  });

  test('token signed with another secret → 401', async () => {
    const other = createApp({ fabric, jwtSecret: new TextEncoder().encode('other') });
    const res = await request(other).get('/api/drugs').set(as('dr.smith'));
    expect(res.status).toBe(401);
  });
});

describe('role enforcement is left to the chaincode (D7, D19)', () => {
  test.each([
    ['pharm.jones', 'post', '/api/prescriptions', validIssue],
    ['dr.smith', 'post', `/api/prescriptions/${RX}/fulfillments`, { quantityDispensed: 1 }],
    ['auditor.gov', 'get', `/api/prescriptions/${RX}/patient`, undefined],
    ['dr.smith', 'get', `/api/audit/${RX}/history`, undefined],
  ])('%s %s %s is forwarded; the chaincode rejection becomes 403', async (user, method, path, body) => {
    fabric.error = Object.assign(new Error('10 ABORTED: failed to endorse transaction'), {
      details: [{ message: 'chaincode response 500, UNAUTHORIZED: role may not call this function' }],
    });
    const res = await request(app)[method](path).set(as(user)).send(body);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('UNAUTHORIZED');
    expect(fabric.calls).toHaveLength(1);
    expect(fabric.calls[0].user).toBe(user);
  });
});

describe('POST /api/prescriptions', () => {
  test('submits with patient data only in the transient map, plus a fresh salt', async () => {
    fabric.result = { prescriptionId: 'x' };
    const res = await request(app).post('/api/prescriptions').set(as('dr.smith')).send(validIssue);
    expect(res.status).toBe(201);

    const [call] = fabric.calls;
    expect(call).toMatchObject({
      kind: 'submit',
      user: 'dr.smith',
      contract: CONTRACTS.PRESCRIPTION,
      fn: 'IssuePrescription',
    });
    const [id, ...rest] = call.args;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(rest).toEqual(['IN-MORPH-10', 30, '1 tablet every 12 hours', 0, 30]);
    expect(JSON.stringify(call.args)).not.toContain('Priya');
    expect(call.transient).toMatchObject({
      patientName: 'Priya Sharma',
      patientDOB: '1985-03-12',
      patientRef: 'PT-4471',
    });
    expect(call.transient.salt).toMatch(/^[0-9a-f]{64}$/);

    await request(app).post('/api/prescriptions').set(as('dr.smith')).send(validIssue);
    expect(fabric.calls[1].transient.salt).not.toBe(call.transient.salt);
  });

  test.each([
    ['missing patientName', { patientName: undefined }],
    ['bad date of birth', { patientDOB: '12/03/1985' }],
    ['zero quantity', { quantity: 0 }],
    ['fractional quantity', { quantity: 1.5 }],
    ['negative refills', { refillsAllowed: -1 }],
    ['non-numeric validity', { validityDays: 'soon' }],
    ['dosage too long', { dosageInstructions: 'x'.repeat(501) }],
  ])('%s → 400 before any transaction', async (_name, change) => {
    const res = await request(app)
      .post('/api/prescriptions')
      .set(as('dr.smith'))
      .send({ ...validIssue, ...change });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_ARGUMENT');
    expect(fabric.calls).toHaveLength(0);
  });

  test('malformed JSON → 400', async () => {
    const res = await request(app)
      .post('/api/prescriptions')
      .set(as('dr.smith'))
      .set('Content-Type', 'application/json')
      .send('{"oops"');
    expect(res.status).toBe(400);
  });
});

describe('chaincode error mapping', () => {
  test.each([
    ['R1: fulfillment limit reached', 403, 'R1'],
    ['R7: early refill at a different pharmacy', 403, 'R7'],
    ['UNAUTHORIZED: role "doctor" is not valid for organization PharmacyXMSP', 403, 'UNAUTHORIZED'],
    ['NOT_FOUND: prescription x does not exist', 404, 'NOT_FOUND'],
    ['ALREADY_EXISTS: prescription x is already revoked', 409, 'ALREADY_EXISTS'],
  ])('%s → %i', async (message, status, code) => {
    fabric.error = Object.assign(new Error('10 ABORTED: failed to endorse transaction'), {
      details: [{ message: `chaincode response 500, ${message}` }],
    });
    const res = await request(app)
      .post(`/api/prescriptions/${RX}/fulfillments`)
      .set(as('pharm.jones'))
      .send({ quantityDispensed: 1 });
    expect(res.status).toBe(status);
    expect(res.body.error).toBe(code);
  });

  test('network failure → 500 generic message', async () => {
    fabric.error = new Error('14 UNAVAILABLE: connect ECONNREFUSED 127.0.0.1:9051');
    const res = await request(app).get(`/api/prescriptions/${RX}`).set(as('pharm.jones'));
    expect(res.status).toBe(500);
    expect(res.body.message).not.toContain('ECONNREFUSED');
  });
});

describe('read and query routes', () => {
  test('status wraps the derived value', async () => {
    fabric.result = 'ISSUED';
    const res = await request(app).get(`/api/prescriptions/${RX}/status`).set(as('pharm.jones'));
    expect(res.body).toEqual({ prescriptionId: RX, status: 'ISSUED' });
    expect(fabric.calls[0]).toMatchObject({ contract: CONTRACTS.QUERY, fn: 'GetPrescriptionStatus', args: [RX] });
  });

  test('non-UUID id → 400', async () => {
    const res = await request(app).get('/api/prescriptions/not-a-uuid').set(as('pharm.jones'));
    expect(res.status).toBe(400);
  });

  test('eligibility requires a positive quantity', async () => {
    expect((await request(app).get(`/api/prescriptions/${RX}/eligibility`).set(as('pharm.jones'))).status).toBe(400);
    fabric.result = { eligible: true, status: 'ISSUED' };
    const res = await request(app).get(`/api/prescriptions/${RX}/eligibility?quantity=5`).set(as('pharm.jones'));
    expect(res.status).toBe(200);
    expect(fabric.calls.at(-1).args).toEqual([RX, 5]);
  });

  test("doctor's own list uses identity from the JWT, not the request", async () => {
    fabric.result = [];
    await request(app).get('/api/doctors/me/prescriptions?msp=HospitalBMSP').set(as('dr.smith'));
    expect(fabric.calls[0].args).toEqual(['HospitalAMSP', 'dr.smith']);
  });

  test('audit history adds endorsing orgs per transaction', async () => {
    fabric.result = [{ txId: 'tx1', timestamp: 't', isDelete: false, value: {} }];
    const res = await request(app).get(`/api/audit/${RX}/history`).set(as('auditor.gov'));
    expect(res.status).toBe(200);
    expect(res.body.entries[0]).toMatchObject({
      txId: 'tx1',
      validationCode: 'VALID',
      endorsers: ['HospitalAMSP', 'PharmacyXMSP'],
    });
    expect(fabric.calls.at(-1)).toEqual({ kind: 'endorsers', user: 'auditor.gov', txId: 'tx1' });
  });

  test('revoke requires a reason', async () => {
    expect((await request(app).post(`/api/prescriptions/${RX}/revoke`).set(as('dr.smith')).send({})).status).toBe(400);
  });

  test('unknown endpoint → 404; health is public', async () => {
    expect((await request(app).get('/api/nope').set(as('dr.smith'))).status).toBe(404);
    expect((await request(app).get('/api/health')).body).toEqual({ status: 'ok' });
  });
});
