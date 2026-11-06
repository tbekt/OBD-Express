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
  broadcast({ type: 'stats',   payload: obdState.stats() });
  broadcast({ type: 'history', payload: [] });
  res.json({ success: true });
});

router.get('/api/status', (_req, res) => {
  res.json({
    connected:  obd.isConnected(),
    baudRate:   obd.currentBaudRate(),
    data:       obdState.data,
    sessionKm:  obdState.formattedSessionKm(),
    stats:      obdState.stats(),
  });
});

/** GET /api/session/history — recent samples for charting */
router.get('/api/session/history', (req, res) => {
  const n = Math.min(Math.max(parseInt(String(req.query.n ?? '180'), 10) || 180, 1), 3600);
  res.json({ samples: obdState.history.recent(n) });
});

/** GET /api/session/export — download the whole session log as CSV */
router.get('/api/session/export', (_req, res) => {
  if (obdState.history.length === 0) {
    res.status(404).json({ error: 'Nog geen data in deze sessie' });
    return;
  }

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="obd-sessie-${stamp}.csv"`);
  res.send(obdState.history.toCsv());
});

export default router;
