/* ══════════════════════════════════════════════════════
   Tayla Workforce — Sales Projections
   sales.js
══════════════════════════════════════════════════════ */

// salesData keyed by date: { projected, actual, target_spch, trend_mode, trend_dates }
// trend_mode: 'auto' | 'custom'
// trend_dates: array of date strings (custom mode only)
let salesData = JSON.parse(localStorage.getItem('wf_sales') || '{}');

// ── Seed 52 weeks of realistic fast food data for demo/trend engine
(function seedSalesData() {
  if (localStorage.getItem('wf_sales_seeded_v2')) return;
  const today = new Date();
  // Day-of-week base sales (0=Sun,1=Mon…6=Sat)
  const BASE = { 0:4400, 1:3100, 2:3300, 3:3500, 4:3900, 5:5200, 6:5800 };
  // Seasonal multiplier by month (0=Jan…11=Dec)
  const SEASON = [0.88,0.85,0.92,0.95,1.00,1.03,1.08,1.10,1.02,0.98,1.05,1.15];
  for (let w = 1; w <= 52; w++) {
    for (let d = 0; d < 7; d++) {
      const dt = new Date(today);
      // Align to Mon of that week
      const dow = today.getDay() || 7;
      dt.setDate(today.getDate() - (dow - 1) - (w * 7) + d);
      const key = dt.toISOString().split('T')[0];
      if (salesData[key]?.actual != null) continue;
      const base    = BASE[dt.getDay()] || 3500;
      const season  = SEASON[dt.getMonth()];
      const noise   = 1 + (Math.random() - 0.5) * 0.16;
      const actual  = Math.round(base * season * noise / 10) * 10;
      if (!salesData[key]) salesData[key] = {};
      salesData[key].actual = actual;
    }
  }
  localStorage.setItem('wf_sales', JSON.stringify(salesData));
  localStorage.setItem('wf_sales_seeded_v2', 'true');
})();

// ══════════════════════════════════════════════════════
//  SUPABASE
// ══════════════════════════════════════════════════════

async function dbLoadSalesRange(from, to) {
  if (!_businessId) return;
  const { data, error } = await _supabase
    .from('sales_data').select('*')
    .eq('business_id', _businessId)
    .gte('date', from).lte('date', to);
  if (error) { console.error('Load sales failed:', error); return; }
  (data || []).forEach(r => {
    salesData[r.date] = {
      ...salesData[r.date],
      projected:   r.projected,
      actual:      r.actual,
      target_spch: r.target_spch,
      trend_mode:  r.trend_mode,
      trend_dates: r.trend_dates ? JSON.parse(r.trend_dates) : null,
    };
  });
  localStorage.setItem('wf_sales', JSON.stringify(salesData));
}

async function dbSaveSale(date) {
  const d = salesData[date];
  if (!d || !_businessId) return;
  const { error } = await _supabase.from('sales_data').upsert({
    business_id: _businessId,
    date,
    projected:   d.projected   ?? null,
    actual:      d.actual      ?? null,
    target_spch: d.target_spch ?? null,
    trend_mode:  d.trend_mode  ?? 'auto',
    trend_dates: d.trend_dates ? JSON.stringify(d.trend_dates) : null,
  }, { onConflict: 'business_id,date' });
  if (error) console.error('Save sales failed:', error);
}

// ══════════════════════════════════════════════════════
//  TREND ENGINE
// ══════════════════════════════════════════════════════

// Returns array of { date, actual } for the same weekday over past 52 weeks
function getSameDayHistory(date) {
  const d = new Date(date);
  const result = [];
  for (let w = 1; w <= 52; w++) {
    const past = new Date(d);
    past.setDate(d.getDate() - w * 7);
    const key = past.toISOString().split('T')[0];
    const val = salesData[key]?.actual;
    if (val != null && val > 0) result.push({ date: key, actual: val, weeksAgo: w });
  }
  return result; // most recent first
}

