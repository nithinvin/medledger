// Package rules holds the fraud rules and status derivation as pure
// functions over already-loaded ledger records, so they can be tested
// without a ledger (docs/design/chaincode.md#fraud-rule-evaluation-order).
package rules

import (
	"time"

	"github.com/nithinvin/medledger/chaincode/errs"
	"github.com/nithinvin/medledger/chaincode/models"
	"github.com/nithinvin/medledger/chaincode/reference"
	"github.com/nithinvin/medledger/chaincode/utils"
)

const day = 24 * time.Hour

// FulfillmentRequest is everything the fraud rules need to judge one dispense.
type FulfillmentRequest struct {
	Prescription      models.Prescription
	Revoked           bool
	Fulfillments      []models.Fulfillment
	Limits            reference.ClassLimits
	CallerMSP         string
	QuantityDispensed int
	Now               time.Time
}

// EvaluateFulfillment applies R5, R3, R1, R2, then R4/R7, in that order, and
// returns the first violation as an *errs.Error coded with its rule ID, or
// nil when the dispense is allowed. Role and existence checks happen earlier,
// in the contract.
func EvaluateFulfillment(req FulfillmentRequest) error {
	p := req.Prescription

	if req.Revoked {
		return errs.New(errs.RuleRevoked, "prescription %s has been revoked", p.PrescriptionID)
	}

	expired, err := IsExpired(p, req.Now)
	if err != nil {
		return err
	}
	if expired {
		return errs.New(errs.RuleExpired, "prescription %s expired after %d days", p.PrescriptionID, p.ValidityDays)
	}

	if len(req.Fulfillments) >= MaxFills(p) {
		return errs.New(errs.RuleFillLimit, "fulfillment limit reached: %d of %d fills used", len(req.Fulfillments), MaxFills(p))
	}

	if req.QuantityDispensed > p.Quantity {
		return errs.New(errs.RuleQuantityOverrun, "quantity %d exceeds prescribed %d per fill", req.QuantityDispensed, p.Quantity)
	}

	return checkRefillInterval(req)
}

// checkRefillInterval implements R4 (same pharmacy) and R7 (different
// pharmacy): both reject a fill inside the control class's refill interval,
// split by who made the latest fill (decision D13).
func checkRefillInterval(req FulfillmentRequest) error {
	interval := req.Limits.MinRefillIntervalDays
	latest, ok := latestFulfillment(req.Fulfillments)
	if interval <= 0 || !ok {
		return nil
	}
	filledAt, err := utils.ParseTime(latest.FulfilledAt)
	if err != nil {
		return err
	}
	if req.Now.Sub(filledAt) >= time.Duration(interval)*day {
		return nil
	}
	if latest.PharmacyMSP == req.CallerMSP {
		return errs.New(errs.RuleEarlyRefillSame, "early refill: last fill at this pharmacy was less than %d days ago", interval)
	}
	return errs.New(errs.RuleEarlyRefillCross, "early refill at a different pharmacy: last fill by %s was less than %d days ago", latest.PharmacyMSP, interval)
}

// MaxFills is the number of dispenses a prescription allows.
func MaxFills(p models.Prescription) int {
	return p.RefillsAllowed + 1
}

// IsExpired reports whether now is past the prescription's validity window.
func IsExpired(p models.Prescription, now time.Time) (bool, error) {
	issuedAt, err := utils.ParseTime(p.IssuedAt)
	if err != nil {
		return false, err
	}
	return now.After(issuedAt.Add(time.Duration(p.ValidityDays) * day)), nil
}

// CheckIssuance applies R6: refills may not exceed the control class limit.
func CheckIssuance(refillsAllowed int, controlClass string, limits reference.ClassLimits) error {
	if refillsAllowed > limits.MaxRefills {
		return errs.New(errs.RuleClassRefillLimit, "control class %s allows at most %d refills, requested %d", controlClass, limits.MaxRefills, refillsAllowed)
	}
	return nil
}

func latestFulfillment(fulfillments []models.Fulfillment) (models.Fulfillment, bool) {
	if len(fulfillments) == 0 {
		return models.Fulfillment{}, false
	}
	latest := fulfillments[0]
	for _, f := range fulfillments[1:] {
		if f.Sequence > latest.Sequence {
			latest = f
		}
	}
	return latest, true
}
