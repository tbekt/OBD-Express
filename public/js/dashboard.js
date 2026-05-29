(function () {
  'use strict';

  // ── Config ────────────────────────────────────────────────────────────────

  const GAUGE_CFG = {
    RPM:          { min: 0,   max: 8000, label: 'RPM',         unit: 'rpm',  color: '#ff4444', redline: 0.82 },
    SPEED:        { min: 0,   max: 240,  label: 'SPEED',       unit: 'km/h', color: '#0099ff', redline: null },
    COOLANT_TEMP: { min: -40, max: 120,  label: 'COOLANT',     unit: '°C',   color: '#ff6b35' },
    ENGINE_LOAD:  { min: 0,   max: 100,  label: 'ENGINE LOAD', unit: '%',    color: '#7bed9f' },
    THROTTLE:     { min: 0,   max: 100,  label: 'THROTTLE',    unit: '%',    color: '#ffd32a' },
    FUEL_LEVEL:   { min: 0,   max: 100,  label: 'FUEL',        unit: '%',    color: '#00d2d3' },
  };

  const LARGE_GAUGES = new Set(['RPM', 'SPEED']);

  // ── Gauge animation state ─────────────────────────────────────────────────

  // Lerp factor applied every rAF frame. At 60 fps, 0.13 gives ~90 % closure
  // in ~25 frames (≈ 420 ms), producing a smooth ease-out sweep.
  const GAUGE_EASE = 0.13;
  // Stop lerping once within this many raw units of the target (avoids
  // infinite micro-nudges and lets the last frame snap cleanly).
  const GAUGE_SNAP = 0.8;

  const gaugeAnim = {};
  LARGE_GAUGES.forEach((key) => {
    gaugeAnim[key] = { val: 0, target: 0, raf: null };
  });

  // ── Metric animation state ────────────────────────────────────────────────

  const METRIC_DURATION = 280; // ms for the count-up ease-out

  const metricCurrent = {}; // key → currently displayed (interpolated) value
  const metricRaf     = {}; // key → active rAF id, or null

  // ── SVG helpers ───────────────────────────────────────────────────────────

  function pt(cx, cy, r, angleDeg) {
    const rad = (angleDeg * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  }

  // Returns an SVG arc path string (clockwise, sweep-flag=1)
  function arcPath(cx, cy, r, startDeg, sweepDeg) {
    const sweep = Math.max(0.01, Math.min(sweepDeg, 359.99));
    const s = pt(cx, cy, r, startDeg);
    const e = pt(cx, cy, r, startDeg + sweep);
    return `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${r} ${r} 0 ${sweep > 180 ? 1 : 0} 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`;
  }

  // ── Circular gauge ────────────────────────────────────────────────────────

  function drawGauge(svgEl, value, cfg) {
    // Geometry
    const cx = 130, cy = 118, r = 96;
    const START = 135, SWEEP = 270;
    const ratio = Math.min(1, Math.max(0, (value - cfg.min) / (cfg.max - cfg.min)));
    const fillSweep = ratio * SWEEP;

    // Unique IDs for SVG defs (avoid cross-gauge conflicts)
    const uid = cfg.label.replace(/\W/g, '');

    // ── Tick marks + labels ─────────────────────────────────
    const N = 10; // 10 segments → 11 tick positions
    let ticks = '';
    for (let i = 0; i <= N; i++) {
      const a     = START + (i / N) * SWEEP;
      const major = i % 2 === 0;
      const oR    = r + 5;
      const iR    = r - (major ? 17 : 8);
      const o     = pt(cx, cy, oR, a);
      const inn   = pt(cx, cy, iR, a);

      ticks += `<line x1="${o.x.toFixed(1)}" y1="${o.y.toFixed(1)}"
                      x2="${inn.x.toFixed(1)}" y2="${inn.y.toFixed(1)}"
                      stroke="${major ? '#484862' : '#26263c'}"
                      stroke-width="${major ? 2 : 1.5}" stroke-linecap="round"/>`;

      if (major) {
        const lp  = pt(cx, cy, r - 30, a);
        const raw = cfg.min + (i / N) * (cfg.max - cfg.min);
        const lbl = raw >= 1000 ? (raw / 1000).toFixed(0) + 'k' : Math.round(raw).toString();
        ticks += `<text x="${lp.x.toFixed(1)}" y="${lp.y.toFixed(1)}"
                        text-anchor="middle" dominant-baseline="central"
                        fill="#404058" font-size="9" font-family="Arial,sans-serif">${lbl}</text>`;
      }
    }

    // ── Redline zone (optional) ─────────────────────────────
    let redZone = '';
    if (cfg.redline) {
      const rlOffset = cfg.redline * SWEEP;
      redZone = `<path d="${arcPath(cx, cy, r, START + rlOffset, SWEEP - rlOffset)}"
                       fill="none" stroke="#ff111180" stroke-width="14" stroke-linecap="round"/>`;
    }

    // ── Needle ──────────────────────────────────────────────
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

      <!-- Outer decorative ring -->
      <circle cx="${cx}" cy="${cy}" r="${r + 14}" fill="none"
              stroke="#0e0e1e" stroke-width="1.5"/>

      <!-- Tick marks & labels -->
      ${ticks}

      <!-- Background track -->
      <path d="${arcPath(cx, cy, r, START, SWEEP)}"
            fill="none" stroke="#181828" stroke-width="14" stroke-linecap="round"/>

      <!-- Redline -->
      ${redZone}

      <!-- Value fill arc -->
      ${fillSweep > 0.1 ? `
      <path d="${arcPath(cx, cy, r, START, fillSweep)}"
            fill="none" stroke="${cfg.color}" stroke-width="14" stroke-linecap="round"
            filter="url(#glow${uid})"/>` : ''}

      <!-- Needle -->
      <polygon points="${tip.x.toFixed(1)},${tip.y.toFixed(1)} ${bl.x.toFixed(1)},${bl.y.toFixed(1)} ${br.x.toFixed(1)},${br.y.toFixed(1)}"
               fill="${cfg.color}" opacity="0.92"
               filter="url(#needle${uid})"/>

      <!-- Needle hub -->
      <circle cx="${cx}" cy="${cy}" r="13" fill="#0a0a18" stroke="${cfg.color}" stroke-width="2.5"/>
      <circle cx="${cx}" cy="${cy}" r="5"  fill="${cfg.color}"/>

      <!-- Readout: value -->
      <text x="${cx}" y="${cy + 38}"
            text-anchor="middle" dominant-baseline="middle"
            fill="white" font-size="34" font-weight="900"
            font-family="'Courier New',monospace">${Math.round(value)}</text>

      <!-- Readout: unit -->
      <text x="${cx}" y="${cy + 60}"
            text-anchor="middle" fill="#44446a" font-size="11"
            font-family="Arial,sans-serif">${cfg.unit}</text>

      <!-- Label -->
      <text x="${cx}" y="${cy + 92}"
            text-anchor="middle" fill="${cfg.color}" font-size="10"
            font-family="Arial,sans-serif" font-weight="700" letter-spacing="2">${cfg.label}</text>
    `;
  }

  // ── Gauge animation loop ──────────────────────────────────────────────────

  function gaugeTick(key) {
    const state = gaugeAnim[key];
    const cfg   = GAUGE_CFG[key];
    const el    = document.getElementById('gauge-' + key);
    if (!el) { state.raf = null; return; }

    const diff = state.target - state.val;

    if (Math.abs(diff) <= GAUGE_SNAP) {
      // Close enough — snap to final value and stop
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
    if (state.raf === null) {
      // Only start a new loop if one isn't already running
      state.raf = requestAnimationFrame(() => gaugeTick(key));
    }
    // If a loop is running it will naturally converge to the (already updated) target
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

    // Clear any in-flight flip timers so rapid updates don't pile up
    _odoFlipTimers.forEach(clearTimeout);
    _odoFlipTimers = [];

    chars.forEach((ch, i) => {
      const el = document.getElementById('odo-' + i);
      if (!el) return;
      if (el.textContent === ch) return; // digit unchanged — skip

      // Restart the CSS flip animation by removing then re-adding the class
      el.classList.remove('flip');
      void el.offsetWidth; // force reflow so the browser sees the class removal
      el.classList.add('flip');

      // Swap the character at the animation's visual midpoint (blank frame)
      const tSwap = setTimeout(() => {
        el.textContent = ch;
      }, 90);

      // Clean up the class after animation finishes
      const tClean = setTimeout(() => {
        el.classList.remove('flip');
      }, 200);

      _odoFlipTimers.push(tSwap, tClean);
    });
  }

  // ── Metric cards ─────────────────────────────────────────────────────────

  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

  function animateMetric(key, target, cfg) {
    const valEl = document.getElementById('val-' + key);
    const barEl = document.getElementById('bar-' + key);
    if (!valEl && !barEl) return;

    // Cancel any animation already running for this metric
    if (metricRaf[key]) {
      cancelAnimationFrame(metricRaf[key]);
      metricRaf[key] = null;
    }

    // Start from the last rendered value so re-animations don't jump
    const from    = (metricCurrent[key] !== undefined) ? metricCurrent[key] : (cfg.min || 0);
    const startTs = performance.now();

    function tick(now) {
      const elapsed  = now - startTs;
      const progress = Math.min(1, elapsed / METRIC_DURATION);
      const eased    = easeOutCubic(progress);
      const current  = from + (target - from) * eased;

      metricCurrent[key] = current;

      if (valEl) valEl.textContent = Math.round(current);
      if (barEl) {
        const ratio = Math.min(1, Math.max(0, (current - cfg.min) / (cfg.max - cfg.min)));
        barEl.style.width = (ratio * 100).toFixed(1) + '%';
      }

      if (progress < 1) {
        metricRaf[key] = requestAnimationFrame(tick);
      } else {
        metricRaf[key] = null;
      }
    }

    metricRaf[key] = requestAnimationFrame(tick);
  }

  function resetMetricCard(key) {
    if (metricRaf[key]) {
      cancelAnimationFrame(metricRaf[key]);
      metricRaf[key] = null;
    }
    metricCurrent[key] = undefined;

    const valEl = document.getElementById('val-' + key);
    const barEl = document.getElementById('bar-' + key);
    if (valEl) valEl.textContent = '—';
    if (barEl) barEl.style.width = '0%';
  }

  // ── Dispatch ──────────────────────────────────────────────────────────────

  function applyKey(key, value) {
    if (key === 'SESSION_KM') {
      updateOdometer(value);
      return;
    }
    const cfg = GAUGE_CFG[key];
    if (!cfg) return;
    if (LARGE_GAUGES.has(key)) {
      setGaugeTarget(key, value);
    } else {
      animateMetric(key, value, cfg);
    }
  }

  function resetAll() {
    // Animate large gauges back to zero
    LARGE_GAUGES.forEach((key) => {
      gaugeAnim[key].target = GAUGE_CFG[key].min;
      scheduleGaugeTick(key);
    });
    // Snap metric cards to zero immediately (no data = no count-up)
    Object.keys(GAUGE_CFG).forEach((key) => {
      if (!LARGE_GAUGES.has(key)) resetMetricCard(key);
    });
    updateOdometer(0);
  }

  // ── Status badge ──────────────────────────────────────────────────────────

  function setStatus(connected) {
    const badge    = document.getElementById('status-badge');
    const connBtn  = document.getElementById('connect-btn');
    const discBtn  = document.getElementById('disconnect-btn');
    const readBtn  = document.getElementById('read-dtc-btn');
    const clearBtn = document.getElementById('clear-dtc-btn');
    const monBtn   = document.getElementById('read-monitors-btn');
    const odoBtn   = document.getElementById('read-odometer-btn');

    if (badge) {
      badge.textContent = connected ? '● CONNECTED' : '● DISCONNECTED';
      badge.className   = 'status-badge ' + (connected ? 'connected' : 'disconnected');
    }

    if (connBtn)  connBtn.disabled  = connected;
    if (discBtn)  discBtn.disabled  = !connected;
    if (readBtn)  readBtn.disabled  = !connected;
    if (clearBtn) clearBtn.disabled = !connected;
    if (monBtn)   monBtn.disabled   = !connected;
    if (odoBtn)   odoBtn.disabled   = !connected;

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
    if (body)  body.innerHTML  = '<span class="diag-placeholder">Connect to check readiness monitors</span>';
    if (icon)  { icon.textContent = '○'; icon.className = 'diag-icon'; }
    if (badge) badge.hidden = true;
  }

  function displayMonitors(data) {
    const body  = document.getElementById('monitors-body');
    const icon  = document.getElementById('mon-icon');
    const badge = document.getElementById('mon-badge');
    if (!body) return;

    const incomplete = data.monitors.filter((m) => !m.complete);
    const allOk      = incomplete.length === 0;

    // Each chip gets a staggered animation-delay so they cascade in
    const chipsHtml = data.monitors.map((m, i) => {
      const cls = m.complete ? 'monitor-chip complete' : 'monitor-chip incomplete';
      const sym = m.complete ? '✓' : '✗';
      return `<span class="${cls}" style="animation-delay:${i * 40}ms"><span class="mon-sym">${sym}</span>${m.name}</span>`;
    }).join('');

    const summaryText = allOk
      ? `All ${data.monitors.length} monitors complete`
      : `${incomplete.length} monitor${incomplete.length > 1 ? 's' : ''} incomplete — drive cycles needed`;

    body.innerHTML = `
      <div class="monitors-grid">${chipsHtml}</div>
      <p class="mon-summary ${allOk ? 'ok' : 'warn'}">${allOk ? '✓' : '⚠'} ${summaryText}</p>
    `;

    if (icon) {
      icon.textContent = allOk ? '●' : '⚠';
      icon.className   = 'diag-icon ' + (allOk ? 'ok' : 'warn');
    }
    if (badge) {
      badge.textContent = allOk ? 'All complete' : incomplete.length + ' incomplete';
      badge.className   = 'diag-badge ' + (allOk ? 'all-complete' : 'incomplete');
      badge.hidden      = false;
    }
  }

  async function readMonitors() {
    const btn = document.getElementById('read-monitors-btn');
    if (btn) { btn.textContent = 'Reading…'; btn.disabled = true; }
    try {
      const res  = await fetch('/api/vehicle/monitors');
      const json = await res.json();
      if (!res.ok) { showError('Could not read monitors: ' + json.error); return; }
      displayMonitors(json);
    } catch {
      showError('Failed to read readiness monitors.');
    } finally {
      if (btn) { btn.textContent = '↻ Check'; btn.disabled = false; }
    }
  }

  // ── True odometer ─────────────────────────────────────────────────────────

  function resetOdometerPanel() {
    const body = document.getElementById('odometer-body');
    if (body) body.innerHTML = '<span class="diag-placeholder">Connect to read odometer</span>';
  }

  function displayOdometer(data) {
    const body = document.getElementById('odometer-body');
    if (!body) return;

    if (!data.supported || data.km === null) {
      body.innerHTML = `
        <div class="true-odo-unsupported">
          <p>Not supported by this vehicle</p>
          <small>OBD-II PID 0xA6 — typically requires 2010+ model year</small>
        </div>`;
      return;
    }

    const formatted = Math.round(data.km).toLocaleString();
    // .true-odo-wrap has fade-up animation from CSS — it fires on insertion
    body.innerHTML = `
      <div class="true-odo-wrap">
        <div class="true-odo-value">${formatted}</div>
        <div class="true-odo-unit">km</div>
        <div class="true-odo-note">via OBD-II PID 0xA6</div>
      </div>`;
  }

  async function readOdometer() {
    const btn = document.getElementById('read-odometer-btn');
    if (btn) { btn.textContent = 'Reading…'; btn.disabled = true; }
    try {
      const res  = await fetch('/api/vehicle/odometer');
      const json = await res.json();
      if (!res.ok) { showError('Could not read odometer: ' + json.error); return; }
      displayOdometer(json);
    } catch {
      showError('Failed to read odometer.');
    } finally {
      if (btn) { btn.textContent = '↻ Read'; btn.disabled = false; }
    }
  }

  // ── DTC panel ─────────────────────────────────────────────────────────────

  function resetDTCPanel() {
    const body  = document.getElementById('dtc-body');
    const icon  = document.getElementById('dtc-icon');
    const count = document.getElementById('dtc-count');
    const panel = document.getElementById('dtc-panel');
    if (body)  body.innerHTML = '<span class="dtc-placeholder">Connect to an OBD adapter to read fault codes</span>';
    if (icon)  { icon.textContent = '○'; icon.className = 'dtc-icon'; }
    if (count) count.hidden = true;
    if (panel) panel.classList.remove('has-codes');
  }

  function displayDTCs(codes) {
    const body  = document.getElementById('dtc-body');
    const icon  = document.getElementById('dtc-icon');
    const count = document.getElementById('dtc-count');
    const panel = document.getElementById('dtc-panel');
    if (!body) return;

    if (codes.length === 0) {
      body.innerHTML = '<span class="dtc-ok-msg">No fault codes detected</span>';
      if (icon)  { icon.textContent = '●'; icon.className = 'dtc-icon ok'; }
      if (count) count.hidden = true;
      if (panel) panel.classList.remove('has-codes');
    } else {
      // Each chip gets a staggered animation-delay so they cascade in one by one
      body.innerHTML = codes.map((code, i) => {
        const cls = 'dtc-chip dtc-chip-' + code[0].toLowerCase();
        return `<span class="${cls}" style="animation-delay:${i * 55}ms">${code}</span>`;
      }).join('');
      if (icon)  { icon.textContent = '⚠'; icon.className = 'dtc-icon warn'; }
      if (count) {
        count.textContent = codes.length + (codes.length === 1 ? ' fault' : ' faults');
        count.hidden = false;
      }
      if (panel) panel.classList.add('has-codes');
    }
  }

  async function readDTCs() {
    const btn = document.getElementById('read-dtc-btn');
    if (btn) { btn.textContent = 'Reading…'; btn.disabled = true; }
    try {
      const res  = await fetch('/api/dtcs');
      const json = await res.json();
      if (!res.ok) { showError('Could not read codes: ' + json.error); return; }
      displayDTCs(json.codes);
    } catch {
      showError('Failed to reach the server while reading fault codes.');
    } finally {
      if (btn) { btn.textContent = '🔍 Read Codes'; btn.disabled = false; }
    }
  }

  // Two-step clear: first click arms, second click within 4 s confirms
  let _clearArmed = false;
  let _clearTimer  = null;

  async function clearDTCs() {
    const btn = document.getElementById('clear-dtc-btn');

    if (!_clearArmed) {
      _clearArmed = true;
      if (btn) { btn.textContent = '⚠ Confirm?'; btn.classList.add('confirm-active'); }
      _clearTimer = setTimeout(() => {
        _clearArmed = false;
        if (btn) { btn.textContent = '🗑 Clear Codes'; btn.classList.remove('confirm-active'); }
      }, 4000);
      return;
    }

    // Second click — confirmed
    _clearArmed = false;
    clearTimeout(_clearTimer);
    if (btn) { btn.textContent = 'Clearing…'; btn.disabled = true; btn.classList.remove('confirm-active'); }

    try {
      const res  = await fetch('/api/dtcs/clear', { method: 'POST' });
      const json = await res.json();
      if (res.ok) {
        displayDTCs([]);
      } else {
        showError('Clear failed: ' + json.error);
      }
    } catch {
      showError('Failed to reach the server while clearing fault codes.');
    } finally {
      if (btn) { btn.textContent = '🗑 Clear Codes'; btn.disabled = false; }
    }
  }

  // ── WebSocket ─────────────────────────────────────────────────────────────

  let ws;

  function initWS() {
    ws = new WebSocket('ws://' + location.host);

    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }

      if (msg.type === 'status') {
        setStatus(msg.payload.connected);
        if (!msg.payload.connected) resetAll();
      } else if (msg.type === 'data' || msg.type === 'snapshot') {
        Object.entries(msg.payload).forEach(([key, d]) => applyKey(key, d.value));
      }
    };

    ws.onclose = () => setTimeout(initWS, 2000);
  }

  // ── Error helper ──────────────────────────────────────────────────────────

  function showError(text) {
    const el = document.getElementById('error-msg');
    if (!el) return;
    el.textContent = text;
    el.hidden = false;
    setTimeout(() => { el.hidden = true; }, 7000);
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
      sel.innerHTML = '<option value="">— Port —</option>';
      ports.forEach((p) => {
        const o = document.createElement('option');
        o.value = p.path;
        o.textContent = p.path + (p.manufacturer ? '  ' + p.manufacturer : '');
        sel.appendChild(o);
      });
      if (ports.length === 0) sel.innerHTML += '<option disabled>No ports found</option>';
    } catch {
      showError('Could not scan serial ports.');
    } finally {
      btn.textContent = 'Scan';
      btn.disabled    = false;
    }
  }

  async function connect() {
    const port = document.getElementById('port-select')?.value;
    const baud = document.getElementById('baud-select')?.value || '38400';
    const btn  = document.getElementById('connect-btn');
    if (!port) { showError('Select a port first.'); return; }

    if (btn) { btn.textContent = 'Connecting…'; btn.disabled = true; }
    try {
      const res  = await fetch('/api/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port, baudRate: parseInt(baud, 10) }),
      });
      const json = await res.json();
      if (!res.ok) {
        showError('Connection failed: ' + json.error);
        if (btn) { btn.textContent = 'Connect'; btn.disabled = false; }
      }
    } catch {
      showError('Request error — is the server running?');
      if (btn) { btn.textContent = 'Connect'; btn.disabled = false; }
    }
  }

  async function disconnect() {
    const btn = document.getElementById('disconnect-btn');
    if (btn) { btn.textContent = 'Disconnecting…'; btn.disabled = true; }
    try { await fetch('/api/disconnect', { method: 'POST' }); } catch { /* ignored */ }
  }

  async function resetSession() {
    try { await fetch('/api/session/reset', { method: 'POST' }); } catch { /* ignored */ }
  }

  // ── Boot ──────────────────────────────────────────────────────────────────

  document.addEventListener('DOMContentLoaded', () => {
    resetAll();
    setStatus(false);
    initWS();

    document.getElementById('scan-btn')?.addEventListener('click', scanPorts);
    document.getElementById('connect-btn')?.addEventListener('click', connect);
    document.getElementById('disconnect-btn')?.addEventListener('click', disconnect);
    document.getElementById('reset-session-btn')?.addEventListener('click', resetSession);
    document.getElementById('read-dtc-btn')?.addEventListener('click', readDTCs);
    document.getElementById('clear-dtc-btn')?.addEventListener('click', clearDTCs);
    document.getElementById('read-monitors-btn')?.addEventListener('click', readMonitors);
    document.getElementById('read-odometer-btn')?.addEventListener('click', readOdometer);

    scanPorts(); // pre-populate port list on load
  });
})();
