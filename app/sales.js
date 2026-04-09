/* ══════════════════════════════════════════════════════
   Tayla Workforce — Sales Projections
   sales.js
══════════════════════════════════════════════════════ */

// ── Business Supabase client (for mirroring actual sales)
// Uses Business project credentials directly — anon key + RLS is sufficient
const _BIZ_SUPABASE_URL  = 'https://vyikolyljzygmxiahcul.supabase.co';
const _BIZ_SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ5aWtvbHlsanp5Z214aWFoY3VsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ3NzMyNDQsImV4cCI6MjA5MDM0OTI0NH0.v75aCYpDGlUgnaNFj3JE_clvVxmt2YAA_I9AYFABZII';
let _bizSupabase = null; // initialised lazily on first mirror attempt

function getBizSupabase() {
  if (!_bizSupabase && typeof supabase !== 'undefined') {
    _bizSupabase = supabase.createClient(_BIZ_SUPABASE_URL, _BIZ_SUPABASE_ANON);
  }
  return _bizSupabase;
}

// Linked Business account ID — set from businesses.linked_business_id
let _linkedBusinessId = null;

// salesData keyed by date: { projected, actual, target_spch, food, beverage, other }
let salesData = JSON.parse(localStorage.getItem('wf_sales') || '{}');

// ══════════════════════════════════════════════════════
//  SUPABASE
// ══════════════════════════════════════════════════════

async function dbLoadSalesRange(from, to) {
  if (!_businessId) return;

  // For owner at Head Office — aggregate sales across all franchises
  const isHeadOffice = _userRole === 'owner' && _businessId === _ownerBusinessId && _franchises?.length > 0;

  if (isHeadOffice) {
    const allBizIds = [_ownerBusinessId, ..._franchises.map(f => f.id)].filter(Boolean);
    const { data, error } = await _supabase
      .from('sales_data').select('*')
      .in('business_id', allBizIds)
      .gte('date', from).lte('date', to);
    if (error) { console.error('Load sales failed:', error); return; }

    // Aggregate by date — sum across all franchises
    salesData = {};
    (data || []).forEach(r => {
      if (!salesData[r.date]) salesData[r.date] = { projected: 0, actual: 0, target_spch: null };
      salesData[r.date].projected = (salesData[r.date].projected || 0) + (r.projected || 0);
      salesData[r.date].actual    = (salesData[r.date].actual    || 0) + (r.actual    || 0);
      // Use average target_spch across franchises
      if (r.target_spch) {
        salesData[r.date].target_spch = r.target_spch;
      }
    });
    localStorage.setItem('wf_sales', JSON.stringify(salesData));
    return;
  }

  // Normal single-business load
  const { data, error } = await _supabase
    .from('sales_data').select('*')
    .eq('business_id', _businessId)
    .gte('date', from).lte('date', to);
  if (error) { console.error('Load sales failed:', error); return; }
  (data || []).forEach(r => {
    if (!salesData[r.date]) salesData[r.date] = {};
    salesData[r.date].projected   = r.projected    ?? null;
    salesData[r.date].actual      = r.actual       ?? null;
    salesData[r.date].target_spch = r.target_spch  ?? null;
    salesData[r.date].food        = r.food         ?? null;
    salesData[r.date].beverage    = r.beverage     ?? null;
    salesData[r.date].other       = r.other_revenue ?? null;
  });
  localStorage.setItem('wf_sales', JSON.stringify(salesData));
}

async function dbSaveSale(date) {
  const d = salesData[date];
  if (!_businessId) return;
  const { error } = await _supabase.from('sales_data').upsert({
    business_id:   _businessId,
    date,
    projected:     d?.projected    ?? null,
    actual:        d?.actual       ?? null,
    target_spch:   d?.target_spch  ?? null,
    food:          d?.food         ?? null,
    beverage:      d?.beverage     ?? null,
    other_revenue: d?.other        ?? null,
  }, { onConflict: 'business_id,date' });
  if (error) console.error('Save sales failed:', error);

  // Mirror actual sales to Business if linked and actual is set
  if (d?.actual != null && _linkedBusinessId) {
    await dbMirrorSalesToBusiness(date);
  }
}

// ══════════════════════════════════════════════════════
//  MIRROR SALES TO TAYLA BUSINESS
//  Writes actual daily sales to the Business Supabase
//  project so the Stocktake module can calculate UPT.
//  Only runs when a Business account is linked.
// ══════════════════════════════════════════════════════

