package rules

import (
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nithinvin/medledger/chaincode/errs"
	"github.com/nithinvin/medledger/chaincode/models"
	"github.com/nithinvin/medledger/chaincode/reference"
)

var t0 = time.Date(2026, 10, 1, 9, 0, 0, 0, time.UTC)

func prescription(refills, validityDays int) models.Prescription {
	return models.Prescription{
		PrescriptionID: "p1", Quantity: 30, RefillsAllowed: refills,
		ValidityDays: validityDays, IssuedAt: t0.Format(time.RFC3339),
	}
}

func fill(seq int, msp string, at time.Time) models.Fulfillment {
	return models.Fulfillment{Sequence: seq, PharmacyMSP: msp, FulfilledAt: at.Format(time.RFC3339)}
}

func codeOf(t *testing.T, err error) string {
	t.Helper()
	if err == nil {
		return ""
	}
	var coded *errs.Error
	require.True(t, errors.As(err, &coded), "error is *errs.Error: %v", err)
	return coded.Code
}

func TestEvaluateFulfillment(t *testing.T) {
	interval20 := reference.ClassLimits{MaxRefills: 2, MinRefillIntervalDays: 20}
	noInterval := reference.ClassLimits{MaxRefills: 0}

	tests := []struct {
		name string
		req  FulfillmentRequest
		want string // expected code; "" = allowed
	}{
		{"first fill allowed", FulfillmentRequest{Prescription: prescription(0, 30), Limits: noInterval, CallerMSP: "PX", QuantityDispensed: 30, Now: t0.Add(time.Hour)}, ""},
		{"R5 revoked wins over everything", FulfillmentRequest{Prescription: prescription(0, 30), Revoked: true, Fulfillments: []models.Fulfillment{fill(0, "PX", t0)}, Limits: noInterval, QuantityDispensed: 999, Now: t0.Add(400 * day)}, errs.RuleRevoked},
		{"R3 expired", FulfillmentRequest{Prescription: prescription(0, 30), Limits: noInterval, QuantityDispensed: 1, Now: t0.Add(31 * day)}, errs.RuleExpired},
		{"R3 boundary: exactly at expiry still valid", FulfillmentRequest{Prescription: prescription(0, 30), Limits: noInterval, QuantityDispensed: 1, Now: t0.Add(30 * day)}, ""},
		{"R1 second fill on zero refills", FulfillmentRequest{Prescription: prescription(0, 30), Fulfillments: []models.Fulfillment{fill(0, "PX", t0)}, Limits: noInterval, CallerMSP: "PX", QuantityDispensed: 1, Now: t0.Add(day)}, errs.RuleFillLimit},
		{"R1 cross-pharmacy on zero refills reports R1, not R7", FulfillmentRequest{Prescription: prescription(0, 30), Fulfillments: []models.Fulfillment{fill(0, "PX", t0)}, Limits: noInterval, CallerMSP: "PY", QuantityDispensed: 1, Now: t0.Add(day)}, errs.RuleFillLimit},
		{"R2 quantity overrun", FulfillmentRequest{Prescription: prescription(0, 30), Limits: noInterval, QuantityDispensed: 31, Now: t0}, errs.RuleQuantityOverrun},
		{"R2 boundary: exact quantity allowed", FulfillmentRequest{Prescription: prescription(0, 30), Limits: noInterval, QuantityDispensed: 30, Now: t0}, ""},
		{"R4 early refill same pharmacy", FulfillmentRequest{Prescription: prescription(2, 90), Fulfillments: []models.Fulfillment{fill(0, "PX", t0)}, Limits: interval20, CallerMSP: "PX", QuantityDispensed: 10, Now: t0.Add(10 * day)}, errs.RuleEarlyRefillSame},
		{"R7 early refill different pharmacy", FulfillmentRequest{Prescription: prescription(2, 90), Fulfillments: []models.Fulfillment{fill(0, "PX", t0)}, Limits: interval20, CallerMSP: "PY", QuantityDispensed: 10, Now: t0.Add(10 * day)}, errs.RuleEarlyRefillCross},
		{"interval boundary: exactly 20 days allowed", FulfillmentRequest{Prescription: prescription(2, 90), Fulfillments: []models.Fulfillment{fill(0, "PX", t0)}, Limits: interval20, CallerMSP: "PY", QuantityDispensed: 10, Now: t0.Add(20 * day)}, ""},
		{"interval measured from the latest fill", FulfillmentRequest{Prescription: prescription(2, 90), Fulfillments: []models.Fulfillment{fill(1, "PY", t0.Add(25*day)), fill(0, "PX", t0)}, Limits: interval20, CallerMSP: "PY", QuantityDispensed: 10, Now: t0.Add(30 * day)}, errs.RuleEarlyRefillSame},
		{"zero interval disables R4/R7", FulfillmentRequest{Prescription: prescription(2, 90), Fulfillments: []models.Fulfillment{fill(0, "PX", t0)}, Limits: reference.ClassLimits{MaxRefills: 2}, CallerMSP: "PX", QuantityDispensed: 10, Now: t0.Add(time.Minute)}, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, codeOf(t, EvaluateFulfillment(tt.req)))
		})
	}
}

