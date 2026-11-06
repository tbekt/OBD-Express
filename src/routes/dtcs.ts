import { Router } from 'express';
import { obd } from '../obd/state';
import { describeDTCs } from '../obd/dtcDescriptions';

const router = Router();

/** GET /api/dtcs — read stored fault codes (Mode 03) with descriptions */
router.get('/api/dtcs', async (_req, res) => {
  if (!obd.isConnected()) {
    res.status(409).json({ error: 'Not connected to OBD adapter' });
    return;
  }
  try {
    const codes = await obd.readDTCs();
    // `codes` stays for backwards compatibility; `details` carries the
    // resolved description, severity and subsystem per code.
    res.json({ codes, details: describeDTCs(codes) });
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
