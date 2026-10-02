package contracts

import (
	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"

	"github.com/nithinvin/medledger/chaincode/models"
	"github.com/nithinvin/medledger/chaincode/rules"
	"github.com/nithinvin/medledger/chaincode/utils"
)

// FulfillmentContract records dispenses. Invoke as "FulfillmentContract:<fn>".
type FulfillmentContract struct {
	contractapi.Contract
}

// RecordFulfillment appends a fulfillment after the fraud rules pass. It
// writes only a FULFILL~ key — never the prescription record (AC-7).
func (c *FulfillmentContract) RecordFulfillment(ctx contractapi.TransactionContextInterface,
	prescriptionID string, quantityDispensed int) (*models.Fulfillment, error) {

	caller, err := utils.RequireRole(ctx, utils.RolePharmacist)
	if err != nil {
		return nil, err
	}
	if err := validatePositive("quantityDispensed", quantityDispensed); err != nil {
		return nil, err
	}
	p, err := loadPrescription(ctx, prescriptionID)
	if err != nil {
		return nil, err
	}
	req, err := buildFulfillmentRequest(ctx, p, caller.MSP, quantityDispensed)
	if err != nil {
		return nil, err
	}
	if err := rules.EvaluateFulfillment(req); err != nil {
		return nil, err
	}

	seq := len(req.Fulfillments)
	f := models.Fulfillment{
		FulfillmentID:     fulfillmentID(prescriptionID, seq),
		PrescriptionID:    prescriptionID,
		PharmacistID:      caller.ID,
		PharmacyMSP:       caller.MSP,
		QuantityDispensed: quantityDispensed,
		FulfilledAt:       utils.FormatTime(req.Now),
		Sequence:          seq,
		DocType:           models.DocTypeFulfillment,
	}
	key, err := utils.FulfillmentKey(ctx, prescriptionID, seq)
	if err != nil {
		return nil, err
	}
	if err := putJSON(ctx, key, f); err != nil {
		return nil, err
	}
	return &f, nil
}

// GetFulfillments lists a prescription's fulfillments in sequence order.
func (c *FulfillmentContract) GetFulfillments(ctx contractapi.TransactionContextInterface, prescriptionID string) ([]models.Fulfillment, error) {
	if _, err := utils.RequireRole(ctx, utils.AllRoles()...); err != nil {
		return nil, err
	}
	if _, err := loadPrescription(ctx, prescriptionID); err != nil {
		return nil, err
	}
	return loadFulfillments(ctx, prescriptionID)
}
