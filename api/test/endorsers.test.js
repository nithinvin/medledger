import { common, msp, peer } from '@hyperledger/fabric-protos';
import { decodeEndorsers } from '../src/endorsers.js';

function processedTransaction(endorserMsps, validationCode) {
  const endorsed = new peer.ChaincodeEndorsedAction();
  endorsed.setEndorsementsList(
    endorserMsps.map((mspId) => {
      const identity = new msp.SerializedIdentity();
      identity.setMspid(mspId);
      const endorsement = new peer.Endorsement();
      endorsement.setEndorser(identity.serializeBinary());
      return endorsement;
    }),
  );
  const actionPayload = new peer.ChaincodeActionPayload();
  actionPayload.setAction(endorsed);
  const action = new peer.TransactionAction();
  action.setPayload(actionPayload.serializeBinary());
  const tx = new peer.Transaction();
  tx.setActionsList([action]);
  const payload = new common.Payload();
  payload.setData(tx.serializeBinary());
  const envelope = new common.Envelope();
  envelope.setPayload(payload.serializeBinary());
  const processed = new peer.ProcessedTransaction();
  processed.setTransactionenvelope(envelope);
  processed.setValidationcode(validationCode);
  return processed.serializeBinary();
}

test('lists endorsing MSPs, de-duplicated and sorted, with the validation code', () => {
  const bytes = processedTransaction(['PharmacyXMSP', 'HospitalAMSP', 'PharmacyXMSP'], peer.TxValidationCode.VALID);
  expect(decodeEndorsers(bytes)).toEqual({ validationCode: 'VALID', endorsers: ['HospitalAMSP', 'PharmacyXMSP'] });
});

test('reports a non-valid transaction code', () => {
  const bytes = processedTransaction(['HospitalAMSP'], peer.TxValidationCode.MVCC_READ_CONFLICT);
  expect(decodeEndorsers(bytes).validationCode).toBe('MVCC_READ_CONFLICT');
});
