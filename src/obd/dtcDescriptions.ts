/**
 * Human-readable descriptions for OBD-II diagnostic trouble codes.
 *
 * A raw code like "P0301" tells you nothing unless you already know the spec,
 * so every code gets resolved through three layers:
 *   1. an exact lookup of the common generic (SAE) codes
 *   2. a pattern rule, which covers whole families such as P03xx misfires
 *   3. a subsystem fallback derived from the code's first digits
 *
 * Descriptions are Dutch, matching the rest of the UI.
 */

export interface DTCInfo {
  code:        string;
  description: string;
  /** Rough seriousness, used to colour-code the UI. */
  severity:    'low' | 'medium' | 'high';
  /** Vehicle subsystem the code belongs to. */
  system:      string;
}

// ── Exact matches for the codes that actually show up in practice ──────────
const EXACT: Record<string, { description: string; severity: DTCInfo['severity'] }> = {
  // Fuel & air metering
  P0100: { description: 'Luchtmassameter (MAF) — circuitfout',                  severity: 'medium' },
  P0101: { description: 'Luchtmassameter (MAF) — bereik/prestatieprobleem',     severity: 'medium' },
  P0102: { description: 'Luchtmassameter (MAF) — signaal te laag',              severity: 'medium' },
  P0103: { description: 'Luchtmassameter (MAF) — signaal te hoog',              severity: 'medium' },
  P0106: { description: 'Inlaatdruksensor (MAP) — bereik/prestatieprobleem',    severity: 'medium' },
  P0107: { description: 'Inlaatdruksensor (MAP) — signaal te laag',             severity: 'medium' },
  P0108: { description: 'Inlaatdruksensor (MAP) — signaal te hoog',             severity: 'medium' },
  P0110: { description: 'Inlaatluchttemperatuursensor — circuitfout',           severity: 'low'    },
  P0112: { description: 'Inlaatluchttemperatuursensor — signaal te laag',       severity: 'low'    },
  P0113: { description: 'Inlaatluchttemperatuursensor — signaal te hoog',       severity: 'low'    },
  P0115: { description: 'Koelvloeistoftemperatuursensor — circuitfout',         severity: 'medium' },
  P0116: { description: 'Koelvloeistoftemperatuursensor — bereikprobleem',      severity: 'medium' },
  P0117: { description: 'Koelvloeistoftemperatuursensor — signaal te laag',     severity: 'medium' },
  P0118: { description: 'Koelvloeistoftemperatuursensor — signaal te hoog',     severity: 'medium' },
  P0120: { description: 'Gaspedaalstandsensor — circuitfout',                   severity: 'high'   },
  P0121: { description: 'Gaspedaalstandsensor — bereik/prestatieprobleem',      severity: 'high'   },
  P0128: { description: 'Thermostaat — motor bereikt bedrijfstemperatuur niet', severity: 'low'    },
  P0130: { description: 'Lambdasonde bank 1 sensor 1 — circuitfout',            severity: 'medium' },
  P0131: { description: 'Lambdasonde bank 1 sensor 1 — spanning te laag',       severity: 'medium' },
  P0132: { description: 'Lambdasonde bank 1 sensor 1 — spanning te hoog',       severity: 'medium' },
  P0133: { description: 'Lambdasonde bank 1 sensor 1 — reageert te langzaam',   severity: 'medium' },
  P0134: { description: 'Lambdasonde bank 1 sensor 1 — geen activiteit',        severity: 'medium' },
  P0135: { description: 'Lambdasonde bank 1 sensor 1 — verwarming defect',      severity: 'medium' },
  P0141: { description: 'Lambdasonde bank 1 sensor 2 — verwarming defect',      severity: 'medium' },
  P0171: { description: 'Mengsel te arm (bank 1)',                              severity: 'medium' },
  P0172: { description: 'Mengsel te rijk (bank 1)',                             severity: 'medium' },
  P0174: { description: 'Mengsel te arm (bank 2)',                              severity: 'medium' },
  P0175: { description: 'Mengsel te rijk (bank 2)',                             severity: 'medium' },

  // Injection / idle
  P0201: { description: 'Injector cilinder 1 — circuitfout',                    severity: 'high'   },
  P0202: { description: 'Injector cilinder 2 — circuitfout',                    severity: 'high'   },
  P0203: { description: 'Injector cilinder 3 — circuitfout',                    severity: 'high'   },
  P0204: { description: 'Injector cilinder 4 — circuitfout',                    severity: 'high'   },

  // Misfires
  P0300: { description: 'Willekeurige ontstekingsfout (meerdere cilinders)',    severity: 'high'   },
  P0301: { description: 'Ontstekingsfout cilinder 1',                           severity: 'high'   },
  P0302: { description: 'Ontstekingsfout cilinder 2',                           severity: 'high'   },
  P0303: { description: 'Ontstekingsfout cilinder 3',                           severity: 'high'   },
  P0304: { description: 'Ontstekingsfout cilinder 4',                           severity: 'high'   },
  P0305: { description: 'Ontstekingsfout cilinder 5',                           severity: 'high'   },
  P0306: { description: 'Ontstekingsfout cilinder 6',                           severity: 'high'   },

  // Knock / crank / cam
  P0325: { description: 'Klopsensor bank 1 — circuitfout',                      severity: 'medium' },
  P0335: { description: 'Krukaspositiesensor — circuitfout',                    severity: 'high'   },
  P0336: { description: 'Krukaspositiesensor — bereik/prestatieprobleem',       severity: 'high'   },
  P0340: { description: 'Nokkenaspositiesensor — circuitfout',                  severity: 'high'   },

  // EGR / emissions
  P0401: { description: 'EGR — onvoldoende doorstroming',                       severity: 'medium' },
  P0402: { description: 'EGR — te veel doorstroming',                           severity: 'medium' },
  P0403: { description: 'EGR — circuitfout',                                    severity: 'medium' },
  P0411: { description: 'Secundair luchtinjectiesysteem — verkeerde stroming',  severity: 'low'    },
  P0420: { description: 'Katalysator bank 1 — rendement onder drempel',         severity: 'medium' },
  P0430: { description: 'Katalysator bank 2 — rendement onder drempel',         severity: 'medium' },
  P0440: { description: 'Brandstofdampsysteem (EVAP) — algemene fout',          severity: 'low'    },
  P0442: { description: 'EVAP — klein lek gedetecteerd',                        severity: 'low'    },
  P0446: { description: 'EVAP — ventilatieregeling defect',                     severity: 'low'    },
  P0455: { description: 'EVAP — groot lek (tankdop los?)',                      severity: 'low'    },
  P0456: { description: 'EVAP — zeer klein lek gedetecteerd',                   severity: 'low'    },

  // Speed / idle / charging
  P0500: { description: 'Snelheidsmeter — sensorfout',                          severity: 'medium' },
  P0505: { description: 'Stationairregeling — systeemfout',                     severity: 'medium' },
  P0506: { description: 'Stationair toerental te laag',                          severity: 'low'    },
  P0507: { description: 'Stationair toerental te hoog',                          severity: 'low'    },
  P0562: { description: 'Boordspanning te laag',                                 severity: 'medium' },
  P0563: { description: 'Boordspanning te hoog',                                 severity: 'medium' },

  // Transmission
  P0700: { description: 'Transmissieregelsysteem — fout gemeld',                severity: 'high'   },
  P0730: { description: 'Verkeerde overbrengingsverhouding',                     severity: 'high'   },

  // Network / communication
  U0100: { description: 'Geen communicatie met motormanagement (ECM/PCM)',      severity: 'high'   },
  U0101: { description: 'Geen communicatie met transmissieregeleenheid',        severity: 'high'   },
  U0121: { description: 'Geen communicatie met ABS-regeleenheid',               severity: 'high'   },
  U0155: { description: 'Geen communicatie met instrumentenpaneel',             severity: 'medium' },
};

