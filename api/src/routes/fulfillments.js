// Fulfillment routes (docs/design/application.md#api-routes).
import { Router } from 'express';
import { CONTRACTS, ROLES } from '../config.js';
import { requireRole } from '../middleware/auth.js';
import { requireInteger, requireUuid } from '../validation.js';

const { DOCTOR, PHARMACIST, REGULATOR } = ROLES;

export function fulfillmentRoutes(fabric) {
  const router = Router();

  router.get('/prescriptions/:id/eligibility', requireRole(PHARMACIST), async (req, res) => {
    const id = requireUuid(req.params.id);
    const quantity = requireInteger(req.query, 'quantity', { min: 1 });
    res.json(await fabric.evaluate(req.user.username, CONTRACTS.QUERY, 'CheckFulfillmentEligibility', [id, quantity]));
  });

  router.post('/prescriptions/:id/fulfillments', requireRole(PHARMACIST), async (req, res) => {
    const id = requireUuid(req.params.id);
    const quantity = requireInteger(req.body, 'quantityDispensed', { min: 1 });
    res
      .status(201)
      .json(await fabric.submit(req.user.username, CONTRACTS.FULFILLMENT, 'RecordFulfillment', [id, quantity]));
  });

  router.get('/prescriptions/:id/fulfillments', requireRole(DOCTOR, PHARMACIST, REGULATOR), async (req, res) => {
    const id = requireUuid(req.params.id);
    res.json(await fabric.evaluate(req.user.username, CONTRACTS.FULFILLMENT, 'GetFulfillments', [id]));
  });

  return router;
}
