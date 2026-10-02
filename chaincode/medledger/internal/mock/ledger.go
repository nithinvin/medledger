// Package mock is an in-memory Fabric ledger for unit tests. It is imported
// only by _test.go files, so it never ships in the chaincode binary.
//
// It models the Fabric semantics the contracts rely on:
//   - writes are buffered per transaction and committed only on success,
//     so a rejected transaction leaves no trace;
//   - reads see committed state, not the transaction's own pending writes;
//   - every committed write is appended to the key's history;
//   - JSON values come back re-serialized with sorted keys, as Fabric's
//     CouchDB state database returns them — never byte-identical to what
//     was written, so code must not hash or compare raw stored bytes.
//
// Stub methods the contracts do not use are left unimplemented (calling one
// panics via the embedded nil interface), so accidental use is loud.
package mock

import (
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/hyperledger/fabric-chaincode-go/v2/pkg/cid"
	"github.com/hyperledger/fabric-chaincode-go/v2/shim"
	"github.com/hyperledger/fabric-protos-go-apiv2/ledger/queryresult"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const compositeKeyNamespace = "\x00"

// Ledger is the committed world state shared by successive transactions.
type Ledger struct {
	state   map[string][]byte
	private map[string]map[string][]byte
	history map[string][]*queryresult.KeyModification
	txCount int
}

// NewLedger returns an empty ledger.
func NewLedger() *Ledger {
	return &Ledger{
		state:   map[string][]byte{},
		private: map[string]map[string][]byte{},
		history: map[string][]*queryresult.KeyModification{},
	}
}

// Identity is a transaction submitter.
type Identity struct {
	ID   string // certificate common name
	MSP  string
	Role string // "" means no role attribute
}

// Tx describes one transaction invocation.
type Tx struct {
	Caller    Identity
	Time      time.Time
	Transient map[string][]byte
}

// Context implements contractapi.TransactionContextInterface.
type Context struct {
	stub     *Stub
	identity *clientIdentity
}

// GetStub returns the transaction's stub.
func (c *Context) GetStub() shim.ChaincodeStubInterface { return c.stub }

// GetClientIdentity returns the transaction's submitter.
func (c *Context) GetClientIdentity() cid.ClientIdentity { return c.identity }

// Invoke runs fn as one transaction: on success its writes commit, on error
// they are discarded. It returns fn's error.
func (l *Ledger) Invoke(tx Tx, fn func(ctx *Context) error) error {
	l.txCount++
	stub := &Stub{
		ledger:     l,
		txID:       fmt.Sprintf("tx%04d", l.txCount),
		timestamp:  timestamppb.New(tx.Time),
		transient:  tx.Transient,
		writes:     map[string][]byte{},
		privWrites: map[string]map[string][]byte{},
	}
	ctx := &Context{stub: stub, identity: &clientIdentity{who: tx.Caller}}
	if err := fn(ctx); err != nil {
		return err
	}
	stub.commit()
	return nil
}

// State returns the committed value of a key (nil if absent).
func (l *Ledger) State(key string) []byte { return l.state[key] }

// Private returns the committed private value of a key in a collection.
func (l *Ledger) Private(collection, key string) []byte { return l.private[collection][key] }

// SetPrivate overwrites committed private data, to simulate tampering.
func (l *Ledger) SetPrivate(collection, key string, value []byte) {
	if l.private[collection] == nil {
		l.private[collection] = map[string][]byte{}
	}
	l.private[collection][key] = value
}

// History returns the committed history of a key.
func (l *Ledger) History(key string) []*queryresult.KeyModification { return l.history[key] }

// Keys returns all committed public keys, sorted.
func (l *Ledger) Keys() []string {
	keys := make([]string, 0, len(l.state))
	for k := range l.state {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

// CompositeKey builds a key the way the stub does, for test assertions.
func CompositeKey(objectType string, attrs ...string) string {
	var b strings.Builder
	b.WriteString(compositeKeyNamespace + objectType + compositeKeyNamespace)
	for _, a := range attrs {
		b.WriteString(a + compositeKeyNamespace)
	}
	return b.String()
}

// Stub implements the subset of shim.ChaincodeStubInterface used by MedLedger.
type Stub struct {
	shim.ChaincodeStubInterface // nil: unimplemented methods panic

	ledger     *Ledger
	txID       string
	timestamp  *timestamppb.Timestamp
	transient  map[string][]byte
	writes     map[string][]byte
	privWrites map[string]map[string][]byte
}

// couchDBRoundTrip mimics CouchDB storage: valid JSON is decoded and
// re-encoded (Go sorts map keys); other bytes are stored as-is.
func couchDBRoundTrip(value []byte) []byte {
	var doc any
	if json.Unmarshal(value, &doc) != nil {
		return value
	}
	normalized, err := json.Marshal(doc)
	if err != nil {
		return value
	}
	return normalized
}

func (s *Stub) commit() {
	keys := make([]string, 0, len(s.writes))
	for k := range s.writes {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		stored := couchDBRoundTrip(s.writes[k])
		s.ledger.state[k] = stored
		s.ledger.history[k] = append(s.ledger.history[k], &queryresult.KeyModification{
			TxId: s.txID, Value: stored, Timestamp: s.timestamp,
		})
	}
	for coll, kv := range s.privWrites {
		if s.ledger.private[coll] == nil {
			s.ledger.private[coll] = map[string][]byte{}
		}
		for k, v := range kv {
			s.ledger.private[coll][k] = couchDBRoundTrip(v)
		}
	}
}

// GetTxID returns the transaction ID.
func (s *Stub) GetTxID() string { return s.txID }

// GetTxTimestamp returns the transaction timestamp.
func (s *Stub) GetTxTimestamp() (*timestamppb.Timestamp, error) { return s.timestamp, nil }

// GetTransient returns the transient map.
func (s *Stub) GetTransient() (map[string][]byte, error) { return s.transient, nil }

// GetState reads committed state (Fabric does not expose pending writes).
func (s *Stub) GetState(key string) ([]byte, error) { return s.ledger.state[key], nil }

// PutState buffers a write. Like Fabric, an empty value is rejected here
// because it would be treated as a delete.
func (s *Stub) PutState(key string, value []byte) error {
	if len(value) == 0 {
		return fmt.Errorf("mock: PutState with empty value for %q", key)
	}
	s.writes[key] = value
	return nil
}

// GetPrivateData reads committed private data.
func (s *Stub) GetPrivateData(collection, key string) ([]byte, error) {
	return s.ledger.private[collection][key], nil
}

// PutPrivateData buffers a private write.
func (s *Stub) PutPrivateData(collection, key string, value []byte) error {
	if s.privWrites[collection] == nil {
		s.privWrites[collection] = map[string][]byte{}
	}
	s.privWrites[collection][key] = value
	return nil
}

// CreateCompositeKey builds a composite key.
func (s *Stub) CreateCompositeKey(objectType string, attributes []string) (string, error) {
	return CompositeKey(objectType, attributes...), nil
}

// SplitCompositeKey splits a composite key.
func (s *Stub) SplitCompositeKey(key string) (string, []string, error) {
	parts := strings.Split(strings.TrimPrefix(key, compositeKeyNamespace), compositeKeyNamespace)
	if len(parts) < 2 {
		return "", nil, fmt.Errorf("mock: not a composite key: %q", key)
	}
	return parts[0], parts[1 : len(parts)-1], nil
}

// GetStateByPartialCompositeKey returns committed keys with the given prefix, sorted.
func (s *Stub) GetStateByPartialCompositeKey(objectType string, attrs []string) (shim.StateQueryIteratorInterface, error) {
	prefix := CompositeKey(objectType, attrs...)
	var kvs []*queryresult.KV
	for _, k := range s.ledger.Keys() {
		if strings.HasPrefix(k, prefix) {
			kvs = append(kvs, &queryresult.KV{Key: k, Value: s.ledger.state[k]})
		}
	}
	return &stateIterator{items: kvs}, nil
}

// GetHistoryForKey returns the committed history of a key.
func (s *Stub) GetHistoryForKey(key string) (shim.HistoryQueryIteratorInterface, error) {
	return &historyIterator{items: s.ledger.history[key]}, nil
}

type stateIterator struct {
	items []*queryresult.KV
	pos   int
}

func (it *stateIterator) HasNext() bool { return it.pos < len(it.items) }
func (it *stateIterator) Close() error  { return nil }
func (it *stateIterator) Next() (*queryresult.KV, error) {
	if !it.HasNext() {
		return nil, fmt.Errorf("mock: iterator exhausted")
	}
	it.pos++
	return it.items[it.pos-1], nil
}

type historyIterator struct {
	items []*queryresult.KeyModification
	pos   int
}

func (it *historyIterator) HasNext() bool { return it.pos < len(it.items) }
func (it *historyIterator) Close() error  { return nil }
func (it *historyIterator) Next() (*queryresult.KeyModification, error) {
	if !it.HasNext() {
		return nil, fmt.Errorf("mock: iterator exhausted")
	}
	it.pos++
	return it.items[it.pos-1], nil
}

// clientIdentity implements cid.ClientIdentity.
type clientIdentity struct {
	who Identity
}

func (c *clientIdentity) GetID() (string, error)    { return c.who.MSP + "::" + c.who.ID, nil }
func (c *clientIdentity) GetMSPID() (string, error) { return c.who.MSP, nil }

func (c *clientIdentity) GetAttributeValue(name string) (string, bool, error) {
	if name == "role" && c.who.Role != "" {
		return c.who.Role, true, nil
	}
	return "", false, nil
}

func (c *clientIdentity) AssertAttributeValue(name, value string) error {
	if v, ok, _ := c.GetAttributeValue(name); !ok || v != value {
		return fmt.Errorf("mock: attribute %s != %s", name, value)
	}
	return nil
}

func (c *clientIdentity) GetX509Certificate() (*x509.Certificate, error) {
	return &x509.Certificate{Subject: pkix.Name{CommonName: c.who.ID}}, nil
}
