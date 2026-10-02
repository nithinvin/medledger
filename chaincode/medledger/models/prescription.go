// Package models holds the ledger record types (docs/spec.md#data-specification).
// Field order is fixed: encoding/json marshals struct fields in declaration
// order, so every peer produces identical bytes.
package models

// DocTypePrescription identifies prescription records.
const DocTypePrescription = "prescription"

// Prescription is the public, immutable record written once at issuance.
// It deliberately has no status field: status is derived at query time
// (docs/design/chaincode.md#status-derivation).
type Prescription struct {
	PrescriptionID     string `json:"prescriptionId"`
	PatientDataHash    string `json:"patientDataHash"`
	DoctorID           string `json:"doctorId"`
	DoctorMSP          string `json:"doctorMSP"`
	DrugCode           string `json:"drugCode"`
	DrugName           string `json:"drugName"`
	ControlClass       string `json:"controlClass"`
	Quantity           int    `json:"quantity"`
	DosageInstructions string `json:"dosageInstructions"`
	RefillsAllowed     int    `json:"refillsAllowed"`
	ValidityDays       int    `json:"validityDays"`
	IssuedAt           string `json:"issuedAt"`
	DocType            string `json:"docType"`
}

// PatientData is the private payload stored in patientDataCollection.
// Its SHA-256 (over this exact JSON encoding) is Prescription.PatientDataHash.
type PatientData struct {
	PrescriptionID string `json:"prescriptionId"`
	PatientName    string `json:"patientName"`
	PatientDOB     string `json:"patientDOB"`
	PatientRef     string `json:"patientRef"`
	Salt           string `json:"salt"`
}
