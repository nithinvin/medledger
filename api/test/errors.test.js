import { ApiError, parseChaincodeError, statusForCode, toHttpError } from '../src/errors.js';

describe('statusForCode', () => {
  test.each([
    ['R1', 403],
    ['R7', 403],
    ['UNAUTHORIZED', 403],
    ['INVALID_ARGUMENT', 400],
    ['NOT_FOUND', 404],
    ['ALREADY_EXISTS', 409],
    ['INTERNAL', 500],
    ['SOMETHING_ELSE', 500],
  ])('%s → %i', (code, status) => {
    expect(statusForCode(code)).toBe(status);
  });
});

describe('parseChaincodeError', () => {
  test('finds the code in per-peer endorsement details', () => {
    const err = {
      message: '10 ABORTED: failed to endorse transaction, see attached details for more info',
      details: [
        { mspId: 'PharmacyYMSP', message: 'chaincode response 500, R1: fulfillment limit reached: 1 of 1 fills used' },
      ],
    };
    expect(parseChaincodeError(err)).toEqual({ code: 'R1', message: 'fulfillment limit reached: 1 of 1 fills used' });
  });

  test('finds the code in an evaluate error message', () => {
    const err = new Error(
      '2 UNKNOWN: evaluate call to endorser returned error: chaincode response 500, NOT_FOUND: prescription x does not exist',
    );
    expect(parseChaincodeError(err)).toEqual({ code: 'NOT_FOUND', message: 'prescription x does not exist' });
  });

  test('returns null for unrelated errors', () => {
    expect(parseChaincodeError(new Error('14 UNAVAILABLE: connection refused'))).toBeNull();
    expect(parseChaincodeError(undefined)).toBeNull();
  });
});

describe('toHttpError', () => {
  test('fraud rule → 403 with rule ID for the UI', () => {
    const { status, body } = toHttpError({
      message: 'x',
      details: [{ message: 'chaincode response 500, R7: early refill' }],
    });
    expect(status).toBe(403);
    expect(body).toEqual({ error: 'R7', rule: 'R7', message: 'early refill' });
  });

  test('ApiError keeps its status and code', () => {
    expect(toHttpError(new ApiError(400, 'INVALID_ARGUMENT', 'bad'))).toEqual({
      status: 400,
      body: { error: 'INVALID_ARGUMENT', message: 'bad' },
    });
  });

  test('unknown errors become a generic 500 without leaking internals', () => {
    const { status, body } = toHttpError(new Error('secret stack detail'));
    expect(status).toBe(500);
    expect(body.message).not.toContain('secret');
  });
});
