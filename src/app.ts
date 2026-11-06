import express          from 'express';
import { createServer } from 'http';
import path             from 'path';
import { initWss, broadcast } from './ws';
import { obd, obdState }      from './obd/state';
import routes                 from './routes';

/** How often the rolling history is snapshotted, and the chart advanced. */
const SAMPLE_INTERVAL_MS = 1000;
/** How often session statistics are pushed to the browser. */
const STATS_INTERVAL_MS  = 2000;

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
    // Bring a newly opened tab fully up to date: status, current values,
    // session stats and enough history to draw the chart immediately.
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

    if (obdState.history.length > 0) {
      ws.send(JSON.stringify({ type: 'history', payload: obdState.history.recent(180) }));
    }

    ws.send(JSON.stringify({ type: 'stats', payload: obdState.stats() }));
  });

  // ── OBD event → WebSocket broadcast ────────────────────────────────────────
  obd.on('data', (d: { key: string; value: number; unit: string; name: string }) => {
    obdState.data[d.key] = { value: d.value, unit: d.unit, name: d.name };

    if (d.key === 'RPM') {
      obdState.noteRpm(d.value);
    }

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

    if (d.key === 'MAF') {
      // Derive the fuel figures here so the browser never has to know the
      // chemistry, and integrate litres used off the same sample.
      const fuel = obdState.fuelFromMaf();
      const payload: Record<string, { value: number; unit: string; name: string }> = {
        MAF: { value: d.value, unit: d.unit, name: d.name },
      };

      if (fuel) {
        obdState.addFuelSample(fuel.lph);
        obdState.data.FUEL_RATE = { value: fuel.lph, unit: 'L/h', name: 'Fuel Rate' };
        payload.FUEL_RATE = obdState.data.FUEL_RATE;

        if (fuel.l100 !== null) {
          obdState.data.FUEL_ECONOMY = { value: fuel.l100, unit: 'L/100km', name: 'Consumption' };
          payload.FUEL_ECONOMY = obdState.data.FUEL_ECONOMY;
        }
      }

      broadcast({ type: 'data', payload });
      return;
    }

    broadcast({ type: 'data', payload: { [d.key]: { value: d.value, unit: d.unit, name: d.name } } });
  });

  // ── Periodic timers ────────────────────────────────────────────────────────
  // Sampling on a steady clock (rather than per PID response) keeps the chart's
  // time axis honest even though PIDs arrive at different rates.
  let sampleTimer: NodeJS.Timeout | null = null;
  let statsTimer:  NodeJS.Timeout | null = null;

  const startTimers = () => {
    stopTimers();
    sampleTimer = setInterval(() => {
      if (!obd.isConnected()) return;
      obdState.sample();
      const last = obdState.history.recent(1)[0];
      if (last) broadcast({ type: 'sample', payload: last });
    }, SAMPLE_INTERVAL_MS);

    statsTimer = setInterval(() => {
      if (!obd.isConnected()) return;
      broadcast({ type: 'stats', payload: obdState.stats() });
    }, STATS_INTERVAL_MS);
  };

  const stopTimers = () => {
    if (sampleTimer) { clearInterval(sampleTimer); sampleTimer = null; }
    if (statsTimer)  { clearInterval(statsTimer);  statsTimer  = null; }
  };

  obd.on('connected', () => {
    startTimers();
    broadcast({ type: 'status', payload: { connected: true } });
  });

  obd.on('disconnected', () => {
    stopTimers();
    obdState.reset();
    broadcast({ type: 'status',   payload: { connected: false } });
    broadcast({ type: 'snapshot', payload: {} });
    broadcast({ type: 'stats',    payload: obdState.stats() });
  });

  // ── Routes ──────────────────────────────────────────────────────────────────
  app.use(routes);

  return { app, server };
}
