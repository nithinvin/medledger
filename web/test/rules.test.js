import { RULE_STATE, describeError, ruleChecklist } from '../src/rules.js';
import { ApiError } from '../src/api.js';

const states = (eligibility) => Object.fromEntries(ruleChecklist(eligibility).map((r) => [r.rule, r.state]));

test('eligible: every dispense rule passed; R6 is issuance-only', () => {
  expect(states({ eligible: true })).toEqual({
    R5: 'pass',
    R3: 'pass',
    R1: 'pass',
    R2: 'pass',
    R4: 'pass',
    R7: 'pass',
    R6: RULE_STATE.ISSUANCE_ONLY,
  });
});

test('failure at R1: earlier rules passed, R1 failed, later rules not evaluated', () => {
  expect(states({ eligible: false, rule: 'R1' })).toMatchObject({
    R5: 'pass',
    R3: 'pass',
    R1: 'fail',
    R2: 'not-evaluated',
    R4: 'not-evaluated',
    R7: 'not-evaluated',
  });
});

test('failure at the first rule (R5): nothing else evaluated', () => {
  const s = states({ eligible: false, rule: 'R5' });
  expect(s.R5).toBe('fail');
  expect(['R3', 'R1', 'R2', 'R4', 'R7'].every((r) => s[r] === 'not-evaluated')).toBe(true);
});

test('describeError names the rule, or falls back to the code', () => {
  expect(describeError(new ApiError(403, { error: 'R7', rule: 'R7', message: 'too soon' }))).toBe(
    'R7 — Early refill at a different pharmacy: too soon',
  );
  expect(describeError(new ApiError(403, { error: 'UNAUTHORIZED', message: 'no' }))).toBe('UNAUTHORIZED: no');
  expect(describeError(null)).toBe('');
});
