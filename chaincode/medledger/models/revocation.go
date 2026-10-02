package models

// DocTypeRevocation identifies revocation records.
const DocTypeRevocation = "revocation"

// Revocation is an appended event; the prescription itself is never modified.
type Revocation struct {
	RevocationID   string `json:"revocationId"`
	PrescriptionID string `json:"prescriptionId"`
	RevokedBy      string `json:"revokedBy"`
	RevokedByMSP   string `json:"revokedByMSP"`
	Reason         string `json:"reason"`
	RevokedAt      string `json:"revokedAt"`
	DocType        string `json:"docType"`
}
