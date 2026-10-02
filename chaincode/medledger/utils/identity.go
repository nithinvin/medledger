package utils

import (
	"fmt"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"

	"github.com/nithinvin/medledger/chaincode/errs"
)

// Roles carried in the certificate's `role` attribute (Phase 3 enrollment).
const (
	RoleDoctor     = "doctor"
	RolePharmacist = "pharmacist"
	RoleRegulator  = "regulator"

	roleAttribute = "role"
)

// MSP IDs of the consortium (docs/design/architecture.md#organizations-and-hostnames).
const (
	HospitalAMSP = "HospitalAMSP"
	HospitalBMSP = "HospitalBMSP"
	PharmacyXMSP = "PharmacyXMSP"
	PharmacyYMSP = "PharmacyYMSP"
	RegulatorMSP = "RegulatorMSP"
)

// Caller is the authenticated identity invoking a transaction.
type Caller struct {
	ID   string // certificate common name
	MSP  string
	Role string
}

// roleAllowedForMSP binds each role to the organization type that may hold
// it. Every org runs its own CA, so a role attribute alone is self-asserted:
// without this check a pharmacy's CA could mint a "doctor" (decision D14).
func roleAllowedForMSP(role, msp string) bool {
	switch role {
	case RoleDoctor:
		return msp == HospitalAMSP || msp == HospitalBMSP
	case RolePharmacist:
		return msp == PharmacyXMSP || msp == PharmacyYMSP
	case RoleRegulator:
		return msp == RegulatorMSP
	default:
		return false
	}
}

// GetMSPID returns the caller's organization MSP ID.
func GetMSPID(ctx contractapi.TransactionContextInterface) (string, error) {
	msp, err := ctx.GetClientIdentity().GetMSPID()
	if err != nil {
		return "", errs.Internal("read caller MSP ID", err)
	}
	return msp, nil
}

// GetCallerID returns the caller's certificate common name.
func GetCallerID(ctx contractapi.TransactionContextInterface) (string, error) {
	cert, err := ctx.GetClientIdentity().GetX509Certificate()
	if err != nil {
		return "", errs.Internal("read caller certificate", err)
	}
	if cert == nil || cert.Subject.CommonName == "" {
		return "", errs.New(errs.CodeUnauthorized, "caller certificate has no common name")
	}
	return cert.Subject.CommonName, nil
}

// GetRole returns the caller's `role` certificate attribute ("" if absent).
func GetRole(ctx contractapi.TransactionContextInterface) (string, error) {
	role, _, err := ctx.GetClientIdentity().GetAttributeValue(roleAttribute)
	if err != nil {
		return "", errs.Internal("read caller role attribute", err)
	}
	return role, nil
}

// RequireRole authorizes the caller for one of the given roles and returns
// the caller's identity. The role must come from an organization allowed to
// hold it. Call it first in every contract function.
func RequireRole(ctx contractapi.TransactionContextInterface, allowed ...string) (Caller, error) {
	role, err := GetRole(ctx)
	if err != nil {
		return Caller{}, err
	}
	msp, err := GetMSPID(ctx)
	if err != nil {
		return Caller{}, err
	}
	if !contains(allowed, role) {
		return Caller{}, errs.New(errs.CodeUnauthorized, "role %q from %s may not call this function (allowed: %v)", role, msp, allowed)
	}
	if !roleAllowedForMSP(role, msp) {
		return Caller{}, errs.New(errs.CodeUnauthorized, "role %q is not valid for organization %s", role, msp)
	}
	id, err := GetCallerID(ctx)
	if err != nil {
		return Caller{}, err
	}
	return Caller{ID: id, MSP: msp, Role: role}, nil
}

func contains(values []string, v string) bool {
	for _, x := range values {
		if x == v {
			return true
		}
	}
	return false
}

// AllRoles lists every role, for functions any authorized participant may call.
func AllRoles() []string {
	return []string{RoleDoctor, RolePharmacist, RoleRegulator}
}

// String renders a caller for error messages.
func (c Caller) String() string {
	return fmt.Sprintf("%s@%s", c.ID, c.MSP)
}
