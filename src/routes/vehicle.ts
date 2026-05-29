import { Router } from 'express';
import { obd } from '../obd/state';

const router = Router();

/** GET /api/vehicle/monitors — readiness monitor status (Mode 01 PID 01) */
router.get('/api/vehicle/monitors', async (_req, res) => {
  if (!obd.isConnected()) {
    res.status(409).json({ error: 'Not connected to OBD adapter' });
    return;
  }
  try {
    const data = await obd.readMonitors();
    if (data === null) {
      res.status(422).json({ error: 'Vehicle did not return readiness data (PID 01)' });
      return;
    }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/** GET /api/vehicle/odometer — true odometer in km (Mode 01 PID A6, 2010+ vehicles) */
router.get('/api/vehicle/odometer', async (_req, res) => {
  if (!obd.isConnected()) {
    res.status(409).json({ error: 'Not connected to OBD adapter' });
    return;
  }
  try {
    const km = await obd.readOdometer();
    if (km === null) {
      res.json({
        km:        null,
        supported: false,
        note:      'PID 0xA6 not supported — typical on pre-2010 vehicles',
      });
      return;
    }
    res.json({ km, supported: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
