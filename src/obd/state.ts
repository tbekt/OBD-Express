import { ELM327 } from './elm327';
import { History } from './history';

export type DataMap = Record<string, { value: number; unit: string; name: string }>;

export interface SessionStats {
  /** Seconds since the session started (first data after connect). */
  durationSec: number;
  maxRpm:      number;
  maxSpeed:    number;
  /** Distance-weighted average, i.e. total km / total moving time. */
  avgSpeed:    number;
  /** Seconds spent with the engine running but not moving. */
  idleSec:     number;
  /** Litres burned this session, from integrated fuel rate. Null without MAF. */
  fuelUsedL:   number | null;
  /** Session average consumption in L/100km. Null until the car has moved. */
  avgL100:     number | null;
}

// Petrol: stoichiometric air/fuel ratio and fuel density (g/L).
const AFR_PETROL     = 14.7;
const DENSITY_PETROL = 820;

// Singleton OBD adapter instance shared across the app
export const obd = new ELM327();

// Mutable session state stored as an object so all importers share the same reference
export const obdState = {
  data: {} as DataMap,
  history: new History(),

  sessionKm: 0,
  lastSpeedSample: null as { value: number; timestamp: number } | null,

  // ── Session statistics ────────────────────────────────────────────────────
  startedAt:  null as number | null,
  maxRpm:     0,
  maxSpeed:   0,
  movingSec:  0,
  idleSec:    0,
  fuelUsedL:  0,
  sawMaf:     false,
  lastFuelSample: null as { lph: number; timestamp: number } | null,

  /**
   * Integrate a speed reading into the trip distance using the trapezoidal
   * rule, and track moving/idle time off the same samples.
   */
  addSpeedSample(speed: number): void {
    const now = Date.now();
    if (this.startedAt === null) this.startedAt = now;

    if (this.lastSpeedSample !== null) {
      const dtSec    = Math.min((now - this.lastSpeedSample.timestamp) / 1000, 5); // cap gap at 5 s
      const avgSpeed = (this.lastSpeedSample.value + speed) / 2;                   // trapezoidal
      this.sessionKm += (avgSpeed / 3600) * dtSec;

      if (avgSpeed > 1) this.movingSec += dtSec;
      else              this.idleSec   += dtSec;
    }

    this.lastSpeedSample = { value: speed, timestamp: now };
    if (speed > this.maxSpeed) this.maxSpeed = speed;
  },

  noteRpm(rpm: number): void {
    if (this.startedAt === null) this.startedAt = Date.now();
    if (rpm > this.maxRpm) this.maxRpm = rpm;
  },

  /**
   * Instantaneous fuel figures derived from mass air flow.
   *
   * MAF gives grams of air per second; dividing by the stoichiometric ratio
   * gives grams of fuel per second, and by density gives volume. This assumes
   * petrol running near lambda 1, so it is an estimate — good enough to be
   * useful, and far better than showing nothing.
   */
  fuelFromMaf(): { lph: number; l100: number | null } | null {
    const maf = this.data.MAF?.value;
    if (maf === undefined || maf <= 0) return null;

    const gramsFuelPerSec = maf / AFR_PETROL;
    const lph = (gramsFuelPerSec / DENSITY_PETROL) * 3600;

    const speed = this.data.SPEED?.value;
    // Below ~5 km/h the division explodes toward infinity and means nothing.
    const l100 = speed !== undefined && speed > 5 ? (lph / speed) * 100 : null;

    return {
      lph:  +lph.toFixed(2),
      l100: l100 === null ? null : +l100.toFixed(1),
    };
  },

  /** Integrate fuel rate over time to get litres consumed. */
  addFuelSample(lph: number): void {
    const now = Date.now();
    this.sawMaf = true;
    if (this.lastFuelSample !== null) {
      const dtSec = Math.min((now - this.lastFuelSample.timestamp) / 1000, 5);
      const avg   = (this.lastFuelSample.lph + lph) / 2;
      this.fuelUsedL += (avg / 3600) * dtSec;
    }
    this.lastFuelSample = { lph, timestamp: now };
  },

  stats(): SessionStats {
    const durationSec = this.startedAt === null ? 0 : (Date.now() - this.startedAt) / 1000;
    const avgSpeed    = this.movingSec > 0 ? (this.sessionKm / (this.movingSec / 3600)) : 0;
    const avgL100     = this.sawMaf && this.sessionKm > 0.1
      ? (this.fuelUsedL / this.sessionKm) * 100
      : null;

    return {
      durationSec: Math.round(durationSec),
      maxRpm:      Math.round(this.maxRpm),
      maxSpeed:    Math.round(this.maxSpeed),
      avgSpeed:    +avgSpeed.toFixed(1),
      idleSec:     Math.round(this.idleSec),
      fuelUsedL:   this.sawMaf ? +this.fuelUsedL.toFixed(2) : null,
      avgL100:     avgL100 === null ? null : +avgL100.toFixed(1),
    };
  },

  /** Snapshot the current values into the rolling history. */
  sample(): void {
    const values: Record<string, number> = {};
    for (const [key, entry] of Object.entries(this.data)) {
      values[key] = entry.value;
    }
    values.SESSION_KM = this.formattedSessionKm();
    this.history.push(values);
  },

  resetSession(): void {
    this.sessionKm       = 0;
    this.lastSpeedSample = null;
    this.startedAt       = null;
    this.maxRpm          = 0;
    this.maxSpeed        = 0;
    this.movingSec       = 0;
    this.idleSec         = 0;
    this.fuelUsedL       = 0;
    this.sawMaf          = false;
    this.lastFuelSample  = null;
    this.history.clear();
  },

  reset(): void {
    this.data = {};
    this.resetSession();
  },

  formattedSessionKm(): number {
    return +this.sessionKm.toFixed(2);
  },
};
