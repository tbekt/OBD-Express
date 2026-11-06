(function () {
  'use strict';

  // ── Config ────────────────────────────────────────────────────────────────

  const GAUGE_CFG = {
    RPM:            { min: 0,   max: 8000, label: 'TOERENTAL', unit: 'rpm',  color: '#ff4444', redline: 0.82 },
    SPEED:          { min: 0,   max: 240,  label: 'SNELHEID',  unit: 'km/h', color: '#0099ff', redline: null },
    COOLANT_TEMP:   { min: -40, max: 120,  color: '#ff6b35' },
    ENGINE_LOAD:    { min: 0,   max: 100,  color: '#7bed9f' },
    THROTTLE:       { min: 0,   max: 100,  color: '#ffd32a' },
    FUEL_LEVEL:     { min: 0,   max: 100,  color: '#00d2d3' },
    INTAKE_TEMP:    { min: -40, max: 80,   color: '#54a0ff' },
    // Cruising airflow sits around 5–25 g/s; 60 keeps the bar meaningful
    // instead of pinned near zero the way a full-throttle scale would.
    MAF:            { min: 0,   max: 60,   color: '#a29bfe', decimals: 1 },
    TIMING_ADVANCE: { min: -20, max: 50,   color: '#fd79a8' },
    BATTERY:        { min: 10,  max: 15,   color: '#badc58', decimals: 1 },
  };

  const LARGE_GAUGES = new Set(['RPM', 'SPEED']);

  // ── Animation state ───────────────────────────────────────────────────────

  // Needle lerp: ~13 % of the remaining distance per frame gives a smooth
  // mechanical sweep without lagging behind fast throttle changes.
  const GAUGE_EASE = 0.13;
  const GAUGE_SNAP = 0.8;

  const gaugeAnim = {};
  LARGE_GAUGES.forEach((key) => { gaugeAnim[key] = { val: 0, target: 0, raf: null }; });

  const METRIC_DURATION = 280; // ms count-up
  const metricCurrent = {};
  const metricRaf     = {};

  let chart      = null;
  let _connected = false;

  // ── SVG helpers ───────────────────────────────────────────────────────────

  function pt(cx, cy, r, angleDeg) {
    const rad = (angleDeg * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  }

  function arcPath(cx, cy, r, startDeg, sweepDeg) {
    const sweep = Math.max(0.01, Math.min(sweepDeg, 359.99));
    const s = pt(cx, cy, r, startDeg);
    const e = pt(cx, cy, r, startDeg + sweep);
    return `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${r} ${r} 0 ${sweep > 180 ? 1 : 0} 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`;
  }

  // ── Circular gauge ────────────────────────────────────────────────────────

  function drawGauge(svgEl, value, cfg) {
    const cx = 130, cy = 118, r = 96;
    const START = 135, SWEEP = 270;
    const ratio = Math.min(1, Math.max(0, (value - cfg.min) / (cfg.max - cfg.min)));
    const fillSweep = ratio * SWEEP;
    const uid = cfg.label.replace(/\W/g, '');

    // 8 segments puts the major ticks on round numbers for both gauges
    // (0/2k/4k/6k/8k rpm and 0/60/120/180/240 km/h) — 10 would label 1600 "2k".
    const N = 8;
    let ticks = '';
    for (let i = 0; i <= N; i++) {
      const a     = START + (i / N) * SWEEP;
      const major = i % 2 === 0;
      const o     = pt(cx, cy, r + 5, a);
      const inn   = pt(cx, cy, r - (major ? 17 : 8), a);

      ticks += `<line x1="${o.x.toFixed(1)}" y1="${o.y.toFixed(1)}"
                      x2="${inn.x.toFixed(1)}" y2="${inn.y.toFixed(1)}"
                      stroke="${major ? '#4a4a66' : '#262640'}"
                      stroke-width="${major ? 2 : 1.5}" stroke-linecap="round"/>`;

      if (major) {
        const lp  = pt(cx, cy, r - 30, a);
        const raw = cfg.min + (i / N) * (cfg.max - cfg.min);
        const lbl = raw >= 1000 ? (raw / 1000).toFixed(0) + 'k' : Math.round(raw).toString();
        ticks += `<text x="${lp.x.toFixed(1)}" y="${lp.y.toFixed(1)}"
                        text-anchor="middle" dominant-baseline="central"
                        fill="#42425c" font-size="9" font-family="Arial,sans-serif">${lbl}</text>`;
      }
    }

    let redZone = '';
    if (cfg.redline) {
      const rlOffset = cfg.redline * SWEEP;
      redZone = `<path d="${arcPath(cx, cy, r, START + rlOffset, SWEEP - rlOffset)}"
                       fill="none" stroke="#ff111180" stroke-width="14" stroke-linecap="round"/>`;
    }

    const na  = START + ratio * SWEEP;
    const tip = pt(cx, cy, r - 20, na);
    const bl  = pt(cx, cy, 11, na - 90);
    const br  = pt(cx, cy, 11, na + 90);

    svgEl.innerHTML = `
      <defs>
        <filter id="glow${uid}" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="3.5" result="b"/>
          <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <filter id="needle${uid}" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="2" result="b"/>
          <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>

      <circle cx="${cx}" cy="${cy}" r="${r + 14}" fill="none" stroke="#0d0d1c" stroke-width="1.5"/>
      ${ticks}
      <path d="${arcPath(cx, cy, r, START, SWEEP)}"
            fill="none" stroke="#161626" stroke-width="14" stroke-linecap="round"/>
      ${redZone}
      ${fillSweep > 0.1 ? `
      <path d="${arcPath(cx, cy, r, START, fillSweep)}"
            fill="none" stroke="${cfg.color}" stroke-width="14" stroke-linecap="round"
            filter="url(#glow${uid})"/>` : ''}

      <polygon points="${tip.x.toFixed(1)},${tip.y.toFixed(1)} ${bl.x.toFixed(1)},${bl.y.toFixed(1)} ${br.x.toFixed(1)},${br.y.toFixed(1)}"
               fill="${cfg.color}" opacity="0.92" filter="url(#needle${uid})"/>
      <circle cx="${cx}" cy="${cy}" r="13" fill="#090916" stroke="${cfg.color}" stroke-width="2.5"/>
      <circle cx="${cx}" cy="${cy}" r="5"  fill="${cfg.color}"/>

      <text x="${cx}" y="${cy + 38}" text-anchor="middle" dominant-baseline="middle"
            fill="#fff" font-size="34" font-weight="900"
            font-family="'Courier New',monospace">${Math.round(value)}</text>
      <text x="${cx}" y="${cy + 60}" text-anchor="middle" fill="#45456a" font-size="11"
            font-family="Arial,sans-serif">${cfg.unit}</text>
      <text x="${cx}" y="${cy + 92}" text-anchor="middle" fill="${cfg.color}" font-size="10"
            font-family="Arial,sans-serif" font-weight="700" letter-spacing="2">${cfg.label}</text>
    `;
  }

  function gaugeTick(key) {
    const state = gaugeAnim[key];
    const cfg   = GAUGE_CFG[key];
    const el    = document.getElementById('gauge-' + key);
    if (!el) { state.raf = null; return; }

    const diff = state.target - state.val;
    if (Math.abs(diff) <= GAUGE_SNAP) {
      state.val = state.target;
      drawGauge(el, state.val, cfg);
      state.raf = null;
      return;
    }

    state.val += diff * GAUGE_EASE;
    drawGauge(el, state.val, cfg);
    state.raf = requestAnimationFrame(() => gaugeTick(key));
  }

  function scheduleGaugeTick(key) {
    const state = gaugeAnim[key];
    // A loop already running will converge on the updated target by itself
    if (state.raf === null) state.raf = requestAnimationFrame(() => gaugeTick(key));
  }

  function setGaugeTarget(key, value) {
    gaugeAnim[key].target = value;
    scheduleGaugeTick(key);
  }

  // ── Odometer ──────────────────────────────────────────────────────────────

  let _odoFlipTimers = [];

  function updateOdometer(km) {
    const whole   = Math.floor(km).toString().padStart(4, '0');
    const decimal = String(Math.round(km * 10) % 10);
    const chars   = (whole + decimal).split('');

    _odoFlipTimers.forEach(clearTimeout);
    _odoFlipTimers = [];

    chars.forEach((ch, i) => {
      const el = document.getElementById('odo-' + i);
      if (!el || el.textContent === ch) return;

      el.classList.remove('flip');
      void el.offsetWidth; // force reflow so the animation restarts
      el.classList.add('flip');

      // Swap the glyph while the digit is edge-on and invisible
      _odoFlipTimers.push(setTimeout(() => { el.textContent = ch; }, 90));
      _odoFlipTimers.push(setTimeout(() => { el.classList.remove('flip'); }, 200));
    });
  }

  // ── Metric cards ──────────────────────────────────────────────────────────

  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

  function animateMetric(key, target, cfg) {
    const valEl = document.getElementById('val-' + key);
    const barEl = document.getElementById('bar-' + key);
    if (!valEl && !barEl) return;

    valEl?.closest('.metric-card')?.classList.remove('no-data');

    if (metricRaf[key]) { cancelAnimationFrame(metricRaf[key]); metricRaf[key] = null; }

    const from    = metricCurrent[key] !== undefined ? metricCurrent[key] : (cfg.min || 0);
    const startTs = performance.now();
    const dp      = cfg.decimals ?? 0;

    function tick(now) {
      const progress = Math.min(1, (now - startTs) / METRIC_DURATION);
      const current  = from + (target - from) * easeOutCubic(progress);

      metricCurrent[key] = current;
      if (valEl) valEl.textContent = dp > 0 ? current.toFixed(dp) : String(Math.round(current));
      if (barEl) {
        const ratio = Math.min(1, Math.max(0, (current - cfg.min) / (cfg.max - cfg.min)));
        barEl.style.width = (ratio * 100).toFixed(1) + '%';
      }

      metricRaf[key] = progress < 1 ? requestAnimationFrame(tick) : null;
    }

    metricRaf[key] = requestAnimationFrame(tick);
  }

  function resetMetricCard(key) {
    if (metricRaf[key]) { cancelAnimationFrame(metricRaf[key]); metricRaf[key] = null; }
    metricCurrent[key] = undefined;

    const valEl = document.getElementById('val-' + key);
    const barEl = document.getElementById('bar-' + key);
    if (valEl) {
      valEl.textContent = '—';
      valEl.closest('.metric-card')?.classList.add('no-data');
    }
    if (barEl) barEl.style.width = '0%';
  }

  // ── Consumption readout ───────────────────────────────────────────────────

  function updateConsumption(l100) {
    const wrap = document.getElementById('consumption');
    const val  = document.getElementById('consumption-value');
    if (!wrap || !val) return;
    wrap.hidden     = false;
    val.textContent = l100.toFixed(1);
  }

  function resetConsumption() {
    const wrap = document.getElementById('consumption');
    if (wrap) wrap.hidden = true;
  }

  // ── Dispatch ──────────────────────────────────────────────────────────────

  function applyKey(key, value) {
    if (key === 'SESSION_KM')   { updateOdometer(value);     return; }
    if (key === 'FUEL_ECONOMY') { updateConsumption(value);  return; }
    if (key === 'FUEL_RATE')    { return; } // folded into the stats panel

    const cfg = GAUGE_CFG[key];
    if (!cfg) return;

    if (LARGE_GAUGES.has(key)) setGaugeTarget(key, value);
    else                       animateMetric(key, value, cfg);
  }

  function resetAll() {
    LARGE_GAUGES.forEach((key) => {
      gaugeAnim[key].target = GAUGE_CFG[key].min;
      scheduleGaugeTick(key);
    });
    Object.keys(GAUGE_CFG).forEach((key) => {
      if (!LARGE_GAUGES.has(key)) resetMetricCard(key);
    });
    updateOdometer(0);
    resetConsumption();
    resetStats();
    chart?.clear();
  }

  // ── Session statistics ────────────────────────────────────────────────────

  function fmtDuration(sec) {
    if (!sec || sec < 1) return '0:00';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    return h > 0
      ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
      : `${m}:${String(s).padStart(2, '0')}`;
  }

  const STAT_FORMATTERS = {
    maxRpm:      (v) => String(v),
    maxSpeed:    (v) => String(v),
    avgSpeed:    (v) => v.toFixed(1),
    durationSec: (v) => fmtDuration(v),
    idleSec:     (v) => fmtDuration(v),
    fuelUsedL:   (v) => v.toFixed(2),
    avgL100:     (v) => v.toFixed(1),
  };

  const STAT_UNITS = {
    maxRpm: 'rpm', maxSpeed: 'km/h', avgSpeed: 'km/h',
    durationSec: '', idleSec: '', fuelUsedL: 'L', avgL100: 'L/100km',
  };

  function updateStats(stats) {
    Object.keys(STAT_FORMATTERS).forEach((key) => {
      const el = document.getElementById('stat-' + key);
      if (!el) return;

      const raw  = stats[key];
      const unit = STAT_UNITS[key];
      // null means "not measurable yet" (no MAF, or the car hasn't moved)
      const text = raw === null || raw === undefined ? '—' : STAT_FORMATTERS[key](raw);
      el.innerHTML = unit ? `${text} <small>${unit}</small>` : text;
    });
  }

  function resetStats() {
    Object.keys(STAT_FORMATTERS).forEach((key) => {
      const el   = document.getElementById('stat-' + key);
      const unit = STAT_UNITS[key];
      if (el) el.innerHTML = unit ? `— <small>${unit}</small>` : '—';
    });
  }

  // ── Status ────────────────────────────────────────────────────────────────

  function setStatus(connected) {
    _connected = connected;

    const badge = document.getElementById('status-badge');
    if (badge) {
      badge.textContent = connected ? '● VERBONDEN' : '● OFFLINE';
      badge.className   = 'status-badge ' + (connected ? 'connected' : 'disconnected');
    }

    const enableWhenConnected = [
      'disconnect-btn', 'read-dtc-btn', 'clear-dtc-btn',
      'read-monitors-btn', 'read-odometer-btn', 'export-btn',
    ];
    enableWhenConnected.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.disabled = !connected;
    });

    // Connect and Demo are both entry points — neither applies once live
    ['connect-btn', 'demo-btn'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.disabled = connected;
    });

    if (!connected) {
      resetDTCPanel();
      resetMonitorsPanel();
      resetOdometerPanel();
    }
  }

  // ── Readiness monitors ────────────────────────────────────────────────────

  function resetMonitorsPanel() {
    const body  = document.getElementById('monitors-body');
    const icon  = document.getElementById('mon-icon');
    const badge = document.getElementById('mon-badge');
    if (body)  body.innerHTML = '<span class="placeholder">Verbind om monitors te controleren</span>';
    if (icon)  { icon.textContent = '○'; icon.className = 'panel-icon'; }
    if (badge) badge.hidden = true;
  }

  function displayMonitors(data) {
    const body  = document.getElementById('monitors-body');
    const icon  = document.getElementById('mon-icon');
    const badge = document.getElementById('mon-badge');
    if (!body) return;

    const incomplete = data.monitors.filter((m) => !m.complete);
    const allOk      = incomplete.length === 0;

    // Staggered delays make the chips cascade in rather than pop as a block
    const chips = data.monitors.map((m, i) => {
      const cls = m.complete ? 'monitor-chip complete' : 'monitor-chip incomplete';
      const sym = m.complete ? '✓' : '✗';
      return `<span class="${cls}" style="animation-delay:${i * 40}ms"><span class="mon-sym">${sym}</span>${esc(m.name)}</span>`;
    }).join('');

    const summary = allOk
      ? `Alle ${data.monitors.length} monitors compleet`
      : `${incomplete.length} monitor${incomplete.length > 1 ? 's' : ''} incompleet — rijcycli nodig`;

    body.innerHTML = `
      <div class="monitors-grid">${chips}</div>
      <p class="mon-summary ${allOk ? 'ok' : 'warn'}">${allOk ? '✓' : '⚠'} ${summary}</p>`;

    if (icon) {
      icon.textContent = allOk ? '●' : '⚠';
      icon.className   = 'panel-icon ' + (allOk ? 'ok' : 'warn');
    }
    if (badge) {
      badge.textContent = allOk ? 'Compleet' : incomplete.length + ' incompleet';
      badge.className   = 'badge ' + (allOk ? 'all-complete' : '');
      badge.hidden      = false;
    }
  }

  async function readMonitors() {
    await withButton('read-monitors-btn', 'Bezig…', async () => {
      const res  = await fetch('/api/vehicle/monitors');
      const json = await res.json();
      if (!res.ok) { toast('Monitors uitlezen mislukt: ' + json.error, 'error'); return; }
      displayMonitors(json);
    }, 'Monitors uitlezen mislukt.');
  }

  // ── True odometer ─────────────────────────────────────────────────────────

  function resetOdometerPanel() {
    const body = document.getElementById('odometer-body');
    if (body) body.innerHTML = '<span class="placeholder">Verbind om uit te lezen</span>';
  }

  function displayOdometer(data) {
    const body = document.getElementById('odometer-body');
    if (!body) return;

    if (!data.supported || data.km === null) {
      body.innerHTML = `
        <div class="true-odo-unsupported">
          <p>Niet ondersteund door deze auto</p>
          <small>OBD-II PID 0xA6 — vereist meestal bouwjaar 2010+</small>
        </div>`;
      return;
    }

    body.innerHTML = `
      <div class="true-odo-wrap">
        <div class="true-odo-value">${Math.round(data.km).toLocaleString('nl-NL')}</div>
        <div class="true-odo-unit">km</div>
        <div class="true-odo-note">via OBD-II PID 0xA6</div>
      </div>`;
  }

  async function readOdometer() {
    await withButton('read-odometer-btn', 'Bezig…', async () => {
      const res  = await fetch('/api/vehicle/odometer');
      const json = await res.json();
      if (!res.ok) { toast('Km-stand uitlezen mislukt: ' + json.error, 'error'); return; }
      displayOdometer(json);
    }, 'Km-stand uitlezen mislukt.');
  }

  // ── Fault codes ───────────────────────────────────────────────────────────

  const SEVERITY_LABEL = { high: 'Ernstig', medium: 'Matig', low: 'Licht' };

  function resetDTCPanel() {
    const body  = document.getElementById('dtc-body');
    const icon  = document.getElementById('dtc-icon');
    const count = document.getElementById('dtc-count');
    const panel = document.getElementById('dtc-panel');
    if (body)  body.innerHTML = '<span class="placeholder">Verbind met een adapter om foutcodes te lezen</span>';
    if (icon)  { icon.textContent = '○'; icon.className = 'panel-icon'; }
    if (count) count.hidden = true;
    if (panel) panel.classList.remove('has-codes');
  }

  function displayDTCs(details) {
    const body  = document.getElementById('dtc-body');
    const icon  = document.getElementById('dtc-icon');
    const count = document.getElementById('dtc-count');
    const panel = document.getElementById('dtc-panel');
    if (!body) return;

    if (!details || details.length === 0) {
      body.innerHTML = '<span class="dtc-ok-msg">Geen foutcodes gevonden</span>';
      if (icon)  { icon.textContent = '●'; icon.className = 'panel-icon ok'; }
      if (count) count.hidden = true;
      if (panel) panel.classList.remove('has-codes');
      return;
    }

    // Most serious first, so the thing to act on is at the top
    const order  = { high: 0, medium: 1, low: 2 };
    const sorted = details.slice().sort((a, b) => (order[a.severity] ?? 3) - (order[b.severity] ?? 3));

    body.innerHTML = `<div class="dtc-list">${sorted.map((d, i) => `
      <div class="dtc-item sev-${esc(d.severity)}" style="animation-delay:${i * 55}ms">
        <span class="dtc-code">${esc(d.code)}</span>
        <span class="dtc-text">
          <span class="dtc-desc">${esc(d.description)}</span>
          <span class="dtc-system">${esc(d.system)}</span>
        </span>
        <span class="dtc-sev">${esc(SEVERITY_LABEL[d.severity] || d.severity)}</span>
      </div>`).join('')}</div>`;

    if (icon)  { icon.textContent = '⚠'; icon.className = 'panel-icon warn'; }
    if (count) {
      count.textContent = details.length + (details.length === 1 ? ' fout' : ' fouten');
      count.hidden = false;
    }
    if (panel) panel.classList.add('has-codes');
  }

  async function readDTCs() {
    await withButton('read-dtc-btn', 'Bezig…', async () => {
      const res  = await fetch('/api/dtcs');
      const json = await res.json();
      if (!res.ok) { toast('Foutcodes uitlezen mislukt: ' + json.error, 'error'); return; }

      // Fall back to bare codes if an older server has no descriptions
      const details = json.details || (json.codes || []).map((c) => ({
        code: c, description: 'Geen beschrijving beschikbaar', severity: 'medium', system: '',
      }));
      displayDTCs(details);

      if (details.length === 0) toast('Geen foutcodes opgeslagen', 'success');
      else toast(`${details.length} foutcode${details.length > 1 ? 's' : ''} gevonden`, 'info');
    }, 'Foutcodes uitlezen mislukt.');
  }

  // Two-step clear: the first click arms, a second within 4 s confirms
  let _clearArmed = false;
  let _clearTimer = null;

  async function clearDTCs() {
    const btn = document.getElementById('clear-dtc-btn');

    if (!_clearArmed) {
      _clearArmed = true;
      if (btn) { btn.textContent = '⚠ Bevestig?'; btn.classList.add('confirm-active'); }
      _clearTimer = setTimeout(() => {
        _clearArmed = false;
        if (btn) { btn.textContent = 'Wissen'; btn.classList.remove('confirm-active'); }
      }, 4000);
      return;
    }

    _clearArmed = false;
    clearTimeout(_clearTimer);
    if (btn) { btn.textContent = 'Wissen…'; btn.disabled = true; btn.classList.remove('confirm-active'); }

    try {
      const res  = await fetch('/api/dtcs/clear', { method: 'POST' });
      const json = await res.json();
      if (res.ok) {
        displayDTCs([]);
        toast('Foutcodes gewist. Readiness monitors staan nu op incompleet.', 'success');
      } else {
        toast('Wissen mislukt: ' + json.error, 'error');
      }
    } catch {
      toast('Server niet bereikbaar tijdens wissen.', 'error');
    } finally {
      if (btn) { btn.textContent = 'Wissen'; btn.disabled = !_connected; }
    }
  }

  // ── CSV export ────────────────────────────────────────────────────────────

  async function exportCsv() {
    await withButton('export-btn', 'Exporteren…', async () => {
      const res = await fetch('/api/session/export');
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        toast(json.error || 'Export mislukt.', 'error');
        return;
      }

      // Build the download client-side so a failed request never navigates away
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      const name = (res.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/);

      a.href     = url;
      a.download = name ? name[1] : 'obd-sessie.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      toast('CSV gedownload', 'success');
    }, 'Export mislukt.');
  }

  // ── WebSocket ─────────────────────────────────────────────────────────────

  let ws;
  let wsRetry = 0;

  function initWS() {
    const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    ws = new WebSocket(proto + location.host);

    ws.onopen = () => { wsRetry = 0; };

    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }

      switch (msg.type) {
        case 'status':
          setStatus(msg.payload.connected);
          if (!msg.payload.connected) resetAll();
          break;

        case 'data':
        case 'snapshot':
          Object.entries(msg.payload).forEach(([key, d]) => applyKey(key, d.value));
          break;

        case 'history':
          chart?.setHistory(msg.payload);
          break;

        case 'sample':
          chart?.push(msg.payload);
          break;

        case 'stats':
          updateStats(msg.payload);
          break;
      }
    };

    // Back off on repeated failures instead of hammering a dead server
    ws.onclose = () => {
      wsRetry = Math.min(wsRetry + 1, 5);
      setTimeout(initWS, 1000 * wsRetry);
    };
  }

  // ── Toasts ────────────────────────────────────────────────────────────────

  const TOAST_ICONS = { error: '✕', success: '✓', info: 'ℹ' };
  const MAX_TOASTS  = 4;

  function toast(text, kind) {
    const host = document.getElementById('toasts');
    if (!host) return;

    const type = kind || 'info';
    const el   = document.createElement('div');
    el.className = 'toast ' + type;
    el.innerHTML = `<span class="toast-icon">${TOAST_ICONS[type] || 'ℹ'}</span><span>${esc(text)}</span>`;
    host.appendChild(el);

    while (host.children.length > MAX_TOASTS) host.firstElementChild.remove();

    const ttl = type === 'error' ? 9000 : 5000;
    const kill = () => {
      el.classList.add('leaving');
      setTimeout(() => el.remove(), 250);
    };
    const timer = setTimeout(kill, ttl);
    el.addEventListener('click', () => { clearTimeout(timer); kill(); });
  }

  /** Escape text destined for innerHTML — DTC descriptions and port names. */
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  /** Run an async action with a button locked into a pending label. */
  async function withButton(id, pendingLabel, fn, failMsg) {
    const btn   = document.getElementById(id);
    const label = btn ? btn.textContent : '';
    if (btn) { btn.textContent = pendingLabel; btn.disabled = true; }
    try {
      await fn();
    } catch {
      toast(failMsg || 'Actie mislukt.', 'error');
    } finally {
      if (btn) { btn.textContent = label; btn.disabled = !_connected; }
    }
  }

  // ── Port controls ─────────────────────────────────────────────────────────

  async function scanPorts() {
    const sel = document.getElementById('port-select');
    const btn = document.getElementById('scan-btn');
    if (!sel || !btn) return;

    btn.textContent = '…';
    btn.disabled    = true;
    try {
      const json  = await (await fetch('/api/ports')).json();
      const ports = json.ports || [];

      sel.innerHTML = '<option value="">— Poort —</option>';

      // Bluetooth virtual COM ports look identical to USB ones here but have
      // no adapter behind them — label them so they aren't picked by mistake.
      const isBluetooth = (p) => /BTHENUM|BTHMODEM/i.test(p.pnpId || '');
      const sorted = ports.slice().sort((a, b) => isBluetooth(a) - isBluetooth(b));

      sorted.forEach((p) => {
        const o = document.createElement('option');
        o.value = p.path;
        const maker = p.manufacturer && p.manufacturer !== 'Microsoft' ? p.manufacturer : '';
        o.textContent = isBluetooth(p)
          ? `${p.path}  (Bluetooth — geen USB)`
          : `${p.path}${maker ? '  ' + maker : ''}  ← USB`;
        sel.appendChild(o);
      });

      // Preselect the most likely adapter: the first non-Bluetooth port
      const usb = sorted.find((p) => !isBluetooth(p));
      if (usb) sel.value = usb.path;

      if (ports.length === 0) {
        sel.innerHTML += '<option disabled>Geen poorten gevonden</option>';
        toast('Geen seriële poorten gevonden — zit de adapter in de USB-poort?', 'error');
      }
    } catch {
      toast('Kon seriële poorten niet scannen.', 'error');
    } finally {
      btn.textContent = 'Scan';
      btn.disabled    = false;
    }
  }

  async function connect() {
    const port = document.getElementById('port-select')?.value;
    const baud = document.getElementById('baud-select')?.value || 'auto';
    const btn  = document.getElementById('connect-btn');
    if (!port) { toast('Selecteer eerst een poort.', 'error'); return; }

    // 'auto' probes several baud rates server-side and can take ~30 s
    const baudRate = baud === 'auto' ? 'auto' : parseInt(baud, 10);

    if (btn) {
      btn.textContent = baud === 'auto' ? 'Zoeken…' : 'Verbinden…';
      btn.disabled    = true;
    }
    try {
      const res = await fetch('/api/connect', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ port, baudRate }),
      });
      const json = await res.json();

      if (!res.ok) toast('Verbinden mislukt — ' + json.error, 'error');
      else         toast(`Verbonden met ${port} op ${json.baudRate} baud`, 'success');
    } catch {
      toast('Serverfout — draait de server nog? (npm run dev)', 'error');
    } finally {
      // The WS status broadcast may already have disabled this; respect that
      if (btn) { btn.textContent = 'Verbind'; btn.disabled = _connected; }
    }
  }

  async function startDemo() {
    const btn = document.getElementById('demo-btn');
    if (btn) { btn.textContent = 'Starten…'; btn.disabled = true; }
    try {
      const res  = await fetch('/api/simulate', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) toast(json.error || 'Demo starten mislukt.', 'error');
      else toast('Demo-modus actief — gesimuleerde auto', 'info');
    } catch {
      toast('Serverfout bij starten demo.', 'error');
    } finally {
      if (btn) { btn.textContent = 'Demo'; btn.disabled = _connected; }
    }
  }

  async function disconnect() {
    const btn = document.getElementById('disconnect-btn');
    if (btn) { btn.textContent = 'Verbreken…'; btn.disabled = true; }
    try { await fetch('/api/disconnect', { method: 'POST' }); } catch { /* ignored */ }
    if (btn) btn.textContent = 'Verbreek';
  }

  async function resetSession() {
    try {
      await fetch('/api/session/reset', { method: 'POST' });
      chart?.clear();
      toast('Rit gereset', 'info');
    } catch {
      toast('Reset mislukt.', 'error');
    }
  }

  // ── Boot ──────────────────────────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('chart');
    if (canvas && window.OBDChart) {
      chart = new window.OBDChart(canvas, document.getElementById('chart-empty'));
      // Keep the window sliding even while no samples arrive, so the time axis
      // stays truthful and stale data visibly scrolls away.
      setInterval(() => chart.scheduleDraw(), 1000);
    }

    resetAll();
    setStatus(false);
    initWS();

    const on = (id, fn) => document.getElementById(id)?.addEventListener('click', fn);
    on('scan-btn',           scanPorts);
    on('demo-btn',           startDemo);
    on('connect-btn',        connect);
    on('disconnect-btn',     disconnect);
    on('reset-session-btn',  resetSession);
    on('read-dtc-btn',       readDTCs);
    on('clear-dtc-btn',      clearDTCs);
    on('read-monitors-btn',  readMonitors);
    on('read-odometer-btn',  readOdometer);
    on('export-btn',         exportCsv);

    scanPorts(); // pre-populate the port list on load
  });
})();
