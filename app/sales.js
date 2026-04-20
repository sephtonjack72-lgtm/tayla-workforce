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

      <!-- ── AUTO PROJECTION ── -->
      <div class="sales-entry-card" id="auto-proj-card-${date}">
        <div class="sales-entry-card-header">
          <div>
            <div style="font-weight:700;font-size:14px;">Auto Projection</div>
            <div style="font-size:11px;color:var(--text3);">4-week trend · same day of week</div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;">
            ${buildAutoProjectionBadge(date)}
            ${['owner','franchise'].includes(_userRole) ? `<button class="btn btn-ghost btn-sm" onclick="refreshAutoProjection('${date}')" title="Recalculate">↻</button>` : ''}
          </div>
        </div>
        <div id="auto-proj-body-${date}" style="padding:16px;">
          ${buildAutoProjectionBody(date)}
        </div>

        <!-- POS Connection status -->
        <div style="border-top:1px solid var(--border);padding:12px 16px;">
          ${buildPOSConnectionWidget(date)}
        </div>

        <!-- Close Day -->
        ${['owner','franchise'].includes(_userRole) ? `
        <div style="border-top:1px solid var(--border);padding:12px 16px;">
          ${buildCloseDayWidget(date)}
        </div>` : ''}
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

// ══════════════════════════════════════════════════════
//  AUTO PROJECTION ENGINE
//  Pure maths — no AI
//  Algorithm: average of week-on-week % changes for
//  same day of week across last 4 weeks of actual data
// ══════════════════════════════════════════════════════

// In-memory projection cache keyed by date
let _autoProjections = {};

async function calculateAutoProjection(targetDate) {
  if (!_businessId) return null;

  const target = new Date(targetDate + 'T00:00:00');
  const dow    = target.getDay(); // 0=Sun … 6=Sat

  // Fetch up to 5 weeks of closed actual sales for same day of week
  const lookback = new Date(target);
  lookback.setDate(lookback.getDate() - 35);
  const lookbackStr = localDateStr(lookback);

  const { data } = await _supabase
    .from('sales_data')
    .select('date, actual')
    .eq('business_id', _businessId)
    .gte('date', lookbackStr)
    .lt('date', targetDate)
    .not('actual', 'is', null)
    .order('date', { ascending: true });

  // Filter to same day of week with positive actuals
  const sameDow = (data || []).filter(r => {
    const d = new Date(r.date + 'T00:00:00');
    return d.getDay() === dow && r.actual > 0;
  });

  if (sameDow.length < 4) {
    return {
      projected:    null,
      growth_rate:  null,
      weeks_of_data: sameDow.length,
      is_manual:    false,
    };
  }

  // Use most recent 4 data points
  const recent  = sameDow.slice(-4);

  // Calculate week-on-week % changes (3 changes from 4 points)
  const changes = [];
  for (let i = 1; i < recent.length; i++) {
    const prev = recent[i - 1].actual;
    const curr = recent[i].actual;
    if (prev > 0) changes.push((curr - prev) / prev);
  }

  const avgGrowth   = changes.reduce((s, c) => s + c, 0) / changes.length;
  const lastActual  = recent[recent.length - 1].actual;
  const projected   = Math.max(0, +(lastActual * (1 + avgGrowth)).toFixed(2));

  return {
    projected,
    growth_rate:   +avgGrowth.toFixed(6),
    weeks_of_data: recent.length,
    is_manual:     false,
    last_actual:   lastActual,
    last_date:     recent[recent.length - 1].date,
  };
}

async function loadAutoProjectionsForWeek(weekDates) {
  for (const date of weekDates) {
    if (_autoProjections[date]) continue; // already loaded
    const proj = await calculateAutoProjection(date);
    if (proj) _autoProjections[date] = proj;
  }
}

async function refreshAutoProjection(date) {
  delete _autoProjections[date];
  const proj = await calculateAutoProjection(date);
  if (proj) _autoProjections[date] = proj;

  // Re-render just this card's body
  const bodyEl = document.getElementById(`auto-proj-body-${date}`);
  const badgeEl = document.querySelector(`#auto-proj-card-${date} .sales-entry-card-header > div:last-child`);
  if (bodyEl) bodyEl.innerHTML = buildAutoProjectionBody(date);
  toast('Projection recalculated ✓');
}

