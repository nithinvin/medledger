import { render, screen } from '@testing-library/react';
import ErrorBanner from '../src/components/ErrorBanner.jsx';
import RuleChecklist from '../src/components/RuleChecklist.jsx';
import StatusBadge from '../src/components/StatusBadge.jsx';
import { chaincodeRejection } from './helpers.jsx';

test.each([
  ['ISSUED', 'slate'],
  ['PARTIALLY_FULFILLED', 'amber'],
  ['FULLY_FULFILLED', 'green'],
  ['EXPIRED', 'gray'],
  ['REVOKED', 'red'],
])('status badge %s is %s', (status, color) => {
  render(<StatusBadge status={status} />);
  expect(screen.getByText(status).className).toContain(color);
});

test('error banner marks chaincode rejections and shows the rule', () => {
  render(<ErrorBanner error={chaincodeRejection('R1', 'fulfillment limit reached')} />);
  expect(screen.getByRole('alert')).toHaveTextContent('Rejected by the chaincode');
  expect(screen.getByRole('alert')).toHaveTextContent('R1 — Fill limit reached: fulfillment limit reached');
});

test('error banner does not blame the chaincode for network errors', () => {
  render(<ErrorBanner error={chaincodeRejection('NETWORK', 'cannot reach API', 0)} />);
  expect(screen.getByRole('alert')).not.toHaveTextContent('chaincode');
});

test('error banner renders nothing without an error', () => {
  const { container } = render(<ErrorBanner error={null} />);
  expect(container).toBeEmptyDOMElement();
});

test('rule checklist shows the failing rule and the reason', () => {
  render(
    <RuleChecklist eligibility={{ eligible: false, rule: 'R7', reason: 'last fill by PharmacyXMSP 3 days ago' }} />,
  );
  const r7 = screen.getByText('R7').closest('li');
  expect(r7).toHaveAttribute('data-state', 'fail');
  expect(screen.getByText(/Reason: last fill/)).toBeInTheDocument();
});
