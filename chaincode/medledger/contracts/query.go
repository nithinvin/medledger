package contracts

import (
	"encoding/json"
	"errors"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"

	"github.com/nithinvin/medledger/chaincode/errs"
	"github.com/nithinvin/medledger/chaincode/models"
	"github.com/nithinvin/medledger/chaincode/reference"
	"github.com/nithinvin/medledger/chaincode/rules"
	"github.com/nithinvin/medledger/chaincode/utils"
)

// QueryContract provides read-only views. Invoke as "QueryContract:<fn>".
type QueryContract struct {
	contractapi.Contract
}

// GetPrescriptionStatus derives the status; it is never stored (D1).
func (c *QueryContract) GetPrescriptionStatus(ctx contractapi.TransactionContextInterface, prescriptionID string) (string, error) {
	if _, err := utils.RequireRole(ctx, utils.AllRoles()...); err != nil {
		return "", err
	}
	p, err := loadPrescription(ctx, prescriptionID)
	if err != nil {
		return "", err
	}
	return deriveStatus(ctx, p)
}

// GetPrescriptionHistory returns every write to the prescription key. A
// never-modified prescription has exactly one entry (AC-7).
func (c *QueryContract) GetPrescriptionHistory(ctx contractapi.TransactionContextInterface, prescriptionID string) ([]models.HistoryEntry, error) {
	if _, err := utils.RequireRole(ctx, utils.RoleRegulator); err != nil {
		return nil, err
	}
	key, err := utils.PrescriptionKey(ctx, prescriptionID)
	if err != nil {
		return nil, errs.Internal("build prescription key", err)
	}
	iter, err := ctx.GetStub().GetHistoryForKey(key)
	if err != nil {
		return nil, errs.Internal("query key history", err)
	}
	defer func() { _ = iter.Close() }() // read-only iterator; nothing to recover on close

	history := []models.HistoryEntry{}
	for iter.HasNext() {
		mod, err := iter.Next()
		if err != nil {
			return nil, errs.Internal("iterate key history", err)
		}
		entry := models.HistoryEntry{TxID: mod.TxId, IsDelete: mod.IsDelete}
		if mod.Timestamp != nil {
			entry.Timestamp = utils.FormatTime(mod.Timestamp.AsTime())
		}
		if !mod.IsDelete && len(mod.Value) > 0 {
			var p models.Prescription
			if err := json.Unmarshal(mod.Value, &p); err != nil {
				return nil, errs.Internal("decode history value", err)
			}
			entry.Value = &p
		}
		history = append(history, entry)
	}
	if len(history) == 0 {
		return nil, errs.New(errs.CodeNotFound, "prescription %s does not exist", prescriptionID)
	}
	return history, nil
}

// GetPrescriptionsByDoctor lists a doctor's prescriptions. Doctors may list
// only their own; the regulator may list anyone's.
func (c *QueryContract) GetPrescriptionsByDoctor(ctx contractapi.TransactionContextInterface, doctorMSP, doctorID string) ([]models.Prescription, error) {
	caller, err := utils.RequireRole(ctx, utils.RoleDoctor, utils.RoleRegulator)
	if err != nil {
		return nil, err
	}
	if caller.Role == utils.RoleDoctor && (caller.MSP != doctorMSP || caller.ID != doctorID) {
		return nil, errs.New(errs.CodeUnauthorized, "doctors may list only their own prescriptions")
	}
	iter, err := ctx.GetStub().GetStateByPartialCompositeKey(utils.KeyTypeDoctorIndex, []string{doctorMSP, doctorID})
	if err != nil {
		return nil, errs.Internal("query doctor index", err)
	}
	defer func() { _ = iter.Close() }() // read-only iterator; nothing to recover on close

	prescriptions := []models.Prescription{}
	for iter.HasNext() {
		kv, err := iter.Next()
		if err != nil {
			return nil, errs.Internal("iterate doctor index", err)
		}
		_, attrs, err := ctx.GetStub().SplitCompositeKey(kv.Key)
		if err != nil || len(attrs) != 3 {
			return nil, errs.New(errs.CodeInternal, "malformed doctor index key")
		}
		p, err := loadPrescription(ctx, attrs[2])
		if err != nil {
			return nil, err
		}
		prescriptions = append(prescriptions, p)
	}
	return prescriptions, nil
}

// CheckFulfillmentEligibility dry-runs the fraud rules for a dispense and
// reports the outcome instead of failing. Nothing is written.
func (c *QueryContract) CheckFulfillmentEligibility(ctx contractapi.TransactionContextInterface,
	prescriptionID string, quantityRequested int) (*models.Eligibility, error) {

	caller, err := utils.RequireRole(ctx, utils.RolePharmacist)
	if err != nil {
		return nil, err
	}
	if err := validatePositive("quantityRequested", quantityRequested); err != nil {
		return nil, err
	}
	p, err := loadPrescription(ctx, prescriptionID)
	if err != nil {
		return nil, err
	}
	req, err := buildFulfillmentRequest(ctx, p, caller.MSP, quantityRequested)
	if err != nil {
		return nil, err
	}
	status, err := rules.DeriveStatus(p, req.Revoked, len(req.Fulfillments), req.Now)
	if err != nil {
		return nil, err
	}

	result := &models.Eligibility{Eligible: true, Status: status}
	if violation := rules.EvaluateFulfillment(req); violation != nil {
		var coded *errs.Error
		if !errors.As(violation, &coded) || coded.Code == errs.CodeInternal {
			return nil, violation
		}
		result.Eligible = false
		result.Rule = coded.Code
		result.Reason = coded.Message
	}
	return result, nil
}

// GetDrugReference returns the jurisdiction profile, for UI drug pickers.
func (c *QueryContract) GetDrugReference(ctx contractapi.TransactionContextInterface) (*reference.Profile, error) {
	if _, err := utils.RequireRole(ctx, utils.AllRoles()...); err != nil {
		return nil, err
	}
	return loadProfile()
}

func deriveStatus(ctx contractapi.TransactionContextInterface, p models.Prescription) (string, error) {
	revoked, err := revocationExists(ctx, p.PrescriptionID)
	if err != nil {
		return "", err
	}
	fulfillments, err := loadFulfillments(ctx, p.PrescriptionID)
	if err != nil {
		return "", err
	}
	now, err := utils.TxTime(ctx)
	if err != nil {
		return "", err
	}
	return rules.DeriveStatus(p, revoked, len(fulfillments), now)
}
