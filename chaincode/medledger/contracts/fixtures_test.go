package contracts_test

import (
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/nithinvin/medledger/chaincode/contracts"
	"github.com/nithinvin/medledger/chaincode/errs"
	"github.com/nithinvin/medledger/chaincode/internal/mock"
	"github.com/nithinvin/medledger/chaincode/models"
	"github.com/nithinvin/medledger/chaincode/utils"
)

const day = 24 * time.Hour

var t0 = time.Date(2026, 10, 1, 9, 0, 0, 0, time.UTC)

// Demo users (docs/runbook.md#demo-accounts) plus adversarial identities.
var (
	drSmith    = mock.Identity{ID: "dr.smith", MSP: utils.HospitalAMSP, Role: utils.RoleDoctor}
	drPatel    = mock.Identity{ID: "dr.patel", MSP: utils.HospitalBMSP, Role: utils.RoleDoctor}
	drSmithB   = mock.Identity{ID: "dr.smith", MSP: utils.HospitalBMSP, Role: utils.RoleDoctor} // same CN, other hospital
	pharmJones = mock.Identity{ID: "pharm.jones", MSP: utils.PharmacyXMSP, Role: utils.RolePharmacist}
	pharmLee   = mock.Identity{ID: "pharm.lee", MSP: utils.PharmacyYMSP, Role: utils.RolePharmacist}
	auditor    = mock.Identity{ID: "auditor.gov", MSP: utils.RegulatorMSP, Role: utils.RoleRegulator}
	rogueDr    = mock.Identity{ID: "dr.rogue", MSP: utils.PharmacyXMSP, Role: utils.RoleDoctor} // D14
)

var (
	prescriptionC = &contracts.PrescriptionContract{}
	fulfillmentC  = &contracts.FulfillmentContract{}
	queryC        = &contracts.QueryContract{}
)

const patientName = "Priya Sharma"

func id(n int) string { return fmt.Sprintf("%08d-0000-4000-8000-000000000000", n) }

func patientTransient() map[string][]byte {
	return map[string][]byte{
		"patientName": []byte(patientName),
		"patientDOB":  []byte("1985-03-12"),
		"patientRef":  []byte("PT-4471"),
		"salt":        []byte("3c9e0b7a5d1f42e8a6b4c2d0e8f6a4b2"),
	}
}

// issueArgs are IssuePrescription's ordinary arguments.
type issueArgs struct {
	id       string
	drug     string
	quantity int
	dosage   string
	refills  int
	validity int
}

func defaultArgs(n int) issueArgs {
	return issueArgs{id: id(n), drug: "IN-MORPH-10", quantity: 30, dosage: "1 tablet every 12 hours", refills: 0, validity: 30}
}

func issueWith(l *mock.Ledger, who mock.Identity, at time.Time, transient map[string][]byte, a issueArgs) (*models.Prescription, error) {
	var out *models.Prescription
	err := l.Invoke(mock.Tx{Caller: who, Time: at, Transient: transient}, func(ctx *mock.Context) error {
		var err error
		out, err = prescriptionC.IssuePrescription(ctx, a.id, a.drug, a.quantity, a.dosage, a.refills, a.validity)
		return err
	})
	return out, err
}

func mustIssue(t *testing.T, l *mock.Ledger, who mock.Identity, at time.Time, a issueArgs) *models.Prescription {
	t.Helper()
	p, err := issueWith(l, who, at, patientTransient(), a)
	require.NoError(t, err)
	return p
}

func fulfill(l *mock.Ledger, who mock.Identity, at time.Time, presID string, qty int) (*models.Fulfillment, error) {
	var out *models.Fulfillment
	err := l.Invoke(mock.Tx{Caller: who, Time: at}, func(ctx *mock.Context) error {
		var err error
		out, err = fulfillmentC.RecordFulfillment(ctx, presID, qty)
		return err
	})
	return out, err
}

func revoke(l *mock.Ledger, who mock.Identity, at time.Time, presID, reason string) error {
	return l.Invoke(mock.Tx{Caller: who, Time: at}, func(ctx *mock.Context) error {
		_, err := prescriptionC.RevokePrescription(ctx, presID, reason)
		return err
	})
}

func status(t *testing.T, l *mock.Ledger, who mock.Identity, at time.Time, presID string) string {
	t.Helper()
	var s string
	require.NoError(t, l.Invoke(mock.Tx{Caller: who, Time: at}, func(ctx *mock.Context) error {
		var err error
		s, err = queryC.GetPrescriptionStatus(ctx, presID)
		return err
	}))
	return s
}

// query runs a read-only call and returns its result.
func query[T any](l *mock.Ledger, who mock.Identity, at time.Time, fn func(ctx *mock.Context) (T, error)) (T, error) {
	var out T
	err := l.Invoke(mock.Tx{Caller: who, Time: at}, func(ctx *mock.Context) error {
		var err error
		out, err = fn(ctx)
		return err
	})
	return out, err
}

func requireCode(t *testing.T, err error, code string) {
	t.Helper()
	require.Error(t, err)
	var coded *errs.Error
	require.True(t, errors.As(err, &coded), "error is *errs.Error: %v", err)
	require.Equal(t, code, coded.Code, "error: %v", err)
}

func prescriptionKey(presID string) string {
	return mock.CompositeKey(utils.KeyTypePrescription, presID)
}
