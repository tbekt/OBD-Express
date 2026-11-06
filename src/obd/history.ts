/**
 * Rolling sample history.
 *
 * Samples are snapshots taken on a fixed timer rather than on every PID
 * response: poll rounds arrive with jitter and the tiered poller updates
 * different keys at different rates, so charting raw events would produce an
 * uneven time axis. A steady cadence gives the chart a real time base and
 * makes the CSV export trivially analysable.
 */

export interface Sample {
  /** Epoch milliseconds. */
  t: number;
  /** Latest known value per metric key at sample time. */
  v: Record<string, number>;
}

/** One hour at 1 Hz. Bounded so a long session cannot grow without limit. */
const MAX_SAMPLES = 3600;

export class History {
  private samples: Sample[] = [];

  push(values: Record<string, number>): Sample {
    const sample: Sample = { t: Date.now(), v: { ...values } };
    this.samples.push(sample);
    if (this.samples.length > MAX_SAMPLES) this.samples.shift();
    return sample;
  }

  /** The most recent `n` samples, oldest first. */
  recent(n: number): Sample[] {
    return n >= this.samples.length ? [...this.samples] : this.samples.slice(-n);
  }

  all(): Sample[] {
    return [...this.samples];
  }

  get length(): number {
    return this.samples.length;
  }

  clear(): void {
    this.samples = [];
  }

  /**
   * Flatten to CSV. Columns are the union of every key seen, so a metric the
   * vehicle only started reporting midway through still gets its own column.
   */
  toCsv(): string {
    if (this.samples.length === 0) return 'timestamp,elapsed_s\n';

    const keys = [...new Set(this.samples.flatMap((s) => Object.keys(s.v)))].sort();
    const t0   = this.samples[0].t;

    const header = ['timestamp', 'elapsed_s', ...keys].join(',');
    const rows   = this.samples.map((s) => {
      const elapsed = ((s.t - t0) / 1000).toFixed(1);
      const cells   = keys.map((k) => (s.v[k] !== undefined ? String(s.v[k]) : ''));
      return [new Date(s.t).toISOString(), elapsed, ...cells].join(',');
    });

    return [header, ...rows].join('\n') + '\n';
  }
}
