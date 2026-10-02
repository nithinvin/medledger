// Package contracts implements the MedLedger smart contracts
// (docs/design/chaincode.md#function-behaviour). All business and fraud rules
// are enforced here; the API layer is convenience only (decision D7).
package contracts

import (
	"encoding/json"
	"fmt"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"

	"github.com/nithinvin/medledger/chaincode/errs"
	"github.com/nithinvin/medledger/chaincode/models"
	"github.com/nithinvin/medledger/chaincode/reference"
	"github.com/nithinvin/medledger/chaincode/rules"
	"github.com/nithinvin/medledger/chaincode/utils"
)

// CollectionPatientData is the private data collection for patient fields
// (docs/design/chaincode.md#private-data).
const CollectionPatientData = "patientDataCollection"

// indexValue is stored under index keys. PutState with an empty value is a
// delete in Fabric, so index entries need a non-empty placeholder.
var indexValue = []byte{0x00}

func getJSON(ctx contractapi.TransactionContextInterface, key string, v any) (bool, error) {
	data, err := ctx.GetStub().GetState(key)
	if err != nil {
		return false, errs.Internal("read ledger state", err)
	}
	if data == nil {
		return false, nil
	}
	if err := json.Unmarshal(data, v); err != nil {
		return false, errs.Internal("decode ledger record", err)
	}
	return true, nil
}

func putJSON(ctx contractapi.TransactionContextInterface, key string, v any) error {
	data, err := json.Marshal(v)
	if err != nil {
		return errs.Internal("encode ledger record", err)
	}
	if err := ctx.GetStub().PutState(key, data); err != nil {
		return errs.Internal("write ledger state", err)
	}
	return nil
}

func prescriptionExists(ctx contractapi.TransactionContextInterface, id string) (bool, error) {
	key, err := utils.PrescriptionKey(ctx, id)
	if err != nil {
		return false, errs.Internal("build prescription key", err)
	}
	data, err := ctx.GetStub().GetState(key)
	if err != nil {
		return false, errs.Internal("read ledger state", err)
	}
	return data != nil, nil
}

func loadPrescription(ctx contractapi.TransactionContextInterface, id string) (models.Prescription, error) {
	var p models.Prescription
	key, err := utils.PrescriptionKey(ctx, id)
	if err != nil {
		return p, errs.Internal("build prescription key", err)
	}
	found, err := getJSON(ctx, key, &p)
	if err != nil {
		return p, err
	}
	if !found {
		return p, errs.New(errs.CodeNotFound, "prescription %s does not exist", id)
	}
	return p, nil
}

func revocationExists(ctx contractapi.TransactionContextInterface, presID string) (bool, error) {
	key, err := utils.RevocationKey(ctx, presID)
	if err != nil {
		return false, errs.Internal("build revocation key", err)
	}
	data, err := ctx.GetStub().GetState(key)
	if err != nil {
		return false, errs.Internal("read ledger state", err)
	}
	return data != nil, nil
}

// loadFulfillments uses a partial composite key range query: deterministic,
// index-free, and re-validated at commit for phantom reads (decision D6).
func loadFulfillments(ctx contractapi.TransactionContextInterface, presID string) ([]models.Fulfillment, error) {
	iter, err := ctx.GetStub().GetStateByPartialCompositeKey(utils.KeyTypeFulfillment, []string{presID})
	if err != nil {
		return nil, errs.Internal("query fulfillments", err)
	}
	defer func() { _ = iter.Close() }() // read-only iterator; nothing to recover on close

	fulfillments := []models.Fulfillment{}
	for iter.HasNext() {
		kv, err := iter.Next()
		if err != nil {
			return nil, errs.Internal("iterate fulfillments", err)
		}
		var f models.Fulfillment
		if err := json.Unmarshal(kv.Value, &f); err != nil {
			return nil, errs.Internal("decode fulfillment", err)
		}
		fulfillments = append(fulfillments, f)
	}
	return fulfillments, nil
}

func loadProfile() (*reference.Profile, error) {
	profile, err := reference.Load()
	if err != nil {
		return nil, errs.Internal("load jurisdiction profile", err)
	}
	return profile, nil
}

// buildFulfillmentRequest gathers the ledger state the fraud rules judge.
// Shared by RecordFulfillment and CheckFulfillmentEligibility so the dry run
// can never disagree with the real check.
func buildFulfillmentRequest(ctx contractapi.TransactionContextInterface, p models.Prescription, callerMSP string, quantity int) (rules.FulfillmentRequest, error) {
	revoked, err := revocationExists(ctx, p.PrescriptionID)
	if err != nil {
		return rules.FulfillmentRequest{}, err
	}
	fulfillments, err := loadFulfillments(ctx, p.PrescriptionID)
	if err != nil {
		return rules.FulfillmentRequest{}, err
	}
	profile, err := loadProfile()
	if err != nil {
		return rules.FulfillmentRequest{}, err
	}
	limits, ok := profile.Limits(p.ControlClass)
	if !ok {
		return rules.FulfillmentRequest{}, errs.New(errs.CodeInternal, "control class %s missing from jurisdiction profile", p.ControlClass)
	}
	now, err := utils.TxTime(ctx)
	if err != nil {
		return rules.FulfillmentRequest{}, err
	}
	return rules.FulfillmentRequest{
		Prescription:      p,
		Revoked:           revoked,
		Fulfillments:      fulfillments,
		Limits:            limits,
		CallerMSP:         callerMSP,
		QuantityDispensed: quantity,
		Now:               now,
	}, nil
}

func fulfillmentID(presID string, seq int) string {
	return fmt.Sprintf("%s~%s~%s", utils.KeyTypeFulfillment, presID, utils.FormatSequence(seq))
}

func revocationID(presID string) string {
	return fmt.Sprintf("%s~%s", utils.KeyTypeRevocation, presID)
}
