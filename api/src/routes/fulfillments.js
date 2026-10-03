// Fulfillment routes (docs/design/application.md#api-routes).
import { Router } from 'express';
import { CONTRACTS } from '../config.js';
import { requireInteger, requireUuid } from '../validation.js';

export function fulfillmentRoutes(fabric) {
  const router = Router();

  router.get('/prescriptions/:id/eligibility', async (req, res) => {
    const id = requireUuid(req.params.id);
    const quantity = requireInteger(req.query, 'quantity', { min: 1 });
    res.json(await fabric.evaluate(req.user.username, CONTRACTS.QUERY, 'CheckFulfillmentEligibility', [id, quantity]));
  });

  router.post('/prescriptions/:id/fulfillments', async (req, res) => {
    const id = requireUuid(req.params.id);
    const quantity = requireInteger(req.body, 'quantityDispensed', { min: 1 });
    res
      .status(201)
      .json(await fabric.submit(req.user.username, CONTRACTS.FULFILLMENT, 'RecordFulfillment', [id, quantity]));
  });

  router.get('/prescriptions/:id/fulfillments', async (req, res) => {
    const id = requireUuid(req.params.id);
    res.json(await fabric.evaluate(req.user.username, CONTRACTS.FULFILLMENT, 'GetFulfillments', [id]));
  });

  return router;
}