function buildAutoProjectionBadge(date) {
  const proj = _autoProjections[date];
  if (!proj) return '<span class="badge badge-grey">Loading…</span>';
  if (proj.weeks_of_data < 4) {
    return `<span class="badge badge-yellow" title="Need 4 weeks of actuals">${proj.weeks_of_data}/4 weeks data</span>`;
  }
  const pct = (proj.growth_rate * 100).toFixed(1);
  const col = proj.growth_rate >= 0 ? 'badge-green' : 'badge-red';
  return `<span class="badge ${col}">${proj.growth_rate >= 0 ? '+' : ''}${pct}% trend</span>`;
}

function buildAutoProjectionBody(date) {
  const proj = _autoProjections[date];
  const sd   = salesData[date] || {};

  if (!proj) {
    return `<div style="color:var(--text3);font-size:12px;text-align:center;padding:12px 0;">
      <div style="font-size:20px;margin-bottom:8px;">⏳</div>
      Calculating from historical data…
    </div>`;
  }

  if (proj.weeks_of_data < 4) {
    return `
      <div style="text-align:center;padding:12px 0;">
        <div style="font-size:20px;margin-bottom:8px;">📊</div>
        <div style="font-weight:600;font-size:13px;color:var(--text2);margin-bottom:6px;">Not enough history yet</div>
        <div style="font-size:12px;color:var(--text3);line-height:1.6;">
          Need <strong>4 weeks</strong> of actuals for the same day of week.<br>
          You have <strong>${proj.weeks_of_data}</strong> so far — keep entering actuals each day.
        </div>
        <div style="margin-top:12px;font-size:11px;color:var(--text3);">
          Until then, use Manual Projection above.
        </div>
      </div>`;
  }

  const crewHours  = getDayCrewHours(date);
  const labourCost = getDayLabourCost(date);
  const spch       = calcSpch(proj.projected, crewHours);
  const spchCol    = spchColour(spch, sd.target_spch);
  const labourPct  = proj.projected && labourCost ? ((labourCost / proj.projected) * 100).toFixed(1) : null;
  const pct        = (proj.growth_rate * 100).toFixed(1);
  const isOverride = proj.is_manual;

  return `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;">
      <div style="background:var(--surface2);border-radius:8px;padding:12px;text-align:center;">
        <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">Projected</div>
        <div style="font-size:20px;font-weight:700;color:var(--success);">${fmt(proj.projected)}</div>
        ${isOverride ? '<div style="font-size:10px;color:var(--gold);margin-top:2px;">✎ Manual override</div>' : `<div style="font-size:10px;color:var(--text3);margin-top:2px;">${proj.growth_rate >= 0 ? '+' : ''}${pct}% vs last ${getDayName(date)}</div>`}
      </div>
      <div style="background:var(--surface2);border-radius:8px;padding:12px;text-align:center;">
        <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">SPCH</div>
        <div style="font-size:20px;font-weight:700;color:${spchCol};">${spch ? '$' + spch : '—'}</div>
        <div style="font-size:10px;color:var(--text3);margin-top:2px;">Labour: ${labourPct ? labourPct + '%' : '—'}</div>
      </div>
    </div>

    <div style="font-size:11px;color:var(--text3);margin-bottom:10px;">
      Based on last 4 × ${getDayName(date)}s · Last actual: ${fmt(proj.last_actual)} (${fmtDate(proj.last_date)})
    </div>

    ${['owner','franchise'].includes(_userRole) ? `
    <!-- Manual override -->
    <div style="padding:10px 12px;background:var(--surface2);border-radius:8px;">
      <div style="font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">Override Projection</div>
      <div style="display:flex;gap:8px;align-items:center;">
        <div style="position:relative;flex:1;">
          <span class="field-prefix">$</span>
          <input type="number" id="auto-proj-override-${date}" class="sales-input"
            placeholder="${proj.projected}"
            value="${isOverride ? proj.projected : ''}"
            min="0" step="10">
        </div>
        <button class="btn btn-ghost btn-sm" onclick="applyAutoProjectionOverride('${date}')">Apply</button>
        ${isOverride ? `<button class="btn btn-ghost btn-sm" style="color:var(--text3);" onclick="clearAutoProjectionOverride('${date}')">Reset</button>` : ''}
      </div>
    </div>` : ''}
  `;
}