// Weighted average of actuals — weight = (maxW - weeksAgo + 1) so recent = higher weight
function weightedAvg(items) {
  if (!items.length) return null;
  const maxW = Math.max(...items.map(i => i.weeksAgo));
  let sumW = 0, sumV = 0;
  items.forEach(i => {
    const w = maxW - i.weeksAgo + 1;
    sumW += w; sumV += i.actual * w;
  });
  return Math.round(sumV / sumW / 10) * 10;
}

function getTrend(date) {
  const sd = salesData[date] || {};
  const history = getSameDayHistory(date);
  if (!history.length) return null;

  if (sd.trend_mode === 'custom' && sd.trend_dates?.length) {
    const subset = history.filter(h => sd.trend_dates.includes(h.date));
    if (subset.length) return weightedAvg(subset);
  }

  return weightedAvg(history);
}

// ══════════════════════════════════════════════════════
//  SPCH HELPERS
// ══════════════════════════════════════════════════════

function getDayCrewHours(date) {
  return shifts
    .filter(s => s.date === date && s.status !== 'cancelled')
    .reduce((sum, s) => {
      const emp = employees.find(e => e.id === s.employee_id);
      return emp ? sum + calcShiftPay(s, emp).workedHours : sum;
    }, 0);
}

function getDayLabourCost(date) {
  return shifts
    .filter(s => s.date === date && s.status !== 'cancelled')
    .reduce((sum, s) => {
      const emp = employees.find(e => e.id === s.employee_id);
      return emp ? sum + calcShiftPay(s, emp).totalPay : sum;
    }, 0);
}

function calcSpch(sales, crewHours) {
  if (!crewHours || !sales) return null;
  return +(sales / crewHours).toFixed(2);
}

function spchColour(spch, target) {
  if (!spch || !target) return 'var(--text2)';
  if (spch >= target)          return 'var(--success)';
  if (spch >= target * 0.85)   return 'var(--warning)';
  return 'var(--danger)';
}

// ══════════════════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════════════════

let _salesWeekStart   = getWeekStart(new Date().toISOString().split('T')[0]);
let _trendPickerDate  = null; // which date has the picker open
let _historyOpen      = false;

function salesWeekNav(dir) {
  const d = new Date(_salesWeekStart);
  d.setDate(d.getDate() + dir * 7);
  _salesWeekStart = d.toISOString().split('T')[0];
  _trendPickerDate = null;
  renderSales();
}

function goToCurrentSalesWeek() {
  _salesWeekStart = getWeekStart(new Date().toISOString().split('T')[0]);
  _trendPickerDate = null;
  renderSales();
}

// ══════════════════════════════════════════════════════
//  MAIN RENDER
// ══════════════════════════════════════════════════════

function renderSales() {
  const weekDates = getWeekDates(_salesWeekStart);
  const weekEnd   = weekDates[6];

  const label = document.getElementById('sales-week-label');
  if (label) {
    const s = new Date(_salesWeekStart), e = new Date(weekEnd);
    label.textContent = `${s.toLocaleDateString('en-AU',{day:'numeric',month:'short'})} — ${e.toLocaleDateString('en-AU',{day:'numeric',month:'short',year:'numeric'})}`;
  }

  // Load this week + 52 weeks of history in one hit
  const histStart = (() => {
    const d = new Date(_salesWeekStart);
    d.setDate(d.getDate() - 365);
    return d.toISOString().split('T')[0];
  })();

  dbLoadSalesRange(histStart, weekEnd).then(() => {
    renderSalesKPIs(weekDates);
    renderSalesCards(weekDates);
    if (_historyOpen) renderHistoryTable();
  });
}

// ══════════════════════════════════════════════════════
//  KPIs
// ══════════════════════════════════════════════════════

