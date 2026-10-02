// Maps chaincode error codes to HTTP statuses
// (docs/design/application.md#error-mapping).

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const CODE_STATUS = Object.freeze({
  UNAUTHORIZED: 403,
  INVALID_ARGUMENT: 400,
  NOT_FOUND: 404,
  ALREADY_EXISTS: 409,
  INTERNAL: 500,
});

const RULE_CODE = /^R[1-7]$/;
const CHAINCODE_ERROR = /\b(R[1-7]|UNAUTHORIZED|INVALID_ARGUMENT|NOT_FOUND|ALREADY_EXISTS|INTERNAL): ([^\n]*)/;

export function statusForCode(code) {
  if (RULE_CODE.test(code)) return 403;
  return CODE_STATUS[code] ?? 500;
}

// Extracts "<CODE>: <message>" from a fabric-gateway error. Chaincode messages
// appear either in the error message or in its per-peer details.
export function parseChaincodeError(err) {
  const texts = [err?.message ?? '', ...(err?.details ?? []).map((d) => d.message ?? '')];
  for (const text of texts) {
    const match = CHAINCODE_ERROR.exec(text);
    if (match) {
      const [, code, message] = match;
      return { code, message: message.trim() };
    }
  }
  return null;
}

// Converts any error into { status, body } for the HTTP response.
export function toHttpError(err) {
  if (err instanceof ApiError) {
    return { status: err.status, body: { error: err.code, message: err.message } };
  }
  const parsed = parseChaincodeError(err);
  if (parsed) {
    const rule = RULE_CODE.test(parsed.code) ? parsed.code : undefined;
    return { status: statusForCode(parsed.code), body: { error: parsed.code, rule, message: parsed.message } };
  }
  return { status: 500, body: { error: 'INTERNAL', message: 'unexpected server error' } };
}
