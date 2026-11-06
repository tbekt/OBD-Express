import { SerialPort }                          from 'serialport';
import EventEmitter                             from 'events';
import { PIDS, FAST_PIDS, SLOW_PIDS,
         parseResponse, parseVoltage }          from './pids';
import { parseMode03Response }                  from './dtc';
import { parseReadiness, parseOdometer,
         type ReadinessData }                   from './readiness';
import { VehicleSimulator }                     from './simulator';

// ── Command queue entry ──────────────────────────────────────────────────────
interface QueuedCommand {
  cmd:       string;
  timeoutMs: number;
  resolve:   (response: string) => void;
  reject:    (err: Error) => void;
}

/** Baud rates tried, in order, when the user picks "Auto". */
const COMMON_BAUD_RATES = [38400, 9600, 115200, 500000, 230400, 57600];

export class ELM327 extends EventEmitter {
  private port:    SerialPort | null = null;
  private buffer   = '';
  private initialized = false;
  private baudRate = 0;

  // Queue
  private queue:           QueuedCommand[] = [];
  private activeResolve:   ((r: string) => void) | null = null;
  private activeTimer:     NodeJS.Timeout  | null = null;

  // Polling
  private polling    = false;
  private pollTimer: NodeJS.Timeout | null = null;

  /** PIDs this vehicle does not answer, learned at runtime and then skipped. */
  private unsupported = new Set<string>();
  private pidMisses   = new Map<string, number>();

  // Demo mode: a synthetic vehicle, so the dashboard works without a car
  private sim: VehicleSimulator | null = null;
  private simTimer: NodeJS.Timeout | null = null;

  // ── Public: connect ────────────────────────────────────────────────────────

  /**
   * Open the adapter and bring it up. Pass 'auto' to probe the common baud
   * rates — many ELM327 clones ignore their advertised rate.
   * Resolves with the baud rate that actually worked.
   */
  async connect(path: string, baudRate: number | 'auto' = 38400): Promise<number> {
    const candidates = baudRate === 'auto' ? COMMON_BAUD_RATES : [Number(baudRate)];
    const attempts: string[] = [];

    for (const baud of candidates) {
      // A port-level failure (wrong COM port, port in use) is fatal for every
      // baud rate, so surface it immediately rather than retrying six times.
      try {
        await this.openPort(path, baud);
      } catch (err) {
        await this.closePortQuietly();
        throw new Error(describeSerialError(err as Error, path));
      }

      try {
        console.log(`[OBD] ${path} open at ${baud} baud — handshaking…`);
        const banner = await this.handshake();
        console.log(`[OBD] adapter responded: ${banner.replace(/\s+/g, ' ')}`);

        await this.configureELM327();
        await this.verifyVehicleLink();

        this.initialized = true;
        this.baudRate    = baud;
        this.emit('connected');
        console.log(`[OBD] connected at ${baud} baud`);
        return baud;
      } catch (err) {
        const msg = (err as Error).message;
        console.log(`[OBD] ${baud} baud failed: ${msg}`);
        attempts.push(`${baud} baud → ${msg}`);
        await this.closePortQuietly();
        await sleep(300); // Windows needs a moment before the port reopens
      }
    }

    // Single explicit baud rate: report its failure verbatim — it is the answer.
    if (attempts.length === 1) throw new Error(attempts[0]);

    throw new Error(
      `Geen ELM327 gevonden op ${path}. Geprobeerd: ${attempts.join(' | ')}`,
    );
  }

  // ── Private: port plumbing ────────────────────────────────────────────────

