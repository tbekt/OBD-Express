export interface OBDPid {
  pid: string;
  name: string;
  unit: string;
  min: number;
  max: number;
  parse: (bytes: number[]) => number;
}

export const PIDS: Record<string, OBDPid> = {
  RPM: {
    pid: '010C',
    name: 'RPM',
    unit: 'rpm',
    min: 0,
    max: 8000,
    parse: (b) => ((b[0] * 256) + b[1]) / 4,
  },
  SPEED: {
    pid: '010D',
    name: 'Speed',
    unit: 'km/h',
    min: 0,
    max: 240,
    parse: (b) => b[0],
  },
  COOLANT_TEMP: {
    pid: '0105',
    name: 'Coolant Temp',
    unit: '°C',
    min: -40,
    max: 215,
    parse: (b) => b[0] - 40,
  },
  ENGINE_LOAD: {
    pid: '0104',
    name: 'Engine Load',
    unit: '%',
    min: 0,
    max: 100,
    parse: (b) => Math.round((b[0] * 100) / 255),
  },
  THROTTLE: {
    pid: '0111',
    name: 'Throttle',
    unit: '%',
    min: 0,
    max: 100,
    parse: (b) => Math.round((b[0] * 100) / 255),
  },
  FUEL_LEVEL: {
    pid: '012F',
    name: 'Fuel Level',
    unit: '%',
    min: 0,
    max: 100,
    parse: (b) => Math.round((b[0] * 100) / 255),
  },
};

export function parseResponse(pid: OBDPid, response: string): number | null {
  const cleaned = response.replace(/[\s\r\n]/g, '').toUpperCase();

  if (
    cleaned.includes('NODATA') ||
    cleaned.includes('ERROR') ||
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
    if (!isNaN(byte)) bytes.push(byte);
  }

  if (bytes.length === 0) return null;

  try {
    return pid.parse(bytes);
  } catch {
    return null;
  }
}
