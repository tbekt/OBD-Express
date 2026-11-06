/**
 * Synthetic vehicle model for demo mode.
 *
 * Drives the dashboard without a car attached. The point is not physical
 * accuracy but plausibility: values have to move the way a real engine's do
 * and stay consistent with each other, otherwise the chart and the derived
 * fuel figures look obviously fake.
 *
 * Coupling that matters:
 *   throttle → rpm → speed (via a gear ratio) → load → MAF → fuel rate
 *   coolant warms toward its thermostat point and then holds
 */

type Phase = 'idle' | 'accelerate' | 'cruise' | 'decelerate';

export interface SimSample {
  RPM: number;
  SPEED: number;
  THROTTLE: number;
  ENGINE_LOAD: number;
  MAF: number;
  COOLANT_TEMP: number;
  FUEL_LEVEL: number;
  INTAKE_TEMP: number;
  TIMING_ADVANCE: number;
  BATTERY: number;
}

const IDLE_RPM      = 820;
const MAX_RPM       = 6200;
const THERMOSTAT_C  = 90;
/** Approximate km/h per 1000 rpm in each gear. */
const GEAR_RATIOS   = [0, 11, 20, 30, 40, 50, 60];

export class VehicleSimulator {
  private phase: Phase = 'idle';
  private phaseLeft = 3;      // seconds remaining in the current phase
  private rpm       = IDLE_RPM;
  private speed     = 0;
  private throttle  = 0;
  private coolant   = 22;     // cold start
  private fuel      = 68;
  private intake    = 19;
  private gear      = 1;
  private elapsed   = 0;

  /** Advance the model by `dt` seconds and return the current readings. */
  step(dt: number): SimSample {
    this.elapsed  += dt;
    this.phaseLeft -= dt;
    if (this.phaseLeft <= 0) this.nextPhase();

    this.updateThrottle(dt);
    this.updateEngine(dt);
    this.updateTemps(dt);

    // Fuel drains at a rate tied to how hard the engine is working
    const burn = (0.00018 + (this.throttle / 100) * 0.0011) * dt;
    this.fuel = Math.max(0, this.fuel - burn);

    const load = this.computeLoad();
    const maf  = this.computeMaf(load);

    return {
      RPM:            Math.round(this.rpm),
      SPEED:          Math.round(this.speed),
      THROTTLE:       Math.round(this.throttle),
      ENGINE_LOAD:    Math.round(load),
      MAF:            +maf.toFixed(2),
      COOLANT_TEMP:   Math.round(this.coolant),
      FUEL_LEVEL:     Math.round(this.fuel),
      INTAKE_TEMP:    Math.round(this.intake),
      TIMING_ADVANCE: +this.computeTiming().toFixed(1),
      BATTERY:        +this.computeVoltage().toFixed(1),
    };
  }

  // ── Phase machine ─────────────────────────────────────────────────────────

  private nextPhase(): void {
    // Weighted so the trace spends most of its time doing something visible
    const next: Record<Phase, [Phase, number][]> = {
      idle:       [['accelerate', 0.85], ['idle', 1]],
      accelerate: [['cruise', 0.75], ['decelerate', 1]],
      cruise:     [['accelerate', 0.4], ['decelerate', 0.85], ['cruise', 1]],
      decelerate: [['idle', 0.45], ['accelerate', 1]],
    };

    const roll = Math.random();
    const pick = next[this.phase].find(([, p]) => roll <= p);
    this.phase = pick ? pick[0] : 'cruise';

    const durations: Record<Phase, [number, number]> = {
      idle:       [3, 8],
      accelerate: [4, 10],
      cruise:     [8, 20],
      decelerate: [3, 7],
    };
    const [lo, hi] = durations[this.phase];
    this.phaseLeft = lo + Math.random() * (hi - lo);
  }

