import { describeError } from '../rules.js';

// Shows a rejection with its rule ID or error code. Chaincode rejections are
// labelled as such: the point of the demo is that the ledger refuses.
export default function ErrorBanner({ error }) {
  if (!error) return null;
  const fromChaincode = Boolean(error.rule) || error.code === 'UNAUTHORIZED';
  return (
    <div role="alert" className="mt-3 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
      {fromChaincode && <div className="font-semibold">Rejected by the chaincode</div>}
      <div>{describeError(error)}</div>
    </div>
  );
}