async function dbMirrorSalesToBusiness(date) {
  if (!_linkedBusinessId) return;
  const biz = getBizSupabase();
  if (!biz) return;

  const d = salesData[date];
  if (d?.actual == null) return; // only mirror when actual is set

  const food      = d.food      ?? null;
  const beverage  = d.beverage  ?? null;
  const other     = d.other     ?? null;
  const total     = d.actual;

  // Validate: if breakdown is entered, it should sum to actual (allow small rounding diff)
  const breakdownTotal = (food || 0) + (beverage || 0) + (other || 0);
  const hasBreakdown   = food != null || beverage != null || other != null;
  if (hasBreakdown && Math.abs(breakdownTotal - total) > 1) {
    console.warn(`Sales breakdown (${breakdownTotal}) doesn't match actual (${total}) for ${date} — mirroring anyway`);
  }

  const { error } = await biz.from('sales_summary').upsert({
    id:                   `${_linkedBusinessId}_${date}`,
    business_id:          _linkedBusinessId,
    workforce_business_id: _businessId,
    date,
    total_revenue:        total,
    food_revenue:         food,
    beverage_revenue:     beverage,
    other_revenue:        other,
    source:               'workforce_manual',
    updated_at:           new Date().toISOString(),
  }, { onConflict: 'id' });

  if (error) {
    console.error('Mirror to Business failed:', error);
  } else {
    console.log(`Sales mirrored to Business for ${date}: $${total}`);
  }
}

// ══════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════

function getDayCrewHours(date) {
  return shifts
    .filter(s => s.date === date && s.status !== 'cancelled' && s.employee_id)
    .reduce((sum, s) => {
      const emp = employees.find(e => e.id === s.employee_id);
      return emp ? sum + calcShiftPay(s, emp).workedHours : sum;
    }, 0);
}

function getDayLabourCost(date) {
  return shifts
    .filter(s => s.date === date && s.status !== 'cancelled' && s.employee_id)
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
  if (spch >= target)        return 'var(--success)';
  if (spch >= target * 0.85) return 'var(--warning)';
  return 'var(--danger)';
}

// Called by roster.js to get projection data for a date
function getSalesSummary(date) {
  const sd = salesData[date] || {};
  return {
    proj:   sd.projected   ?? null,
    actual: sd.actual      ?? null,
    target: sd.target_spch ?? null,
    trend:  null, // POS integration pending
  };
}

// ══════════════════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════════════════

let _salesWeekStart = getWeekStart(localDateStr(new Date()));
let _activeSalesDay = localDateStr(new Date());

function salesWeekNav(dir) {
  const d = new Date(_salesWeekStart);
  d.setDate(d.getDate() + dir * 7);
  _salesWeekStart = localDateStr(d);
  const weekDates = getWeekDates(_salesWeekStart);
  if (!weekDates.includes(_activeSalesDay)) _activeSalesDay = weekDates[0];
  renderSales();
}

function goToCurrentSalesWeek() {
  _salesWeekStart = getWeekStart(localDateStr(new Date()));
  _activeSalesDay = localDateStr(new Date());
  renderSales();
}

function switchSalesDay(date) {
  _activeSalesDay = date;
  document.querySelectorAll('.sales-day-tab').forEach(el => {
    el.classList.toggle('active', el.dataset.date === date);
  });
  renderSalesDayPanel(_activeSalesDay);
}

// ══════════════════════════════════════════════════════
//  MAIN RENDER
// ══════════════════════════════════════════════════════

function renderSales() {
  const weekDates = getWeekDates(_salesWeekStart);
  const weekEnd   = weekDates[6];

  // Clamp active day to this week
  if (!weekDates.includes(_activeSalesDay)) _activeSalesDay = weekDates[0];

  // Update week label
  const label = document.getElementById('sales-week-label');
  if (label) {
    const s = new Date(_salesWeekStart), e = new Date(weekEnd);
    label.textContent = `${s.toLocaleDateString('en-AU',{day:'numeric',month:'short'})} — ${e.toLocaleDateString('en-AU',{day:'numeric',month:'short',year:'numeric'})}`;
  }

  // Load from Supabase then render — always render even if load fails
  const loadPromise = _businessId ? dbLoadSalesRange(_salesWeekStart, weekEnd) : Promise.resolve();
  loadPromise.finally(() => {
    renderSalesKPIs(weekDates);
    renderSalesDayTabs(weekDates);
    renderSalesDayPanel(_activeSalesDay);
  });
}

