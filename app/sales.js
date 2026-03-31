/* ══════════════════════════════════════════════════════
   Tayla Workforce — Sales Projections
   sales.js
══════════════════════════════════════════════════════ */

// salesData keyed by date: { projected, actual, target_spch, notes }
let salesData = JSON.parse(localStorage.getItem('wf_sales') || '{}');

// ── Seed random historical data (8 weeks back) for trend engine
(function seedSalesData() {
  const today = new Date();
  const BASE = { 1:3200, 2:3500, 3:3400, 4:3800, 5:4800, 6:5600, 0:4200 }; // Mon=1..Sun=0
  const seeded = JSON.parse(localStorage.getItem('wf_sales_seeded') || 'false');
  if (seeded) return;
  for (let w = 1; w <= 8; w++) {
    for (let d = 0; d < 7; d++) {
      const dt = new Date(today);
      dt.setDate(today.getDate() - w * 7 + d - today.getDay() + 1);
      const key = dt.toISOString().split('T')[0];
      if (salesData[key]) continue;
      const base = BASE[dt.getDay()] || 3500;
      const variance = (Math.random() - 0.5) * 0.18;
      const actual = Math.round(base * (1 + variance) / 10) * 10;
      salesData[key] = { actual, projected: null, target_spch: null };
    }
  }
  localStorage.setItem('wf_sales', JSON.stringify(salesData));
  localStorage.setItem('wf_sales_seeded', 'true');
})();

// ══════════════════════════════════════════════════════
//  SUPABASE
// ══════════════════════════════════════════════════════

async function dbLoadSales(weekStart, weekEnd) {
  if (!_businessId) return;
  const { data, error } = await _supabase
    .from('sales_data').select('*')
    .eq('business_id', _businessId)
    .gte('date', weekStart).lte('date', weekEnd);
  if (error) { console.error('Load sales failed:', error); return; }
  (data || []).forEach(r => { salesData[r.date] = { projected: r.projected, actual: r.actual, target_spch: r.target_spch, notes: r.notes }; });
  localStorage.setItem('wf_sales', JSON.stringify(salesData));
}

async function dbSaveSale(date) {
  const d = salesData[date];
  if (!d || !_businessId) return;
  const { error } = await _supabase.from('sales_data').upsert(
    { business_id: _businessId, date, ...d }, { onConflict: 'business_id,date' }
  );
  if (error) console.error('Save sales failed:', error);
}

// ══════════════════════════════════════════════════════
//  TREND ENGINE
// ══════════════════════════════════════════════════════

function getTrend(date) {
  // Collect actuals for same weekday over past 8 weeks
  const d = new Date(date);
  const actuals = [];
  for (let w = 1; w <= 8; w++) {
    const past = new Date(d);
    past.setDate(d.getDate() - w * 7);
    const key = past.toISOString().split('T')[0];
    const val = salesData[key]?.actual;
    if (val != null && val > 0) actuals.push(val);
  }
  if (!actuals.length) return null;
  // Weighted average — more recent weeks weighted higher
  const weights = actuals.map((_, i) => actuals.length - i);
  const sum = actuals.reduce((s, v, i) => s + v * weights[i], 0);
  const wsum = weights.reduce((s, w) => s + w, 0);
  return Math.round(sum / wsum / 10) * 10;
}

// ══════════════════════════════════════════════════════
//  SPCH HELPERS
// ══════════════════════════════════════════════════════

function getDayCrewHours(date) {
  const dayShifts = shifts.filter(s => s.date === date && s.status !== 'cancelled');
  return dayShifts.reduce((sum, s) => {
    const emp = employees.find(e => e.id === s.employee_id);
    if (!emp) return sum;
    const pay = calcShiftPay(s, emp);
    return sum + pay.workedHours;
  }, 0);
}

function calcSpch(sales, crewHours) {
  if (!crewHours || !sales) return null;
  return +(sales / crewHours).toFixed(2);
}

function spchColour(spch, target) {
  if (!spch || !target) return 'var(--text2)';
  if (spch >= target) return 'var(--success)';
  if (spch >= target * 0.85) return 'var(--warning)';
  return 'var(--danger)';
}

// ══════════════════════════════════════════════════════
//  RENDER
// ══════════════════════════════════════════════════════

