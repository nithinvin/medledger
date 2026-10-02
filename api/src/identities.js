// Loads each demo user's signing certificate and private key from the MSP
// directory written by enrollUsers.sh (docs/design/application.md#identities).
// @hyperledger/fabric-gateway has no wallet object.
import { createPrivateKey } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { signers } from '@hyperledger/fabric-gateway';
import { ORGS, USERS, userMspDir } from './config.js';

export function loadIdentity(username) {
  const user = USERS[username];
  if (!user) {
    throw new Error(`unknown user ${username}`);
  }
  const mspDir = userMspDir(username);
  const certificate = readFileSync(path.join(mspDir, 'signcerts', 'cert.pem'));
  const keyDir = path.join(mspDir, 'keystore');
  const keyFiles = readdirSync(keyDir).filter((f) => f.endsWith('_sk'));
  if (keyFiles.length !== 1) {
    throw new Error(`expected one private key in ${keyDir}, found ${keyFiles.length} — run enrollUsers.sh`);
  }
  const privateKey = createPrivateKey(readFileSync(path.join(keyDir, keyFiles[0])));
  return {
    identity: { mspId: ORGS[user.org].msp, credentials: certificate },
    signer: signers.newPrivateKeySigner(privateKey),
  };
}
