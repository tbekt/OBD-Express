import { Router } from 'express';
import { SerialPort } from 'serialport';

const router = Router();

router.get('/api/ports', async (_req, res) => {
  try {
    const ports = await SerialPort.list();
    res.json({ ports });
  } catch {
    res.status(500).json({ error: 'Failed to list serial ports' });
  }
});

export default router;