let _salesWeekStart = getWeekStart(new Date().toISOString().split('T')[0]);

function salesWeekNav(dir) {
  const d = new Date(_salesWeekStart);
  d.setDate(d.getDate() + dir * 7);
  _salesWeekStart = d.toISOString().split('T')[0];
  renderSales();
}

function renderSales() {
  const weekDates = getWeekDates(_salesWeekStart);
  const weekEnd   = weekDates[6];
  const label     = document.getElementById('sales-week-label');
  if (label) {
    const s = new Date(_salesWeekStart), e = new Date(weekEnd);
    label.textContent = `${s.toLocaleDateString('en-AU',{day:'numeric',month:'short'})} — ${e.toLocaleDateString('en-AU',{day:'numeric',month:'short',year:'numeric'})}`;
  }
  dbLoadSales(_salesWeekStart, weekEnd).then(() => renderSalesGrid(weekDates));
}

function renderSalesGrid(weekDates) {
  const container = document.getElementById('sales-grid');
  if (!container) return;

  const DAY_NAMES = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const today = new Date().toISOString().split('T')[0];

  // KPI totals
  let totProj=0, totActual=0, totHours=0;
  weekDates.forEach(date => {
    const sd = salesData[date] || {};
    const trend = getTrend(date);
    const proj = sd.projected ?? trend ?? 0;
    const actual = sd.actual ?? 0;
    const hours = getDayCrewHours(date);
    if (proj) totProj += proj;
    if (actual) totActual += actual;
    totHours += hours;
  });
  const weekSpch = calcSpch(totProj, totHours);

  document.getElementById('sales-kpis').innerHTML = `
    <div class="kpi"><div class="kpi-label">Projected Revenue</div><div class="kpi-value">${fmt(totProj)}</div></div>
    <div class="kpi"><div class="kpi-label">Actual (YTD week)</div><div class="kpi-value positive">${fmt(totActual)}</div></div>
    <div class="kpi"><div class="kpi-label">Rostered Hours</div><div class="kpi-value">${totHours.toFixed(1)}h</div></div>
    <div class="kpi"><div class="kpi-label">Week SPCH</div><div class="kpi-value" style="color:${spchColour(weekSpch, 100)};">${weekSpch ? '$'+weekSpch : '—'}</div></div>
  `;

  container.innerHTML = weekDates.map((date, i) => {
    const sd = salesData[date] || {};
    const trend = getTrend(date);
    const proj = sd.projected ?? trend ?? '';
    const actual = sd.actual ?? '';
    const target = sd.target_spch ?? '';
    const crewHours = getDayCrewHours(date);
    const spch = calcSpch(proj || trend, crewHours);
    const isToday = date === today;
    const isPast  = date < today;
    const isPH    = isPublicHoliday(date);
    const d = new Date(date);

    const spchVal = spch ? `<span style="color:${spchColour(spch, target || 100)};font-weight:700;font-size:18px;">$${spch}</span>` : '<span style="color:var(--text3);">—</span>';
    const vsTarget = (spch && target) ? `<span style="font-size:11px;color:${spchColour(spch,target)};">${spch>=target?'▲':'▼'} vs $${target} target</span>` : '';

    return `
      <div class="sales-day-card ${isToday?'today':''} ${isPast&&!isToday?'past':''}" data-date="${date}">
        <div class="sales-day-header">
          <div>
            <div style="font-weight:700;font-size:14px;color:${isToday?'var(--accent2)':'var(--text)'};">${DAY_NAMES[i]}</div>
            <div style="font-size:11px;color:var(--text3);">${d.getDate()}/${d.getMonth()+1}${isPH?' 🎉':''}</div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;">SPCH</div>
            ${spchVal}
            ${vsTarget}
          </div>
        </div>

        <div class="sales-fields">
          <div class="sales-field-row">
            <label>Projected Sales</label>
            <div style="position:relative;">
              <span class="field-prefix">$</span>
              <input type="number" class="sales-input" placeholder="${trend?trend:'Enter amount'}"
                value="${proj}" min="0" step="10"
                onchange="updateSales('${date}','projected',this.value)"
                oninput="liveUpdateSpch('${date}')">
              ${trend && !sd.projected ? `<div class="trend-badge">Trend: $${trend}</div>` : ''}
            </div>
          </div>
          <div class="sales-field-row">
            <label>Actual Sales ${isPast?'':'<span style="color:var(--text3);font-weight:400;">(if known)</span>'}</label>
            <div style="position:relative;"><span class="field-prefix">$</span>
              <input type="number" class="sales-input ${isPast?'actual-highlight':''}" placeholder="0"
                value="${actual}" min="0" step="10"
                onchange="updateSales('${date}','actual',this.value)"
                oninput="liveUpdateSpch('${date}')">
            </div>
          </div>
          <div class="sales-field-row">
            <label>Target SPCH <span style="color:var(--text3);font-weight:400;">$/crew hour</span></label>
            <div style="position:relative;"><span class="field-prefix">$</span>
              <input type="number" class="sales-input spch-target-input" placeholder="e.g. 100"
                value="${target}" min="0" step="5"
                onchange="updateSales('${date}','target_spch',this.value)"
                oninput="liveUpdateSpch('${date}')">
            </div>
          </div>
        </div>

        <div class="sales-day-footer" id="sales-footer-${date}">
          ${renderSalesDayFooter(date, proj, crewHours, target)}
        </div>
      </div>
    `;
  }).join('');
}

