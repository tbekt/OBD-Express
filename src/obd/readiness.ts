// OBD-II Mode 01 PID 01 — Readiness monitor status
// OBD-II Mode 01 PID A6 — True vehicle odometer
//
// PID 01 byte layout (4 bytes A-D):
//   Byte A  bit 7     : MIL (Check Engine) commanded on
//   Byte A  bits 6–0  : Number of confirmed DTCs
//   Byte B  bits 0–2  : Continuous monitors SUPPORTED  (1 = supported)
//   Byte B  bits 4–6  : Continuous monitors NOT READY  (1 = incomplete)
//   Byte C  bits 0–7  : Non-continuous monitors SUPPORTED
//   Byte D  bits 0–7  : Non-continuous monitors NOT READY  (1 = incomplete)
//
// PID A6 byte layout (4 bytes A-D):
//   Value (km) = (A×2²⁴ + B×2¹⁶ + C×2⁸ + D) × 0.1

export interface Monitor {
  name:     string;
  complete: boolean;                      // false = incomplete (drive cycle needed)
  type:     'continuous' | 'non-continuous';
}

export interface ReadinessData {
  milOn:    boolean;
  dtcCount: number;
  monitors: Monitor[];                    // only SUPPORTED monitors are included
}

// ── Continuous monitor bit positions in Byte B ──────────────────────────────
const CONTINUOUS = [
  { name: 'Misfire',       supportBit: 0, notReadyBit: 4 },
  { name: 'Fuel System',   supportBit: 1, notReadyBit: 5 },
  { name: 'Comprehensive', supportBit: 2, notReadyBit: 6 },
] as const;

// ── Non-continuous monitor bit positions (same bit in Byte C & D) ────────────
const NON_CONTINUOUS = [
  { name: 'Catalyst',         bit: 0 },
  { name: 'Heated Catalyst',  bit: 1 },
  { name: 'EVAP System',      bit: 2 },
  { name: 'Secondary Air',    bit: 3 },
  { name: 'A/C Refrigerant',  bit: 4 },
  { name: 'O2 Sensor',        bit: 5 },
  { name: 'O2 Sensor Heater', bit: 6 },
  { name: 'EGR System',       bit: 7 },
] as const;

// ── Parsers ──────────────────────────────────────────────────────────────────

export function parseReadiness(response: string): ReadinessData | null {
  const hex = response.replace(/[\s\r\n]/g, '').toUpperCase();
  if (hex.includes('NODATA') || hex.includes('?') || hex.includes('ERROR')) return null;

  const idx = hex.indexOf('4101');
  if (idx === -1) return null;

  const data = hex.slice(idx + 4);
  if (data.length < 8) return null;

  const A = parseInt(data.slice(0, 2), 16);
  const B = parseInt(data.slice(2, 4), 16);
  const C = parseInt(data.slice(4, 6), 16);
  const D = parseInt(data.slice(6, 8), 16);
  if ([A, B, C, D].some(isNaN)) return null;

  const monitors: Monitor[] = [];

  for (const m of CONTINUOUS) {
    const supported = ((B >> m.supportBit)  & 1) === 1;
    if (!supported) continue;
    const notReady  = ((B >> m.notReadyBit) & 1) === 1;
    monitors.push({ name: m.name, complete: !notReady, type: 'continuous' });
  }

  for (const m of NON_CONTINUOUS) {
    const supported = ((C >> m.bit) & 1) === 1;
    if (!supported) continue;
    const notReady  = ((D >> m.bit) & 1) === 1;
    monitors.push({ name: m.name, complete: !notReady, type: 'non-continuous' });
  }

  return {
    milOn:    (A & 0x80) !== 0,
    dtcCount: A & 0x7f,
    monitors,
  };
}

/** Returns odometer in km, or null if the vehicle does not support PID 0xA6. */
export function parseOdometer(response: string): number | null {
  const hex = response.replace(/[\s\r\n]/g, '').toUpperCase();
  if (hex.includes('NODATA') || hex.includes('?') || hex.includes('ERROR')) return null;

  const idx = hex.indexOf('41A6');
  if (idx === -1) return null;

  const data = hex.slice(idx + 4);
  if (data.length < 8) return null;

  const A = parseInt(data.slice(0, 2), 16);
  const B = parseInt(data.slice(2, 4), 16);
  const C = parseInt(data.slice(4, 6), 16);
  const D = parseInt(data.slice(6, 8), 16);
  if ([A, B, C, D].some(isNaN)) return null;

  return (A * 16_777_216 + B * 65_536 + C * 256 + D) * 0.1; // km
}
