// Package utils holds ledger-key, identity, and time helpers shared by the
// contracts (docs/design/chaincode.md#models-reference-data-and-utilities).
package utils

import (
	"fmt"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

// Composite key object types (docs/design/chaincode.md#ledger-key-schema).
const (
	KeyTypePrescription = "PRESC"
	KeyTypeFulfillment  = "FULFILL"
	KeyTypeRevocation   = "REVOKE"
	KeyTypeDoctorIndex  = "DOCIDX"
)

// sequenceWidth zero-pads fulfillment sequence numbers so range queries
// return them in numeric order.
const sequenceWidth = 4

// PrescriptionKey is PRESC~{id}.
func PrescriptionKey(ctx contractapi.TransactionContextInterface, id string) (string, error) {
	return compositeKey(ctx, KeyTypePrescription, id)
}

// FulfillmentKey is FULFILL~{presID}~{seq}.
func FulfillmentKey(ctx contractapi.TransactionContextInterface, presID string, seq int) (string, error) {
	return compositeKey(ctx, KeyTypeFulfillment, presID, FormatSequence(seq))
}

// RevocationKey is REVOKE~{presID}.
func RevocationKey(ctx contractapi.TransactionContextInterface, presID string) (string, error) {
	return compositeKey(ctx, KeyTypeRevocation, presID)
}

// DoctorIndexKey is DOCIDX~{doctorMSP}~{doctorID}~{presID}.
func DoctorIndexKey(ctx contractapi.TransactionContextInterface, doctorMSP, doctorID, presID string) (string, error) {
	return compositeKey(ctx, KeyTypeDoctorIndex, doctorMSP, doctorID, presID)
}

// FormatSequence renders a fulfillment sequence number as used in keys.
func FormatSequence(seq int) string {
	return fmt.Sprintf("%0*d", sequenceWidth, seq)
}

func compositeKey(ctx contractapi.TransactionContextInterface, objectType string, attrs ...string) (string, error) {
	key, err := ctx.GetStub().CreateCompositeKey(objectType, attrs)
	if err != nil {
		return "", fmt.Errorf("create %s key: %w", objectType, err)
	}
	return key, nil
}
