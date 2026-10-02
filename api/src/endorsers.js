// Decodes the qscc GetTransactionByID response to list which organizations
// endorsed a transaction (docs/spec.md#fr-6--audit-query).
import { common, msp, peer } from '@hyperledger/fabric-protos';

const VALIDATION_CODES = Object.fromEntries(
  Object.entries(peer.TxValidationCode).map(([name, value]) => [value, name]),
);

export function decodeEndorsers(processedTransactionBytes) {
  const processed = peer.ProcessedTransaction.deserializeBinary(processedTransactionBytes);
  const envelope = processed.getTransactionenvelope();
  const payload = common.Payload.deserializeBinary(envelope.getPayload_asU8());
  const transaction = peer.Transaction.deserializeBinary(payload.getData_asU8());

  const endorsers = new Set();
  for (const action of transaction.getActionsList()) {
    const actionPayload = peer.ChaincodeActionPayload.deserializeBinary(action.getPayload_asU8());
    for (const endorsement of actionPayload.getAction().getEndorsementsList()) {
      endorsers.add(msp.SerializedIdentity.deserializeBinary(endorsement.getEndorser_asU8()).getMspid());
    }
  }
  return {
    validationCode: VALIDATION_CODES[processed.getValidationcode()] ?? String(processed.getValidationcode()),
    endorsers: [...endorsers].sort(),
  };
}