function renderSalesKPIs(weekDates) {
  const el = document.getElementById('sales-kpis');
  if (!el) return;
  const today = new Date().toISOString().split('T')[0];
  let totProj=0, totActual=0, totHours=0, totCost=0;
  weekDates.forEach(date => {
    const sd    = salesData[date] || {};
    const trend = getTrend(date);
    const proj  = sd.projected ?? trend ?? 0;
    totProj   += proj || 0;
    totActual += sd.actual || 0;
    totHours  += getDayCrewHours(date);
    totCost   += getDayLabourCost(date);
  });
  const weekSpch    = calcSpch(totProj, totHours);
  const labourPct   = totProj && totCost ? ((totCost / totProj) * 100).toFixed(1) : null;
  const isPastWeek  = weekDates[6] < today;
  const variance    = totActual && totProj ? (((totActual - totProj) / totProj) * 100).toFixed(1) : null;

  el.innerHTML = `
    <div class="kpi"><div class="kpi-label">Projected Revenue</div><div class="kpi-value">${fmt(totProj)}</div></div>
    ${totActual ? `<div class="kpi"><div class="kpi-label">Actual Revenue</div><div class="kpi-value positive">${fmt(totActual)}</div></div>` : ''}
    ${variance  ? `<div class="kpi"><div class="kpi-label">Variance</div><div class="kpi-value" style="color:${parseFloat(variance)>=0?'var(--success)':'var(--danger)'};">${parseFloat(variance)>=0?'+':''}${variance}%</div></div>` : ''}
    <div class="kpi"><div class="kpi-label">Rostered Hours</div><div class="kpi-value">${totHours.toFixed(1)}h</div></div>
    <div class="kpi"><div class="kpi-label">Week SPCH</div><div class="kpi-value" style="color:var(--text2);">${weekSpch?'$'+weekSpch:'—'}</div></div>
    ${labourPct ? `<div class="kpi"><div class="kpi-label">Labour %</div><div class="kpi-value" style="color:${parseFloat(labourPct)<32?'var(--success)':'var(--warning)'};">${labourPct}%</div></div>` : ''}
  `;
}

// ══════════════════════════════════════════════════════
//  DAY CARDS
// ══════════════════════════════════════════════════════

const DAY_NAMES = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

function renderSalesCards(weekDates) {
  const container = document.getElementById('sales-grid');
  if (!container) return;
  const today = new Date().toISOString().split('T')[0];

  container.innerHTML = weekDates.map((date, i) => buildSalesCard(date, i, today)).join('');
}

