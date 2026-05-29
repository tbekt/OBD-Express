// OBD-II Mode 03 — Diagnostic Trouble Code parsing
// Each DTC is encoded in two bytes.
//
// Byte layout (16 bits):
//   Bits 15–14  → letter prefix: 00=P  01=C  10=B  11=U
//   Bits 13–12  → first digit (0–3)
//   Bits 11–8   → second digit (hex nibble)
//   Bits 7–4    → third digit  (hex nibble)
//   Bits 3–0    → fourth digit (hex nibble)
//
// Example: bytes 0x01 0x31 → 0000 0001 0011 0001
//   15–14 = 00 → P
//   13–12 = 00 → 0
//   11–8  = 0001 → 1
//   7–4   = 0011 → 3
//   3–0   = 0001 → 1
//   Result: P0131

const PREFIXES = ['P', 'C', 'B', 'U'] as const;

export function parseDTC(b1: number, b2: number): string {
  const prefix = PREFIXES[(b1 >> 6) & 0x03];
  const d1     = ((b1 >> 4) & 0x03).toString();           // 0–3
  const d2     = (b1  & 0x0f).toString(16).toUpperCase();
  const d3     = ((b2 >> 4) & 0x0f).toString(16).toUpperCase();
  const d4     = (b2  & 0x0f).toString(16).toUpperCase();
  return `${prefix}${d1}${d2}${d3}${d4}`;
}

export function parseMode03Response(response: string): string[] {
  const cleaned = response.replace(/[\s\r\n]/g, '').toUpperCase();

  if (
    cleaned.includes('NODATA') ||
    cleaned.includes('ERROR') ||
    cleaned.includes('?')     ||
    cleaned === ''
  ) {
    return [];
  }

  // Mode 03 response starts with 43; handle multiple '43' segments
  // (can occur when more than one ECU responds)
  const dtcs: string[] = [];
  let search = cleaned;

  while (true) {
    const idx = search.indexOf('43');
    if (idx === -1) break;

    const hex = search.slice(idx + 2); // bytes after '43'

    for (let i = 0; i + 3 < hex.length; i += 4) {
      const b1 = parseInt(hex.slice(i,     i + 2), 16);
      const b2 = parseInt(hex.slice(i + 2, i + 4), 16);
      if (isNaN(b1) || isNaN(b2)) break;
      if (b1 === 0 && b2 === 0) continue; // padding / empty slot

      const code = parseDTC(b1, b2);
      if (!dtcs.includes(code)) dtcs.push(code);
    }

    // Advance past this '43' segment so we catch the next one if any
    search = search.slice(idx + 2);
    if (!search.includes('43')) break;
  }

  return dtcs;
}