function getDayName(date) {
  return new Date(date + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'long' });
}

async function applyAutoProjectionOverride(date) {
  const val = parseFloat(document.getElementById(`auto-proj-override-${date}`)?.value);
  if (!val || val <= 0) { toast('Enter a valid amount'); return; }

  _autoProjections[date] = {
    ..._autoProjections[date],
    projected:  val,
    is_manual:  true,
  };

  // Also save to sales_data.projected so it feeds through to roster/dashboard
  await saveSalesField(date, 'projected', val);

  const bodyEl = document.getElementById(`auto-proj-body-${date}`);
  if (bodyEl) bodyEl.innerHTML = buildAutoProjectionBody(date);
  toast('Projection override applied ✓');
}

async function clearAutoProjectionOverride(date) {
  delete _autoProjections[date];
  const proj = await calculateAutoProjection(date);
  if (proj) _autoProjections[date] = proj;

  const bodyEl = document.getElementById(`auto-proj-body-${date}`);
  if (bodyEl) bodyEl.innerHTML = buildAutoProjectionBody(date);
  toast('Projection reset to calculated value ✓');
}

// ══════════════════════════════════════════════════════
//  CLOSE DAY
//  Gates on: all rostered employees have a timesheet entry
//  Owner/franchise only
// ══════════════════════════════════════════════════════

// In-memory closed days cache
let _closedDays = {}; // keyed by date, value = sales_days row

async function loadClosedDaysForWeek(weekStart, weekEnd) {
  if (!_businessId) return;
  const { data } = await _supabase
    .from('sales_days')
    .select('*')
    .eq('business_id', _businessId)
    .gte('date', weekStart)
    .lte('date', weekEnd);
  _closedDays = {};
  (data || []).forEach(r => { _closedDays[r.date] = r; });
}

function buildCloseDayWidget(date) {
  const closed   = _closedDays[date];
  const today    = localDateStr(new Date());
  const isPast   = date <= today;
  const sd       = salesData[date] || {};
  const hasSales = (sd.actual || sd.projected) > 0;

  if (!isPast && date !== today) {
    return `<div style="font-size:11px;color:var(--text3);text-align:center;padding:4px 0;">Close Day available once date is reached</div>`;
  }

  if (closed?.status === 'closed') {
    const closedAt = new Date(closed.closed_at).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    return `
      <div style="display:flex;align-items:center;justify-content:space-between;">
        <div>
          <div style="font-size:12px;font-weight:700;color:var(--success);">✓ Day Closed</div>
          <div style="font-size:10px;color:var(--text3);">Closed ${closedAt} · Labour ${closed.labour_percent ? closed.labour_percent + '%' : '—'}</div>
        </div>
        <span class="badge badge-green">Locked</span>
      </div>`;
  }

  // Check for missing timesheets
  const dayShifts    = (typeof shifts !== 'undefined' ? shifts : []).filter(s => s.date === date && s.status !== 'cancelled');
  const missingCount = dayShifts.filter(s => {
    return !(typeof timesheets !== 'undefined' ? timesheets : []).find(t => t.employee_id === s.employee_id && t.date === date);
  }).length;

  return `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
      <div>
        <div style="font-size:12px;font-weight:600;color:var(--text2);">Close Day</div>
        <div style="font-size:10px;color:var(--text3);">
          ${missingCount > 0
            ? `<span style="color:var(--warning);">⚠ ${missingCount} timesheet${missingCount !== 1 ? 's' : ''} missing</span>`
            : '✓ All timesheets entered'}
        </div>
      </div>
      <button class="btn btn-primary btn-sm" onclick="openCloseDayModal('${date}')"
        ${missingCount > 0 ? 'disabled style="opacity:.5;cursor:not-allowed;"' : ''}>
        Close Day
      </button>
    </div>`;
}

