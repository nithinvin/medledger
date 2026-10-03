// Fetch client for the MedLedger API (docs/design/application.md#api-routes).
// All paths go through /api, which Vite proxies to the gateway.

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.message ?? `request failed with status ${status}`);
    this.status = status;
    this.code = body?.error ?? 'INTERNAL';
    this.rule = body?.rule;
  }
}

async function readJson(res) {
  const text = await res.text();
  if (text === '') return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function createApiClient({ getToken, fetchImpl = (...args) => fetch(...args) }) {
  async function request(method, path, body) {
    const headers = { Accept: 'application/json' };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    let res;
    try {
      res = await fetchImpl(`/api${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError(0, { error: 'NETWORK', message: 'cannot reach the MedLedger API — is it running?' });
    }
    const data = await readJson(res);
    if (!res.ok) throw new ApiError(res.status, data);
    return data;
  }

  const id = (value) => encodeURIComponent(value);

  return {
    login: (username, password) => request('POST', '/auth/login', { username, password }),
    drugs: () => request('GET', '/drugs'),
    issue: (prescription) => request('POST', '/prescriptions', prescription),
    prescription: (rxId) => request('GET', `/prescriptions/${id(rxId)}`),
    status: (rxId) => request('GET', `/prescriptions/${id(rxId)}/status`),
    patient: (rxId) => request('GET', `/prescriptions/${id(rxId)}/patient`),
    eligibility: (rxId, quantity) =>
      request('GET', `/prescriptions/${id(rxId)}/eligibility?quantity=${encodeURIComponent(quantity)}`),
    fulfill: (rxId, quantityDispensed) =>
      request('POST', `/prescriptions/${id(rxId)}/fulfillments`, { quantityDispensed }),
    fulfillments: (rxId) => request('GET', `/prescriptions/${id(rxId)}/fulfillments`),
    revoke: (rxId, reason) => request('POST', `/prescriptions/${id(rxId)}/revoke`, { reason }),
    myPrescriptions: () => request('GET', '/doctors/me/prescriptions'),
    history: (rxId) => request('GET', `/audit/${id(rxId)}/history`),
  };
}
