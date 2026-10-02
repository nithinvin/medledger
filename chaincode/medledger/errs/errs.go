// Package errs defines the coded errors chaincode returns. The API maps the
// code prefix of the message ("R1: ...", "UNAUTHORIZED: ...") to an HTTP
// status (docs/design/application.md#error-mapping).
package errs

import "fmt"

// Error codes. Fraud rules use their spec IDs (docs/spec.md#fr-4--fraud-rules).
const (
	CodeUnauthorized    = "UNAUTHORIZED"
	CodeInvalidArgument = "INVALID_ARGUMENT"
	CodeNotFound        = "NOT_FOUND"
	CodeAlreadyExists   = "ALREADY_EXISTS"
	CodeInternal        = "INTERNAL"

	RuleFillLimit        = "R1"
	RuleQuantityOverrun  = "R2"
	RuleExpired          = "R3"
	RuleEarlyRefillSame  = "R4"
	RuleRevoked          = "R5"
	RuleClassRefillLimit = "R6"
	RuleEarlyRefillCross = "R7"
)

// Error is a chaincode error carrying a machine-readable code.
type Error struct {
	Code    string
	Message string
}

func (e *Error) Error() string {
	return e.Code + ": " + e.Message
}

// New returns an *Error with a formatted message.
func New(code, format string, args ...any) *Error {
	return &Error{Code: code, Message: fmt.Sprintf(format, args...)}
}

// Internal wraps an unexpected lower-level failure (ledger access, JSON).
func Internal(context string, err error) *Error {
	return &Error{Code: CodeInternal, Message: fmt.Sprintf("%s: %v", context, err)}
}
