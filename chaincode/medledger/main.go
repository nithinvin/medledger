// Command medledger is the MedLedger chaincode entry point.
package main

import (
	"log"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"

	"github.com/nithinvin/medledger/chaincode/contracts"
)

func main() {
	// PrescriptionContract is listed first, so it is the default contract and
	// its functions need no name prefix. Others: "FulfillmentContract:<fn>",
	// "QueryContract:<fn>".
	chaincode, err := contractapi.NewChaincode(
		&contracts.PrescriptionContract{},
		&contracts.FulfillmentContract{},
		&contracts.QueryContract{},
	)
	if err != nil {
		log.Panicf("create medledger chaincode: %v", err)
	}
	chaincode.Info.Title = "MedLedger"
	chaincode.Info.Version = "1.0"
	if err := chaincode.Start(); err != nil {
		log.Panicf("start medledger chaincode: %v", err)
	}
}
