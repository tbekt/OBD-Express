import { Router } from 'express';
import { obd, obdState } from '../obd/state';
import { broadcast } from '../ws';

const router = Router();

router.post('/api/session/reset', (_req, res) => {
  obdState.resetSession();
  broadcast({
    type: 'data',
    payload: { SESSION_KM: { value: 0, unit: 'km', name: 'Session Distance' } },
  });
  res.json({ success: true });
});

router.get('/api/status', (_req, res) => {
  res.json({
    connected: obd.isConnected(),
    data:       obdState.data,
    sessionKm:  obdState.formattedSessionKm(),
  });
});

export default router;