function buildSalesCard(date, dayIdx, today) {
  const sd         = salesData[date] || {};
  const trend      = getTrend(date);
  const proj       = sd.projected;         // null if not manually set
  const actual     = sd.actual ?? null;
  const target     = sd.target_spch ?? null;
  const crewHours  = getDayCrewHours(date);
  const labourCost = getDayLabourCost(date);
  const isToday    = date === today;
  const isPast     = date < today;
  const isPH       = isPublicHoliday(date);
  const d          = new Date(date);
  const isCustom   = sd.trend_mode === 'custom' && sd.trend_dates?.length;
  const pickerOpen = _trendPickerDate === date;

  // What to use as the "effective projection" for SPCH calc
  const effectiveProj = proj ?? trend ?? null;
  const spch          = calcSpch(effectiveProj, crewHours);
  const spchCol       = spchColour(spch, target);
  const labourPct     = effectiveProj && labourCost ? ((labourCost / effectiveProj) * 100).toFixed(1) : null;

  // Sparkline data — last 8 same-weekday actuals
  const history = getSameDayHistory(date).slice(0, 8).reverse();
  const sparkline = buildSparkline(history, proj, trend);

  // Trend mode button label
  const trendLabel = isCustom
    ? `Custom (${sd.trend_dates.length} date${sd.trend_dates.length>1?'s':''})`
    : 'Auto (52wk weighted)';

  return `
    <div class="sales-day-card ${isToday?'today':''} ${isPast&&!isToday?'past':''}" data-date="${date}" id="scard-${date}">

      <!-- Card header -->
      <div class="sales-day-header">
        <div>
          <div class="sales-day-name" style="${isToday?'color:var(--accent2);':''}">${DAY_NAMES[dayIdx]}</div>
          <div style="font-size:11px;color:var(--text3);">${d.getDate()} ${d.toLocaleDateString('en-AU',{month:'short'})}${isPH?' 🎉':''}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;">SPCH</div>
          <div style="font-weight:700;font-size:20px;color:${spchCol};line-height:1;">${spch?'$'+spch:'—'}</div>
          ${spch && target ? `<div style="font-size:10px;color:${spchCol};">${spch>=target?'▲':'▼'} vs $${target} target</div>` : ''}
        </div>
      </div>

      <!-- Sparkline -->
      ${sparkline}

      <!-- Fields -->
      <div class="sales-fields">

        <!-- AUTO TREND — read-only display -->
        <div class="sales-field-row">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;">
            <label>Auto Trend</label>
            <button class="trend-source-btn ${isCustom?'custom':''}" style="padding:3px 10px;font-size:10px;" onclick="toggleTrendPicker('${date}')">
              ${isCustom?'⚙ Custom':'📈 52wk'} ${pickerOpen?'▴':'▾'}
            </button>
          </div>
          <div class="trend-readonly-display ${trend?'has-trend':'no-trend'}">
            ${trend
              ? `<span class="trend-readonly-value">${fmt(trend)}</span><span class="trend-readonly-label">weighted avg · ${getSameDayHistory(date).length}wk data</span>`
              : `<span class="trend-readonly-label" style="color:var(--text3);">No historical data yet — enter actuals to build trend</span>`
            }
          </div>
        </div>

        <!-- MANUAL PROJECTION — always a separate input -->
        <div class="sales-field-row">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <label>Manual Projection</label>
            ${proj!=null && trend ? `<span style="font-size:10px;color:${proj>trend?'var(--success)':'var(--danger)'};">${proj>trend?'▲':'▼'} ${Math.abs(((proj-trend)/trend)*100).toFixed(0)}% vs trend</span>` : ''}
          </div>
          <div style="position:relative;">
            <span class="field-prefix">$</span>
            <input type="number" class="sales-input ${proj!=null?'has-override':''}"
              placeholder="${trend ? `Leave blank to use trend (${fmt(trend)})` : 'Enter projected sales'}"
              value="${proj??''}" min="0" step="10"
              onchange="updateSales('${date}','projected',this.value)"
              oninput="liveSpchUpdate('${date}')">
          </div>
        </div>

        <!-- USING indicator -->
        <div id="using-indicator-${date}" class="using-indicator">
          ${proj!=null
            ? `<span class="using-pill using-manual">Using: Manual ${fmt(proj)}</span>`
            : trend
              ? `<span class="using-pill using-trend">Using: Trend ${fmt(trend)}</span>`
              : `<span class="using-pill using-none">No projection — enter a manual figure above</span>`
          }
        </div>

        <!-- Actual -->
        <div class="sales-field-row">
          <label>Actual Sales${!isPast?' <span style="color:var(--text3);font-weight:400;font-size:10px;">(if known)</span>':''}</label>
          <div style="position:relative;">
            <span class="field-prefix">$</span>
            <input type="number" class="sales-input ${actual!=null&&isPast?'actual-highlight':''}"
              placeholder="0" value="${actual??''}" min="0" step="10"
              onchange="updateSales('${date}','actual',this.value)"
              oninput="liveSpchUpdate('${date}')">
          </div>
          ${actual!=null && effectiveProj ? `<div style="font-size:10px;margin-top:3px;color:${actual>=effectiveProj?'var(--success)':'var(--danger)'};">${actual>=effectiveProj?'▲':'▼'} ${Math.abs(((actual-effectiveProj)/effectiveProj)*100).toFixed(1)}% vs projection</div>` : ''}
        </div>

        <!-- Target SPCH -->
        <div class="sales-field-row">
          <label>Target SPCH <span style="font-size:10px;color:var(--text3);font-weight:400;">$/crew hr</span></label>
          <div style="position:relative;">
            <span class="field-prefix">$</span>
            <input type="number" class="sales-input spch-target-input"
              placeholder="e.g. 100" value="${target??''}" min="0" step="5"
              onchange="updateSales('${date}','target_spch',this.value)"
              oninput="liveSpchUpdate('${date}')">
          </div>
        </div>
      </div>

      <!-- Trend date picker (inline, only for this card) -->
      ${pickerOpen ? buildTrendPicker(date) : ''}

      <!-- Footer stats -->
      <div class="sales-day-footer" id="sfooter-${date}">
        ${buildSalesFooter(crewHours, labourCost, effectiveProj, target, labourPct)}
      </div>
    </div>
  `;
}

