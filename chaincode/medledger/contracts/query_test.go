package contracts_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nithinvin/medledger/chaincode/errs"
	"github.com/nithinvin/medledger/chaincode/internal/mock"
	"github.com/nithinvin/medledger/chaincode/models"
	"github.com/nithinvin/medledger/chaincode/reference"
	"github.com/nithinvin/medledger/chaincode/utils"
)

func TestGetPrescriptionStatusAllStates(t *testing.T) {
	l := mock.NewLedger()
	mustIssue(t, l, drSmith, t0, h1Args(1))      // 3 fills
	mustIssue(t, l, drSmith, t0, defaultArgs(2)) // 1 fill
	mustIssue(t, l, drSmith, t0, defaultArgs(3))
	mustIssue(t, l, drSmith, t0, defaultArgs(4))
	_, err := fulfill(l, pharmJones, t0, id(1), 10)
	require.NoError(t, err)
	_, err = fulfill(l, pharmJones, t0, id(2), 10)
	require.NoError(t, err)
	require.NoError(t, revoke(l, drSmith, t0, id(4), "error"))

	assert.Equal(t, models.StatusPartiallyFulfilled, status(t, l, auditor, t0, id(1)))
	assert.Equal(t, models.StatusFullyFulfilled, status(t, l, auditor, t0, id(2)))
	assert.Equal(t, models.StatusIssued, status(t, l, auditor, t0, id(3)))
	assert.Equal(t, models.StatusExpired, status(t, l, auditor, t0.Add(31*day), id(3)))
	assert.Equal(t, models.StatusRevoked, status(t, l, auditor, t0, id(4)))

	_, err = query(l, auditor, t0, func(ctx *mock.Context) (string, error) {
		return queryC.GetPrescriptionStatus(ctx, id(9))
	})
	requireCode(t, err, errs.CodeNotFound)
}

func TestGetPrescriptionHistory(t *testing.T) { // AC-9
	l := mock.NewLedger()
	mustIssue(t, l, drSmith, t0, defaultArgs(1))
	history, err := query(l, auditor, t0, func(ctx *mock.Context) ([]models.HistoryEntry, error) {
		return queryC.GetPrescriptionHistory(ctx, id(1))
	})
	require.NoError(t, err)
	require.Len(t, history, 1)
	assert.NotEmpty(t, history[0].TxID)
	assert.Equal(t, "2026-10-01T09:00:00Z", history[0].Timestamp)
	require.NotNil(t, history[0].Value)
	assert.Equal(t, id(1), history[0].Value.PrescriptionID)

	_, err = query(l, drSmith, t0, func(ctx *mock.Context) ([]models.HistoryEntry, error) {
		return queryC.GetPrescriptionHistory(ctx, id(1))
	})
	requireCode(t, err, errs.CodeUnauthorized)

	_, err = query(l, auditor, t0, func(ctx *mock.Context) ([]models.HistoryEntry, error) {
		return queryC.GetPrescriptionHistory(ctx, id(9))
	})
	requireCode(t, err, errs.CodeNotFound)
}

func TestGetPrescriptionsByDoctor(t *testing.T) {
	l := mock.NewLedger()
	mustIssue(t, l, drSmith, t0, defaultArgs(1))
	mustIssue(t, l, drSmith, t0, defaultArgs(2))
	mustIssue(t, l, drPatel, t0, defaultArgs(3))
	byDoctor := func(who mock.Identity, msp, doctorID string) ([]models.Prescription, error) {
		return query(l, who, t0, func(ctx *mock.Context) ([]models.Prescription, error) {
			return queryC.GetPrescriptionsByDoctor(ctx, msp, doctorID)
		})
	}

	own, err := byDoctor(drSmith, utils.HospitalAMSP, "dr.smith")
	require.NoError(t, err)
	assert.Len(t, own, 2)

	others, err := byDoctor(auditor, utils.HospitalBMSP, "dr.patel")
	require.NoError(t, err)
	assert.Len(t, others, 1, "regulator may list any doctor")

	none, err := byDoctor(drSmithB, utils.HospitalBMSP, "dr.smith")
	require.NoError(t, err)
	assert.Empty(t, none, "same name at another hospital is a different doctor")

	_, err = byDoctor(drSmith, utils.HospitalBMSP, "dr.patel")
	requireCode(t, err, errs.CodeUnauthorized)
	_, err = byDoctor(pharmJones, utils.HospitalAMSP, "dr.smith")
	requireCode(t, err, errs.CodeUnauthorized)
}

func TestCheckFulfillmentEligibility(t *testing.T) {
	l := mock.NewLedger()
	mustIssue(t, l, drSmith, t0, defaultArgs(1))
	check := func(who mock.Identity, at time.Time, qty int) (*models.Eligibility, error) {
		return query(l, who, at, func(ctx *mock.Context) (*models.Eligibility, error) {
			return queryC.CheckFulfillmentEligibility(ctx, id(1), qty)
		})
	}

	ok, err := check(pharmJones, t0, 30)
	require.NoError(t, err)
	assert.Equal(t, models.Eligibility{Eligible: true, Status: models.StatusIssued}, *ok)

	over, err := check(pharmJones, t0, 31)
	require.NoError(t, err)
	assert.False(t, over.Eligible)
	assert.Equal(t, errs.RuleQuantityOverrun, over.Rule)
	assert.NotEmpty(t, over.Reason)

	keysBefore := l.Keys()
	_, err = fulfill(l, pharmJones, t0, id(1), 30)
	require.NoError(t, err)
	assert.NotEqual(t, keysBefore, l.Keys())

	used, err := check(pharmLee, t0.Add(day), 10)
	require.NoError(t, err)
	assert.Equal(t, models.Eligibility{Eligible: false, Status: models.StatusFullyFulfilled, Rule: errs.RuleFillLimit, Reason: used.Reason}, *used)

	_, err = check(drSmith, t0, 10)
	requireCode(t, err, errs.CodeUnauthorized)
	_, err = check(pharmJones, t0, 0)
	requireCode(t, err, errs.CodeInvalidArgument)
}

func TestEligibilityDryRunWritesNothing(t *testing.T) {
	l := mock.NewLedger()
	mustIssue(t, l, drSmith, t0, defaultArgs(1))
	keys := l.Keys()
	_, err := query(l, pharmJones, t0, func(ctx *mock.Context) (*models.Eligibility, error) {
		return queryC.CheckFulfillmentEligibility(ctx, id(1), 30)
	})
	require.NoError(t, err)
	assert.Equal(t, keys, l.Keys())
}

func TestGetDrugReference(t *testing.T) {
	for _, who := range []mock.Identity{drSmith, pharmLee, auditor} {
		p, err := query(mock.NewLedger(), who, t0, func(ctx *mock.Context) (*reference.Profile, error) {
			return queryC.GetDrugReference(ctx)
		})
		require.NoError(t, err)
		assert.Equal(t, "IN", p.Jurisdiction)
	}
	_, err := query(mock.NewLedger(), rogueDr, t0, func(ctx *mock.Context) (*reference.Profile, error) {
		return queryC.GetDrugReference(ctx)
	})
	requireCode(t, err, errs.CodeUnauthorized)
}
