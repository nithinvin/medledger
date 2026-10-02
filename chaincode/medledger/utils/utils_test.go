package utils_test

import (
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nithinvin/medledger/chaincode/errs"
	"github.com/nithinvin/medledger/chaincode/internal/mock"
	"github.com/nithinvin/medledger/chaincode/utils"
)

func requireRoleAs(t *testing.T, who mock.Identity, allowed ...string) (utils.Caller, error) {
	t.Helper()
	var caller utils.Caller
	var callErr error
	_ = mock.NewLedger().Invoke(mock.Tx{Caller: who, Time: time.Now()}, func(ctx *mock.Context) error {
		caller, callErr = utils.RequireRole(ctx, allowed...)
		return nil
	})
	return caller, callErr
}

func TestRequireRole(t *testing.T) {
	tests := []struct {
		name    string
		who     mock.Identity
		allowed []string
		wantErr bool
	}{
		{"doctor from hospital", mock.Identity{ID: "dr.smith", MSP: utils.HospitalAMSP, Role: utils.RoleDoctor}, []string{utils.RoleDoctor}, false},
		{"pharmacist from pharmacy", mock.Identity{ID: "pharm.lee", MSP: utils.PharmacyYMSP, Role: utils.RolePharmacist}, []string{utils.RolePharmacist}, false},
		{"regulator from regulator", mock.Identity{ID: "auditor.gov", MSP: utils.RegulatorMSP, Role: utils.RoleRegulator}, utils.AllRoles(), false},
		{"wrong role for function", mock.Identity{ID: "pharm.jones", MSP: utils.PharmacyXMSP, Role: utils.RolePharmacist}, []string{utils.RoleDoctor}, true},
		{"no role attribute", mock.Identity{ID: "x", MSP: utils.HospitalAMSP}, utils.AllRoles(), true},
		{"D14: doctor minted by a pharmacy CA", mock.Identity{ID: "dr.rogue", MSP: utils.PharmacyXMSP, Role: utils.RoleDoctor}, []string{utils.RoleDoctor}, true},
		{"D14: pharmacist minted by a hospital CA", mock.Identity{ID: "ph.rogue", MSP: utils.HospitalBMSP, Role: utils.RolePharmacist}, []string{utils.RolePharmacist}, true},
		{"D14: regulator minted by a hospital CA", mock.Identity{ID: "aud.rogue", MSP: utils.HospitalAMSP, Role: utils.RoleRegulator}, []string{utils.RoleRegulator}, true},
		{"unknown MSP", mock.Identity{ID: "dr.x", MSP: "EvilMSP", Role: utils.RoleDoctor}, []string{utils.RoleDoctor}, true},
		{"empty common name", mock.Identity{ID: "", MSP: utils.HospitalAMSP, Role: utils.RoleDoctor}, []string{utils.RoleDoctor}, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			caller, err := requireRoleAs(t, tt.who, tt.allowed...)
			if tt.wantErr {
				var coded *errs.Error
				require.True(t, errors.As(err, &coded))
				assert.Equal(t, errs.CodeUnauthorized, coded.Code)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, utils.Caller{ID: tt.who.ID, MSP: tt.who.MSP, Role: tt.who.Role}, caller)
		})
	}
}

func TestFormatSequenceSortsNumerically(t *testing.T) {
	assert.Equal(t, "0002", utils.FormatSequence(2))
	assert.Less(t, utils.FormatSequence(9), utils.FormatSequence(10))
}

func TestTimeRoundTrip(t *testing.T) {
	ts := time.Date(2026, 10, 1, 9, 30, 0, 0, time.FixedZone("IST", 5*3600+1800))
	parsed, err := utils.ParseTime(utils.FormatTime(ts))
	require.NoError(t, err)
	assert.True(t, ts.Equal(parsed))
	assert.Equal(t, "2026-10-01T04:00:00Z", utils.FormatTime(ts), "stored in UTC")

	_, err = utils.ParseTime("yesterday")
	assert.Error(t, err)
}

func TestTxTimeComesFromTransaction(t *testing.T) {
	want := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	var got time.Time
	require.NoError(t, mock.NewLedger().Invoke(mock.Tx{Time: want}, func(ctx *mock.Context) error {
		var err error
		got, err = utils.TxTime(ctx)
		return err
	}))
	assert.True(t, want.Equal(got))
}