function buildSparkline(history, proj, trend) {
  if (!history.length) return '';
  const vals   = history.map(h => h.actual);
  const maxV   = Math.max(...vals, proj||0, trend||0);
  const minV   = Math.min(...vals) * 0.85;
  const range  = maxV - minV || 1;
  const W = 180, H = 36, pad = 4;
  const pts = vals.map((v, i) => {
    const x = pad + (i / Math.max(vals.length-1,1)) * (W - pad*2);
    const y = H - pad - ((v - minV) / range) * (H - pad*2);
    return `${x},${y}`;
  });

  // Trend line (flat)
  const tY = trend ? H - pad - ((trend - minV) / range) * (H - pad*2) : null;
  const pY = proj  ? H - pad - ((proj  - minV) / range) * (H - pad*2) : null;

  return `
    <div style="padding:0 14px 6px;position:relative;">
      <svg width="100%" viewBox="0 0 ${W} ${H}" style="display:block;overflow:visible;">
        <!-- Area fill -->
        <defs>
          <linearGradient id="sg-${history[0]?.date}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="var(--accent3)" stop-opacity=".25"/>
            <stop offset="100%" stop-color="var(--accent3)" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <polygon points="${pts.join(' ')} ${W-pad},${H} ${pad},${H}" fill="url(#sg-${history[0]?.date})"/>
        <!-- Line -->
        <polyline points="${pts.join(' ')}" fill="none" stroke="var(--accent3)" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
        <!-- Dots -->
        ${vals.map((v,i) => { const [x,y] = pts[i].split(','); return `<circle cx="${x}" cy="${y}" r="2" fill="var(--accent3)"/>`; }).join('')}
        <!-- Trend ref line -->
        ${tY !== null ? `<line x1="${pad}" y1="${tY}" x2="${W-pad}" y2="${tY}" stroke="var(--warning)" stroke-width="1" stroke-dasharray="3,3" opacity=".7"/>` : ''}
        ${pY !== null && proj !== trend ? `<line x1="${pad}" y1="${pY}" x2="${W-pad}" y2="${pY}" stroke="var(--success)" stroke-width="1" stroke-dasharray="3,3" opacity=".7"/>` : ''}
      </svg>
      <div style="display:flex;justify-content:space-between;font-size:9px;color:var(--text3);margin-top:-2px;">
        <span>${history[0]?.date ? new Date(history[0].date).toLocaleDateString('en-AU',{day:'numeric',month:'short'}) : ''}</span>
        <span style="color:var(--accent3);">▲ last ${history.length}wk</span>
        <span>${history.at(-1)?.date ? new Date(history.at(-1).date).toLocaleDateString('en-AU',{day:'numeric',month:'short'}) : ''}</span>
      </div>
    </div>
  `;
}

