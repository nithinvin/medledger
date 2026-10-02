package rules

import (
	"time"

	"github.com/nithinvin/medledger/chaincode/models"
)

// DeriveStatus computes a prescription's status from its events
// (docs/design/chaincode.md#status-derivation). Order matters: REVOKED wins;
// FULLY_FULFILLED is checked before EXPIRED so a completed prescription never
// later appears expired.
func DeriveStatus(p models.Prescription, revoked bool, fillCount int, now time.Time) (string, error) {
	if revoked {
		return models.StatusRevoked, nil
	}
	if fillCount >= MaxFills(p) {
		return models.StatusFullyFulfilled, nil
	}
	expired, err := IsExpired(p, now)
	if err != nil {
		return "", err
	}
	if expired {
		return models.StatusExpired, nil
	}
	if fillCount == 0 {
		return models.StatusIssued, nil
	}
	return models.StatusPartiallyFulfilled, nil
}
