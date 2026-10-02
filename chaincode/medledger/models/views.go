package models

// Status values (docs/spec.md#fr-3--derived-status).
const (
	StatusIssued             = "ISSUED"
	StatusPartiallyFulfilled = "PARTIALLY_FULFILLED"
	StatusFullyFulfilled     = "FULLY_FULFILLED"
	StatusExpired            = "EXPIRED"
	StatusRevoked            = "REVOKED"
)

// HistoryEntry is one write to a prescription key, for the audit view.
type HistoryEntry struct {
	TxID      string        `json:"txId"`
	Timestamp string        `json:"timestamp"`
	IsDelete  bool          `json:"isDelete"`
	Value     *Prescription `json:"value,omitempty" metadata:",optional"`
}

// Eligibility is the result of a read-only fulfillment dry run.
type Eligibility struct {
	Eligible bool   `json:"eligible"`
	Status   string `json:"status"`
	Rule     string `json:"rule,omitempty" metadata:",optional"`
	Reason   string `json:"reason,omitempty" metadata:",optional"`
}