// ══════════════════════════════════════════════════════
//  WEEK KPIs
// ══════════════════════════════════════════════════════

function renderSalesKPIs(weekDates) {
  const el = document.getElementById('sales-kpis');
  if (!el) return;
  let totProj = 0, totActual = 0, totHours = 0, totCost = 0;
  weekDates.forEach(date => {
    const sd = salesData[date] || {};
    totProj   += sd.projected || 0;
    totActual += sd.actual    || 0;
    totHours  += getDayCrewHours(date);
    totCost   += getDayLabourCost(date);
  });
  const weekSpch  = calcSpch(totProj, totHours);
  const labourPct = totProj && totCost ? ((totCost / totProj) * 100).toFixed(1) : null;
  const variance  = totActual && totProj ? (((totActual - totProj) / totProj) * 100).toFixed(1) : null;

  el.innerHTML = `
    <div class="kpi"><div class="kpi-label">Week Projection</div><div class="kpi-value">${totProj ? fmt(totProj) : '—'}</div></div>
    ${totActual ? `<div class="kpi"><div class="kpi-label">Actual Revenue</div><div class="kpi-value positive">${fmt(totActual)}</div></div>` : ''}
    ${variance  ? `<div class="kpi"><div class="kpi-label">Variance</div><div class="kpi-value" style="color:${parseFloat(variance)>=0?'var(--success)':'var(--danger)'};">${parseFloat(variance)>=0?'+':''}${variance}%</div></div>` : ''}
    <div class="kpi"><div class="kpi-label">Rostered Hours</div><div class="kpi-value">${totHours.toFixed(1)}h</div></div>
    <div class="kpi"><div class="kpi-label">Week SPCH</div><div class="kpi-value" style="color:${weekSpch?'var(--text)':'var(--text3)'};">${weekSpch ? '$'+weekSpch : '—'}</div></div>
    ${labourPct ? `<div class="kpi"><div class="kpi-label">Labour %</div><div class="kpi-value" style="color:${parseFloat(labourPct)<32?'var(--success)':'var(--warning)'};">${labourPct}%</div></div>` : ''}
  `;
}

// ══════════════════════════════════════════════════════
//  DAY TABS
// ══════════════════════════════════════════════════════

const SALES_DAY_SHORT = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

function renderSalesDayTabs(weekDates) {
  const container = document.getElementById('sales-day-tabs');
  if (!container) return;
  const today = localDateStr(new Date());

  container.innerHTML = weekDates.map((date, i) => {
    const isActive = date === _activeSalesDay;
    const isToday  = date === today;
    const isPH     = isPublicHoliday(date);
    const sd       = salesData[date] || {};
    const d        = new Date(date);
    const hasProj  = sd.projected != null;
    const crewHours = getDayCrewHours(date);
    const spch = calcSpch(sd.projected, crewHours);
    const target = sd.target_spch;
    const spchCol = spch && target ? spchColour(spch, target) : 'var(--text3)';

    return `
      <div class="day-tab sales-day-tab ${isActive?'active':''} ${isToday?'today':''}"
           data-date="${date}" onclick="switchSalesDay('${date}')">
        <div class="day-tab-top">
          <span class="day-tab-name">${SALES_DAY_SHORT[i]}</span>
          ${isToday ? '<span class="today-dot"></span>' : ''}
          ${isPH    ? '<span class="ph-tag">PH</span>' : ''}
          ${hasProj ? '<span class="proj-dot" title="Projection entered"></span>' : ''}
        </div>
        <div class="day-tab-date">${d.getDate()}/${d.getMonth()+1}</div>
        <div class="day-tab-meta">
          ${hasProj ? `<span>${fmt(sd.projected)}</span>` : '<span style="color:var(--text3);">No projection</span>'}
        </div>
        ${spch ? `<div class="day-tab-spch" style="color:${spchCol};">$${spch}/h</div>` : ''}
      </div>
    `;
  }).join('');
}

// ══════════════════════════════════════════════════════
//  DAY PANEL
// ══════════════════════════════════════════════════════

