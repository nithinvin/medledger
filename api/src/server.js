// API entry point: wires the real Fabric service and listens on localhost.
import { createApp } from './app.js';
import { HTTP_HOST, HTTP_PORT, USERS } from './config.js';
import { createFabricService } from './gateway.js';
import { loadIdentity } from './identities.js';
import { logger } from './logger.js';
import { jwtSecret } from './middleware/auth.js';

// Fail fast if any demo user is not enrolled (network/scripts/enrollUsers.sh).
for (const username of Object.keys(USERS)) {
  loadIdentity(username);
}

const fabric = createFabricService();
const server = createApp({ fabric, jwtSecret: jwtSecret() }).listen(HTTP_PORT, HTTP_HOST, () => {
  logger.info(`MedLedger API listening on http://${HTTP_HOST}:${HTTP_PORT}`);
});

function shutdown(signal) {
  logger.info(`${signal} received, shutting down`);
  server.close(() => {
    fabric.close();
    process.exit(0);
  });
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