async function openCloseDayModal(date) {
  if (!['owner', 'franchise'].includes(_userRole)) {
    toast('Only owners and franchise managers can close a day');
    return;
  }

  const closed = _closedDays[date];
  if (closed?.status === 'closed') { toast('This day is already closed'); return; }

  // Check all rostered employees have timesheet entries
  const dayShifts = (typeof shifts !== 'undefined' ? shifts : []).filter(s => s.date === date && s.status !== 'cancelled');
  const missing   = [];
  for (const s of dayShifts) {
    const hasTs = (typeof timesheets !== 'undefined' ? timesheets : []).find(t => t.employee_id === s.employee_id && t.date === date);
    if (!hasTs) {
      const emp = (typeof employees !== 'undefined' ? employees : []).find(e => e.id === s.employee_id);
      if (emp) missing.push(`${emp.first_name} ${emp.last_name}`);
    }
  }

  // Calculate labour figures
  const labourCost = getDayLabourCost(date);
  const sd         = salesData[date] || {};
  const totalSales = sd.actual || sd.projected || 0;
  const labourPct  = totalSales > 0 ? +((labourCost / totalSales) * 100).toFixed(2) : null;
  const fmtD       = new Date(date + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' });

  // Build modal content
  let modal = document.getElementById('close-day-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'close-day-modal';
    modal.innerHTML = `
      <div class="modal" style="max-width:460px;">
        <h3>Close Day</h3>
        <div id="close-day-content"></div>
        <div class="flex-gap" style="justify-content:flex-end;margin-top:20px;">
          <button class="btn btn-ghost btn-sm" onclick="closeModal('close-day-modal')">Cancel</button>
          <button class="btn btn-primary" id="confirm-close-day-btn">Close Day</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
  }

  document.getElementById('close-day-content').innerHTML = `
    <div style="font-size:13px;color:var(--text2);margin-bottom:16px;">${fmtD}</div>

    ${missing.length > 0 ? `
    <div style="padding:12px 14px;background:rgba(229,62,62,.08);border:1px solid rgba(229,62,62,.2);border-radius:8px;font-size:12px;color:var(--danger);margin-bottom:16px;">
      <div style="font-weight:700;margin-bottom:6px;">⚠ Cannot close — missing timesheet entries</div>
      <ul style="margin:4px 0 0 16px;padding:0;">
        ${missing.map(n => `<li>${n}</li>`).join('')}
      </ul>
    </div>` : ''}

    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:16px;">
      <div style="background:var(--surface2);border-radius:8px;padding:12px;text-align:center;">
        <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">Sales</div>
        <div style="font-size:18px;font-weight:700;color:var(--success);">${fmt(totalSales)}</div>
        <div style="font-size:9px;color:var(--text3);margin-top:2px;">${sd.actual ? 'actual' : 'projected'}</div>
      </div>
      <div style="background:var(--surface2);border-radius:8px;padding:12px;text-align:center;">
        <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">Labour</div>
        <div style="font-size:18px;font-weight:700;">${fmt(labourCost)}</div>
      </div>
      <div style="background:var(--surface2);border-radius:8px;padding:12px;text-align:center;">
        <div style="font-size:10px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">Labour %</div>
        <div style="font-size:18px;font-weight:700;color:${labourPct > 35 ? 'var(--danger)' : labourPct > 30 ? 'var(--gold)' : 'var(--success)'};">
          ${labourPct !== null ? labourPct + '%' : '—'}
        </div>
      </div>
    </div>

    <div style="font-size:12px;color:var(--text3);padding:10px 12px;background:var(--surface2);border-radius:8px;">
      Closing the day locks today's sales figures and calculates final labour %. This cannot be undone.
    </div>
  `;

  const confirmBtn = document.getElementById('confirm-close-day-btn');
  confirmBtn.disabled = missing.length > 0;
  confirmBtn.style.opacity = missing.length > 0 ? '.5' : '';
  confirmBtn.onclick = () => executeCloseDay(date, totalSales, labourCost, labourPct);

  modal.classList.add('show');
}

async function executeCloseDay(date, totalSales, labourCost, labourPct) {
  const btn = document.getElementById('confirm-close-day-btn');
  if (btn) { btn.textContent = 'Closing…'; btn.disabled = true; }

  try {
    const { data: { session } } = await _supabase.auth.getSession();
    const record = {
      business_id:    _businessId,
      date,
      status:         'closed',
      total_sales:    totalSales,
      labour_cost:    labourCost,
      labour_percent: labourPct,
      pos_source:     _posConnection?.provider || 'manual',
      closed_at:      new Date().toISOString(),
      closed_by:      session?.user?.id || null,
    };

    const { error } = await _supabase
      .from('sales_days')
      .upsert(record, { onConflict: 'business_id,date' });

    if (error) throw new Error(error.message);

    _closedDays[date] = record;

    closeModal('close-day-modal');
    toast(`Day closed ✓ — Labour ${labourPct !== null ? labourPct + '%' : '—'}`);

    // Re-render the panel to show locked state
    renderSalesDayPanel(date);

    // Trigger projections for upcoming same-weekday
    generateNextProjection(date);

  } catch (err) {
    toast('Error: ' + err.message);
    if (btn) { btn.textContent = 'Close Day'; btn.disabled = false; }
  }
}

// After closing a day, auto-generate the next projection for same weekday
async function generateNextProjection(closedDate) {
  const dow = new Date(closedDate + 'T00:00:00').getDay();
  const next = new Date(closedDate + 'T00:00:00');
  next.setDate(next.getDate() + 7);
  const nextStr = localDateStr(next);
  delete _autoProjections[nextStr];
  const proj = await calculateAutoProjection(nextStr);
  if (proj) _autoProjections[nextStr] = proj;
}

// ══════════════════════════════════════════════════════
//  SQUARE POS CONNECTION
//  OAuth 2.0 flow — owner/franchise only
// ══════════════════════════════════════════════════════

// Square App credentials — set after developer account created
const SQUARE_APP_ID      = 'sq0idp-f4IyMV1D5_TL5E0Tsrv8Aw';
const SQUARE_REDIRECT    = 'https://workforce.usetayla.com.au/app/square-callback';
const SQUARE_SCOPE       = 'ORDERS_READ PAYMENTS_READ MERCHANT_PROFILE_READ';
const SQUARE_AUTH_URL    = 'https://connect.squareup.com/oauth2/authorize';

function buildPOSConnectionWidget(date) {
  if (!['owner', 'franchise'].includes(_userRole)) {
    return `<div style="font-size:11px;color:var(--text3);">POS connection managed by owner</div>`;
  }

  if (_posConnection) {
    return `
      <div style="display:flex;align-items:center;justify-content:space-between;">
        <div style="display:flex;align-items:center;gap:8px;">
          <div style="width:8px;height:8px;border-radius:50%;background:var(--success);"></div>
          <div>
            <div style="font-size:12px;font-weight:600;color:var(--text2);">${_posConnection.provider.charAt(0).toUpperCase() + _posConnection.provider.slice(1)} Connected</div>
            <div style="font-size:10px;color:var(--text3);">Sales sync active</div>
          </div>
        </div>
        <div style="display:flex;gap:6px;">
          <button class="btn btn-ghost btn-sm" onclick="syncSquareSales('${date}')">↻ Sync Now</button>
          <button class="btn btn-ghost btn-sm" style="color:var(--danger);" onclick="disconnectPOS()">Disconnect</button>
        </div>
      </div>`;
  }

  return `
    <div style="display:flex;align-items:center;justify-content:space-between;">
      <div>
        <div style="font-size:12px;font-weight:600;color:var(--text2);">Connect POS</div>
        <div style="font-size:10px;color:var(--text3);">Auto-fill daily sales from your POS</div>
      </div>
      <div style="display:flex;gap:6px;">
        <button class="btn btn-primary btn-sm" onclick="connectSquare()">⬛ Connect Square</button>
        <button class="btn btn-ghost btn-sm" style="font-size:10px;color:var(--text3);" title="Lightspeed & OrderMate coming soon">More POS…</button>
      </div>
    </div>`;
}

function connectSquare() {
  if (!SQUARE_APP_ID) {
    toast('Square App ID not yet configured — check back soon');
    return;
  }
  const state = btoa(JSON.stringify({ businessId: _businessId, ts: Date.now() }));
  const url   = `${SQUARE_AUTH_URL}?client_id=${SQUARE_APP_ID}&scope=${encodeURIComponent(SQUARE_SCOPE)}&state=${state}&redirect_uri=${encodeURIComponent(SQUARE_REDIRECT)}`;
  window.location.href = url;
}

// Called on page load to handle Square OAuth callback
async function handleSquareCallback() {
  const params = new URLSearchParams(window.location.search);
  const code   = params.get('code');
  const state  = params.get('state');
  if (!code || !state) return;

  // Clean URL
  window.history.replaceState({}, '', window.location.pathname);

  toast('Connecting Square…');

  try {
    // Exchange code for token via Edge Function
    const { data: { session } } = await _supabase.auth.getSession();
    const res = await fetch(
      'https://whedwekxzjfqwjuoarid.supabase.co/functions/v1/square-oauth',
      {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ code, state }),
      }
    );
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'OAuth failed');

    await dbLoadPOSConnection();
    toast('Square connected ✓');
    renderSales();

  } catch (err) {
    toast('Square connection failed: ' + err.message);
  }
}

async function dbLoadPOSConnection() {
  if (!_businessId) return;
  const { data } = await _supabase
    .from('pos_connections')
    .select('*')
    .eq('business_id', _businessId)
    .eq('status', 'active')
    .maybeSingle();
  _posConnection = data || null;
}

async function disconnectPOS() {
  if (!_posConnection) return;
  if (!confirm('Disconnect your POS? Sales will need to be entered manually.')) return;
  await _supabase.from('pos_connections').update({ status: 'disconnected' }).eq('id', _posConnection.id);
  _posConnection = null;
  toast('POS disconnected');
  renderSales();
}

// Manually trigger a Square sales sync for a given date
async function syncSquareSales(date) {
  if (!_posConnection || _posConnection.provider !== 'square') {
    toast('No Square connection found');
    return;
  }
  toast('Syncing Square sales…');
  try {
    const { data: { session } } = await _supabase.auth.getSession();
    const res = await fetch(
      'https://whedwekxzjfqwjuoarid.supabase.co/functions/v1/square-sync-sales',
      {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ date, business_id: _businessId }),
      }
    );
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || 'Sync failed');

    // Reload sales data for this date
    await dbLoadSalesRange(date, date);
    renderSalesDayPanel(date);
    toast(`Square sales synced ✓ — ${fmt(data.total_sales || 0)}`);

  } catch (err) {
    toast('Sync failed: ' + err.message);
  }
}

// ══════════════════════════════════════════════════════
//  HOOK INTO EXISTING renderSales
//  Load projections, POS connection, and closed days
//  when the sales page renders
// ══════════════════════════════════════════════════════

const _originalRenderSales = renderSales;
renderSales = function() {
  _originalRenderSales.call(this);
  // Load new data in background after existing render
  const weekDates = getWeekDates(_salesWeekStart);
  const weekEnd   = weekDates[6];
  Promise.all([
    dbLoadPOSConnection(),
    loadClosedDaysForWeek(_salesWeekStart, weekEnd),
    loadAutoProjectionsForWeek(weekDates),
  ]).then(() => {
    // Re-render day panel to show updated projection/close day widgets
    renderSalesDayPanel(_activeSalesDay);
  });

  // Handle Square OAuth callback if present
  if (window.location.search.includes('code=')) {
    handleSquareCallback();
  }
};
