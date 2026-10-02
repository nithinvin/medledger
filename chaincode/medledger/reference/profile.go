// Package reference provides the jurisdiction profile: control classes with
// their limits, and the drug reference list
// (docs/design/chaincode.md#jurisdiction-profile).
//
// The profile is compiled in with go:embed so every endorsing peer evaluates
// identical bytes; it is never read from disk or the environment (NFR-7).
package reference

import (
	_ "embed"
	"encoding/json"
	"fmt"
)

//go:embed profile.json
var profileJSON []byte // read-only; never modified

// ClassLimits are the refill limits attached to a control class.
type ClassLimits struct {
	LegalBasis            string `json:"legalBasis"`
	MaxRefills            int    `json:"maxRefills"`
	MinRefillIntervalDays int    `json:"minRefillIntervalDays"`
}

// Drug is one entry of the drug reference list.
type Drug struct {
	DrugCode     string `json:"drugCode"`
	DrugName     string `json:"drugName"`
	ControlClass string `json:"controlClass"`
}

// Profile is a complete jurisdiction profile.
type Profile struct {
	Jurisdiction   string                 `json:"jurisdiction"`
	Note           string                 `json:"note"`
	ControlClasses map[string]ClassLimits `json:"controlClasses"`
	Drugs          []Drug                 `json:"drugs"`
}

// Load parses and validates the embedded profile. It is parsed per call
// rather than cached to avoid package-level mutable state.
func Load() (*Profile, error) {
	return parse(profileJSON)
}

func parse(data []byte) (*Profile, error) {
	var p Profile
	if err := json.Unmarshal(data, &p); err != nil {
		return nil, fmt.Errorf("parse jurisdiction profile: %w", err)
	}
	if err := p.validate(); err != nil {
		return nil, fmt.Errorf("invalid jurisdiction profile: %w", err)
	}
	return &p, nil
}

func (p *Profile) validate() error {
	if p.Jurisdiction == "" {
		return fmt.Errorf("jurisdiction is empty")
	}
	if len(p.ControlClasses) == 0 || len(p.Drugs) == 0 {
		return fmt.Errorf("control classes and drugs must be non-empty")
	}
	for name, limits := range p.ControlClasses {
		if limits.MaxRefills < 0 || limits.MinRefillIntervalDays < 0 {
			return fmt.Errorf("control class %s has negative limits", name)
		}
	}
	seen := make(map[string]bool, len(p.Drugs))
	for _, d := range p.Drugs {
		if d.DrugCode == "" || d.DrugName == "" {
			return fmt.Errorf("drug entry with empty code or name")
		}
		if seen[d.DrugCode] {
			return fmt.Errorf("duplicate drug code %s", d.DrugCode)
		}
		seen[d.DrugCode] = true
		if _, ok := p.ControlClasses[d.ControlClass]; !ok {
			return fmt.Errorf("drug %s uses unknown control class %s", d.DrugCode, d.ControlClass)
		}
	}
	return nil
}

// LookupDrug returns the drug with the given code.
func (p *Profile) LookupDrug(code string) (Drug, bool) {
	for _, d := range p.Drugs {
		if d.DrugCode == code {
			return d, true
		}
	}
	return Drug{}, false
}

// Limits returns the limits of a control class.
func (p *Profile) Limits(class string) (ClassLimits, bool) {
	limits, ok := p.ControlClasses[class]
	return limits, ok
}
