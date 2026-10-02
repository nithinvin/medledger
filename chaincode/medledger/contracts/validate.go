package contracts

import (
	"encoding/hex"
	"time"

	"github.com/nithinvin/medledger/chaincode/errs"
)

const (
	maxTextLength   = 500 // free-text fields: dosage, reason, patient name/ref
	maxValidityDays = 365
	minSaltHexChars = 32 // 16 random bytes (docs/spec.md#fr-7--private-patient-data)
	dateOfBirthForm = "2006-01-02"
	uuidLength      = 36
)

// validateUUID checks the canonical 8-4-4-4-12 hex form.
func validateUUID(field, value string) error {
	if len(value) != uuidLength {
		return errs.New(errs.CodeInvalidArgument, "%s must be a UUID", field)
	}
	for i, r := range value {
		switch i {
		case 8, 13, 18, 23:
			if r != '-' {
				return errs.New(errs.CodeInvalidArgument, "%s must be a UUID", field)
			}
		default:
			if !isHex(r) {
				return errs.New(errs.CodeInvalidArgument, "%s must be a UUID", field)
			}
		}
	}
	return nil
}

func isHex(r rune) bool {
	return (r >= '0' && r <= '9') || (r >= 'a' && r <= 'f') || (r >= 'A' && r <= 'F')
}

func validateText(field, value string) error {
	if value == "" {
		return errs.New(errs.CodeInvalidArgument, "%s is required", field)
	}
	if len(value) > maxTextLength {
		return errs.New(errs.CodeInvalidArgument, "%s exceeds %d characters", field, maxTextLength)
	}
	return nil
}

func validatePositive(field string, value int) error {
	if value <= 0 {
		return errs.New(errs.CodeInvalidArgument, "%s must be greater than 0", field)
	}
	return nil
}

func validateDate(field, value string) error {
	if _, err := time.Parse(dateOfBirthForm, value); err != nil {
		return errs.New(errs.CodeInvalidArgument, "%s must be a date in YYYY-MM-DD form", field)
	}
	return nil
}

func validateSalt(value string) error {
	if len(value) < minSaltHexChars {
		return errs.New(errs.CodeInvalidArgument, "salt must be at least %d hex characters", minSaltHexChars)
	}
	if _, err := hex.DecodeString(value); err != nil {
		return errs.New(errs.CodeInvalidArgument, "salt must be hex-encoded")
	}
	return nil
}
