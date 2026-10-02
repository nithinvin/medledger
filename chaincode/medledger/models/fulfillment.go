package models

// DocTypeFulfillment identifies fulfillment records.
const DocTypeFulfillment = "fulfillment"

// Fulfillment is one appended dispense event.
type Fulfillment struct {
	FulfillmentID     string `json:"fulfillmentId"`
	PrescriptionID    string `json:"prescriptionId"`
	PharmacistID      string `json:"pharmacistId"`
	PharmacyMSP       string `json:"pharmacyMSP"`
	QuantityDispensed int    `json:"quantityDispensed"`
	FulfilledAt       string `json:"fulfilledAt"`
	Sequence          int    `json:"sequence"`
	DocType           string `json:"docType"`
}
