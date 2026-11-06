/**
 * Rolling time-series chart for the OBD dashboard.
 *
 * Two series share one plot with independent scales: RPM on the left axis and
 * speed on the right. The window slides with wall-clock time rather than with
 * sample count, so a gap in the data reads as a gap instead of being squeezed
 * away — which matters when the adapter stalls or the car is switched off.
 *
 * Exposes a single global: window.OBDChart
 */
(function () {
  'use strict';

  const WINDOW_MS = 90_000;  // visible time span
  const PAD       = { top: 14, right: 46, bottom: 22, left: 46 };

  const SERIES = [
    { key: 'RPM',   color: '#ff4444', axis: 'left',  max: 8000, label: 'rpm'  },
    { key: 'SPEED', color: '#0099ff', axis: 'right', max: 240,  label: 'km/h' },
  ];

  function OBDChart(canvas, emptyEl) {
    this.canvas  = canvas;
    this.emptyEl = emptyEl || null;
    this.ctx     = canvas.getContext('2d');
    this.samples = [];        // { t, v: { KEY: number } }
    this.raf     = null;
    this.dpr     = 1;

    this._resize();
    window.addEventListener('resize', () => { this._resize(); this.draw(); });
  }

  /** Match the backing store to the CSS size so lines stay crisp on HiDPI. */
  OBDChart.prototype._resize = function () {
    const rect = this.canvas.getBoundingClientRect();
    const dpr  = window.devicePixelRatio || 1;
    // getBoundingClientRect is 0 while the element is hidden; keep the last size
    if (rect.width === 0) return;

    this.dpr           = dpr;
    this.cssW          = rect.width;
    this.cssH          = rect.height;
    this.canvas.width  = Math.round(rect.width  * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  /** Replace the whole buffer (used for server-provided history). */
  OBDChart.prototype.setHistory = function (samples) {
    this.samples = Array.isArray(samples) ? samples.slice() : [];
    this._prune();
    this.scheduleDraw();
  };

  /** Append one sample and redraw. */
  OBDChart.prototype.push = function (sample) {
    if (!sample || typeof sample.t !== 'number') return;
    this.samples.push(sample);
    this._prune();
    this.scheduleDraw();
  };

  OBDChart.prototype.clear = function () {
    this.samples = [];
    this.scheduleDraw();
  };

  /** Drop samples that have scrolled off the left edge, keeping one for continuity. */
  OBDChart.prototype._prune = function () {
    const cutoff = Date.now() - WINDOW_MS - 2000;
    let i = 0;
    while (i < this.samples.length && this.samples[i].t < cutoff) i++;
    if (i > 1) this.samples = this.samples.slice(i - 1);
  };

  OBDChart.prototype.scheduleDraw = function () {
    if (this.raf !== null) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = null;
      this.draw();
    });
  };

  OBDChart.prototype.draw = function () {
    const ctx = this.ctx;
    const w   = this.cssW;
    const h   = this.cssH;
    if (!w || !h) return;

    ctx.clearRect(0, 0, w, h);

    const plotW = w - PAD.left - PAD.right;
    const plotH = h - PAD.top  - PAD.bottom;
    if (plotW <= 0 || plotH <= 0) return;

    const now  = Date.now();
    const tMin = now - WINDOW_MS;

    const visible = this.samples.filter((s) => s.t >= tMin - 2000);
    const hasData = visible.some((s) => SERIES.some((ser) => typeof s.v[ser.key] === 'number'));

    if (this.emptyEl) this.emptyEl.hidden = hasData;

    this._drawGrid(ctx, plotW, plotH);
    if (!hasData) return;

    const xOf = (t) => PAD.left + ((t - tMin) / WINDOW_MS) * plotW;

    SERIES.forEach((ser) => {
      const yOf = (val) => {
        const ratio = Math.min(1, Math.max(0, val / ser.max));
        return PAD.top + plotH - ratio * plotH;
      };
      this._drawSeries(ctx, visible, ser, xOf, yOf, plotH);
    });

    this._drawAxisLabels(ctx, plotW, plotH);
  };

  OBDChart.prototype._drawGrid = function (ctx, plotW, plotH) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.055)';
    ctx.lineWidth   = 1;

    // Horizontal grid: 4 bands
    for (let i = 0; i <= 4; i++) {
      const y = PAD.top + (i / 4) * plotH;
      ctx.beginPath();
      ctx.moveTo(PAD.left, y + 0.5);
      ctx.lineTo(PAD.left + plotW, y + 0.5);
      ctx.stroke();
    }

    // Vertical grid: one line per 15 s
    const steps = WINDOW_MS / 15_000;
    for (let i = 0; i <= steps; i++) {
      const x = PAD.left + (i / steps) * plotW;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, PAD.top);
      ctx.lineTo(x + 0.5, PAD.top + plotH);
      ctx.stroke();
    }
    ctx.restore();
  };

  OBDChart.prototype._drawSeries = function (ctx, samples, ser, xOf, yOf, plotH) {
    // Break the line wherever the metric is missing or time jumped, so absent
    // data is visible as a gap rather than interpolated across.
    const segments = [];
    let current    = [];

    let prevT = null;
    samples.forEach((s) => {
      const val = s.v[ser.key];
      const ok  = typeof val === 'number' && isFinite(val);
      const jumped = prevT !== null && s.t - prevT > 4000;

      if (!ok || jumped) {
        if (current.length) segments.push(current);
        current = [];
      }
      if (ok) current.push({ x: xOf(s.t), y: yOf(val) });
      prevT = s.t;
    });
    if (current.length) segments.push(current);
    if (segments.length === 0) return;

    const baseY = PAD.top + plotH;

    segments.forEach((pts) => {
      if (pts.length === 0) return;

      // Gradient fill beneath the line
      if (pts.length > 1) {
        const grad = ctx.createLinearGradient(0, PAD.top, 0, baseY);
        grad.addColorStop(0, hexAlpha(ser.color, 0.26));
        grad.addColorStop(1, hexAlpha(ser.color, 0.0));

        ctx.beginPath();
        ctx.moveTo(pts[0].x, baseY);
        pts.forEach((p) => ctx.lineTo(p.x, p.y));
        ctx.lineTo(pts[pts.length - 1].x, baseY);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();
      }

      // The line itself
      ctx.beginPath();
      pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.strokeStyle = ser.color;
      ctx.lineWidth   = 1.9;
      ctx.lineJoin    = 'round';
      ctx.lineCap     = 'round';
      ctx.shadowColor = hexAlpha(ser.color, 0.55);
      ctx.shadowBlur  = 7;
      ctx.stroke();
      ctx.shadowBlur  = 0;
    });

    // Dot at the newest point of the last segment
    const last = segments[segments.length - 1];
    const tip  = last[last.length - 1];
    if (tip) {
      ctx.beginPath();
      ctx.arc(tip.x, tip.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = ser.color;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(tip.x, tip.y, 6, 0, Math.PI * 2);
      ctx.strokeStyle = hexAlpha(ser.color, 0.35);
      ctx.lineWidth   = 1.5;
      ctx.stroke();
    }
  };

  OBDChart.prototype._drawAxisLabels = function (ctx, plotW, plotH) {
    ctx.save();
    ctx.font         = '9px Arial, sans-serif';
    ctx.textBaseline = 'middle';

    // Left axis: RPM, right axis: speed
    for (let i = 0; i <= 4; i++) {
      const y     = PAD.top + (i / 4) * plotH;
      const ratio = 1 - i / 4;

      ctx.fillStyle = 'rgba(255,68,68,0.55)';
      ctx.textAlign = 'right';
      const rpm = Math.round((ratio * 8000) / 100) * 100;
      ctx.fillText(rpm >= 1000 ? (rpm / 1000).toFixed(0) + 'k' : String(rpm), PAD.left - 7, y);

      ctx.fillStyle = 'rgba(0,153,255,0.55)';
      ctx.textAlign = 'left';
      ctx.fillText(String(Math.round(ratio * 240)), PAD.left + plotW + 7, y);
    }

    // Time axis
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.textAlign = 'center';
    const steps = WINDOW_MS / 15_000;
    for (let i = 0; i <= steps; i++) {
      const x    = PAD.left + (i / steps) * plotW;
      const secs = Math.round((WINDOW_MS / 1000) * (1 - i / steps));
      ctx.fillText(secs === 0 ? 'nu' : '-' + secs + 's', x, PAD.top + plotH + 11);
    }
    ctx.restore();
  };

  /** '#rrggbb' + alpha → 'rgba(...)'. Chart colours are all hex literals. */
  function hexAlpha(hex, alpha) {
    const h = hex.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  window.OBDChart = OBDChart;
})();
