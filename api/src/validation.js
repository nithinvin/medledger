// Request-body validation at the API boundary (CONSTITUTION.md Assertive
// Programming). The chaincode re-validates everything; these checks give
// clearer 400s before a transaction is attempted.
import { ApiError } from './errors.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TEXT = 500;

function invalid(message) {
  return new ApiError(400, 'INVALID_ARGUMENT', message);
}

export function requireText(body, field) {
  const value = body?.[field];
  if (typeof value !== 'string' || value.trim() === '') throw invalid(`${field} is required`);
  if (value.length > MAX_TEXT) throw invalid(`${field} exceeds ${MAX_TEXT} characters`);
  return value;
}

export function requireDate(body, field) {
  const value = requireText(body, field);
  if (!DATE.test(value) || Number.isNaN(Date.parse(value))) throw invalid(`${field} must be YYYY-MM-DD`);
  return value;
}

export function requireInteger(source, field, { min = 0 } = {}) {
  const raw = source?.[field];
  const value = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  if (!Number.isInteger(value) || value < min) throw invalid(`${field} must be an integer ≥ ${min}`);
  return value;
}

export function requireUuid(value, field = 'id') {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value ?? '')) {
    throw invalid(`${field} must be a UUID`);
  }
  return value;
}
