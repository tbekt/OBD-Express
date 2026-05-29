import { Router } from 'express';
import { obd } from '../obd/state';

const router = Router();

router.post('/api/connect', async (req, res) => {
  const { port, baudRate = 38400 } = req.body as { port: string; baudRate?: number };

  if (!port) {
    res.status(400).json({ error: 'port is required' });
    return;
  }
  if (obd.isConnected()) {
    res.status(409).json({ error: 'Already connected — disconnect first' });
    return;
  }

  try {
    await obd.connect(port, Number(baudRate));
    obd.startPolling(500);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
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
