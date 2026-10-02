package main

import (
	"testing"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
	"github.com/stretchr/testify/require"

	"github.com/nithinvin/medledger/chaincode/contracts"
)

// NewChaincode validates every contract function signature by reflection.
// Running it here catches unsupported types before deployment (Phase 5).
func TestChaincodeMetadataIsValid(t *testing.T) {
	cc, err := contractapi.NewChaincode(
		&contracts.PrescriptionContract{},
		&contracts.FulfillmentContract{},
		&contracts.QueryContract{},
	)
	require.NoError(t, err)
	require.NotNil(t, cc)
}
