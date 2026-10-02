// Prescription routes (docs/design/application.md#api-routes).
import { randomBytes, randomUUID } from 'node:crypto';
import { Router } from 'express';
import { CONTRACTS, ROLES } from '../config.js';
import { requireRole } from '../middleware/auth.js';
import { requireDate, requireInteger, requireText, requireUuid } from '../validation.js';

const { DOCTOR, PHARMACIST, REGULATOR } = ROLES;
const ANY = [DOCTOR, PHARMACIST, REGULATOR];

export function prescriptionRoutes(fabric) {
  const router = Router();

  router.get('/drugs', requireRole(...ANY), async (req, res) => {
    res.json(await fabric.evaluate(req.user.username, CONTRACTS.QUERY, 'GetDrugReference'));
  });

  router.post('/prescriptions', requireRole(DOCTOR), async (req, res) => {
    const body = req.body;
    const args = [
      randomUUID(),
      requireText(body, 'drugCode'),
      requireInteger(body, 'quantity', { min: 1 }),
      requireText(body, 'dosageInstructions'),
      requireInteger(body, 'refillsAllowed', { min: 0 }),
      requireInteger(body, 'validityDays', { min: 1 }),
    ];
    // Patient fields travel only in the transient map, never as arguments (D5);
    // the salt stops anyone reversing the public hash (D12).
    const transient = {
      patientName: requireText(body, 'patientName'),
      patientDOB: requireDate(body, 'patientDOB'),
      patientRef: requireText(body, 'patientRef'),
      salt: randomBytes(32).toString('hex'),
    };
    const prescription = await fabric.submit(
      req.user.username,
      CONTRACTS.PRESCRIPTION,
      'IssuePrescription',
      args,
      transient,
    );
    res.status(201).json(prescription);
  });

  router.get('/prescriptions/:id', requireRole(...ANY), async (req, res) => {
    const id = requireUuid(req.params.id);
    res.json(await fabric.evaluate(req.user.username, CONTRACTS.PRESCRIPTION, 'ReadPrescription', [id]));
  });

  router.get('/prescriptions/:id/status', requireRole(...ANY), async (req, res) => {
    const id = requireUuid(req.params.id);
    const status = await fabric.evaluate(req.user.username, CONTRACTS.QUERY, 'GetPrescriptionStatus', [id]);
    res.json({ prescriptionId: id, status });
  });

  router.get('/prescriptions/:id/patient', requireRole(DOCTOR, PHARMACIST), async (req, res) => {
    const id = requireUuid(req.params.id);
    res.json(await fabric.evaluate(req.user.username, CONTRACTS.PRESCRIPTION, 'ReadPatientData', [id]));
  });

  router.post('/prescriptions/:id/revoke', requireRole(DOCTOR), async (req, res) => {
    const id = requireUuid(req.params.id);
    const reason = requireText(req.body, 'reason');
    res
      .status(201)
      .json(await fabric.submit(req.user.username, CONTRACTS.PRESCRIPTION, 'RevokePrescription', [id, reason]));
  });

  router.get('/doctors/me/prescriptions', requireRole(DOCTOR), async (req, res) => {
    const { username, msp } = req.user;
    res.json(await fabric.evaluate(username, CONTRACTS.QUERY, 'GetPrescriptionsByDoctor', [msp, username]));
  });

  return router;
}
