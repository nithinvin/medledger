package reference

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLoadEmbeddedProfile(t *testing.T) {
	p, err := Load()
	require.NoError(t, err)
	assert.Equal(t, "IN", p.Jurisdiction)

	for _, class := range []string{"NDPS", "SCHEDULE_X", "SCHEDULE_H1", "SCHEDULE_H", "NONE"} {
		_, ok := p.Limits(class)
		assert.True(t, ok, "control class %s present", class)
	}
	ndps, _ := p.Limits("NDPS")
	assert.Equal(t, 0, ndps.MaxRefills, "NDPS drugs allow no refills")

	morphine, ok := p.LookupDrug("IN-MORPH-10")
	require.True(t, ok)
	assert.Equal(t, "NDPS", morphine.ControlClass)

	_, ok = p.LookupDrug("NO-SUCH-DRUG")
	assert.False(t, ok)
}

func TestParseRejectsInvalidProfiles(t *testing.T) {
	const classes = `"controlClasses":{"A":{"maxRefills":1,"minRefillIntervalDays":0}}`
	tests := []struct {
		name string
		json string
	}{
		{"malformed JSON", `{`},
		{"empty object", `{}`},
		{"missing jurisdiction", `{` + classes + `,"drugs":[{"drugCode":"D","drugName":"n","controlClass":"A"}]}`},
		{"no drugs", `{"jurisdiction":"X",` + classes + `,"drugs":[]}`},
		{"unknown class", `{"jurisdiction":"X",` + classes + `,"drugs":[{"drugCode":"D","drugName":"n","controlClass":"B"}]}`},
		{"duplicate code", `{"jurisdiction":"X",` + classes + `,"drugs":[{"drugCode":"D","drugName":"n","controlClass":"A"},{"drugCode":"D","drugName":"m","controlClass":"A"}]}`},
		{"empty drug name", `{"jurisdiction":"X",` + classes + `,"drugs":[{"drugCode":"D","drugName":"","controlClass":"A"}]}`},
		{"negative limit", `{"jurisdiction":"X","controlClasses":{"A":{"maxRefills":-1}},"drugs":[{"drugCode":"D","drugName":"n","controlClass":"A"}]}`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := parse([]byte(tt.json))
			assert.Error(t, err)
		})
	}
}