function renderSalesDayPanel(date) {
  const panel = document.getElementById('sales-day-panel');
  if (!panel) return;

  const isHeadOfficeAgg = _userRole === 'owner' && _businessId === _ownerBusinessId && _franchises?.length > 0;

  const sd         = salesData[date] || {};
  const weekDates  = getWeekDates(_salesWeekStart);
  const dayIdx     = weekDates.indexOf(date);
  const d          = new Date(date);
  const today      = localDateStr(new Date());
  const isPast     = date < today;
  const isToday    = date === today;
  const isPH       = isPublicHoliday(date);
  const crewHours  = getDayCrewHours(date);
  const labourCost = getDayLabourCost(date);
  const proj       = sd.projected   ?? null;
  const actual     = sd.actual      ?? null;
  const target     = sd.target_spch ?? null;
  const spch       = calcSpch(proj, crewHours);
  const spchCol    = spchColour(spch, target);
  const labourPct  = proj && labourCost ? ((labourCost / proj) * 100).toFixed(1) : null;

  panel.innerHTML = `
    <!-- Day heading -->
    <div class="sales-panel-heading">
      <div>
        <div style="font-family:'DM Serif Display',serif;font-size:22px;line-height:1.1;">
          ${['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'][dayIdx] || '—'}
          ${isPH ? '<span style="font-size:11px;background:#fde2e2;color:var(--danger);padding:3px 9px;border-radius:99px;margin-left:8px;font-family:\'DM Sans\',sans-serif;">Public Holiday</span>' : ''}
        </div>
        <div style="font-size:12px;color:var(--text3);margin-top:2px;">${d.toLocaleDateString('en-AU',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}</div>
      </div>
      <div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap;">
        <div class="gantt-stat">
          <div class="gantt-stat-label">Projection</div>
          <div class="gantt-stat-value" id="spanel-proj">${proj ? fmt(proj) : '—'}</div>
        </div>
        <div class="gantt-stat">
          <div class="gantt-stat-label">SPCH</div>
          <div class="gantt-stat-value" id="spanel-spch" style="color:${spchCol};">${spch ? '$'+spch : '—'}</div>
        </div>
        <div class="gantt-stat">
          <div class="gantt-stat-label">Labour %</div>
          <div class="gantt-stat-value" id="spanel-labour" style="color:${labourPct?parseFloat(labourPct)<32?'var(--success)':'var(--warning)':'var(--text3)'};">${labourPct ? labourPct+'%' : '—'}</div>
        </div>
      </div>
    </div>

    <!-- Two columns: Manual entry + Auto placeholder -->
    <div class="sales-panel-body">

      <!-- ── MANUAL PROJECTION ── -->
      <div class="sales-entry-card">
        <div class="sales-entry-card-header">
          <div>
            <div style="font-weight:700;font-size:14px;">Manual Projection</div>
            <div style="font-size:11px;color:var(--text3);">Enter your projected sales for this day</div>
          </div>
          <span class="badge badge-green">Active</span>
        </div>

        <div class="sales-fields" style="padding:16px;">
          <!-- Projected sales -->
          <div class="sales-field-row">
            <label>Projected Sales ($)</label>
            <div style="position:relative;">
              <span class="field-prefix">$</span>
              <input type="number" id="input-proj-${date}" class="sales-input ${proj!=null?'has-override':''}"
                placeholder="e.g. 4500" value="${proj??''}" min="0" step="10"
                ${isHeadOfficeAgg ? 'readonly style="background:var(--surface2);cursor:not-allowed;"' : ''}
                oninput="liveSalesPanelUpdate('${date}')"
                onchange="saveSalesField('${date}','projected',this.value)">
            </div>
          </div>

          <!-- Actual sales -->
          <div class="sales-field-row">
            <label>Actual Sales ($) ${!isPast?'<span style="font-size:10px;color:var(--text3);font-weight:400;">(if known)</span>':''}</label>
            <div style="position:relative;">
              <span class="field-prefix">$</span>
              <input type="number" id="input-actual-${date}" class="sales-input ${actual!=null&&isPast?'actual-highlight':''}"
                placeholder="0" value="${actual??''}" min="0" step="10"
                ${isHeadOfficeAgg ? 'readonly style="background:var(--surface2);cursor:not-allowed;"' : ''}
                oninput="liveSalesPanelUpdate('${date}')"
                onchange="saveSalesField('${date}','actual',this.value)">
            </div>
            ${actual!=null && proj ? `<div style="font-size:10px;margin-top:4px;color:${actual>=proj?'var(--success)':'var(--danger)'};">${actual>=proj?'▲':'▼'} ${Math.abs(((actual-proj)/proj)*100).toFixed(1)}% vs projection</div>` : ''}
          </div>

          <!-- Sales breakdown — food / beverage / other -->
          <div style="margin-top:2px;padding:12px 14px;background:var(--surface2);border-radius:10px;">
            <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.6px;color:var(--text3);margin-bottom:10px;">
              Sales Breakdown
              <span style="font-size:10px;font-weight:400;text-transform:none;letter-spacing:0;color:var(--text3);"> — optional, used for UPT calculation</span>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;">
              <div>
                <label style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--text3);display:block;margin-bottom:4px;">Food ($)</label>
                <div style="position:relative;">
                  <span class="field-prefix" style="font-size:11px;">$</span>
                  <input type="number" id="input-food-${date}" class="sales-input"
                    placeholder="0" value="${sd.food??''}" min="0" step="10"
                    ${isHeadOfficeAgg ? 'readonly style="background:var(--surface2);cursor:not-allowed;"' : ''}
                    onchange="saveSalesField('${date}','food',this.value)">
                </div>
              </div>
              <div>
                <label style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--text3);display:block;margin-bottom:4px;">Beverage ($)</label>
                <div style="position:relative;">
                  <span class="field-prefix" style="font-size:11px;">$</span>
                  <input type="number" id="input-beverage-${date}" class="sales-input"
                    placeholder="0" value="${sd.beverage??''}" min="0" step="10"
                    ${isHeadOfficeAgg ? 'readonly style="background:var(--surface2);cursor:not-allowed;"' : ''}
                    onchange="saveSalesField('${date}','beverage',this.value)">
                </div>
              </div>
              <div>
                <label style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--text3);display:block;margin-bottom:4px;">Other ($)</label>
                <div style="position:relative;">
                  <span class="field-prefix" style="font-size:11px;">$</span>
                  <input type="number" id="input-other-${date}" class="sales-input"
                    placeholder="0" value="${sd.other??''}" min="0" step="10"
                    ${isHeadOfficeAgg ? 'readonly style="background:var(--surface2);cursor:not-allowed;"' : ''}
                    onchange="saveSalesField('${date}','other',this.value)">
                </div>
              </div>
            </div>
            ${(sd.food||0)+(sd.beverage||0)+(sd.other||0) > 0 ? `
              <div style="margin-top:8px;font-size:11px;color:var(--text3);text-align:right;">
                Breakdown total: <strong style="color:var(--text2);">$${((sd.food||0)+(sd.beverage||0)+(sd.other||0)).toFixed(0)}</strong>
                ${actual && Math.abs(((sd.food||0)+(sd.beverage||0)+(sd.other||0))-actual) > 1
                  ? `<span style="color:var(--warning);margin-left:6px;">⚠ differs from actual by $${Math.abs(((sd.food||0)+(sd.beverage||0)+(sd.other||0))-actual).toFixed(0)}</span>`
                  : `<span style="color:var(--success);margin-left:6px;">✓ matches actual</span>`
                }
              </div>` : ''}
          </div>

          <!-- Target SPCH -->
          <div class="sales-field-row">
            <label>Target SPCH <span style="font-size:10px;color:var(--text3);font-weight:400;">$/crew hr</span></label>
            <div style="position:relative;">
              <span class="field-prefix">$</span>
              <input type="number" id="input-spch-${date}" class="sales-input spch-target-input"
                placeholder="e.g. 100" value="${target??''}" min="0" step="5"
                ${isHeadOfficeAgg ? 'readonly style="background:var(--surface2);cursor:not-allowed;"' : ''}
                oninput="liveSalesPanelUpdate('${date}')"
                onchange="saveSalesField('${date}','target_spch',this.value)">
            </div>
          </div>

          <!-- Live stats -->
          <div class="sales-live-stats" id="slive-${date}">
            ${buildSalesLiveStats(date, proj, actual, target, crewHours, labourCost)}
          </div>
        </div>
      </div>

      <!-- ── AUTO PROJECTION PLACEHOLDER ── -->
      <div class="sales-entry-card sales-entry-card-placeholder">
        <div class="sales-entry-card-header">
          <div>
            <div style="font-weight:700;font-size:14px;color:var(--text2);">Auto Projection</div>
            <div style="font-size:11px;color:var(--text3);">AI-powered forecast from your POS data</div>
          </div>
          <span class="badge badge-grey">Coming Soon</span>
        </div>

        <div style="padding:24px 20px;display:flex;flex-direction:column;align-items:center;gap:14px;">
          <div style="font-size:36px;">📊</div>
          <div style="text-align:center;">
            <div style="font-weight:600;font-size:14px;color:var(--text2);margin-bottom:6px;">POS Integration Required</div>
            <div style="font-size:12px;color:var(--text3);line-height:1.6;max-width:240px;">
              Connect your POS system to enable automatic sales projections based on your historical trading data, seasonal trends, and day-of-week patterns.
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:6px;width:100%;margin-top:4px;">
            ${['Square','Lightspeed','Doshii','Others'].map(pos => `
              <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:var(--bg);border-radius:8px;font-size:12px;">
                <span style="color:var(--text2);">${pos}</span>
                <span style="font-size:10px;color:var(--text3);">Coming soon</span>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Hourly breakdown placeholder -->
        <div style="border-top:1px solid var(--border);padding:16px 20px;">
          <div style="font-weight:600;font-size:13px;margin-bottom:4px;">Hourly Sales Breakdown</div>
          <div style="font-size:11px;color:var(--text3);margin-bottom:12px;">Shows projected sales by hour alongside SPCH · Requires POS integration</div>
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;">
            ${['9am','10am','11am','12pm','1pm','2pm','3pm','4pm'].map(h => `
              <div style="background:var(--bg);border-radius:6px;padding:8px;text-align:center;">
                <div style="font-size:10px;color:var(--text3);">${h}</div>
                <div style="font-size:12px;color:var(--border);font-weight:600;margin:2px 0;">$—</div>
                <div style="font-size:9px;color:var(--border);">SPCH —</div>
              </div>
            `).join('')}
          </div>
          <div style="margin-top:10px;font-size:10px;color:var(--text3);text-align:center;">
            ⏳ Hourly projections coming soon — connect your POS to unlock
          </div>
        </div>
      </div>

    </div>
  `;
}

function buildSalesLiveStats(date, proj, actual, target, crewHours, labourCost) {
  const spch      = calcSpch(proj, crewHours);
  const spchCol   = spchColour(spch, target);
  const labourPct = proj && labourCost ? ((labourCost / proj) * 100).toFixed(1) : null;

  if (!proj && !actual && !crewHours) return `<div style="color:var(--text3);font-size:11px;text-align:center;padding:8px 0;">Enter a projection above to see stats</div>`;

  return `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:4px;">
      <div class="sales-stat-chip">
        <div class="sales-stat-label">Crew Hours</div>
        <div class="sales-stat-value">${crewHours.toFixed(1)}h</div>
      </div>
      <div class="sales-stat-chip">
        <div class="sales-stat-label">Labour Cost</div>
        <div class="sales-stat-value">${labourCost ? fmt(labourCost) : '—'}</div>
      </div>
      <div class="sales-stat-chip">
        <div class="sales-stat-label">SPCH</div>
        <div class="sales-stat-value" style="color:${spchCol};">${spch ? '$'+spch : '—'}</div>
      </div>
      <div class="sales-stat-chip">
        <div class="sales-stat-label">Labour %</div>
        <div class="sales-stat-value" style="color:${labourPct?parseFloat(labourPct)<32?'var(--success)':'var(--warning)':'var(--text3)'};">${labourPct ? labourPct+'%' : '—'}</div>
      </div>
    </div>
    ${target && spch ? `
      <div style="margin-top:8px;padding:8px 10px;border-radius:8px;background:${spch>=target?'rgba(56,161,105,.1)':'rgba(229,62,62,.08)'};font-size:11px;color:${spchCol};font-weight:600;text-align:center;">
        ${spch >= target ? `✓ On target — $${spch} vs $${target} target SPCH` : `⚠ Below target — $${spch} vs $${target} target SPCH`}
      </div>
    ` : ''}
  `;
}

// ══════════════════════════════════════════════════════
//  LIVE UPDATE (no re-render)
// ══════════════════════════════════════════════════════

function liveSalesPanelUpdate(date) {
  const proj   = parseFloat(document.getElementById(`input-proj-${date}`)?.value)   || null;
  const actual = parseFloat(document.getElementById(`input-actual-${date}`)?.value) || null;
  const target = parseFloat(document.getElementById(`input-spch-${date}`)?.value)   || null;
  const crewHours  = getDayCrewHours(date);
  const labourCost = getDayLabourCost(date);
  const spch       = calcSpch(proj, crewHours);
  const spchCol    = spchColour(spch, target);
  const labourPct  = proj && labourCost ? ((labourCost / proj) * 100).toFixed(1) : null;

  // Update panel heading stats
  const pEl = document.getElementById('spanel-proj');   if (pEl) pEl.textContent = proj ? fmt(proj) : '—';
  const sEl = document.getElementById('spanel-spch');   if (sEl) { sEl.textContent = spch ? '$'+spch : '—'; sEl.style.color = spchCol; }
  const lEl = document.getElementById('spanel-labour'); if (lEl) { lEl.textContent = labourPct ? labourPct+'%' : '—'; lEl.style.color = labourPct ? parseFloat(labourPct)<32?'var(--success)':'var(--warning)' : 'var(--text3)'; }

  // Update live stats block
  const liveEl = document.getElementById(`slive-${date}`);
  if (liveEl) liveEl.innerHTML = buildSalesLiveStats(date, proj, actual, target, crewHours, labourCost);

  // Update day tab
  const tabEl = document.querySelector(`.sales-day-tab[data-date="${date}"]`);
  if (tabEl) {
    const metaEl = tabEl.querySelector('.day-tab-meta');
    if (metaEl) metaEl.innerHTML = proj ? `<span>${fmt(proj)}</span>` : '<span style="color:var(--text3);">No projection</span>';
    const spchTabEl = tabEl.querySelector('.day-tab-spch');
    if (spchTabEl) { spchTabEl.textContent = spch ? `$${spch}/h` : ''; spchTabEl.style.color = spchCol; }
    else if (spch) {
      const newSpchEl = document.createElement('div');
      newSpchEl.className = 'day-tab-spch';
      newSpchEl.style.color = spchCol;
      newSpchEl.textContent = `$${spch}/h`;
      tabEl.appendChild(newSpchEl);
    }
    // Toggle proj dot
    const dotEl = tabEl.querySelector('.proj-dot');
    if (proj && !dotEl) {
      const dot = document.createElement('span');
      dot.className = 'proj-dot';
      tabEl.querySelector('.day-tab-top')?.appendChild(dot);
    } else if (!proj && dotEl) dotEl.remove();
  }

  // Sync to roster tab SPCH
  refreshRosterDaySpch(date);
}

// ══════════════════════════════════════════════════════
//  SAVE
// ══════════════════════════════════════════════════════

async function saveSalesField(date, field, value) {
  // Head office shows aggregated data — not editable
  const isHeadOfficeAgg = _userRole === 'owner' && 
    (_ownerBusinessId ? _businessId === _ownerBusinessId : true) && 
    _franchises?.length > 0;
  if (isHeadOfficeAgg) {
    toast('Head Office shows combined franchise data — edit sales in each franchise directly');
    renderSales(); // Reset inputs to aggregated values
    return;
  }
  if (!salesData[date]) salesData[date] = {};
  salesData[date][field] = value === '' ? null : parseFloat(value) || null;

  // If a breakdown field changed, auto-update the actual total if not manually set
  if (['food','beverage','other'].includes(field)) {
    const d = salesData[date];
    const breakdownTotal = (d.food || 0) + (d.beverage || 0) + (d.other || 0);
    // Only auto-fill actual if it's not already manually set or if it equals a previous breakdown total
    if (breakdownTotal > 0) {
      const currentActual = document.getElementById(`input-actual-${date}`)?.value;
      // Auto-fill actual from breakdown sum for convenience — user can override
      if (!currentActual || parseFloat(currentActual) === 0) {
        salesData[date].actual = breakdownTotal;
        const actualEl = document.getElementById(`input-actual-${date}`);
        if (actualEl) actualEl.value = breakdownTotal;
      }
    }
  }

  localStorage.setItem('wf_sales', JSON.stringify(salesData));
  await dbSaveSale(date);
  renderSalesKPIs(getWeekDates(_salesWeekStart));
  refreshRosterDaySpch(date);
}
