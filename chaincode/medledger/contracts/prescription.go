package contracts

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"

	"github.com/nithinvin/medledger/chaincode/errs"
	"github.com/nithinvin/medledger/chaincode/models"
	"github.com/nithinvin/medledger/chaincode/rules"
	"github.com/nithinvin/medledger/chaincode/utils"
)

// Transient map keys carrying patient data (never ordinary arguments, D5).
const (
	transientPatientName = "patientName"
	transientPatientDOB  = "patientDOB"
	transientPatientRef  = "patientRef"
	transientSalt        = "salt"
)

// PrescriptionContract issues, revokes, and reads prescriptions. It is the
// default contract, so its functions can be invoked without a name prefix.
type PrescriptionContract struct {
	contractapi.Contract
}

// IssuePrescription writes an immutable prescription. Patient fields arrive in
// the transient map (patientName, patientDOB, patientRef, salt).
func (c *PrescriptionContract) IssuePrescription(ctx contractapi.TransactionContextInterface,
	prescriptionID, drugCode string, quantity int, dosageInstructions string,
	refillsAllowed, validityDays int) (*models.Prescription, error) {

	caller, err := utils.RequireRole(ctx, utils.RoleDoctor)
	if err != nil {
		return nil, err
	}
	if err := validateIssueArgs(prescriptionID, quantity, dosageInstructions, refillsAllowed, validityDays); err != nil {
		return nil, err
	}
	exists, err := prescriptionExists(ctx, prescriptionID)
	if err != nil {
		return nil, err
	}
	if exists {
		return nil, errs.New(errs.CodeAlreadyExists, "prescription %s already exists", prescriptionID)
	}

	profile, err := loadProfile()
	if err != nil {
		return nil, err
	}
	drug, ok := profile.LookupDrug(drugCode)
	if !ok {
		return nil, errs.New(errs.CodeInvalidArgument, "unknown drug code %q", drugCode)
	}
	limits, ok := profile.Limits(drug.ControlClass)
	if !ok {
		return nil, errs.New(errs.CodeInternal, "control class %s missing from jurisdiction profile", drug.ControlClass)
	}
	if err := rules.CheckIssuance(refillsAllowed, drug.ControlClass, limits); err != nil {
		return nil, err
	}

	patient, err := readPatientTransient(ctx, prescriptionID)
	if err != nil {
		return nil, err
	}
	patientJSON, err := json.Marshal(patient)
	if err != nil {
		return nil, errs.Internal("encode patient data", err)
	}
	patientHash, err := patientDataHash(patient)
	if err != nil {
		return nil, err
	}
	now, err := utils.TxTime(ctx)
	if err != nil {
		return nil, err
	}

	p := models.Prescription{
		PrescriptionID:     prescriptionID,
		PatientDataHash:    patientHash,
		DoctorID:           caller.ID,
		DoctorMSP:          caller.MSP,
		DrugCode:           drug.DrugCode,
		DrugName:           drug.DrugName,
		ControlClass:       drug.ControlClass,
		Quantity:           quantity,
		DosageInstructions: dosageInstructions,
		RefillsAllowed:     refillsAllowed,
		ValidityDays:       validityDays,
		IssuedAt:           utils.FormatTime(now),
		DocType:            models.DocTypePrescription,
	}
	if err := writePrescription(ctx, p, patientJSON); err != nil {
		return nil, err
	}
	return &p, nil
}

// RevokePrescription appends a revocation; only the issuing doctor (same MSP
// and common name) may revoke. The prescription record is never modified.
func (c *PrescriptionContract) RevokePrescription(ctx contractapi.TransactionContextInterface,
	prescriptionID, reason string) (*models.Revocation, error) {

	caller, err := utils.RequireRole(ctx, utils.RoleDoctor)
	if err != nil {
		return nil, err
	}
	if err := validateText("reason", reason); err != nil {
		return nil, err
	}
	p, err := loadPrescription(ctx, prescriptionID)
	if err != nil {
		return nil, err
	}
	if p.DoctorMSP != caller.MSP || p.DoctorID != caller.ID {
		return nil, errs.New(errs.CodeUnauthorized, "only the issuing doctor %s@%s may revoke this prescription", p.DoctorID, p.DoctorMSP)
	}
	revoked, err := revocationExists(ctx, prescriptionID)
	if err != nil {
		return nil, err
	}
	if revoked {
		return nil, errs.New(errs.CodeAlreadyExists, "prescription %s is already revoked", prescriptionID)
	}
	now, err := utils.TxTime(ctx)
	if err != nil {
		return nil, err
	}
	r := models.Revocation{
		RevocationID:   revocationID(prescriptionID),
		PrescriptionID: prescriptionID,
		RevokedBy:      caller.ID,
		RevokedByMSP:   caller.MSP,
		Reason:         reason,
		RevokedAt:      utils.FormatTime(now),
		DocType:        models.DocTypeRevocation,
	}
	key, err := utils.RevocationKey(ctx, prescriptionID)
	if err != nil {
		return nil, errs.Internal("build revocation key", err)
	}
	if err := putJSON(ctx, key, r); err != nil {
		return nil, err
	}
	return &r, nil
}