function buildSalesFooter(crewHours, labourCost, proj, target, labourPct) {
  const spch    = calcSpch(proj, crewHours);
  const spchCol = spchColour(spch, target);
  return `
    <div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;flex-wrap:wrap;gap:4px;">
      <span style="color:var(--text3);">👥 ${crewHours.toFixed(1)}h crew</span>
      ${labourCost ? `<span style="color:var(--text3);">💰 ${fmt(labourCost)}</span>` : ''}
      ${labourPct  ? `<span style="font-weight:600;color:${parseFloat(labourPct)<32?'var(--success)':'var(--warning)'};">${labourPct}% labour</span>` : ''}
      ${spch       ? `<span style="font-weight:600;color:${spchCol};">$${spch}/h</span>` : ''}
    </div>
  `;
}

// ══════════════════════════════════════════════════════
//  TREND DATE PICKER
// ══════════════════════════════════════════════════════

function buildTrendPicker(date) {
  const history  = getSameDayHistory(date);
  const sd       = salesData[date] || {};
  const selected = new Set(sd.trend_dates || []);
  const trend    = getTrend(date);

  if (!history.length) return `<div class="trend-picker"><div style="color:var(--text3);font-size:12px;">No historical data yet. Data builds up over time.</div></div>`;

  return `
    <div class="trend-picker">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
        <div style="font-size:12px;font-weight:600;">Select dates to include in trend</div>
        <div style="display:flex;gap:6px;">
          <button class="btn btn-ghost btn-sm" onclick="setTrendMode('${date}','auto')">Reset to Auto</button>
          <button class="btn btn-ghost btn-sm" onclick="selectAllTrend('${date}')">All</button>
          <button class="btn btn-ghost btn-sm" onclick="selectNoneTrend('${date}')">None</button>
        </div>
      </div>
      <div class="trend-date-list">
        ${history.map(h => {
          const checked = sd.trend_mode !== 'custom' || selected.has(h.date);
          const d = new Date(h.date);
          const label = d.toLocaleDateString('en-AU',{day:'numeric',month:'short',year:'numeric'});
          return `
            <label class="trend-date-row ${checked?'checked':''}">
              <input type="checkbox" ${checked?'checked':''} onchange="toggleTrendDate('${date}','${h.date}',this.checked)" style="width:auto;margin:0;">
              <span class="trend-date-label">${label}</span>
              <span class="trend-date-val">${fmt(h.actual)}</span>
              <span style="font-size:10px;color:var(--text3);">${h.weeksAgo}wk ago</span>
            </label>
          `;
        }).join('')}
      </div>
      <div style="margin-top:10px;font-size:11px;color:var(--text3);">
        ${selected.size || sd.trend_mode !== 'custom' ? `Trend from selected: <strong>${fmt(trend??0)}</strong>` : 'Select at least one date'}
      </div>
    </div>
  `;
}

function toggleTrendPicker(date) {
  _trendPickerDate = _trendPickerDate === date ? null : date;
  const weekDates = getWeekDates(_salesWeekStart);
  const today     = new Date().toISOString().split('T')[0];
  const i = weekDates.indexOf(date);
  const card = document.getElementById(`scard-${date}`);
  if (card) card.outerHTML = buildSalesCard(date, i, today);
}

function toggleTrendDate(date, histDate, checked) {
  if (!salesData[date]) salesData[date] = {};
  const sd = salesData[date];
  if (sd.trend_mode !== 'custom') {
    // Switch to custom, pre-select all except this one if unchecking
    const all = getSameDayHistory(date).map(h => h.date);
    sd.trend_mode  = 'custom';
    sd.trend_dates = checked ? [...all] : all.filter(d => d !== histDate);
  } else {
    sd.trend_dates = sd.trend_dates || [];
    if (checked) { if (!sd.trend_dates.includes(histDate)) sd.trend_dates.push(histDate); }
    else         { sd.trend_dates = sd.trend_dates.filter(d => d !== histDate); }
  }
  localStorage.setItem('wf_sales', JSON.stringify(salesData));
  dbSaveSale(date);
  // Refresh picker section only
  const pickerEl = document.querySelector(`#scard-${date} .trend-picker`);
  if (pickerEl) pickerEl.outerHTML = buildTrendPicker(date);
  liveSpchUpdate(date);
}

