import { SerialPort }                          from 'serialport';
import EventEmitter                             from 'events';
import { PIDS, parseResponse }                  from './pids';
import { parseMode03Response }                  from './dtc';
import { parseReadiness, parseOdometer,
         type ReadinessData }                   from './readiness';

// ── Command queue entry ──────────────────────────────────────────────────────
interface QueuedCommand {
  cmd:       string;
  timeoutMs: number;
  resolve:   (response: string) => void;
  reject:    (err: Error) => void;
}

export class ELM327 extends EventEmitter {
  private port:    SerialPort | null = null;
  private buffer   = '';
  private initialized = false;

  // Queue
  private queue:           QueuedCommand[] = [];
  private activeResolve:   ((r: string) => void) | null = null;
  private activeTimer:     NodeJS.Timeout  | null = null;

  // Polling
  private polling    = false;
  private pollTimer: NodeJS.Timeout | null = null;

  // ── Public: connect ────────────────────────────────────────────────────────

  async connect(path: string, baudRate = 38400): Promise<void> {
    return new Promise((resolve, reject) => {
      this.port = new SerialPort({ path, baudRate });

      this.port.on('data', (chunk: Buffer) => {
        this.buffer += chunk.toString('ascii');
        const promptIdx = this.buffer.indexOf('>');
        if (promptIdx !== -1) {
          const response = this.buffer.slice(0, promptIdx).trim();
          this.buffer    = this.buffer.slice(promptIdx + 1);
          this.settle(response);
        }
      });

      this.port.on('open', async () => {
        await sleep(500);   // discard any stale device output
        this.buffer = '';
        try {
          await this.initializeELM327();
          resolve();
        } catch (err) {
          reject(err);
        }
      });

      this.port.on('error', reject);
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

  // ── Private: ELM327 init ───────────────────────────────────────────────────

  private async initializeELM327(): Promise<void> {
    await this.enqueue('ATZ', 5000);  // reset; ELM327 needs a moment after
    await sleep(1500);
    await this.enqueue('ATE0', 3000); // echo off
    await this.enqueue('ATL0', 3000); // linefeeds off
    await this.enqueue('ATS0', 3000); // spaces off
    await this.enqueue('ATH0', 3000); // headers off
    await this.enqueue('ATSP0', 3000); // auto protocol
    this.initialized = true;
    this.emit('connected');
  }

  // ── Public: polling ────────────────────────────────────────────────────────

  startPolling(roundIntervalMs = 500): void {
    if (this.polling || !this.initialized) return;
    this.polling = true;
    const pidKeys = Object.keys(PIDS);

    const pollRound = async () => {
      if (!this.polling) return;

      for (const key of pidKeys) {
        if (!this.polling) break;
        const pid = PIDS[key];
        try {
          const response = await this.enqueue(pid.pid, 2000);
          const value    = parseResponse(pid, response);
          if (value !== null) {
            this.emit('data', { key, value, unit: pid.unit, name: pid.name });
          }
        } catch { /* skip this PID */ }
      }

      if (this.polling) this.pollTimer = setTimeout(pollRound, roundIntervalMs);
    };

    pollRound();
  }

  stopPolling(): void {
    this.polling = false;
    if (this.pollTimer) { clearTimeout(this.pollTimer); this.pollTimer = null; }
  }

  // ── Public: DTC read / clear ───────────────────────────────────────────────

  async readDTCs(): Promise<string[]> {
    if (!this.initialized) throw new Error('Not connected to OBD adapter');
    // Use a generous timeout; response can be slow on some vehicles
    const response = await this.enqueue('03', 10_000);
    return parseMode03Response(response);
  }

  async clearDTCs(): Promise<void> {
    if (!this.initialized) throw new Error('Not connected to OBD adapter');
    await this.enqueue('04', 10_000);
  }

  // ── Public: readiness monitors & odometer ────────────────────────────────

  /** Read Mode 01 PID 01 — monitor readiness status. */
  async readMonitors(): Promise<ReadinessData | null> {
    if (!this.initialized) throw new Error('Not connected to OBD adapter');
    const response = await this.enqueue('0101', 10_000);
    return parseReadiness(response);
  }

  /** Read Mode 01 PID A6 — true vehicle odometer in km. Returns null if unsupported. */
  async readOdometer(): Promise<number | null> {
    if (!this.initialized) throw new Error('Not connected to OBD adapter');
    const response = await this.enqueue('01A6', 10_000);
    return parseOdometer(response);
  }

  // ── Public: disconnect ────────────────────────────────────────────────────

  async disconnect(): Promise<void> {
    this.stopPolling();
    this.initialized = false;
    this.buffer        = '';
    this.activeResolve = null;
    if (this.activeTimer) { clearTimeout(this.activeTimer); this.activeTimer = null; }
    this.queue = [];

    return new Promise((resolve) => {
      if (this.port?.isOpen) {
        this.port.close(() => { this.port = null; this.emit('disconnected'); resolve(); });
      } else {
        this.port = null;
        this.emit('disconnected');
        resolve();
      }
    });
  }

  isConnected(): boolean {
    return this.initialized && (this.port?.isOpen ?? false);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