func TestEvaluateFulfillmentRejectsCorruptTimestamps(t *testing.T) {
	p := prescription(0, 30)
	p.IssuedAt = "not-a-time"
	assert.Equal(t, errs.CodeInternal, codeOf(t, EvaluateFulfillment(FulfillmentRequest{Prescription: p, Now: t0})))

	bad := FulfillmentRequest{Prescription: prescription(2, 90), Fulfillments: []models.Fulfillment{{Sequence: 0, FulfilledAt: "bad"}}, Limits: reference.ClassLimits{MaxRefills: 2, MinRefillIntervalDays: 5}, QuantityDispensed: 1, Now: t0}
	assert.Equal(t, errs.CodeInternal, codeOf(t, EvaluateFulfillment(bad)))
}

func TestCheckIssuance(t *testing.T) {
	assert.NoError(t, CheckIssuance(0, "NDPS", reference.ClassLimits{MaxRefills: 0}))
	assert.Equal(t, errs.RuleClassRefillLimit, codeOf(t, CheckIssuance(1, "NDPS", reference.ClassLimits{MaxRefills: 0})))
	assert.NoError(t, CheckIssuance(2, "SCHEDULE_H1", reference.ClassLimits{MaxRefills: 2}))
	assert.Equal(t, errs.RuleClassRefillLimit, codeOf(t, CheckIssuance(3, "SCHEDULE_H1", reference.ClassLimits{MaxRefills: 2})))
}

func TestDeriveStatus(t *testing.T) {
	tests := []struct {
		name    string
		p       models.Prescription
		revoked bool
		fills   int
		now     time.Time
		want    string
	}{
		{"issued", prescription(1, 30), false, 0, t0, models.StatusIssued},
		{"partially fulfilled", prescription(1, 30), false, 1, t0, models.StatusPartiallyFulfilled},
		{"fully fulfilled", prescription(1, 30), false, 2, t0, models.StatusFullyFulfilled},
		{"expired", prescription(1, 30), false, 1, t0.Add(31 * day), models.StatusExpired},
		{"revoked", prescription(1, 30), true, 0, t0, models.StatusRevoked},
		{"revoked beats fully fulfilled", prescription(0, 30), true, 1, t0, models.StatusRevoked},
		{"fully fulfilled never later appears expired", prescription(0, 30), false, 1, t0.Add(400 * day), models.StatusFullyFulfilled},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := DeriveStatus(tt.p, tt.revoked, tt.fills, tt.now)
			require.NoError(t, err)
			assert.Equal(t, tt.want, got)
		})
	}

	bad := prescription(0, 30)
	bad.IssuedAt = "bad"
	_, err := DeriveStatus(bad, false, 0, t0)
	assert.Error(t, err)
}