function setTrendMode(date, mode) {
  if (!salesData[date]) salesData[date] = {};
  salesData[date].trend_mode  = mode;
  salesData[date].trend_dates = null;
  localStorage.setItem('wf_sales', JSON.stringify(salesData));
  dbSaveSale(date);
  _trendPickerDate = null;
  const weekDates = getWeekDates(_salesWeekStart);
  const today = new Date().toISOString().split('T')[0];
  const i = weekDates.indexOf(date);
  const card = document.getElementById(`scard-${date}`);
  if (card) card.outerHTML = buildSalesCard(date, i, today);
}

function selectAllTrend(date) {
  if (!salesData[date]) salesData[date] = {};
  salesData[date].trend_mode  = 'custom';
  salesData[date].trend_dates = getSameDayHistory(date).map(h => h.date);
  localStorage.setItem('wf_sales', JSON.stringify(salesData));
  dbSaveSale(date);
  const pickerEl = document.querySelector(`#scard-${date} .trend-picker`);
  if (pickerEl) pickerEl.outerHTML = buildTrendPicker(date);
  liveSpchUpdate(date);
}

function selectNoneTrend(date) {
  if (!salesData[date]) salesData[date] = {};
  salesData[date].trend_mode  = 'custom';
  salesData[date].trend_dates = [];
  localStorage.setItem('wf_sales', JSON.stringify(salesData));
  dbSaveSale(date);
  const pickerEl = document.querySelector(`#scard-${date} .trend-picker`);
  if (pickerEl) pickerEl.outerHTML = buildTrendPicker(date);
  liveSpchUpdate(date);
}

// ══════════════════════════════════════════════════════
//  LIVE UPDATE (no re-render)
// ══════════════════════════════════════════════════════

function liveSpchUpdate(date) {
  const card = document.getElementById(`scard-${date}`);
  if (!card) return;
  const projInput   = card.querySelector('input[onchange*="projected"]');
  const targetInput = card.querySelector('input[onchange*="target_spch"]');
  const proj   = parseFloat(projInput?.value)   || null;
  const target = parseFloat(targetInput?.value) || null;
  const crewHours  = getDayCrewHours(date);
  const labourCost = getDayLabourCost(date);
  const trend      = getTrend(date);
  const effProj    = proj ?? trend;
  const spch       = calcSpch(effProj, crewHours);
  const spchCol    = spchColour(spch, target);
  const labourPct  = effProj && labourCost ? ((labourCost/effProj)*100).toFixed(1) : null;

  // Header SPCH
  const hdrRight = card.querySelector('.sales-day-header > div:last-child');
  if (hdrRight) hdrRight.innerHTML = `
    <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;">SPCH</div>
    <div style="font-weight:700;font-size:20px;color:${spchCol};line-height:1;">${spch?'$'+spch:'—'}</div>
    ${spch&&target?`<div style="font-size:10px;color:${spchCol};">${spch>=target?'▲':'▼'} vs $${target} target</div>`:''}
  `;

  // Using indicator
  const usingEl = document.getElementById(`using-indicator-${date}`);
  if (usingEl) usingEl.innerHTML = proj!=null
    ? `<span class="using-pill using-manual">Using: Manual ${fmt(proj)}</span>`
    : trend
      ? `<span class="using-pill using-trend">Using: Trend ${fmt(trend)}</span>`
      : `<span class="using-pill using-none">No projection — enter a manual figure above</span>`;

  // Footer
  const footer = document.getElementById(`sfooter-${date}`);
  if (footer) footer.innerHTML = buildSalesFooter(crewHours, labourCost, effProj, target, labourPct);
}

