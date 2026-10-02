package contracts_test

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nithinvin/medledger/chaincode/contracts"
	"github.com/nithinvin/medledger/chaincode/errs"
	"github.com/nithinvin/medledger/chaincode/internal/mock"
	"github.com/nithinvin/medledger/chaincode/models"
	"github.com/nithinvin/medledger/chaincode/utils"
)

func TestIssuePrescriptionSuccess(t *testing.T) { // AC-1
	l := mock.NewLedger()
	p := mustIssue(t, l, drSmith, t0, defaultArgs(1))

	assert.Equal(t, "dr.smith", p.DoctorID)
	assert.Equal(t, utils.HospitalAMSP, p.DoctorMSP)
	assert.Equal(t, "Morphine sulfate 10 mg tablet", p.DrugName, "copied from the profile")
	assert.Equal(t, "NDPS", p.ControlClass, "copied from the profile")
	assert.Equal(t, "2026-10-01T09:00:00Z", p.IssuedAt, "from the transaction timestamp")
	assert.Equal(t, models.DocTypePrescription, p.DocType)

	assert.NotNil(t, l.State(prescriptionKey(id(1))), "public record written")
	assert.NotNil(t, l.State(mock.CompositeKey(utils.KeyTypeDoctorIndex, utils.HospitalAMSP, "dr.smith", id(1))), "doctor index written")

	private := l.Private(contracts.CollectionPatientData, id(1))
	require.NotNil(t, private, "patient data in the private collection")
	sum := sha256.Sum256(private)
	assert.Equal(t, hex.EncodeToString(sum[:]), p.PatientDataHash, "public hash is SHA-256 of the private payload")

	// Visible from a pharmacy (AC-1: queryable from a pharmacy peer).
	got, err := query(l, pharmJones, t0, func(ctx *mock.Context) (*models.Prescription, error) {
		return prescriptionC.ReadPrescription(ctx, id(1))
	})
	require.NoError(t, err)
	assert.Equal(t, *p, *got)
}

func TestPatientDataNeverInPublicState(t *testing.T) { // AC-10
	l := mock.NewLedger()
	mustIssue(t, l, drSmith, t0, defaultArgs(1))
	for _, key := range l.Keys() {
		for _, secret := range []string{patientName, "1985-03-12", "PT-4471"} {
			assert.False(t, bytes.Contains(l.State(key), []byte(secret)), "public key %q leaks %q", key, secret)
		}
	}
}

func TestIssuePrescriptionRejections(t *testing.T) {
	withArgs := func(mod func(*issueArgs)) issueArgs {
		a := defaultArgs(1)
		mod(&a)
		return a
	}
	withTransient := func(mod func(map[string][]byte)) map[string][]byte {
		tm := patientTransient()
		mod(tm)
		return tm
	}
	long := string(bytes.Repeat([]byte("x"), 501))

	tests := []struct {
		name      string
		who       mock.Identity
		args      issueArgs
		transient map[string][]byte
		code      string
	}{
		{"AC-2: pharmacist cannot issue", pharmJones, defaultArgs(1), patientTransient(), errs.CodeUnauthorized},
		{"regulator cannot issue", auditor, defaultArgs(1), patientTransient(), errs.CodeUnauthorized},
		{"D14: doctor role from a pharmacy CA", rogueDr, defaultArgs(1), patientTransient(), errs.CodeUnauthorized},
		{"AC-6: NDPS drug with refills (R6)", drSmith, withArgs(func(a *issueArgs) { a.refills = 1 }), patientTransient(), errs.RuleClassRefillLimit},
		{"R6: Schedule H1 above its limit", drSmith, withArgs(func(a *issueArgs) { a.drug, a.refills = "IN-CEFX-200", 3 }), patientTransient(), errs.RuleClassRefillLimit},
		{"AC-13: unknown drug code", drSmith, withArgs(func(a *issueArgs) { a.drug = "XX-NOPE" }), patientTransient(), errs.CodeInvalidArgument},
		{"prescriptionId not a UUID", drSmith, withArgs(func(a *issueArgs) { a.id = "rx-1" }), patientTransient(), errs.CodeInvalidArgument},
		{"zero quantity", drSmith, withArgs(func(a *issueArgs) { a.quantity = 0 }), patientTransient(), errs.CodeInvalidArgument},
		{"negative refills", drSmith, withArgs(func(a *issueArgs) { a.refills = -1 }), patientTransient(), errs.CodeInvalidArgument},
		{"zero validity", drSmith, withArgs(func(a *issueArgs) { a.validity = 0 }), patientTransient(), errs.CodeInvalidArgument},
		{"validity over a year", drSmith, withArgs(func(a *issueArgs) { a.validity = 366 }), patientTransient(), errs.CodeInvalidArgument},
		{"empty dosage", drSmith, withArgs(func(a *issueArgs) { a.dosage = "" }), patientTransient(), errs.CodeInvalidArgument},
		{"dosage too long", drSmith, withArgs(func(a *issueArgs) { a.dosage = long }), patientTransient(), errs.CodeInvalidArgument},
		{"no transient data", drSmith, defaultArgs(1), nil, errs.CodeInvalidArgument},
		{"missing patient name", drSmith, defaultArgs(1), withTransient(func(m map[string][]byte) { delete(m, "patientName") }), errs.CodeInvalidArgument},
		{"bad date of birth", drSmith, defaultArgs(1), withTransient(func(m map[string][]byte) { m["patientDOB"] = []byte("12/03/1985") }), errs.CodeInvalidArgument},
		{"missing patient ref", drSmith, defaultArgs(1), withTransient(func(m map[string][]byte) { delete(m, "patientRef") }), errs.CodeInvalidArgument},
		{"salt too short", drSmith, defaultArgs(1), withTransient(func(m map[string][]byte) { m["salt"] = []byte("abcd") }), errs.CodeInvalidArgument},
		{"salt not hex", drSmith, defaultArgs(1), withTransient(func(m map[string][]byte) { m["salt"] = bytes.Repeat([]byte("z"), 32) }), errs.CodeInvalidArgument},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			l := mock.NewLedger()
			_, err := issueWith(l, tt.who, t0, tt.transient, tt.args)
			requireCode(t, err, tt.code)
			assert.Empty(t, l.Keys(), "a rejected transaction writes nothing")
		})
	}
}

