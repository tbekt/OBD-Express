import express        from 'express';
import { createServer } from 'http';
import path            from 'path';
import { initWss, broadcast } from './ws';
import { obd, obdState }      from './obd/state';
import routes                 from './routes';

export function createApp() {
  const app    = express();
  const server = createServer(app);

  // ── Middleware ──────────────────────────────────────────────────────────────
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));

  // ── WebSocket ───────────────────────────────────────────────────────────────
  const wss = initWss(server);

  wss.on('connection', (ws) => {
    // Send current state to the newly connected browser tab
    ws.send(JSON.stringify({ type: 'status', payload: { connected: obd.isConnected() } }));
    if (Object.keys(obdState.data).length > 0) {
      ws.send(JSON.stringify({
        type: 'snapshot',
        payload: {
          ...obdState.data,
          SESSION_KM: { value: obdState.formattedSessionKm(), unit: 'km', name: 'Session Distance' },
        },
      }));
    }
  });

  // ── OBD event → WebSocket broadcast ────────────────────────────────────────
  obd.on('data', (d: { key: string; value: number; unit: string; name: string }) => {
    obdState.data[d.key] = { value: d.value, unit: d.unit, name: d.name };

    if (d.key === 'SPEED') {
      obdState.addSpeedSample(d.value);
      broadcast({
        type: 'data',
        payload: {
          SPEED:      { value: d.value, unit: d.unit, name: d.name },
          SESSION_KM: { value: obdState.formattedSessionKm(), unit: 'km', name: 'Session Distance' },
        },
      });
      return;
    }

    broadcast({ type: 'data', payload: { [d.key]: { value: d.value, unit: d.unit, name: d.name } } });
  });

  obd.on('connected', () => {
    broadcast({ type: 'status', payload: { connected: true } });
  });

  obd.on('disconnected', () => {
    obdState.reset();
    broadcast({ type: 'status',   payload: { connected: false } });
    broadcast({ type: 'snapshot', payload: {} });
  });

  // ── Routes ──────────────────────────────────────────────────────────────────
  app.use(routes);

  return { app, server };
}