// ReadPrescription returns the public prescription record.
func (c *PrescriptionContract) ReadPrescription(ctx contractapi.TransactionContextInterface, prescriptionID string) (*models.Prescription, error) {
	if _, err := utils.RequireRole(ctx, utils.AllRoles()...); err != nil {
		return nil, err
	}
	p, err := loadPrescription(ctx, prescriptionID)
	if err != nil {
		return nil, err
	}
	return &p, nil
}

// ReadPatientData returns the private patient fields, after checking they
// still match the hash on the public record.
func (c *PrescriptionContract) ReadPatientData(ctx contractapi.TransactionContextInterface, prescriptionID string) (*models.PatientData, error) {
	if _, err := utils.RequireRole(ctx, utils.RoleDoctor, utils.RolePharmacist); err != nil {
		return nil, err
	}
	p, err := loadPrescription(ctx, prescriptionID)
	if err != nil {
		return nil, err
	}
	data, err := ctx.GetStub().GetPrivateData(CollectionPatientData, prescriptionID)
	if err != nil {
		return nil, errs.Internal("read private patient data", err)
	}
	if data == nil {
		return nil, errs.New(errs.CodeNotFound, "no patient data for prescription %s on this peer", prescriptionID)
	}
	var patient models.PatientData
	if err := json.Unmarshal(data, &patient); err != nil {
		return nil, errs.Internal("decode patient data", err)
	}
	hash, err := patientDataHash(patient)
	if err != nil {
		return nil, err
	}
	if hash != p.PatientDataHash {
		return nil, errs.New(errs.CodeInternal, "patient data for %s does not match its public hash", prescriptionID)
	}
	return &patient, nil
}

func validateIssueArgs(prescriptionID string, quantity int, dosageInstructions string, refillsAllowed, validityDays int) error {
	if err := validateUUID("prescriptionId", prescriptionID); err != nil {
		return err
	}
	if err := validatePositive("quantity", quantity); err != nil {
		return err
	}
	if err := validatePositive("validityDays", validityDays); err != nil {
		return err
	}
	if validityDays > maxValidityDays {
		return errs.New(errs.CodeInvalidArgument, "validityDays must be at most %d", maxValidityDays)
	}
	if refillsAllowed < 0 {
		return errs.New(errs.CodeInvalidArgument, "refillsAllowed must not be negative")
	}
	return validateText("dosageInstructions", dosageInstructions)
}

func readPatientTransient(ctx contractapi.TransactionContextInterface, prescriptionID string) (models.PatientData, error) {
	transient, err := ctx.GetStub().GetTransient()
	if err != nil {
		return models.PatientData{}, errs.Internal("read transient data", err)
	}
	field := func(name string) string { return string(transient[name]) }

	patient := models.PatientData{
		PrescriptionID: prescriptionID,
		PatientName:    field(transientPatientName),
		PatientDOB:     field(transientPatientDOB),
		PatientRef:     field(transientPatientRef),
		Salt:           field(transientSalt),
	}
	if err := validateText(transientPatientName, patient.PatientName); err != nil {
		return models.PatientData{}, err
	}
	if err := validateDate(transientPatientDOB, patient.PatientDOB); err != nil {
		return models.PatientData{}, err
	}
	if err := validateText(transientPatientRef, patient.PatientRef); err != nil {
		return models.PatientData{}, err
	}
	if err := validateSalt(patient.Salt); err != nil {
		return models.PatientData{}, err
	}
	return patient, nil
}

func writePrescription(ctx contractapi.TransactionContextInterface, p models.Prescription, patientJSON []byte) error {
	key, err := utils.PrescriptionKey(ctx, p.PrescriptionID)
	if err != nil {
		return errs.Internal("build prescription key", err)
	}
	if err := putJSON(ctx, key, p); err != nil {
		return err
	}
	if err := ctx.GetStub().PutPrivateData(CollectionPatientData, p.PrescriptionID, patientJSON); err != nil {
		return errs.Internal("write private patient data", err)
	}
	indexKey, err := utils.DoctorIndexKey(ctx, p.DoctorMSP, p.DoctorID, p.PrescriptionID)
	if err != nil {
		return errs.Internal("build doctor index key", err)
	}
	if err := ctx.GetStub().PutState(indexKey, indexValue); err != nil {
		return errs.Internal("write doctor index", err)
	}
	return nil
}

// patientDataHash is SHA-256 over the canonical encoding of the payload: the
// models.PatientData struct marshalled in its fixed field order. Never hash
// stored bytes directly — CouchDB returns JSON re-serialized with sorted keys.
func patientDataHash(patient models.PatientData) (string, error) {
	canonical, err := json.Marshal(patient)
	if err != nil {
		return "", errs.Internal("encode patient data", err)
	}
	sum := sha256.Sum256(canonical)
	return hex.EncodeToString(sum[:]), nil
}