func TestIssuePrescriptionDuplicateID(t *testing.T) {
	l := mock.NewLedger()
	mustIssue(t, l, drSmith, t0, defaultArgs(1))
	_, err := issueWith(l, drPatel, t0, patientTransient(), defaultArgs(1))
	requireCode(t, err, errs.CodeAlreadyExists)
}

func TestSaltChangesTheHash(t *testing.T) {
	l := mock.NewLedger()
	p1 := mustIssue(t, l, drSmith, t0, defaultArgs(1))
	tm := patientTransient()
	tm["salt"] = []byte("ffffffffffffffffffffffffffffffff")
	p2, err := issueWith(l, drSmith, t0, tm, defaultArgs(2))
	require.NoError(t, err)
	assert.NotEqual(t, p1.PatientDataHash, p2.PatientDataHash, "same patient, different salt, different hash")
}

func TestRevokePrescription(t *testing.T) {
	setup := func(t *testing.T) *mock.Ledger {
		l := mock.NewLedger()
		mustIssue(t, l, drSmith, t0, defaultArgs(1))
		return l
	}

	t.Run("issuer revokes; record untouched", func(t *testing.T) {
		l := setup(t)
		before := l.State(prescriptionKey(id(1)))
		require.NoError(t, revoke(l, drSmith, t0.Add(day), id(1), "patient allergy"))
		assert.Equal(t, before, l.State(prescriptionKey(id(1))))
		assert.Len(t, l.History(prescriptionKey(id(1))), 1)
		assert.Equal(t, models.StatusRevoked, status(t, l, auditor, t0.Add(day), id(1)))
	})
	t.Run("same-named doctor at the other hospital cannot revoke", func(t *testing.T) {
		requireCode(t, revoke(setup(t), drSmithB, t0, id(1), "x"), errs.CodeUnauthorized)
	})
	t.Run("another doctor cannot revoke", func(t *testing.T) {
		requireCode(t, revoke(setup(t), drPatel, t0, id(1), "x"), errs.CodeUnauthorized)
	})
	t.Run("pharmacist cannot revoke", func(t *testing.T) {
		requireCode(t, revoke(setup(t), pharmJones, t0, id(1), "x"), errs.CodeUnauthorized)
	})
	t.Run("reason required", func(t *testing.T) {
		requireCode(t, revoke(setup(t), drSmith, t0, id(1), ""), errs.CodeInvalidArgument)
	})
	t.Run("cannot revoke twice", func(t *testing.T) {
		l := setup(t)
		require.NoError(t, revoke(l, drSmith, t0, id(1), "first"))
		requireCode(t, revoke(l, drSmith, t0, id(1), "second"), errs.CodeAlreadyExists)
	})
	t.Run("unknown prescription", func(t *testing.T) {
		requireCode(t, revoke(setup(t), drSmith, t0, id(9), "x"), errs.CodeNotFound)
	})
}

func TestReadPatientData(t *testing.T) {
	l := mock.NewLedger()
	mustIssue(t, l, drSmith, t0, defaultArgs(1))
	read := func(who mock.Identity) (*models.PatientData, error) {
		return query(l, who, t0, func(ctx *mock.Context) (*models.PatientData, error) {
			return prescriptionC.ReadPatientData(ctx, id(1))
		})
	}

	for _, who := range []mock.Identity{drSmith, pharmJones, pharmLee} {
		pd, err := read(who)
		require.NoError(t, err, who.ID)
		assert.Equal(t, patientName, pd.PatientName)
	}

	l.SetPrivate(contracts.CollectionPatientData, id(1), []byte(`{"patientName":"Someone Else"}`))
	_, err := read(pharmJones)
	requireCode(t, err, errs.CodeInternal) // tampered private data no longer matches the public hash

	_, err = read(auditor) // AC-10, scenario 11
	requireCode(t, err, errs.CodeUnauthorized)

	_, err = query(l, drSmith, t0, func(ctx *mock.Context) (*models.PatientData, error) {
		return prescriptionC.ReadPatientData(ctx, id(9))
	})
	requireCode(t, err, errs.CodeNotFound)
}