  private openPort(path: string, baudRate: number): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (err?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) reject(err); else resolve();
      };

      const timer = setTimeout(
        () => done(new Error(`Timeout bij het openen van ${path}`)),
        4000,
      );

      let port: SerialPort;
      try {
        port = new SerialPort({ path, baudRate });
      } catch (err) {
        done(err as Error);
        return;
      }
      this.port = port;

      port.on('data',  (chunk: Buffer) => this.onData(chunk));
      port.on('error', (err: Error)    => done(err));
      port.once('open', ()             => done());
    });
  }

  /** Collect bytes until the ELM327 prompt '>' delimits a complete response. */
  private onData(chunk: Buffer): void {
    this.buffer += chunk.toString('ascii');
    let idx: number;
    // A single chunk can carry several prompts — drain all of them.
    while ((idx = this.buffer.indexOf('>')) !== -1) {
      const response = this.buffer.slice(0, idx).trim();
      this.buffer    = this.buffer.slice(idx + 1);
      this.settle(response);
    }
  }

  private writeRaw(data: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.port?.isOpen) { reject(new Error('Poort is niet open')); return; }
      this.port.write(data, (err) => (err ? reject(err) : resolve()));
    });
  }

  private closePortQuietly(): Promise<void> {
    return new Promise((resolve) => {
      this.queue         = [];
      this.activeResolve = null;
      this.buffer        = '';
      if (this.activeTimer) { clearTimeout(this.activeTimer); this.activeTimer = null; }

      const p   = this.port;
      this.port = null;
      if (p?.isOpen) p.close(() => resolve());
      else resolve();
    });
  }

  // ── Private: queue engine ─────────────────────────────────────────────────

  /** Resolve the in-flight command and pull the next one from the queue. */
  private settle(response: string): void {
    if (!this.activeResolve) return;
    if (this.activeTimer) { clearTimeout(this.activeTimer); this.activeTimer = null; }
    const resolver      = this.activeResolve;
    this.activeResolve  = null;
    resolver(response);
    this.processQueue();
  }

  /** Dispatch the next queued command if the channel is free. */
  private processQueue(): void {
    if (this.activeResolve !== null || this.queue.length === 0) return;
    if (!this.port?.isOpen) return;

    const item = this.queue.shift()!;

    this.activeTimer = setTimeout(() => {
      this.activeTimer   = null;
      this.activeResolve = null;
      item.resolve('TIMEOUT');
      this.processQueue();
    }, item.timeoutMs);

    this.activeResolve = item.resolve;

    this.port.write(item.cmd + '\r', (err) => {
      if (err) {
        if (this.activeTimer) { clearTimeout(this.activeTimer); this.activeTimer = null; }
        this.activeResolve = null;
        item.reject(err);
        this.processQueue();
      }
    });
  }

  /** Enqueue a command and return a promise for its response. */
  private enqueue(cmd: string, timeoutMs = 5000): Promise<string> {
    return new Promise((resolve, reject) => {
      this.queue.push({ cmd, timeoutMs, resolve, reject });
      this.processQueue();
    });
  }

  // ── Private: ELM327 bring-up ──────────────────────────────────────────────

  /**
   * Prove there is an ELM327 on the other end at this baud rate.
   * Garbage bytes (wrong baud) and silence both fail here, which is what makes
   * auto-detection possible.
   */
  private async handshake(): Promise<string> {
    // Some clones swallow the first byte after the port opens — nudge them.
    await this.writeRaw('\r');
    await sleep(250);
    this.buffer = '';

    const reset = await this.enqueue('ATZ', 6000);
    if (isElmBanner(reset)) { await sleep(1200); return reset; }

    // A few clones answer ATZ with nothing useful but still identify via ATI.
    await sleep(800);
    const ident = await this.enqueue('ATI', 4000);
    if (isElmBanner(ident)) return ident;

    if (reset === 'TIMEOUT' && ident === 'TIMEOUT') {
      throw new Error('geen antwoord van de adapter');
    }
    throw new Error('onleesbaar antwoord (waarschijnlijk verkeerde baud rate)');
  }

  private async configureELM327(): Promise<void> {
    const echoOff = await this.enqueue('ATE0', 3000); // echo off
    if (echoOff === 'TIMEOUT') throw new Error('adapter stopte met antwoorden na reset');

    await this.enqueue('ATL0',  3000); // linefeeds off
    await this.enqueue('ATS0',  3000); // spaces off
    await this.enqueue('ATH0',  3000); // headers off
    await this.enqueue('ATSP0', 3000); // auto protocol
  }

  /**
   * Ask the ECU for its supported-PID bitmap. This is the difference between
   * "adapter works" and "adapter is actually talking to the car" — by far the
   * most common real-world failure, and it deserves its own message.
   */
  private async verifyVehicleLink(): Promise<void> {
    // First request also triggers the ELM327's protocol search, so allow time.
    const res     = await this.enqueue('0100', 12_000);
    const cleaned = res.replace(/[\s\r\n]/g, '').toUpperCase();

    if (cleaned.includes('4100')) return; // ECU answered

    if (cleaned.includes('UNABLETOCONNECT') || cleaned.includes('NODATA') || res === 'TIMEOUT') {
      throw new Error(
        'adapter werkt, maar de auto antwoordt niet — zet het contact aan (stand II) of start de motor',
      );
    }
    if (cleaned.includes('BUSINIT') || cleaned.includes('CANERROR')) {
      throw new Error('bus-fout bij verbinden met de auto — controleer of de adapter goed in de OBD-poort zit');
    }
    throw new Error(`onverwacht antwoord van de auto: ${res.replace(/\s+/g, ' ').slice(0, 60)}`);
  }

  // ── Public: polling ────────────────────────────────────────────────────────

  /**
   * Round-robin poll. Fast PIDs are read every round; slow ones every
   * SLOW_EVERY rounds and battery voltage every VOLTAGE_EVERY rounds, so
   * adding metrics does not cost responsiveness on the gauges that matter.
   */
  startPolling(roundIntervalMs = 300): void {
    if (this.polling || !this.initialized) return;
    this.polling = true;

    const SLOW_EVERY    = 4;
    const VOLTAGE_EVERY = 10;
    let round = 0;

    const readPid = async (key: string): Promise<void> => {
      const pid = PIDS[key];
      try {
        const response = await this.enqueue(pid.pid, 2000);
        const value    = parseResponse(pid, response);
        if (value !== null) {
          this.emit('data', { key, value, unit: pid.unit, name: pid.name });
        } else if (!this.unsupported.has(key)) {
          // Remember PIDs the vehicle never answers so we stop wasting a
          // round-trip on them every single cycle.
          const misses = (this.pidMisses.get(key) ?? 0) + 1;
          this.pidMisses.set(key, misses);
          if (misses >= 3) {
            this.unsupported.add(key);
            console.log(`[OBD] ${key} (${pid.pid}) not supported — skipping`);
          }
        }
      } catch { /* skip this PID */ }
    };

    const pollRound = async () => {
      if (!this.polling) return;
      round++;

      const keys = [
        ...FAST_PIDS,
        ...(round % SLOW_EVERY === 0 ? SLOW_PIDS : []),
      ].filter((k) => !this.unsupported.has(k));

      for (const key of keys) {
        if (!this.polling) break;
        await readPid(key);
      }

      if (this.polling && round % VOLTAGE_EVERY === 1) {
        const v = await this.readVoltage();
        if (v !== null) {
          this.emit('data', { key: 'BATTERY', value: v, unit: 'V', name: 'Battery' });
        }
      }

      if (this.polling) this.pollTimer = setTimeout(pollRound, roundIntervalMs);
    };

    pollRound();
  }

  /** Adapter-reported battery voltage via the ELM327's own `ATRV` command. */
  async readVoltage(): Promise<number | null> {
    if (!this.initialized) return null;
    try {
      const res = await this.enqueue('ATRV', 2500);
      if (res === 'TIMEOUT') return null;
      return parseVoltage(res);
    } catch {
      return null;
    }
  }

  stopPolling(): void {
    this.polling = false;
    if (this.pollTimer) { clearTimeout(this.pollTimer); this.pollTimer = null; }
    // Support is per-vehicle, so forget it when the link drops.
    this.unsupported.clear();
    this.pidMisses.clear();
  }

  // ── Public: DTC read / clear ───────────────────────────────────────────────

  async readDTCs(): Promise<string[]> {
    if (this.sim) { await sleep(600); return this.simDTCs; }
    if (!this.initialized) throw new Error('Not connected to OBD adapter');
    // Use a generous timeout; response can be slow on some vehicles
    const response = await this.enqueue('03', 10_000);
    return parseMode03Response(response);
  }

  async clearDTCs(): Promise<void> {
    if (this.sim) {
      await sleep(800);
      this.simDTCs      = [];
      this.simCleared   = true; // monitors go incomplete, as on a real clear
      return;
    }
    if (!this.initialized) throw new Error('Not connected to OBD adapter');
    await this.enqueue('04', 10_000);
  }

  // ── Public: readiness monitors & odometer ────────────────────────────────

  /** Read Mode 01 PID 01 — monitor readiness status. */
  async readMonitors(): Promise<ReadinessData | null> {
    if (this.sim) { await sleep(500); return this.simMonitors(); }
    if (!this.initialized) throw new Error('Not connected to OBD adapter');
    const response = await this.enqueue('0101', 10_000);
    return parseReadiness(response);
  }

  /** Read Mode 01 PID A6 — true vehicle odometer in km. Returns null if unsupported. */
  async readOdometer(): Promise<number | null> {
    if (this.sim) { await sleep(500); return 147_382.4; }
    if (!this.initialized) throw new Error('Not connected to OBD adapter');
    const response = await this.enqueue('01A6', 10_000);
    return parseOdometer(response);
  }

  // ── Demo-mode diagnostic data ─────────────────────────────────────────────

  private simDTCs    = VehicleSimulator.demoDTCs();
  private simCleared = false;

  /**
   * After a clear, the non-continuous monitors read incomplete until enough
   * drive cycles have run — mirroring the behaviour the panel is there to warn
   * about.
   */
  private simMonitors(): ReadinessData {
    const continuous = ['Misfire', 'Fuel System', 'Comprehensive'];
    const nonCont    = ['Catalyst', 'Heated Catalyst', 'Evaporative System',
                        'Secondary Air', 'Oxygen Sensor', 'Oxygen Sensor Heater', 'EGR System'];

    return {
      milOn:    !this.simCleared && this.simDTCs.length > 0,
      dtcCount: this.simDTCs.length,
      monitors: [
        ...continuous.map((name) => ({ name, complete: true, type: 'continuous' as const })),
        ...nonCont.map((name, i) => ({
          name,
          // Leave a couple incomplete even before a clear, as most cars show
          complete: this.simCleared ? false : i > 1,
          type: 'non-continuous' as const,
        })),
      ],
    };
  }

  // ── Public: disconnect ────────────────────────────────────────────────────

  async disconnect(): Promise<void> {
    if (this.sim) { this.stopSimulation(); return; }

    this.stopPolling();
    this.initialized = false;
    this.baudRate    = 0;
    await this.closePortQuietly();
    this.emit('disconnected');
  }

  isConnected(): boolean {
    if (this.sim !== null) return true;
    return this.initialized && (this.port?.isOpen ?? false);
  }

  isSimulated(): boolean {
    return this.sim !== null;
  }

  // ── Demo mode ─────────────────────────────────────────────────────────────

  /**
   * Run a synthetic vehicle instead of a serial adapter. Refused while a real
   * adapter is connected so the two can never fight over the same state.
   */
  startSimulation(intervalMs = 250): void {
    if (this.isConnected()) throw new Error('Verbreek eerst de echte verbinding');

    this.sim = new VehicleSimulator();
    const dt = intervalMs / 1000;

    this.simTimer = setInterval(() => {
      if (!this.sim) return;
      const s = this.sim.step(dt);
      for (const [key, value] of Object.entries(s) as [keyof typeof s, number][]) {
        const pid = PIDS[key];
        this.emit('data', {
          key,
          value,
          unit: key === 'BATTERY' ? 'V' : pid?.unit ?? '',
          name: key === 'BATTERY' ? 'Battery' : pid?.name ?? key,
        });
      }
    }, intervalMs);

    console.log('[OBD] demo mode started');
    this.emit('connected');
  }

  stopSimulation(): void {
    if (this.simTimer) { clearInterval(this.simTimer); this.simTimer = null; }
    if (this.sim) {
      this.sim = null;
      console.log('[OBD] demo mode stopped');
      this.emit('disconnected');
    }
  }

  /** Baud rate currently in use, or 0 when disconnected. */
  currentBaudRate(): number {
    return this.baudRate;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Real and cloned ELM327s identify themselves as "ELM327 v1.x"; a handful of
 * clones answer "OBDII". At the wrong baud rate you get binary noise instead,
 * which is exactly what this rejects.
 */
function isElmBanner(response: string): boolean {
  if (!response || response === 'TIMEOUT') return false;
  return /ELM\s*327|ELM|OBD\s*II|OBDII/i.test(response);
}

/** Turn a raw serialport error into something a human can act on. */
function describeSerialError(err: Error, path: string): string {
  const m = err.message.toLowerCase();

  if (m.includes('access denied') || m.includes('resource busy') || m.includes('temporarily unavailable')) {
    return `${path} is al in gebruik — sluit andere OBD-software (of PuTTY / Arduino IDE) en probeer opnieuw.`;
  }
  if (m.includes('file not found') || m.includes('no such file') || m.includes('cannot find')) {
    return `${path} bestaat niet (meer) — klik op Scan en kies de juiste poort.`;
  }
  if (m.includes('permission denied')) {
    return `Geen rechten om ${path} te openen.`;
  }
  return `Kon ${path} niet openen: ${err.message}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
