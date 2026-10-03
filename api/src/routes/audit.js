// Audit route: prescription history plus endorsing organizations per
// transaction (docs/spec.md#fr-6--audit-query).
import { Router } from 'express';
import { CONTRACTS } from '../config.js';
import { requireUuid } from '../validation.js';

export function auditRoutes(fabric) {
  const router = Router();

  router.get('/audit/:id/history', async (req, res) => {
    const id = requireUuid(req.params.id);
    const { username } = req.user;
    const history = await fabric.evaluate(username, CONTRACTS.QUERY, 'GetPrescriptionHistory', [id]);
    const entries = await Promise.all(
      history.map(async (entry) => ({ ...entry, ...(await fabric.transactionEndorsers(username, entry.txId)) })),
    );
    res.json({ prescriptionId: id, entries });
  });

  return router;
}
