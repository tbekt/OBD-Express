import { Router } from 'express';
import { obd } from '../obd/state';

const router = Router();

/** GET /api/dtcs — read stored fault codes (Mode 03) */
router.get('/api/dtcs', async (_req, res) => {
  if (!obd.isConnected()) {
    res.status(409).json({ error: 'Not connected to OBD adapter' });
    return;
  }
  try {
    const codes = await obd.readDTCs();
    res.json({ codes });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/** POST /api/dtcs/clear — clear fault codes and reset MIL (Mode 04) */
router.post('/api/dtcs/clear', async (_req, res) => {
  if (!obd.isConnected()) {
    res.status(409).json({ error: 'Not connected to OBD adapter' });
    return;
  }
  try {
    await obd.clearDTCs();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
