import { ELM327 } from './elm327';

export type DataMap = Record<string, { value: number; unit: string; name: string }>;

// Singleton OBD adapter instance shared across the app
export const obd = new ELM327();

// Mutable session state stored as an object so all importers share the same reference
export const obdState = {
  data: {} as DataMap,
  sessionKm: 0,
  lastSpeedSample: null as { value: number; timestamp: number } | null,

  addSpeedSample(speed: number): void {
    const now = Date.now();
    if (this.lastSpeedSample !== null) {
      const dtSec    = Math.min((now - this.lastSpeedSample.timestamp) / 1000, 5); // cap gap at 5 s
      const avgSpeed = (this.lastSpeedSample.value + speed) / 2;                   // trapezoidal
      this.sessionKm += (avgSpeed / 3600) * dtSec;
    }
    this.lastSpeedSample = { value: speed, timestamp: now };
  },

  resetSession(): void {
    this.sessionKm       = 0;
    this.lastSpeedSample = null;
  },

  reset(): void {
    this.data = {};
    this.resetSession();
  },

  formattedSessionKm(): number {
    return +this.sessionKm.toFixed(2);
  },
};