  private updateThrottle(dt: number): void {
    const target =
      this.phase === 'idle'       ? 0 :
      this.phase === 'accelerate' ? 45 + Math.random() * 40 :
      this.phase === 'cruise'     ? 16 + Math.random() * 10 :
      /* decelerate */              0;

    // Pedal movement is quick but not instantaneous
    const rate = this.phase === 'decelerate' ? 90 : 55;
    this.throttle += clamp(target - this.throttle, -rate * dt, rate * dt);
    this.throttle = clamp(this.throttle, 0, 100);
  }

  private updateEngine(dt: number): void {
    if (this.phase === 'decelerate' || this.throttle < 2) {
      // Engine braking, then coast down to a stop
      this.speed = Math.max(0, this.speed - (this.phase === 'decelerate' ? 14 : 4) * dt);
    } else {
      // Accelerating force falls off as speed rises, like real drag
      const power = (this.throttle / 100) * 13;
      const drag  = this.speed * 0.055;
      this.speed  = clamp(this.speed + (power - drag) * dt, 0, 185);
    }

    this.pickGear();

    if (this.speed < 1) {
      // Idle with a little hunting so the needle is never perfectly still
      const target = IDLE_RPM + Math.sin(this.elapsed * 1.6) * 22 + (Math.random() - 0.5) * 14;
      this.rpm += (target - this.rpm) * Math.min(1, dt * 4);
    } else {
      const fromGear = (this.speed / GEAR_RATIOS[this.gear]) * 1000;
      const target   = clamp(fromGear, IDLE_RPM, MAX_RPM);
      // Revs chase the gearing, faster under throttle than off it
      this.rpm += (target - this.rpm) * Math.min(1, dt * (this.throttle > 5 ? 3.2 : 2));
    }
  }

  private pickGear(): void {
    // Upshift near 3.4k, downshift below 1.3k — hysteresis prevents hunting
    const rpmIn = (g: number) => (this.speed / GEAR_RATIOS[g]) * 1000;
    if (this.gear < 6 && rpmIn(this.gear) > 3400) this.gear++;
    else if (this.gear > 1 && rpmIn(this.gear) < 1300) this.gear--;
  }

  private updateTemps(dt: number): void {
    // Warm-up is fast at first and asymptotes at the thermostat point
    if (this.coolant < THERMOSTAT_C) {
      this.coolant += (0.55 + (this.throttle / 100) * 0.5) * dt;
    } else {
      this.coolant = THERMOSTAT_C + Math.sin(this.elapsed * 0.08) * 2.2;
    }
    // Intake air heats in the bay at low speed, cools with airflow
    const intakeTarget = 19 + 16 * (1 - Math.min(1, this.speed / 70));
    this.intake += (intakeTarget - this.intake) * Math.min(1, dt * 0.25);
  }

  // ── Derived readings ──────────────────────────────────────────────────────

  private computeLoad(): number {
    const rpmFactor = this.rpm / MAX_RPM;
    const base      = this.speed < 1 ? 17 : 22;
    return clamp(base + this.throttle * 0.62 + rpmFactor * 14, 0, 100);
  }

  private computeMaf(load: number): number {
    // Airflow scales with revs and how open the throttle is
    const flow = (this.rpm / 1000) * (0.9 + (load / 100) * 5.6);
    return clamp(flow + (Math.random() - 0.5) * 0.25, 0.6, 180);
  }

  private computeTiming(): number {
    // Advance pulls back under load, like a real knock-aware map
    return clamp(14 + (1 - this.throttle / 100) * 18 - (this.rpm / MAX_RPM) * 6, -6, 42);
  }

  private computeVoltage(): number {
    // Alternator holds ~14.1 V running; sags briefly under hard acceleration
    const sag = this.throttle > 70 ? 0.25 : 0;
    return 14.1 - sag + Math.sin(this.elapsed * 0.4) * 0.08;
  }

  /** Fault codes demo mode reports, chosen to exercise all severity levels. */
  static demoDTCs(): string[] {
    return ['P0301', 'P0420', 'P0456'];
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
