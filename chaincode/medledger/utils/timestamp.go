package utils

import (
	"time"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"

	"github.com/nithinvin/medledger/chaincode/errs"
)

// TxTime returns the transaction's timestamp, set by the submitting client
// and identical on every endorsing peer. Never use time.Now() in chaincode:
// peers' clocks differ, which breaks endorsement (NFR-7).
func TxTime(ctx contractapi.TransactionContextInterface) (time.Time, error) {
	ts, err := ctx.GetStub().GetTxTimestamp()
	if err != nil {
		return time.Time{}, errs.Internal("read transaction timestamp", err)
	}
	if ts == nil {
		return time.Time{}, errs.New(errs.CodeInternal, "transaction has no timestamp")
	}
	return ts.AsTime().UTC(), nil
}

// FormatTime renders a ledger timestamp (RFC 3339, UTC).
func FormatTime(t time.Time) string {
	return t.UTC().Format(time.RFC3339)
}

// ParseTime parses a ledger timestamp written by FormatTime.
func ParseTime(s string) (time.Time, error) {
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return time.Time{}, errs.Internal("parse ledger timestamp", err)
	}
	return t, nil
}
