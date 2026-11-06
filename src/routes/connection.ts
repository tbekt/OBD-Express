import { Router } from 'express';
import { obd } from '../obd/state';

const router = Router();

router.post('/api/connect', async (req, res) => {
  const { port, baudRate = 'auto' } = req.body as {
    port: string;
    baudRate?: number | 'auto';
  };

  if (!port) {
    res.status(400).json({ error: 'port is required' });
    return;
  }
  if (obd.isConnected()) {
    res.status(409).json({ error: 'Already connected — disconnect first' });
    return;
  }

  const baud = baudRate === 'auto' ? 'auto' : Number(baudRate);

  try {
    const detected = await obd.connect(port, baud);
    obd.startPolling(500);
    res.json({ success: true, baudRate: detected });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/** POST /api/simulate — start demo mode (synthetic vehicle, no adapter needed) */
router.post('/api/simulate', (_req, res) => {
  try {
    obd.startSimulation();
    res.json({ success: true, simulated: true });
  } catch (err) {
    res.status(409).json({ error: (err as Error).message });
  }
});

router.post('/api/disconnect', async (_req, res) => {
  try {
    await obd.disconnect();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export default router;