// ══════════════════════════════════════════════════════
//  SAVE
// ══════════════════════════════════════════════════════

async function updateSales(date, field, value) {
  if (!salesData[date]) salesData[date] = {};
  salesData[date][field] = value === '' ? null : parseFloat(value) || null;
  localStorage.setItem('wf_sales', JSON.stringify(salesData));
  await dbSaveSale(date);
  refreshRosterDaySpch(date);
  // Refresh KPIs
  renderSalesKPIs(getWeekDates(_salesWeekStart));
}

// ══════════════════════════════════════════════════════
//  HISTORY TABLE
// ══════════════════════════════════════════════════════

function toggleHistory() {
  _historyOpen = !_historyOpen;
  const btn = document.getElementById('history-toggle-btn');
  if (btn) btn.textContent = _historyOpen ? '▴ Hide History' : '▾ Show 52-Week History';
  renderHistoryTable();
}

function renderHistoryTable() {
  const el = document.getElementById('sales-history');
  if (!el) return;
  if (!_historyOpen) { el.innerHTML = ''; return; }

  const today = new Date().toISOString().split('T')[0];
  const rows  = [];

  for (let w = 1; w <= 52; w++) {
    const d = new Date(_salesWeekStart);
    d.setDate(d.getDate() - w * 7);
    const weekStart = getWeekStart(d.toISOString().split('T')[0]);
    const weekDates = getWeekDates(weekStart);
    const weekActuals = weekDates.map(date => salesData[date]?.actual ?? null);
    const weekProj    = weekDates.map(date => salesData[date]?.projected ?? null);
    const totActual   = weekActuals.reduce((s,v) => s + (v||0), 0);
    if (!totActual && weekActuals.every(v => v===null)) continue; // skip empty weeks
    rows.push({ weekStart, weekDates, weekActuals, weekProj, totActual });
  }

  if (!rows.length) {
    el.innerHTML = `<div style="padding:24px;text-align:center;color:var(--text3);">No historical data yet.</div>`;
    return;
  }

  el.innerHTML = `
    <div class="table-wrap" style="margin-top:0;">
      <table>
        <thead>
          <tr>
            <th>Week of</th>
            <th>Mon</th><th>Tue</th><th>Wed</th><th>Thu</th><th>Fri</th><th>Sat</th><th>Sun</th>
            <th>Week Total</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(({ weekStart, weekDates, weekActuals, weekProj, totActual }) => {
            const ws = new Date(weekStart);
            return `
              <tr ${weekStart === _salesWeekStart ? 'style="background:rgba(232,197,71,.08);font-weight:600;"' : ''}>
                <td style="font-size:12px;white-space:nowrap;">${ws.toLocaleDateString('en-AU',{day:'numeric',month:'short',year:'numeric'})}</td>
                ${weekDates.map((date, i) => {
                  const actual  = weekActuals[i];
                  const proj    = weekProj[i];
                  const isPH    = isPublicHoliday(date);
                  const isFut   = date > today;
                  return `<td class="mono" style="font-size:11px;${isPH?'background:rgba(229,62,62,.06);':''}${isFut?'color:var(--text3);':''}">
                    ${actual != null ? fmt(actual) : (proj!=null?`<span style="color:var(--text3);">${fmt(proj)}</span>` : '<span style="color:var(--border);">—</span>')}
                  </td>`;
                }).join('')}
                <td class="mono" style="font-weight:700;font-size:12px;">${totActual ? fmt(totActual) : '—'}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// ══════════════════════════════════════════════════════
//  ROSTER INTEGRATION
// ══════════════════════════════════════════════════════

function getSalesSummary(date) {
  const sd    = salesData[date] || {};
  const trend = getTrend(date);
  const proj  = sd.projected ?? trend ?? null;
  return { proj, actual: sd.actual ?? null, target: sd.target_spch ?? null, trend };
}
