// Fabric service: submits and evaluates chaincode transactions as a given
// demo user, through that user's own org peer
// (docs/design/application.md#gateway-connections).
//
// The routes depend only on this interface, so tests can inject a fake:
//   submit(username, contract, fn, args, transient) → result
//   evaluate(username, contract, fn, args)           → result
//   transactionEndorsers(username, txId)             → { validationCode, endorsers }
//   close()
import { readFileSync } from 'node:fs';
import * as grpc from '@grpc/grpc-js';
import { connect, hash } from '@hyperledger/fabric-gateway';
import { CHAINCODE_NAME, CHANNEL_NAME, USERS, peerEndpoint, peerTlsCaPath } from './config.js';
import { decodeEndorsers } from './endorsers.js';
import { loadIdentity } from './identities.js';

const utf8 = new TextDecoder();

// Chaincode returns JSON for objects and raw text for strings (e.g. a status).
function decodeResult(bytes) {
  const text = utf8.decode(bytes);
  if (text === '') return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function toTransient(transient) {
  return Object.fromEntries(Object.entries(transient).map(([k, v]) => [k, Buffer.from(String(v))]));
}

export function createFabricService() {
  const clients = new Map(); // org → grpc.Client
  const gateways = new Map(); // username → Gateway

  function clientFor(org) {
    if (!clients.has(org)) {
      const credentials = grpc.credentials.createSsl(readFileSync(peerTlsCaPath(org)));
      clients.set(org, new grpc.Client(peerEndpoint(org), credentials));
    }
    return clients.get(org);
  }

  function gatewayFor(username) {
    if (!gateways.has(username)) {
      const { org } = USERS[username];
      const { identity, signer } = loadIdentity(username);
      gateways.set(
        username,
        connect({
          client: clientFor(org),
          identity,
          signer,
          hash: hash.sha256,
          evaluateOptions: () => ({ deadline: Date.now() + 5_000 }),
          endorseOptions: () => ({ deadline: Date.now() + 15_000 }),
          submitOptions: () => ({ deadline: Date.now() + 5_000 }),
          commitStatusOptions: () => ({ deadline: Date.now() + 60_000 }),
        }),
      );
    }
    return gateways.get(username);
  }

  function contract(username, contractName) {
    return gatewayFor(username).getNetwork(CHANNEL_NAME).getContract(CHAINCODE_NAME, contractName);
  }

  return {
    async submit(username, contractName, fn, args = [], transient = {}) {
      const bytes = await contract(username, contractName).submit(fn, {
        arguments: args.map(String),
        transientData: toTransient(transient),
      });
      return decodeResult(bytes);
    },

    async evaluate(username, contractName, fn, args = []) {
      const bytes = await contract(username, contractName).evaluate(fn, { arguments: args.map(String) });
      return decodeResult(bytes);
    },

    async transactionEndorsers(username, txId) {
      const qscc = gatewayFor(username).getNetwork(CHANNEL_NAME).getContract('qscc');
      const bytes = await qscc.evaluateTransaction('GetTransactionByID', CHANNEL_NAME, txId);
      return decodeEndorsers(bytes);
    },

    close() {
      for (const gateway of gateways.values()) gateway.close();
      for (const client of clients.values()) client.close();
      gateways.clear();
      clients.clear();
    },
  };
}