// ── Family rules, checked before the subsystem fallback ───────────────────
const PATTERNS: { re: RegExp; description: string; severity: DTCInfo['severity'] }[] = [
  { re: /^P03(\d)\d$/,  description: 'Ontstekingsfout — cilinder of algemeen',   severity: 'high'   },
  { re: /^P01[3-6]\d$/, description: 'Lambdasonde — circuit of werking',          severity: 'medium' },
  { re: /^P02\d\d$/,    description: 'Injector- of brandstofcircuitfout',         severity: 'high'   },
  { re: /^P04[2-3]\d$/, description: 'Katalysator of uitlaatnabehandeling',       severity: 'medium' },
  { re: /^P044\d$/,     description: 'Brandstofdampsysteem (EVAP)',               severity: 'low'    },
  { re: /^P06\d\d$/,    description: 'Interne fout in de regeleenheid',           severity: 'high'   },
  { re: /^P07\d\d$/,    description: 'Transmissie — regeling of sensor',          severity: 'high'   },
  { re: /^P2\d\d\d$/,   description: 'Uitgebreide motor-/emissiecode',            severity: 'medium' },
];

/** Subsystem each letter + first digit maps to, per SAE J2012. */
const SYSTEMS: Record<string, string> = {
  P: 'Motor & transmissie',
  C: 'Chassis (ABS, stuurinrichting)',
  B: 'Carrosserie (airbag, comfort)',
  U: 'Netwerk & communicatie',
};

const P_GROUPS: { re: RegExp; label: string }[] = [
  { re: /^P0[01]/, label: 'Brandstof- en luchttoevoer' },
  { re: /^P02/,    label: 'Brandstof- en luchttoevoer' },
  { re: /^P03/,    label: 'Ontstekingssysteem' },
  { re: /^P04/,    label: 'Emissieregeling' },
  { re: /^P05/,    label: 'Snelheid & stationairregeling' },
  { re: /^P06/,    label: 'Regeleenheid (ECU)' },
  { re: /^P07/,    label: 'Transmissie' },
  { re: /^P08/,    label: 'Transmissie' },
];

export function describeDTC(code: string): DTCInfo {
  const upper  = code.toUpperCase().trim();
  const letter = upper.charAt(0);
  const system = resolveSystem(upper, letter);

  const exact = EXACT[upper];
  if (exact) {
    return { code: upper, description: exact.description, severity: exact.severity, system };
  }

  for (const p of PATTERNS) {
    if (p.re.test(upper)) {
      return { code: upper, description: p.description, severity: p.severity, system };
    }
  }

  // Manufacturer-specific codes (second digit 1 or 2) cannot be resolved from
  // the generic spec at all — say so rather than inventing a meaning.
  const manufacturerSpecific = /^[PCBU][12]/.test(upper);
  return {
    code:        upper,
    description: manufacturerSpecific
      ? 'Fabrikantspecifieke code — raadpleeg merkdocumentatie'
      : 'Onbekende code — geen generieke beschrijving beschikbaar',
    severity:    'medium',
    system,
  };
}

function resolveSystem(upper: string, letter: string): string {
  if (letter === 'P') {
    const g = P_GROUPS.find((x) => x.re.test(upper));
    if (g) return g.label;
  }
  return SYSTEMS[letter] ?? 'Onbekend subsysteem';
}

/** Resolve a list of raw codes to full info objects. */
export function describeDTCs(codes: string[]): DTCInfo[] {
  return codes.map(describeDTC);
}
