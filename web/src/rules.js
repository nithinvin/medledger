// Fraud rules (docs/spec.md#fr-4--fraud-rules) and the order the chaincode
// evaluates them at dispense (docs/design/chaincode.md#fraud-rule-evaluation-order).

export const RULES = Object.freeze({
  R1: 'Fill limit reached',
  R2: 'Quantity exceeds prescribed amount',
  R3: 'Prescription expired',
  R4: 'Early refill at the same pharmacy',
  R5: 'Prescription revoked',
  R6: 'Refills exceed the control-class limit',
  R7: 'Early refill at a different pharmacy',
});

export const DISPENSE_ORDER = Object.freeze(['R5', 'R3', 'R1', 'R2', 'R4', 'R7']);

export const RULE_STATE = Object.freeze({
  PASS: 'pass',
  FAIL: 'fail',
  NOT_EVALUATED: 'not-evaluated',
  ISSUANCE_ONLY: 'issuance-only',
});

// The chaincode stops at the first failing rule, so rules after it were never
// evaluated — show that honestly rather than as passed.
export function ruleChecklist(eligibility) {
  const failedAt = eligibility.eligible ? -1 : DISPENSE_ORDER.indexOf(eligibility.rule);
  const rows = DISPENSE_ORDER.map((rule, i) => {
    let state = RULE_STATE.PASS;
    if (failedAt === i) state = RULE_STATE.FAIL;
    else if (failedAt !== -1 && i > failedAt) state = RULE_STATE.NOT_EVALUATED;
    return { rule, label: RULES[rule], state };
  });
  rows.push({ rule: 'R6', label: RULES.R6, state: RULE_STATE.ISSUANCE_ONLY });
  return rows;
}

export function describeError(error) {
  if (!error) return '';
  const prefix = error.rule ? `${error.rule} — ${RULES[error.rule]}` : error.code;
  return `${prefix}: ${error.message}`;
}