function renderSalesDayFooter(date, proj, crewHours, target) {
  const spch = calcSpch(proj, crewHours);
  const col = spchColour(spch, target || 100);
  const weekCost = (() => {
    const dayShifts = shifts.filter(s => s.date === date && s.status !== 'cancelled');
    return dayShifts.reduce((sum, s) => {
      const emp = employees.find(e => e.id === s.employee_id);
      return emp ? sum + calcShiftPay(s, emp).totalPay : sum;
    }, 0);
  })();
  const labourPct = proj && weekCost ? ((weekCost / proj) * 100).toFixed(1) : null;

  return `
    <div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;color:var(--text3);">
      <span>👥 ${crewHours.toFixed(1)} crew hrs</span>
      ${weekCost ? `<span>💰 ${fmt(weekCost)} labour</span>` : ''}
      ${labourPct ? `<span style="color:${parseFloat(labourPct)<32?'var(--success)':'var(--warning)'};">${labourPct}% labour</span>` : ''}
    </div>
  `;
}

function liveUpdateSpch(date) {
  // Recalculate and repaint just the footer + SPCH header for this card — no full re-render
  const card = document.querySelector(`.sales-day-card[data-date="${date}"]`);
  if (!card) return;
  const projInput  = card.querySelector('input[onchange*="projected"]');
  const targetInput = card.querySelector('input[onchange*="target_spch"]');
  const proj   = parseFloat(projInput?.value) || 0;
  const target = parseFloat(targetInput?.value) || 0;
  const crewHours = getDayCrewHours(date);
  const spch = calcSpch(proj, crewHours);
  const col  = spchColour(spch, target || 100);

  // Update SPCH display in header
  const spchEl = card.querySelector('.sales-day-header > div:last-child');
  if (spchEl) spchEl.innerHTML = `
    <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;">SPCH</div>
    <span style="color:${col};font-weight:700;font-size:18px;">${spch ? '$'+spch : '—'}</span>
    ${(spch && target) ? `<span style="font-size:11px;color:${col};">${spch>=target?'▲':'▼'} vs $${target} target</span>` : ''}
  `;
  // Update footer
  const footer = document.getElementById(`sales-footer-${date}`);
  if (footer) footer.innerHTML = renderSalesDayFooter(date, proj, crewHours, target);
}

async function updateSales(date, field, value) {
  if (!salesData[date]) salesData[date] = {};
  salesData[date][field] = value === '' ? null : parseFloat(value) || null;
  localStorage.setItem('wf_sales', JSON.stringify(salesData));
  await dbSaveSale(date);
  // Also refresh roster day header SPCH if roster is visible
  refreshRosterDaySpch(date);
}

// Called from roster to keep SPCH in sync
function getSalesSummary(date) {
  const sd = salesData[date] || {};
  const trend = getTrend(date);
  const proj = sd.projected ?? trend ?? null;
  const target = sd.target_spch ?? null;
  return { proj, actual: sd.actual ?? null, target, trend };
}
