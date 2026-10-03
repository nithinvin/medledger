import { ApiError, createApiClient } from '../src/api.js';

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  };
}

test('sends the bearer token and JSON body; returns parsed JSON', async () => {
  const fetchImpl = jest.fn().mockResolvedValue(response(201, { fulfillmentId: 'f1' }));
  const api = createApiClient({ getToken: () => 'tok', fetchImpl });
  await expect(api.fulfill('rx 1', 2)).resolves.toEqual({ fulfillmentId: 'f1' });
  const [url, init] = fetchImpl.mock.calls[0];
  expect(url).toBe('/api/prescriptions/rx%201/fulfillments');
  expect(init.method).toBe('POST');
  expect(init.headers.Authorization).toBe('Bearer tok');
  expect(JSON.parse(init.body)).toEqual({ quantityDispensed: 2 });
});

test('omits Authorization when signed out', async () => {
  const fetchImpl = jest.fn().mockResolvedValue(response(200, {}));
  await createApiClient({ getToken: () => undefined, fetchImpl }).drugs();
  expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBeUndefined();
});

test('error responses become ApiError with code and rule', async () => {
  const fetchImpl = jest.fn().mockResolvedValue(response(403, { error: 'R1', rule: 'R1', message: 'limit reached' }));
  const err = await createApiClient({ getToken: () => 't', fetchImpl })
    .fulfill('x', 1)
    .catch((e) => e);
  expect(err).toBeInstanceOf(ApiError);
  expect(err).toMatchObject({ status: 403, code: 'R1', rule: 'R1', message: 'limit reached' });
});

test('non-JSON error bodies still produce an ApiError', async () => {
  const fetchImpl = jest
    .fn()
    .mockResolvedValue({ ok: false, status: 502, text: async () => '<html>Bad gateway</html>' });
  const err = await createApiClient({ getToken: () => 't', fetchImpl })
    .drugs()
    .catch((e) => e);
  expect(err).toMatchObject({ status: 502, code: 'INTERNAL' });
});

test('network failure → NETWORK error with a helpful message', async () => {
  const fetchImpl = jest.fn().mockRejectedValue(new TypeError('Failed to fetch'));
  const err = await createApiClient({ getToken: () => 't', fetchImpl })
    .drugs()
    .catch((e) => e);
  expect(err).toMatchObject({ status: 0, code: 'NETWORK' });
  expect(err.message).toMatch(/API/);
});

test('eligibility encodes the quantity query parameter', async () => {
  const fetchImpl = jest.fn().mockResolvedValue(response(200, { eligible: true }));
  await createApiClient({ getToken: () => 't', fetchImpl }).eligibility('rx', '5');
  expect(fetchImpl.mock.calls[0][0]).toBe('/api/prescriptions/rx/eligibility?quantity=5');
});
