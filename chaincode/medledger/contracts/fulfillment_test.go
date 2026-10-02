package contracts_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nithinvin/medledger/chaincode/errs"
	"github.com/nithinvin/medledger/chaincode/internal/mock"
	"github.com/nithinvin/medledger/chaincode/models"
	"github.com/nithinvin/medledger/chaincode/utils"
)

// h1Args issues a Schedule H1 drug: 2 refills, 20-day refill interval.
func h1Args(n int) issueArgs {
	a := defaultArgs(n)
	a.drug, a.refills, a.validity = "IN-CEFX-200", 2, 90
	return a
}

func TestRecordFulfillmentSuccess(t *testing.T) {
	l := mock.NewLedger()
	mustIssue(t, l, drSmith, t0, defaultArgs(1))
	f, err := fulfill(l, pharmJones, t0.Add(day), id(1), 30)
	require.NoError(t, err)

	assert.Equal(t, "FULFILL~"+id(1)+"~0000", f.FulfillmentID)
	assert.Equal(t, utils.PharmacyXMSP, f.PharmacyMSP)
	assert.Equal(t, "pharm.jones", f.PharmacistID)
	assert.Equal(t, 0, f.Sequence)
	assert.Equal(t, models.DocTypeFulfillment, f.DocType)
	assert.NotNil(t, l.State(mock.CompositeKey(utils.KeyTypeFulfillment, id(1), "0000")))
}

func TestStatusChangesWithoutMutatingPrescription(t *testing.T) { // AC-7
	l := mock.NewLedger()
	mustIssue(t, l, drSmith, t0, defaultArgs(1))
	before := l.State(prescriptionKey(id(1)))
	assert.Equal(t, models.StatusIssued, status(t, l, pharmJones, t0, id(1)))

	_, err := fulfill(l, pharmJones, t0.Add(day), id(1), 30)
	require.NoError(t, err)

	assert.Equal(t, models.StatusFullyFulfilled, status(t, l, pharmJones, t0.Add(day), id(1)))
	assert.Equal(t, before, l.State(prescriptionKey(id(1))), "prescription bytes unchanged")
	history, err := query(l, auditor, t0.Add(day), func(ctx *mock.Context) ([]models.HistoryEntry, error) {
		return queryC.GetPrescriptionHistory(ctx, id(1))
	})
	require.NoError(t, err)
	assert.Len(t, history, 1, "prescription written exactly once")
}

func TestRecordFulfillmentRejections(t *testing.T) {
	tests := []struct {
		name  string
		setup func(t *testing.T, l *mock.Ledger) // runs after issuing prescription 1
		args  issueArgs
		who   mock.Identity
		qty   int
		when  int // days after t0
		code  string
	}{
		{"AC-3: doctor cannot fulfill", nil, defaultArgs(1), drSmith, 10, 1, errs.CodeUnauthorized},
		{"regulator cannot fulfill", nil, defaultArgs(1), auditor, 10, 1, errs.CodeUnauthorized},
		{"zero quantity", nil, defaultArgs(1), pharmJones, 0, 1, errs.CodeInvalidArgument},
		{"AC-4: second fill on zero refills (R1)", fillOnce(pharmJones, 1), defaultArgs(1), pharmJones, 10, 2, errs.RuleFillLimit},
		{"AC-5: other pharmacy on zero refills (R1)", fillOnce(pharmJones, 1), defaultArgs(1), pharmLee, 10, 2, errs.RuleFillLimit},
		{"AC-5: other pharmacy inside refill interval (R7)", fillOnce(pharmJones, 1), h1Args(1), pharmLee, 10, 5, errs.RuleEarlyRefillCross},
		{"same pharmacy inside refill interval (R4)", fillOnce(pharmJones, 1), h1Args(1), pharmJones, 10, 5, errs.RuleEarlyRefillSame},
		{"quantity overrun (R2)", nil, defaultArgs(1), pharmJones, 31, 1, errs.RuleQuantityOverrun},
		{"AC-8: expired (R3)", nil, defaultArgs(1), pharmJones, 10, 31, errs.RuleExpired},
		{"revoked (R5)", revokeBy(drSmith), defaultArgs(1), pharmJones, 10, 1, errs.RuleRevoked},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			l := mock.NewLedger()
			mustIssue(t, l, drSmith, t0, tt.args)
			if tt.setup != nil {
				tt.setup(t, l)
			}
			keysBefore := l.Keys()
			_, err := fulfill(l, tt.who, t0.Add(time.Duration(tt.when)*day), id(1), tt.qty)
			requireCode(t, err, tt.code)
			assert.Equal(t, keysBefore, l.Keys(), "a rejected fulfillment writes nothing")
		})
	}

	t.Run("unknown prescription", func(t *testing.T) {
		_, err := fulfill(mock.NewLedger(), pharmJones, t0, id(9), 1)
		requireCode(t, err, errs.CodeNotFound)
	})
}

func TestRefillsAfterIntervalAndUpToLimit(t *testing.T) {
	l := mock.NewLedger()
	mustIssue(t, l, drSmith, t0, h1Args(1)) // 3 fills, 20-day interval
	_, err := fulfill(l, pharmJones, t0, id(1), 10)
	require.NoError(t, err)
	assert.Equal(t, models.StatusPartiallyFulfilled, status(t, l, drSmith, t0, id(1)))

	_, err = fulfill(l, pharmLee, t0.Add(20*day), id(1), 10)
	require.NoError(t, err, "other pharmacy allowed once the interval has passed")
	_, err = fulfill(l, pharmJones, t0.Add(40*day), id(1), 10)
	require.NoError(t, err)
	assert.Equal(t, models.StatusFullyFulfilled, status(t, l, drSmith, t0.Add(40*day), id(1)))

	_, err = fulfill(l, pharmJones, t0.Add(60*day), id(1), 10)
	requireCode(t, err, errs.RuleFillLimit)

	fills, err := query(l, auditor, t0, func(ctx *mock.Context) ([]models.Fulfillment, error) {
		return fulfillmentC.GetFulfillments(ctx, id(1))
	})
	require.NoError(t, err)
	require.Len(t, fills, 3)
	for i, f := range fills {
		assert.Equal(t, i, f.Sequence, "returned in sequence order")
	}
}

func TestGetFulfillmentsUnknownPrescription(t *testing.T) {
	_, err := query(mock.NewLedger(), auditor, t0, func(ctx *mock.Context) ([]models.Fulfillment, error) {
		return fulfillmentC.GetFulfillments(ctx, id(9))
	})
	requireCode(t, err, errs.CodeNotFound)
}

func fillOnce(who mock.Identity, afterDays int) func(t *testing.T, l *mock.Ledger) {
	return func(t *testing.T, l *mock.Ledger) {
		t.Helper()
		_, err := fulfill(l, who, t0.Add(time.Duration(afterDays)*day), id(1), 10)
		require.NoError(t, err)
	}
}

func revokeBy(who mock.Identity) func(t *testing.T, l *mock.Ledger) {
	return func(t *testing.T, l *mock.Ledger) {
		t.Helper()
		require.NoError(t, revoke(l, who, t0, id(1), "issued in error"))
	}
}
