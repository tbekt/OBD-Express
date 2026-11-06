/**
 * OBD-II Mode 01 PID definitions.
 *
 * Polling is tiered: every PID costs a serial round-trip (~40–120 ms), so
 * polling nine of them in one round would make the RPM gauge visibly laggy.
 * 'fast' PIDs change moment to moment and are read every round; 'slow' PIDs
 * (coolant, fuel level, intake temp) drift over minutes and are read every
 * Nth round instead.
 */

export type PidTier = 'fast' | 'slow';

export interface OBDPid {
  pid:   string;
  name:  string;
  unit:  string;
  min:   number;
  max:   number;
  tier:  PidTier;
  parse: (bytes: number[]) => number;
}

export const PIDS: Record<string, OBDPid> = {
  // ── Fast tier: read every poll round ────────────────────────────────────
  RPM: {
    pid: '010C', name: 'RPM', unit: 'rpm', min: 0, max: 8000, tier: 'fast',
    parse: (b) => ((b[0] * 256) + b[1]) / 4,
  },
  SPEED: {
    pid: '010D', name: 'Speed', unit: 'km/h', min: 0, max: 240, tier: 'fast',
    parse: (b) => b[0],
  },
  THROTTLE: {
    pid: '0111', name: 'Throttle', unit: '%', min: 0, max: 100, tier: 'fast',
    parse: (b) => Math.round((b[0] * 100) / 255),
  },
  ENGINE_LOAD: {
    pid: '0104', name: 'Engine Load', unit: '%', min: 0, max: 100, tier: 'fast',
    parse: (b) => Math.round((b[0] * 100) / 255),
  },
  MAF: {
    // Mass air flow — drives the fuel-consumption calculation, so it has to
    // stay in step with speed to be meaningful.
    pid: '0110', name: 'Mass Air Flow', unit: 'g/s', min: 0, max: 400, tier: 'fast',
    parse: (b) => ((b[0] * 256) + b[1]) / 100,
  },

  // ── Slow tier: read every Nth round ─────────────────────────────────────
  COOLANT_TEMP: {
    pid: '0105', name: 'Coolant Temp', unit: '°C', min: -40, max: 215, tier: 'slow',
    parse: (b) => b[0] - 40,
  },
  FUEL_LEVEL: {
    pid: '012F', name: 'Fuel Level', unit: '%', min: 0, max: 100, tier: 'slow',
    parse: (b) => Math.round((b[0] * 100) / 255),
  },
  INTAKE_TEMP: {
    pid: '010F', name: 'Intake Air Temp', unit: '°C', min: -40, max: 215, tier: 'slow',
    parse: (b) => b[0] - 40,
  },
  TIMING_ADVANCE: {
    pid: '010E', name: 'Timing Advance', unit: '°', min: -64, max: 64, tier: 'slow',
    parse: (b) => (b[0] / 2) - 64,
  },
};

export const FAST_PIDS = Object.keys(PIDS).filter((k) => PIDS[k].tier === 'fast');
export const SLOW_PIDS = Object.keys(PIDS).filter((k) => PIDS[k].tier === 'slow');

/** Bytes each two-byte PID's formula needs — guards against truncated frames. */
const MIN_BYTES: Record<string, number> = {
  '010C': 2, // RPM
  '0110': 2, // MAF
};

export function parseResponse(pid: OBDPid, response: string): number | null {
  const cleaned = response.replace(/[\s\r\n]/g, '').toUpperCase();

  if (
    cleaned.includes('NODATA') ||
    cleaned.includes('ERROR') ||
    cleaned.includes('STOPPED') ||
    cleaned.includes('UNABLETOCONNECT') ||
    cleaned.includes('?') ||
    cleaned.includes('TIMEOUT') ||
    cleaned === ''
  ) {
    return null;
  }

  // Mode 01 response starts with "41" followed by the PID hex
  const pidHex = pid.pid.slice(2).toUpperCase(); // e.g. "0C"
  const marker = '41' + pidHex;
  const idx = cleaned.indexOf(marker);
  if (idx === -1) return null;

  const dataHex = cleaned.slice(idx + marker.length);
  const bytes: number[] = [];
  for (let i = 0; i + 1 < dataHex.length; i += 2) {
    const byte = parseInt(dataHex.slice(i, i + 2), 16);
    if (isNaN(byte)) break;
    bytes.push(byte);
  }

  // A truncated frame would otherwise feed NaN into the formula and surface as
  // a garbage reading on the dashboard.
  const needed = MIN_BYTES[pid.pid] ?? 1;
  if (bytes.length < needed) return null;

  try {
    const value = pid.parse(bytes);
    if (!Number.isFinite(value)) return null;
    // Reject physically impossible readings (corrupted frame that still parsed)
    if (value < pid.min - 1 || value > pid.max * 1.5) return null;
    return value;
  } catch {
    return null;
  }
}

/** Parse the ELM327's own `ATRV` reply, e.g. "12.6V" → 12.6 */
export function parseVoltage(response: string): number | null {
  const m = response.match(/(\d{1,2}(?:\.\d{1,2})?)\s*V?/i);
  if (!m) return null;
  const v = parseFloat(m[1]);
  if (!Number.isFinite(v) || v < 1 || v > 40) return null;
  return +v.toFixed(1);
}
