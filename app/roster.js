/* ══════════════════════════════════════════════════════
   Tayla Workforce — Roster (Tanda-style Gantt)
   roster.js
══════════════════════════════════════════════════════ */

let shifts = JSON.parse(localStorage.getItem('wf_shifts') || '[]');
let _currentWeekStart = getWeekStart(localDateStr(new Date()));
let _activeDay        = localDateStr(new Date());
let _assignPopover    = null; // { shiftId, el }
let _dragJustFinished = false; // suppress click after drag-create

// ── Pay cache — cleared on each render, avoids recalculating per shift repeatedly
const _payCache = {};
function cachedShiftPay(shift, emp) {
  const key = `${shift.id}-${emp.id}-${shift.start_time}-${shift.end_time}-${shift.date}`;
  if (!_payCache[key]) _payCache[key] = calcShiftPay(shift, emp);
  return _payCache[key];
}
function clearPayCache() { Object.keys(_payCache).forEach(k => delete _payCache[k]); }

const TIMELINE_START = 6;
const TIMELINE_END   = 26;
const TIMELINE_HOURS = TIMELINE_END - TIMELINE_START;
const DRAG_THRESHOLD = 5;
const DAY_SHORT = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const DAY_LONG  = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];

// ══════════════════════════════════════════════════════
//  SUPABASE
// ══════════════════════════════════════════════════════

// Availability keyed by employee_id → array of { day_of_week, available, start_time, end_time }
let availabilityData = {};

async function ensureAvailabilityLoaded() {
  if (_availabilityLoaded) return;
  await dbLoadAvailability();
}

async function dbLoadAvailability() {
  if (!_businessId) return;
  const { data, error } = await _supabase
    .from('employee_availability')
    .select('*')
    .eq('business_id', _businessId);
  if (error) { console.error('Load availability failed:', error); return; }
  availabilityData = {};
  (data || []).forEach(row => {
    if (!availabilityData[row.employee_id]) availabilityData[row.employee_id] = {};
    availabilityData[row.employee_id][row.day_of_week] = row;
  });
}

async function dbLoadShifts(weekStart, weekEnd) {
  await ensureShiftsLoaded(weekStart, weekEnd);
}

async function dbSaveShift(shift) {
  const idx = shifts.findIndex(s => s.id === shift.id);
  if (idx >= 0) shifts[idx] = shift; else shifts.push(shift);
  localStorage.setItem('wf_shifts', JSON.stringify(shifts));
  if (!_businessId) return;
  const { error } = await _supabase
    .from('shifts').upsert({ ...shift, business_id: _businessId }, { onConflict: 'id' });
  if (error) { console.error('Save shift failed:', error); toast('⚠ Sync failed: ' + error.message); }
}

async function dbDeleteShift(id) {
  shifts = shifts.filter(s => s.id !== id);
  localStorage.setItem('wf_shifts', JSON.stringify(shifts));
  if (!_businessId) return;
  await _supabase.from('shifts').delete().eq('id', id);
}

// ══════════════════════════════════════════════════════
//  WEEK NAV
// ══════════════════════════════════════════════════════

function getWeekStart(dateStr) {
  const d = parseLocalDate(dateStr);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return localDateStr(d);
}

function weekNav(dir) {
  const d = parseLocalDate(_currentWeekStart);
  d.setDate(d.getDate() + dir * 7);
  _currentWeekStart = localDateStr(d);
  _activeDay = _currentWeekStart;
  closeAssignPopover();
  renderRoster();
}

function goToCurrentWeek() {
  _currentWeekStart = getWeekStart(localDateStr(new Date()));
  _activeDay = localDateStr(new Date());
  closeAssignPopover();
  renderRoster();
}

function switchDay(date) {
  _activeDay = date;
  closeAssignPopover();
  document.querySelectorAll('.day-tab').forEach(el => {
    el.classList.toggle('active', el.dataset.date === date);
  });
  renderGanttPanel(date);
}

// ══════════════════════════════════════════════════════
//  MAIN RENDER
// ══════════════════════════════════════════════════════

// Instant render from memory — called on tab switch
function renderRosterFromMemory() {
  clearPayCache();
  const weekDates = getWeekDates(_currentWeekStart);
  if (!weekDates.includes(_activeDay)) _activeDay = weekDates[0];
  const weekEnd = weekDates[6];

  const label = document.getElementById('roster-week-label');
  if (label) {
    const s = parseLocalDate(_currentWeekStart), e = parseLocalDate(weekEnd);
    label.textContent = `${s.toLocaleDateString('en-AU',{day:'numeric',month:'short'})} — ${e.toLocaleDateString('en-AU',{day:'numeric',month:'short',year:'numeric'})}`;
  }

  renderRosterKPIs(weekDates);
  renderDayTabs(weekDates);
  renderGanttPanel(_activeDay);
}

// Full render — fetches from Supabase if week not yet loaded, then renders
function renderRoster() {
  clearPayCache();
  const weekDates = getWeekDates(_currentWeekStart);
  const weekEnd   = weekDates[6];
  if (!weekDates.includes(_activeDay)) _activeDay = weekDates[0];

  const label = document.getElementById('roster-week-label');
  if (label) {
    const s = parseLocalDate(_currentWeekStart), e = parseLocalDate(weekEnd);
    label.textContent = `${s.toLocaleDateString('en-AU',{day:'numeric',month:'short'})} — ${e.toLocaleDateString('en-AU',{day:'numeric',month:'short',year:'numeric'})}`;
  }

  Promise.all([
    ensureShiftsLoaded(_currentWeekStart, weekEnd),
    ensureAvailabilityLoaded(),
  ]).then(() => {
    markShiftsLoaded(_currentWeekStart, weekEnd);
    renderRosterKPIs(weekDates);
    renderDayTabs(weekDates);
    renderGanttPanel(_activeDay);
  });
}

// ══════════════════════════════════════════════════════
//  WEEK KPIs
// ══════════════════════════════════════════════════════

function renderRosterKPIs(weekDates) {
  const el = document.getElementById('roster-kpis');
  if (!el) return;
  const weekShifts  = shifts.filter(s => weekDates.includes(s.date) && s.status !== 'cancelled');
  const assigned    = weekShifts.filter(s => s.employee_id);
  const unassigned  = weekShifts.filter(s => !s.employee_id);
  const activeEmps  = employees.filter(e => e.active !== false);
  let totalHours = 0, totalCost = 0;
  activeEmps.forEach(emp => {
    assigned.filter(s => s.employee_id === emp.id).forEach(s => {
      const p = cachedShiftPay(s, emp);
      totalHours += p.workedHours;
      totalCost  += p.totalPay;
    });
  });
  const staffed = new Set(assigned.map(s => s.employee_id)).size;
  let weekProj = 0;
  weekDates.forEach(d => { const s = getSalesSummary(d); if (s.proj) weekProj += s.proj; });
  const weekSpch = weekProj && totalHours ? (weekProj / totalHours).toFixed(2) : null;

  el.innerHTML = `
    <div class="kpi"><div class="kpi-label">Shifts This Week</div><div class="kpi-value">${weekShifts.length}</div></div>
    <div class="kpi"><div class="kpi-label">Staff Rostered</div><div class="kpi-value">${staffed} / ${activeEmps.length}</div></div>
    ${unassigned.length ? `<div class="kpi"><div class="kpi-label">Unassigned</div><div class="kpi-value warning">${unassigned.length}</div></div>` : ''}
    <div class="kpi"><div class="kpi-label">Total Hours</div><div class="kpi-value">${totalHours.toFixed(1)}h</div></div>
    <div class="kpi"><div class="kpi-label">Est. Labour Cost</div><div class="kpi-value negative">${fmt(totalCost)}</div></div>
    ${weekSpch ? `<div class="kpi"><div class="kpi-label">Week SPCH</div><div class="kpi-value" style="color:var(--success);">$${weekSpch}</div></div>` : ''}
  `;
}

// ══════════════════════════════════════════════════════
//  DAY TABS
// ══════════════════════════════════════════════════════

function renderDayTabs(weekDates) {
  const container = document.getElementById('roster-day-tabs');
  if (!container) return;
  const today = localDateStr(new Date());

  container.innerHTML = weekDates.map((date, i) => {
    const isActive   = date === _activeDay;
    const isToday    = date === today;
    const isPH       = isPublicHoliday(date);
    const dayShifts  = shifts.filter(s => s.date === date && s.status !== 'cancelled');
    const unassigned = dayShifts.filter(s => !s.employee_id).length;
    const d = parseLocalDate(date);

    let dayCost = 0, dayHours = 0;
    employees.filter(e => e.active !== false).forEach(emp => {
      dayShifts.filter(s => s.employee_id === emp.id).forEach(s => {
        const p = cachedShiftPay(s, emp); dayCost += p.totalPay; dayHours += p.workedHours;
      });
    });
    const { proj, target } = getSalesSummary(date);
    const displaySales = proj;
    const spch    = displaySales && dayHours ? Math.round(displaySales / dayHours) : null;
    const spchCol = spch && target ? spchColour(spch, target) : 'var(--text3)';
    const noProj  = !proj;

    return `
      <div class="day-tab ${isActive?'active':''} ${isToday?'today':''} ${noProj?'no-proj':''}" data-date="${date}" onclick="switchDay('${date}')">
        <div class="day-tab-top">
          <span class="day-tab-name">${DAY_SHORT[i]}</span>
          ${isToday    ? '<span class="today-dot"></span>' : ''}
          ${isPH       ? '<span class="ph-tag">PH</span>' : ''}
          ${unassigned ? `<span class="unassigned-dot" title="${unassigned} unassigned"></span>` : ''}
          ${noProj     ? '<span class="no-proj-dot" title="No projection entered"></span>' : ''}
        </div>
        <div class="day-tab-date">${d.getDate()}/${d.getMonth()+1}</div>
        <div class="day-tab-meta">
          <span>${dayShifts.length} shift${dayShifts.length!==1?'s':''}</span>
          ${dayHours > 0 ? `<span>${dayHours.toFixed(1)}h</span>` : ''}
        </div>
        ${dayCost > 0 ? `<div class="day-tab-cost">${fmt(dayCost)}</div>` : ''}
        ${noProj ? `<div class="day-tab-no-proj">No projection</div>` : ''}
        ${spch   ? `<div class="day-tab-spch" style="color:${spchCol};">$${spch}/h</div>` : ''}
      </div>
    `;
  }).join('');
}

// ══════════════════════════════════════════════════════
//  GANTT PANEL
// ══════════════════════════════════════════════════════

function renderGanttPanel(date) {
  const panel = document.getElementById('roster-gantt-panel');
  if (!panel) return;
  closeAssignPopover();

  const dayShifts  = shifts.filter(s => s.date === date && s.status !== 'cancelled');
  const activeEmps = employees.filter(e => e.active !== false);
  const weekDates  = getWeekDates(_currentWeekStart);
  const dayIdx     = weekDates.indexOf(date);

  // Only count assigned shifts for labour
  let dayHours = 0, dayCost = 0;
  activeEmps.forEach(emp => {
    dayShifts.filter(s => s.employee_id === emp.id).forEach(s => {
      const p = cachedShiftPay(s, emp); dayHours += p.workedHours; dayCost += p.totalPay;
    });
  });

  const unassignedCount = dayShifts.filter(s => !s.employee_id).length;
  const { proj, target } = getSalesSummary(date);
  const displaySales = proj;
  const spch    = displaySales && dayHours ? (displaySales / dayHours).toFixed(2) : null;
  const spchCol = spch && target ? spchColour(parseFloat(spch), target) : 'var(--text2)';
  const isPH    = isPublicHoliday(date);
  const d       = parseLocalDate(date);
  const noProj  = !proj;

  panel.innerHTML = `
    <div class="gantt-day-heading">
      <div>
        <div style="font-family:'DM Serif Display',serif;font-size:22px;line-height:1.1;">
          ${DAY_LONG[dayIdx] || '—'}
          ${isPH ? `<span style="font-size:11px;background:#fde2e2;color:var(--danger);padding:3px 9px;border-radius:99px;margin-left:8px;font-family:'DM Sans',sans-serif;">Public Holiday ${(getPenaltyMultiplier('publicHoliday', 'permanent') * 100).toFixed(0)}%</span>` : ''}
          ${unassignedCount ? `<span style="font-size:11px;background:#fff3cd;color:#856404;padding:3px 9px;border-radius:99px;margin-left:8px;font-family:'DM Sans',sans-serif;">⚠ ${unassignedCount} unassigned</span>` : ''}
        </div>
        <div style="font-size:12px;color:var(--text3);margin-top:2px;">${d.toLocaleDateString('en-AU',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}</div>
      </div>
      <div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap;">
        <div class="gantt-stat"><div class="gantt-stat-label">Hours</div><div class="gantt-stat-value" id="ghd-hours">${dayHours.toFixed(1)}h</div></div>
        <div class="gantt-stat"><div class="gantt-stat-label">Labour</div><div class="gantt-stat-value" id="ghd-cost" style="color:var(--danger);">${fmt(dayCost)}</div></div>
        <div class="gantt-stat">
          <div class="gantt-stat-label">SPCH</div>
          <div class="gantt-stat-value" id="ghd-spch" style="color:${spchCol};">${spch ? '$'+spch : '—'}</div>
          ${displaySales ? `<div style="font-size:10px;color:var(--text3);text-align:center;" id="ghd-sales">of $${(displaySales/1000).toFixed(1)}k</div>` : ''}
        </div>
        <div class="add-shift-wrap" title="${noProj?'Tip: add a sales projection first for SPCH tracking':''}">
          <button class="btn btn-primary btn-sm" onclick="event.stopPropagation();openAddShift('','${date}')">+ Add Shift</button>
        </div>
      </div>
    </div>
    ${noProj ? `
      <div class="no-proj-banner">
        <span>⚠ No sales projection for this day — SPCH tracking won't work until you add one.</span>
        <button class="btn btn-ghost btn-sm no-proj-banner-btn" onclick="goToSalesProjection('${date}')">Add projection →</button>
      </div>
    ` : ''}
    <div class="gantt-wrap" id="gantt-wrap-${date}">
      ${buildGanttDay(date, dayShifts, activeEmps)}
    </div>
  `;
}

// ══════════════════════════════════════════════════════
//  GANTT BUILD
// ══════════════════════════════════════════════════════

function timeToX(timeStr) {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  let hours = h + m / 60;
  if (hours < TIMELINE_START) hours += 24;
  return Math.max(0, Math.min(100, ((hours - TIMELINE_START) / TIMELINE_HOURS) * 100));
}

function xToTime(pct) {
  let totalHours = TIMELINE_START + (pct / 100) * TIMELINE_HOURS;
  let h = Math.floor(totalHours) % 24;
  let m = Math.round((totalHours % 1) * 60 / 15) * 15;
  if (m >= 60) { h = (h + 1) % 24; m = 0; }
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}

function buildGanttDay(date, dayShifts, activeEmps) {
  const hourMarks = [];
  for (let h = TIMELINE_START; h <= TIMELINE_END; h++) {
    const dispH = h % 24;
    const label = dispH === 0 ? '12am' : dispH < 12 ? `${dispH}am` : dispH === 12 ? '12pm' : `${dispH-12}pm`;
    hourMarks.push({ label, pct: ((h - TIMELINE_START) / TIMELINE_HOURS) * 100 });
  }

  const nowPct = (() => {
    const now = new Date();
    if (date !== localDateStr(now)) return null;
    const h = now.getHours() + now.getMinutes() / 60;
    if (h < TIMELINE_START || h > TIMELINE_END) return null;
    return ((h - TIMELINE_START) / TIMELINE_HOURS) * 100;
  })();

  const unassignedShifts = dayShifts.filter(s => !s.employee_id);
  // Only show employees who have shifts on this day — no empty rows
  const withShifts = activeEmps.filter(e => dayShifts.some(s => s.employee_id === e.id));
  // Stable manual order — seed on first render, never auto-sort
  if (!_rosterRowOrder[date]) {
    _rosterRowOrder[date] = withShifts.map(e => e.id);
  } else {
    withShifts.forEach(e => { if (!_rosterRowOrder[date].includes(e.id)) _rosterRowOrder[date].push(e.id); });
    _rosterRowOrder[date] = _rosterRowOrder[date].filter(id => withShifts.some(e => e.id === id));
  }
  withShifts.sort((a, b) => _rosterRowOrder[date].indexOf(a.id) - _rosterRowOrder[date].indexOf(b.id));
  const ordered = withShifts;

  const gridLines = hourMarks.slice(1).map(({pct}) =>
    `<div class="gantt-gridline" style="left:calc(var(--gcol) + (100% - var(--gcol)) * ${pct/100});"></div>`
  ).join('');

  const nowLine = nowPct !== null
    ? `<div class="gantt-now-line" style="left:calc(var(--gcol) + (100% - var(--gcol)) * ${nowPct/100});"></div>`
    : '';

  return `
    <div class="gantt-inner">
      <!-- Hour ruler -->
      <div class="gantt-ruler">
        <div class="gantt-emp-col" style="font-size:10px;color:var(--text3);padding-left:14px;font-weight:600;letter-spacing:.4px;">EMPLOYEE</div>
        <div class="gantt-ruler-track">
          ${hourMarks.map(({label,pct}) => `<div class="gantt-ruler-mark" style="left:${pct}%;">${label}</div>`).join('')}
          ${hourMarks.filter((_,i) => i > 0).map(({pct}) => `<div class="gantt-ruler-line" style="left:${pct}%;"></div>`).join('')}
        </div>
      </div>

      <div class="gantt-body" id="gantt-body-${date}">
        ${gridLines}${nowLine}

        <!-- ── UNASSIGNED ROW — always visible ── -->
        ${buildUnassignedRow(date, unassignedShifts)}

        <!-- ── EMPLOYEE ROWS ── -->
        ${ordered.map(emp => buildGanttRow(emp, date, dayShifts.filter(s => s.employee_id === emp.id))).join('')}
      </div>
    </div>
  `;
}

// ── Refresh all unassigned rows for a date ───────────────────────────────────
function refreshUnassignedRows(date) {
  const body = document.getElementById(`gantt-body-${date}`);
  if (!body) { renderGanttPanel(date); return; }

  // Remove all existing unassigned rows
  body.querySelectorAll('.gantt-row-unassigned').forEach(el => el.remove());

  // Rebuild and insert before the first employee row
  const unassigned = shifts.filter(s => s.date === date && !s.employee_id && s.status !== 'cancelled');
  const html = buildUnassignedRow(date, unassigned);
  const firstEmpRow = body.querySelector('.gantt-row:not(.gantt-row-unassigned)');
  if (firstEmpRow) {
    firstEmpRow.insertAdjacentHTML('beforebegin', html);
  } else {
    body.insertAdjacentHTML('beforeend', html);
  }
}

// ── Unassigned rows — one row per unassigned shift ──────────────────────────
function buildUnassignedRow(date, unassignedShifts) {
  if (!unassignedShifts.length) {
    // Empty placeholder row so there's always somewhere to drag
    return `
      <div class="gantt-row gantt-row-unassigned" id="gantt-row-unassigned-${date}">
        <div class="gantt-emp-col gantt-emp-unassigned">
          <div class="unassigned-icon">?</div>
          <div style="min-width:0;">
            <div style="font-weight:600;font-size:12px;color:var(--text2);">Unassigned</div>
            <div style="font-size:10px;color:var(--text3);">Drag here or click + Add Shift</div>
          </div>
        </div>
        <div class="gantt-track gantt-track-unassigned" data-emp="" data-date="${date}"
          onmousedown="onTrackMouseDown(event,'','${date}')"
          onclick="onTrackClick(event,'','${date}')">
        </div>
      </div>`;
  }

  // One row per unassigned shift — first row gets the "Unassigned" label
  return unassignedShifts.map((shift, i) => {
    const isFirst = i === 0;
    const rowId   = isFirst ? `gantt-row-unassigned-${date}` : `gantt-row-unassigned-${date}-${shift.id}`;
    return `
      <div class="gantt-row gantt-row-unassigned" id="${rowId}">
        <div class="gantt-emp-col gantt-emp-unassigned">
          ${isFirst ? `
            <div class="unassigned-icon">?</div>
            <div style="min-width:0;">
              <div style="font-weight:600;font-size:12px;color:var(--text2);">Unassigned</div>
              <div style="font-size:10px;color:var(--text3);">Click shift to assign</div>
            </div>
          ` : `<div style="flex:1;border-left:2px dashed var(--border);margin-left:13px;height:100%;min-height:36px;"></div>`}
        </div>
        <div class="gantt-track gantt-track-unassigned" data-emp="" data-date="${date}"
          onmousedown="onTrackMouseDown(event,'','${date}')"
          onclick="onTrackClick(event,'','${date}')">
          ${buildUnassignedBar(shift)}
        </div>
      </div>`;
  }).join('');
}

function buildUnassignedBar(shift) {
  const left  = timeToX(shift.start_time);
  const right = timeToX(shift.end_time);
  const width = Math.max(right - left, 2);
  const slim  = width < 8;

  // Duration for display
  const [sh,sm] = shift.start_time.split(':').map(Number);
  const [eh,em] = shift.end_time.split(':').map(Number);
  let sM = sh*60+sm, eM = eh*60+em;
  if (eM <= sM) eM += 1440;
  const hrs = ((eM - sM - (eM-sM > 300 ? 30 : 0)) / 60).toFixed(1);

  return `
    <div class="shift-bar shift-bar-unassigned" id="bar-${shift.id}"
      style="left:${left}%;width:${width}%;"
      title="${fmtTime(shift.start_time)}–${fmtTime(shift.end_time)} · Unassigned"
      onmousedown="event.stopPropagation();onBarMouseDown(event,'${shift.id}')"
      onclick="event.stopPropagation();openAssignPopover('${shift.id}',this)">
      <div class="shift-bar-handle left"  onmousedown="event.stopPropagation();onHandleMouseDown(event,'${shift.id}','start')"></div>
      <div class="shift-bar-label" style="${slim?'opacity:0;':''}">
        <span>${fmtTime(shift.start_time)}–${fmtTime(shift.end_time)}</span>
        <span style="opacity:.85;font-weight:700;">👤 Assign</span>
      </div>
      <div class="shift-bar-handle right" onmousedown="event.stopPropagation();onHandleMouseDown(event,'${shift.id}','end')"></div>
    </div>
  `;
}

// ── Employee rows — one row per shift, first row shows name ──────────────────
function buildGanttRow(emp, date, empShifts) {
  const initials = ((emp.first_name?.[0]||'')+(emp.last_name?.[0]||'')).toUpperCase();

  // Sort shifts by start time earliest first
  empShifts = [...empShifts].sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));

  let totalHours = 0, totalCost = 0;
  empShifts.forEach(s => { const p = cachedShiftPay(s,emp); totalHours += p.workedHours; totalCost += p.totalPay; });

  // Build availability overlay for this employee on this day
  const avOverlay = buildAvailabilityOverlay(emp.id, date);

  if (!empShifts.length) {
    // Employee with no shifts — show row so they can drag to create
    return `
      <div class="gantt-row" id="gantt-row-${emp.id}-${date}">
        <div class="gantt-emp-col">
          <div class="avatar" style="width:28px;height:28px;font-size:10px;flex-shrink:0;">${initials}</div>
          <div style="min-width:0;flex:1;">
            <div style="font-weight:600;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${emp.first_name} ${emp.last_name}</div>
            <div style="font-size:10px;color:var(--text3);">${emp.employment_type||'casual'}</div>
          </div>
        </div>
        <div class="gantt-track" data-emp="${emp.id}" data-date="${date}"
          onmousedown="onTrackMouseDown(event,'${emp.id}','${date}')"
          onclick="onTrackClick(event,'${emp.id}','${date}')">${avOverlay}</div>
      </div>`;
  }

  // One row per shift — first row shows the employee name, subsequent rows are blank in the emp col
  return empShifts.map((s, i) => {
    const isFirst = i === 0;
    const rowId   = isFirst ? `gantt-row-${emp.id}-${date}` : `gantt-row-${emp.id}-${date}-${s.id}`;
    return `
      <div class="gantt-row" id="${rowId}">
        <div class="gantt-emp-col" style="${!isFirst ? 'padding-top:0;' : ''}">
          ${isFirst ? `
            <div data-emp="${emp.id}" data-date="${date}"
              onpointerdown="onRowHandlePointerDown(event,'${emp.id}','${date}')"
              title="Drag to reorder"
              style="cursor:grab;padding:0 4px;color:var(--text3);font-size:14px;flex-shrink:0;user-select:none;">⠿</div>
            <div class="avatar" style="width:28px;height:28px;font-size:10px;flex-shrink:0;">${initials}</div>
            <div style="min-width:0;flex:1;">
              <div style="font-weight:600;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${emp.first_name} ${emp.last_name}</div>
              <div style="font-size:10px;color:var(--text3);">${emp.employment_type||'casual'}${totalHours>0?` · ${totalHours.toFixed(1)}h · ${fmt(totalCost)}`:''}</div>
            </div>
          ` : `<div style="flex:1;border-left:2px solid var(--border);margin-left:13px;height:100%;min-height:36px;"></div>`}
        </div>
        <div class="gantt-track" data-emp="${emp.id}" data-date="${date}"
          onmousedown="onTrackMouseDown(event,'${emp.id}','${date}')"
          onclick="onTrackClick(event,'${emp.id}','${date}')">
          ${isFirst ? avOverlay : ''}
          ${buildShiftBar(s, emp)}
        </div>
      </div>`;
  }).join('');
}

// ── Availability overlay — grey blocks for unavailable hours ─────────────────
function buildAvailabilityOverlay(empId, date) {
  const empAvail = availabilityData[empId];
  if (!empAvail) return ''; // no availability data — show nothing

  const d = parseLocalDate(date);
  const dow = d.getDay(); // 0=Sun … 6=Sat
  const avail = empAvail[dow];

  // If fully unavailable for this day
  if (avail && avail.available === false) {
    return `<div class="gantt-avail-overlay gantt-avail-unavailable" title="${getEmpName(empId)} is unavailable this day"></div>`;
  }

  // If available with time restrictions
  if (avail && avail.available === true && avail.start_time && avail.end_time) {
    const GANTT_START = 6; // 6am
    const GANTT_HOURS = 20; // 6am–2am (20hrs shown)
    const avStart = timeToDecimal(avail.start_time);
    const avEnd   = timeToDecimal(avail.end_time);

    const leftPct  = Math.max(0, ((GANTT_START - GANTT_START) / GANTT_HOURS) * 100);
    const beforeW  = Math.max(0, ((avStart - GANTT_START) / GANTT_HOURS) * 100);
    const afterL   = Math.max(0, ((avEnd - GANTT_START) / GANTT_HOURS) * 100);
    const afterW   = Math.max(0, (1 - afterL / 100) * 100);

    let overlays = '';
    if (beforeW > 0) {
      overlays += `<div class="gantt-avail-overlay gantt-avail-restricted" style="left:0;width:${beforeW}%" title="Unavailable before ${fmtTime(avail.start_time)}"></div>`;
    }
    if (afterL < 100) {
      overlays += `<div class="gantt-avail-overlay gantt-avail-restricted" style="left:${afterL}%;width:${100 - afterL}%" title="Unavailable after ${fmtTime(avail.end_time)}"></div>`;
    }
    return overlays;
  }

  return ''; // available all day — no overlay
}

function timeToDecimal(timeStr) {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return h + m / 60;
}

function getEmpName(empId) {
  const emp = employees.find(e => e.id === empId);
  return emp ? `${emp.first_name} ${emp.last_name}` : 'Employee';
}

function buildShiftBar(shift, emp) {
  const left  = timeToX(shift.start_time);
  const right = timeToX(shift.end_time);
  const width = Math.max(right - left, 1.5);
  const pay   = cachedShiftPay(shift, emp);
  const bg    = { permanent:'var(--accent)', casual:'#4f8ef7', parttime:'#805ad5' }[emp.employment_type||'casual'] || '#4f8ef7';
  const slim  = width < 5;

  return `
    <div class="shift-bar" id="bar-${shift.id}"
      style="left:${left}%;width:${width}%;background:${bg};"
      title="${fmtTime(shift.start_time)}–${fmtTime(shift.end_time)} · ${pay.workedHours}h · ${fmt(pay.totalPay)}"
      onmousedown="event.stopPropagation();onBarMouseDown(event,'${shift.id}')">
      <div class="shift-bar-handle left"  onmousedown="event.stopPropagation();onHandleMouseDown(event,'${shift.id}','start')"></div>
      <div class="shift-bar-label" style="${slim?'opacity:0;':''}">
        <span>${fmtTime(shift.start_time)}–${fmtTime(shift.end_time)}</span>
        <span style="opacity:.75;">${pay.workedHours}h · ${fmt(pay.totalPay)}</span>
      </div>
      <div class="shift-bar-handle right" onmousedown="event.stopPropagation();onHandleMouseDown(event,'${shift.id}','end')"></div>
    </div>
  `;
}

// ══════════════════════════════════════════════════════
//  ASSIGN POPOVER
// ══════════════════════════════════════════════════════

function openAssignPopover(shiftId, barEl) {
  closeAssignPopover();

  const shift = shifts.find(s => s.id === shiftId);
  if (!shift) return;

  const activeEmps = employees.filter(e => e.active !== false);
  if (!activeEmps.length) { toast('Add employees first'); return; }

  // Check availability for warning purposes
  const d = parseLocalDate(shift.date);
  const dow = d.getDay();

  const popover = document.createElement('div');
  popover.className = 'assign-popover';
  popover.id = 'assign-popover';

  popover.innerHTML = `
    <div class="assign-popover-header">
      <div>
        <div style="font-weight:700;font-size:13px;">Assign Shift</div>
        <div style="font-size:11px;color:var(--text3);">${fmtTime(shift.start_time)}–${fmtTime(shift.end_time)}</div>
      </div>
      <button class="assign-popover-close" onclick="closeAssignPopover()">✕</button>
    </div>
    <div class="assign-emp-list">
      ${activeEmps.map(emp => {
        const initials   = ((emp.first_name?.[0]||'')+(emp.last_name?.[0]||'')).toUpperCase();
        const isAssigned = shift.employee_id === emp.id;
        const pay        = calcShiftPay({ ...shift, employee_id: emp.id }, emp);
        const empAvail   = availabilityData[emp.id];
        const avail      = empAvail?.[dow];
                const unavailable = avail && avail.available === false;
        const restricted  = avail && avail.available === true && avail.start_time && avail.end_time;
        const availNote   = unavailable
          ? ' · <span style="color:var(--danger);font-weight:600;">Unavailable</span>'
          : restricted
            ? ' · <span style="color:var(--warning);font-weight:600;">' + fmtTime(avail.start_time) + '–' + fmtTime(avail.end_time) + '</span>'
            : '';
        return `
          <div class="assign-emp-row ${isAssigned?'assigned':''}" onclick="assignShift('${shiftId}','${emp.id}')">
            <div class="avatar" style="width:28px;height:28px;font-size:10px;flex-shrink:0;${isAssigned?'background:var(--success);':unavailable?'opacity:.5;':''}">${initials}</div>
            <div style="flex:1;min-width:0;">
              <div style="font-weight:600;font-size:12px;${unavailable?'color:var(--text2);font-style:italic;':''}">${emp.first_name} ${emp.last_name}</div>
              <div style="font-size:10px;color:var(--text3);">${emp.employment_type||'casual'}${availNote}</div>
            </div>
            <div style="text-align:right;font-size:11px;">
              <div class="mono" style="font-weight:700;color:var(--success);">${fmt(pay.totalPay)}</div>
              <div style="color:var(--text3);">${pay.workedHours}h · ${(pay.multiplier*100).toFixed(0)}%</div>
            </div>
            ${isAssigned ? '<div style="font-size:16px;margin-left:4px;">✓</div>' : ''}
          </div>
        `;
      }).join('')}
    </div>
    <div style="padding:10px 14px;border-top:1px solid var(--border);display:flex;gap:8px;">
      <button class="btn btn-ghost btn-sm" style="flex:1;" onclick="openEditShiftFromPopover('${shiftId}')">✏ Edit Times</button>
      <button class="btn btn-ghost btn-sm" style="color:var(--danger);" onclick="deleteUnassignedShift('${shiftId}')">Delete</button>
    </div>
  `;

  // Append hidden first so offsetHeight is accurate after layout
  popover.style.visibility = 'hidden';
  document.body.appendChild(popover);
  requestAnimationFrame(() => {
    const barRect = barEl.getBoundingClientRect();
    const popW    = 280;
    const popH    = popover.offsetHeight || 320;
    let   left    = barRect.left + barRect.width / 2 - popW / 2;
    let   top     = barRect.bottom + 8 + window.scrollY;
    left = Math.max(8, Math.min(left, window.innerWidth - popW - 8));
    if (barRect.bottom + popH + 8 > window.innerHeight) top = barRect.top + window.scrollY - popH - 8;
    top = Math.max(window.scrollY + 8, top);
    popover.style.left       = left + 'px';
    popover.style.top        = top  + 'px';
    popover.style.visibility = '';
  });

  _assignPopover = { shiftId, el: popover };

  // Close on outside click (next tick so this click doesn't immediately close it)
  setTimeout(() => {
    document.addEventListener('mousedown', onOutsideClick, { once: true });
  }, 0);
}

function onOutsideClick(e) {
  if (!document.getElementById('assign-popover')?.contains(e.target)) {
    closeAssignPopover();
  } else {
    // Re-attach if click was inside
    setTimeout(() => document.addEventListener('mousedown', onOutsideClick, { once: true }), 0);
  }
}

function closeAssignPopover() {
  const el = document.getElementById('assign-popover');
  if (el) el.remove();
  _assignPopover = null;
}

async function assignShift(shiftId, empId) {
  const shift = shifts.find(s => s.id === shiftId);
  if (!shift) return;

  const oldEmpId = shift.employee_id;
  shift.employee_id = empId;
  await dbSaveShift(shift);
  closeAssignPopover();

  // Refresh unassigned row
  const unassignedRowEl = document.getElementById(`gantt-row-unassigned-${shift.date}`);
  if (unassignedRowEl) {
    const unassigned = shifts.filter(s => s.date === shift.date && !s.employee_id && s.status !== 'cancelled');
    refreshUnassignedRows(shift.date);
  }

  // Refresh old employee row if reassigning
  if (oldEmpId) {
    const oldEmp = employees.find(e => e.id === oldEmpId);
    if (oldEmp) refreshEmpRows(oldEmp, shift.date);
  }

  // Refresh new employee row
  const emp = employees.find(e => e.id === empId);
  if (emp) refreshEmpRows(emp, shift.date);

  refreshDayHeading(shift.date);
  renderDayTabs(getWeekDates(_currentWeekStart));
  renderRosterKPIs(getWeekDates(_currentWeekStart));
  toast(`Assigned to ${emp?.first_name} ${emp?.last_name} ✓`);
}

function openEditShiftFromPopover(shiftId) {
  closeAssignPopover();
  openEditShift(shiftId);
}

async function deleteUnassignedShift(shiftId) {
  const shift = shifts.find(s => s.id === shiftId);
  if (!shift) return;
  const date  = shift.date;
  const empId = shift.employee_id;
  closeAssignPopover(); // close first so outside-click handler doesn't interfere
  await dbDeleteShift(shiftId);

  if (date === _activeDay) {
    if (empId) {
      const emp   = employees.find(e => e.id === empId);
      const rowEl = document.getElementById(`gantt-row-${empId}-${date}`);
      if (emp && rowEl) {
        const empShifts = shifts.filter(s => s.employee_id === empId && s.date === date && s.status !== 'cancelled');
        rowEl.outerHTML = buildGanttRow(emp, date, empShifts);
      }
    } else {
      const rowEl = document.getElementById(`gantt-row-unassigned-${date}`);
      if (rowEl) {
        const unassigned = shifts.filter(s => s.date === date && !s.employee_id && s.status !== 'cancelled');
        refreshUnassignedRows(date);
      }
    }
    refreshDayHeading(date);
  }

  renderDayTabs(getWeekDates(_currentWeekStart));
  renderRosterKPIs(getWeekDates(_currentWeekStart));
  toast('Shift deleted');
}

// ══════════════════════════════════════════════════════
//  DRAG ENGINE
// ══════════════════════════════════════════════════════

// ── 1. CREATE — drag on empty track to draw a new shift
function onTrackMouseDown(e, empId, date) {
  if (!canAccess('roster_edit')) return; // Payroll officers view only
  if (e.target.closest('.shift-bar')) return;
  e.preventDefault();
  closeAssignPopover();
  const trackEl  = e.currentTarget;
  const startX   = e.clientX;
  const startPct = (() => { const r = trackEl.getBoundingClientRect(); return ((e.clientX - r.left) / r.width) * 100; })();

  let ghost = null, active = false;

  function move(ev) {
    const rect   = trackEl.getBoundingClientRect();
    const curPct = Math.max(0, Math.min(100, ((ev.clientX - rect.left) / rect.width) * 100));
    if (!active && Math.abs(ev.clientX - startX) < DRAG_THRESHOLD) return;
    active = true;
    if (!ghost) {
      ghost = document.createElement('div');
      ghost.className = `shift-bar ghost-bar${!empId ? ' ghost-bar-unassigned' : ''}`;
      ghost.innerHTML = `<div class="shift-bar-label"><span></span></div>`;
      trackEl.appendChild(ghost);
    }
    const lo = Math.min(startPct, curPct);
    const hi = Math.max(startPct, curPct);
    ghost.style.left  = lo + '%';
    ghost.style.width = Math.max(hi - lo, 0.3) + '%';
    const labelEl = ghost.querySelector('span');
    if (hi - lo > 2) labelEl.textContent = `${fmtTime(xToTime(lo))} – ${fmtTime(xToTime(hi))}`;
    else             labelEl.textContent = '';
  }

  function up(ev) {
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', up);
    document.body.style.userSelect = '';
    if (ghost) ghost.remove();
    if (document.querySelector('.modal-overlay.show')) return;
    if (!active) return;
    const rect   = trackEl.getBoundingClientRect();
    const curPct = Math.max(0, Math.min(100, ((ev.clientX - rect.left) / rect.width) * 100));
    const lo = Math.min(startPct, curPct);
    const hi = Math.max(startPct, curPct);
    const newStart = xToTime(lo), newEnd = xToTime(hi);
    const [sh,sm] = newStart.split(':').map(Number);
    const [eh,em] = newEnd.split(':').map(Number);
    let sM = sh*60+sm, eM = eh*60+em;
    if (eM <= sM) eM += 1440;
    if (eM - sM < 15) return;
    _dragJustFinished = true;
    setTimeout(() => { _dragJustFinished = false; }, 100);
    openAddShift(empId, date, newStart, newEnd);
  }

  document.body.style.userSelect = 'none';
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
}

// Plain click on empty track → open modal at that hour (employee rows only)
function onTrackClick(e, empId, date) {
  if (e.target.closest('.shift-bar')) return;
  if (_dragJustFinished) return; // suppress click fired after drag-create
  // Unassigned track: clicks are handled by bar popovers; empty clicks do nothing
  if (!empId) return;
  closeAssignPopover();
  const rect = e.currentTarget.getBoundingClientRect();
  const pct  = ((e.clientX - rect.left) / rect.width) * 100;
  const [h]  = xToTime(pct).split(':').map(Number);
  const sh   = String(h).padStart(2,'0');
  const eh   = String((h+4)%24).padStart(2,'0');
  openAddShift(empId, date, `${sh}:00`, `${eh}:00`);
}

// ── 2. MOVE — drag existing bar
function onBarMouseDown(e, shiftId) {
  if (!canAccess('roster_edit')) return; // Payroll officers view only
  e.preventDefault();
  closeAssignPopover();
  const shift   = shifts.find(s => s.id === shiftId);
  const bar     = document.getElementById(`bar-${shiftId}`);
  const trackEl = bar?.closest('.gantt-track');
  if (!shift || !bar || !trackEl) return;

  const startX   = e.clientX;
  const origLeft = parseFloat(bar.style.left);
  const origW    = parseFloat(bar.style.width);
  let moved = false;

  function move(ev) {
    if (!moved && Math.abs(ev.clientX - startX) < DRAG_THRESHOLD) return;
    moved = true;
    const rect     = trackEl.getBoundingClientRect();
    const deltaPct = ((ev.clientX - startX) / rect.width) * 100;
    const newLeft  = Math.max(0, Math.min(100 - origW, origLeft + deltaPct));
    bar.style.left    = newLeft + '%';
    bar.style.opacity = '0.8';
    const labelEl = bar.querySelector('.shift-bar-label span');
    if (labelEl) labelEl.textContent = `${fmtTime(xToTime(newLeft))}–${fmtTime(xToTime(newLeft+origW))}`;
  }

  async function up() {
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', up);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    bar.style.opacity = '';
    if (!moved) {
      // Unassigned bar: open assign popover. Assigned bar: open edit modal.
      if (!shift.employee_id) openAssignPopover(shiftId, bar);
      else                    openEditShift(shiftId);
      return;
    }
    const newLeft = parseFloat(bar.style.left);
    shift.start_time = xToTime(newLeft);
    shift.end_time   = xToTime(newLeft + origW);
    shift.break_mins = null;
    await dbSaveShift(shift);
    refreshGanttRow(shiftId);
    toast(`${fmtTime(shift.start_time)}–${fmtTime(shift.end_time)} ✓`);
  }

  document.body.style.cursor     = 'grabbing';
  document.body.style.userSelect = 'none';
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
}

// ── 3. RESIZE — drag left/right handle
function onHandleMouseDown(e, shiftId, side) {
  if (!canAccess('roster_edit')) return; // Payroll officers view only
  e.preventDefault();
  closeAssignPopover();
  const shift   = shifts.find(s => s.id === shiftId);
  const bar     = document.getElementById(`bar-${shiftId}`);
  const trackEl = bar?.closest('.gantt-track');
  if (!shift || !bar || !trackEl) return;

  const origLeft  = parseFloat(bar.style.left);
  const origWidth = parseFloat(bar.style.width);

  function move(ev) {
    const rect   = trackEl.getBoundingClientRect();
    const curPct = Math.max(0, Math.min(100, ((ev.clientX - rect.left) / rect.width) * 100));
    if (side === 'start') {
      const newLeft = Math.min(curPct, origLeft + origWidth - 1.5);
      bar.style.left  = Math.max(0, newLeft) + '%';
      bar.style.width = (origLeft + origWidth - Math.max(0, newLeft)) + '%';
    } else {
      bar.style.width = Math.max(1.5, curPct - origLeft) + '%';
    }
    bar.style.opacity = '0.8';
    const curLeft = parseFloat(bar.style.left);
    const curW    = parseFloat(bar.style.width);
    const labelEl = bar.querySelector('.shift-bar-label span');
    if (labelEl) labelEl.textContent = `${fmtTime(xToTime(curLeft))}–${fmtTime(xToTime(curLeft+curW))}`;
  }

  async function up() {
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', up);
    document.body.style.cursor     = '';
    document.body.style.userSelect = '';
    bar.style.opacity = '';
    const curLeft = parseFloat(bar.style.left);
    const curW    = parseFloat(bar.style.width);
    if (side === 'start') shift.start_time = xToTime(curLeft);
    else                  shift.end_time   = xToTime(curLeft + curW);
    shift.break_mins = null;
    await dbSaveShift(shift);
    refreshGanttRow(shiftId);
    toast(`${fmtTime(shift.start_time)}–${fmtTime(shift.end_time)} ✓`);
  }

  document.body.style.cursor     = 'ew-resize';
  document.body.style.userSelect = 'none';
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
}

// ══════════════════════════════════════════════════════
//  REFRESH HELPERS
// ══════════════════════════════════════════════════════

// Refresh all gantt rows for a given employee on a date (handles one-row-per-shift)
function refreshEmpRows(emp, date) {
  const empShifts = shifts.filter(s => s.employee_id === emp.id && s.date === date && s.status !== 'cancelled');
  const newHtml   = buildGanttRow(emp, date, empShifts);
  const body = document.getElementById(`gantt-body-${date}`);
  if (!body) return;
  body.querySelectorAll(`[id^="gantt-row-${emp.id}-${date}"]`).forEach(el => el.remove());
  const unassignedRow = document.getElementById(`gantt-row-unassigned-${date}`);
  const ref = unassignedRow?.nextSibling || null;
  const tmp = document.createElement('div');
  tmp.innerHTML = newHtml;
  while (tmp.firstChild) body.insertBefore(tmp.firstChild, ref);
}

function refreshGanttRow(shiftId) {
  const shift = shifts.find(s => s.id === shiftId);
  if (!shift) return;
  clearPayCache();

  if (!shift.employee_id) {
    const rowEl = document.getElementById(`gantt-row-unassigned-${shift.date}`);
    if (rowEl) {
      const unassigned = shifts.filter(s => s.date === shift.date && !s.employee_id && s.status !== 'cancelled');
      refreshUnassignedRows(shift.date);
    }
  } else {
    // With one-row-per-shift, remove ALL rows for this employee on this date
    // then re-insert them after the first row's position
    const emp = employees.find(e => e.id === shift.employee_id);
    if (!emp) return;
    const empShifts = shifts.filter(s => s.employee_id === emp.id && s.date === shift.date && s.status !== 'cancelled');
    const newHtml   = buildGanttRow(emp, shift.date, empShifts);

    // Remove all existing rows for this employee on this date
    const body = document.getElementById(`gantt-body-${shift.date}`);
    if (body) {
      body.querySelectorAll(`[id^="gantt-row-${emp.id}-${shift.date}"]`).forEach(el => el.remove());
      // Re-insert after the unassigned row
      const unassignedRow = document.getElementById(`gantt-row-unassigned-${shift.date}`);
      const ref = unassignedRow?.nextSibling || null;
      const tmp = document.createElement('div');
      tmp.innerHTML = newHtml;
      while (tmp.firstChild) body.insertBefore(tmp.firstChild, ref);
    }
  }

  refreshDayHeading(shift.date);
  renderDayTabs(getWeekDates(_currentWeekStart));
  renderRosterKPIs(getWeekDates(_currentWeekStart));
}

function refreshDayHeading(date) {
  const dayShifts  = shifts.filter(s => s.date === date && s.status !== 'cancelled');
  const activeEmps = employees.filter(e => e.active !== false);
  let dayHours = 0, dayCost = 0;
  activeEmps.forEach(emp => {
    dayShifts.filter(s => s.employee_id === emp.id).forEach(s => {
      const p = calcShiftPay(s, emp); dayHours += p.workedHours; dayCost += p.totalPay;
    });
  });
  const { proj, target } = getSalesSummary(date);
  const displaySales = proj;
  const spch    = displaySales && dayHours ? (displaySales / dayHours).toFixed(2) : null;
  const spchCol = spch && target ? spchColour(parseFloat(spch), target) : 'var(--text2)';
  const hEl = document.getElementById('ghd-hours'); if (hEl) hEl.textContent = `${dayHours.toFixed(1)}h`;
  const cEl = document.getElementById('ghd-cost');  if (cEl) cEl.textContent = fmt(dayCost);
  const sEl = document.getElementById('ghd-spch');  if (sEl) { sEl.textContent = spch ? `$${spch}` : '—'; sEl.style.color = spchCol; }

  // Toggle no-projection banner
  const panel    = document.getElementById('roster-gantt-panel');
  const existing = panel?.querySelector('.no-proj-banner');
  if (!proj && !existing && panel) {
    const banner = document.createElement('div');
    banner.className = 'no-proj-banner';
    banner.innerHTML = `<span>⚠ No sales projection for this day — SPCH tracking won't work until you add one.</span><button class="btn btn-ghost btn-sm no-proj-banner-btn" onclick="goToSalesProjection('${date}')">Add projection →</button>`;
    const ganttWrap = panel.querySelector('.gantt-wrap');
    if (ganttWrap) panel.insertBefore(banner, ganttWrap);
  } else if (proj && existing) {
    existing.remove();
  }
}

function refreshRosterDaySpch(date) {
  if (date === _activeDay) refreshDayHeading(date);
  renderDayTabs(getWeekDates(_currentWeekStart));
}

// ══════════════════════════════════════════════════════
//  SHIFT MODAL
// ══════════════════════════════════════════════════════

async function openAddShift(employeeId, date, startTime, endTime) {
  if (!canAccess('roster_edit')) return;
  // If called from the "+ Add Shift" button (no employee), instantly drop an
  // unassigned bar onto the gantt and open the assign popover — no modal needed.
  if (!employeeId) {
    const targetDate = date || _activeDay;
    const shift = {
      id:          uid(),
      employee_id: null,
      date:        targetDate,
      start_time:  startTime || '09:00',
      end_time:    endTime   || '17:00',
      break_mins:  null,
      notes:       '',
      status:      'published',
    };
    await dbSaveShift(shift);

    // Remove all existing unassigned rows for this date and rebuild them
    refreshUnassignedRows(targetDate);

    renderDayTabs(getWeekDates(_currentWeekStart));
    renderRosterKPIs(getWeekDates(_currentWeekStart));

    // Immediately open the assign popover on the new bar
    setTimeout(() => {
      const barEl = document.getElementById(`bar-${shift.id}`);
      if (barEl) openAssignPopover(shift.id, barEl);
    }, 50);

    toast('Unassigned shift added — assign to an employee below');
    return;
  }

  // Called from drag-create with a specific employee — open the modal as before
  document.getElementById('shift-modal-title').textContent = 'Add Shift';
  document.getElementById('shift-edit-id').value  = '';
  document.getElementById('shift-employee').value = employeeId || '';
  document.getElementById('shift-date').value     = date || _activeDay;
  document.getElementById('shift-start').value    = startTime || '09:00';
  document.getElementById('shift-end').value      = endTime   || '17:00';
  document.getElementById('shift-break').value    = '';
  document.getElementById('shift-notes').value    = '';
  document.getElementById('shift-status').value   = 'published';
  populateShiftEmployeeSelect();
  updateShiftPreview();
  const delBtn = document.getElementById('shift-delete-btn');
  if (delBtn) delBtn.style.display = 'none';
  document.getElementById('shift-modal').classList.add('show');
}

function openEditShift(shiftId) {
  const s = shifts.find(s => s.id === shiftId);
  if (!s) return;
  document.getElementById('shift-modal-title').textContent = 'Edit Shift';
  document.getElementById('shift-edit-id').value   = s.id;
  document.getElementById('shift-employee').value  = s.employee_id || '';
  document.getElementById('shift-date').value      = s.date;
  document.getElementById('shift-start').value     = s.start_time;
  document.getElementById('shift-end').value       = s.end_time;
  document.getElementById('shift-break').value     = s.break_mins || '';
  document.getElementById('shift-notes').value     = s.notes || '';
  document.getElementById('shift-status').value    = s.status || 'published';
  populateShiftEmployeeSelect();
  updateShiftPreview();
  const delBtn = document.getElementById('shift-delete-btn');
  if (delBtn) delBtn.style.display = '';
  document.getElementById('shift-modal').classList.add('show');
}

function updateShiftPreview() {
  const empId   = document.getElementById('shift-employee').value;
  const date    = document.getElementById('shift-date').value;
  const start   = document.getElementById('shift-start').value;
  const end     = document.getElementById('shift-end').value;
  const breakM  = parseInt(document.getElementById('shift-break').value) || null;
  const preview = document.getElementById('shift-pay-preview');
  if (!preview) return;
  if (!empId) {
    preview.innerHTML = `<div style="background:var(--bg);border-radius:8px;padding:12px 14px;font-size:12px;margin-top:12px;color:var(--text3);">Select an employee to preview pay — or save without one to create an unassigned shift.</div>`;
    return;
  }
  const emp = employees.find(e => e.id === empId);
  if (!emp || !date || !start || !end) { preview.innerHTML = ''; return; }
  const pay = calcShiftPay({ employee_id: empId, date, start_time: start, end_time: end, break_mins: breakM }, emp);
  const autoBreak = calcBreakMins(
    ((parseInt(end.split(':')[0])*60+parseInt(end.split(':')[1])) -
     (parseInt(start.split(':')[0])*60+parseInt(start.split(':')[1]))) / 60
  );
  preview.innerHTML = `
    <div style="background:var(--bg);border-radius:8px;padding:12px 14px;font-size:12px;margin-top:12px;">
      <div style="font-weight:600;margin-bottom:8px;">Pay Preview — ${emp.first_name} ${emp.last_name}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;color:var(--text2);">
        <span>Rate type</span><span style="font-weight:500;color:var(--text);">${penaltyLabel(pay.penaltyKey)} (${(pay.multiplier*100).toFixed(0)}%)</span>
        <span>Base rate</span><span class="mono">${fmt(pay.baseRate)}/hr</span>
        <span>Hourly rate</span><span class="mono">${fmt(pay.hourlyRate)}/hr</span>
        <span>Hours worked</span><span class="mono">${pay.workedHours}h</span>
        ${pay.isMinimumEngagement?`<span style="color:var(--warning);">Min engagement</span><span class="mono" style="color:var(--warning);">${MIN_ENGAGEMENT_HOURS}h applied</span>`:''}
        ${autoBreak>0?`<span>Break</span><span class="mono">${autoBreak}min unpaid</span>`:''}
        ${pay.laundryAllowance>0?`<span>Laundry</span><span class="mono">${fmt(pay.laundryAllowance)}</span>`:''}
        <span style="font-weight:700;color:var(--text);">Estimated pay</span><span class="mono" style="font-weight:700;font-size:14px;">${fmt(pay.totalPay)}</span>
      </div>
      ${isPublicHoliday(date) ? `<div style="color:var(--danger);margin-top:8px;font-size:11px;">🎉 Public holiday — ${(getPenaltyMultiplier('publicHoliday', 'permanent') * 100).toFixed(0)}% applies</div>` : ''}
    </div>`;
}

async function saveShift() {
  const editId    = document.getElementById('shift-edit-id').value;
  const empId     = document.getElementById('shift-employee').value; // can be empty
  const date      = document.getElementById('shift-date').value;
  const startTime = document.getElementById('shift-start').value;
  const endTime   = document.getElementById('shift-end').value;
  const breakMins = parseInt(document.getElementById('shift-break').value) || null;
  const notes     = document.getElementById('shift-notes').value.trim();
  const status    = document.getElementById('shift-status').value;
  if (!date||!startTime||!endTime) { toast('Date and times required'); return; }

  const shift = {
    id:          editId || uid(),
    employee_id: empId || null,
    date, start_time: startTime, end_time: endTime,
    break_mins: breakMins, notes, status,
  };
  await dbSaveShift(shift);
  _dragJustFinished = true;
  setTimeout(() => { _dragJustFinished = false; }, 300);
  closeModal('shift-modal');
  if (date === _activeDay) renderGanttPanel(date);
  renderDayTabs(getWeekDates(_currentWeekStart));
  renderRosterKPIs(getWeekDates(_currentWeekStart));
  toast(empId ? `Shift ${editId?'updated':'added'} ✓` : 'Unassigned shift created — click to assign');
}

async function deleteShiftConfirm() {
  if (!canAccess('roster_edit')) return;
  const id = document.getElementById('shift-edit-id').value;
  if (!id || !confirm('Delete this shift?')) return;
  const shift = shifts.find(s => s.id === id);
  const date  = shift?.date;
  const empId = shift?.employee_id;
  await dbDeleteShift(id);
  _dragJustFinished = true;
  setTimeout(() => { _dragJustFinished = false; }, 300);
  closeModal('shift-modal');

  if (date === _activeDay) {
    if (empId) {
      const emp = employees.find(e => e.id === empId);
      if (emp) refreshEmpRows(emp, date);
    } else {
      const rowEl = document.getElementById(`gantt-row-unassigned-${date}`);
      if (rowEl) {
        const unassigned = shifts.filter(s => s.date === date && !s.employee_id && s.status !== 'cancelled');
        refreshUnassignedRows(date);
      }
    }
    refreshDayHeading(date);
  }

  renderDayTabs(getWeekDates(_currentWeekStart));
  renderRosterKPIs(getWeekDates(_currentWeekStart));
  toast('Shift deleted');
}

function populateShiftEmployeeSelect() {
  const sel = document.getElementById('shift-employee');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">— Unassigned —</option>' +
    employees.filter(e => e.active !== false).map(e =>
      `<option value="${e.id}" ${e.id===cur?'selected':''}>${e.first_name} ${e.last_name} (${e.employment_type||'casual'})</option>`
    ).join('');
}

// ══════════════════════════════════════════════════════
//  PUBLISH WEEK
// ══════════════════════════════════════════════════════

async function publishWeek() {
  const weekDates  = getWeekDates(_currentWeekStart);
  const weekEnd    = weekDates[6];
  const btn        = document.getElementById('publish-week-btn');

  // Get all non-cancelled shifts this week
  const weekShifts = shifts.filter(s =>
    weekDates.includes(s.date) && s.status !== 'cancelled'
  );

  if (!weekShifts.length) {
    toast('No shifts to publish this week');
    return;
  }

  if (!confirm(`Publish ${weekShifts.length} shift${weekShifts.length !== 1 ? 's' : ''} for this week? Employees with Tayla accounts will be notified.`)) return;

  btn.textContent = 'Publishing…';
  btn.disabled    = true;

  try {
    // 1. Mark all draft shifts as published in DB
    const draftShifts = weekShifts.filter(s => s.status === 'draft');
    for (const shift of draftShifts) {
      shift.status = 'published';
      await dbSaveShift(shift);
    }

    // 2. Push to Tayla via Edge Function
    const token = _supabase.changedAccessToken
      || (await _supabase.auth.getSession()).data.session?.access_token;

    const res = await fetch(
      'https://whedwekxzjfqwjuoarid.supabase.co/functions/v1/push-shifts',
      {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          business_id: _businessId,
          week_start:  _currentWeekStart,
          week_end:    weekEnd,
        }),
      }
    );

    const data = await res.json();

    if (!res.ok || data.error) throw new Error(data.error || 'Push failed');

    // 3. Refresh roster to show published status
    renderRoster();

    const notified = data.employees_notified || 0;
    const msg = notified > 0
      ? `Week published ✓ · ${notified} employee${notified !== 1 ? 's' : ''} notified on Tayla`
      : `Week published ✓ · No employees connected to Tayla yet`;

    toast(msg, 5000);

  } catch (err) {
    console.error('Publish week failed:', err);
    toast('⚠ ' + err.message);
  } finally {
    btn.textContent = '📢 Publish Week';
    btn.disabled    = false;
  }
}


// ══════════════════════════════════════════════════════
//  MANUAL ROW REORDER — drag ⠿ handle to reorder employees
// ══════════════════════════════════════════════════════

if (typeof _rosterRowOrder === 'undefined') var _rosterRowOrder = {};

let _rowDrag = null;

function onRowHandlePointerDown(e, empId, date) {
  e.preventDefault();
  e.stopPropagation();
  const body = document.getElementById('gantt-body-' + date);
  if (!body) return;
  const dragRowEl = document.getElementById('gantt-row-' + empId + '-' + date);
  if (!dragRowEl) return;
  const rect    = dragRowEl.getBoundingClientRect();
  const offsetY = e.clientY - rect.top;
  const ghost   = dragRowEl.cloneNode(true);
  ghost.id      = 'gantt-row-drag-ghost';
  ghost.style.cssText = 'position:fixed;left:' + rect.left + 'px;width:' + rect.width + 'px;top:' + rect.top + 'px;opacity:0.85;pointer-events:none;z-index:9999;background:var(--surface);box-shadow:0 4px 20px rgba(0,0,0,0.18);border:1px solid var(--accent);border-radius:6px;';
  document.body.appendChild(ghost);
  dragRowEl.style.opacity = '0.3';
  _rowDrag = { empId, date, offsetY, ghost, dragRowEl };
  document.addEventListener('pointermove', onRowDragMove, { passive: false });
  document.addEventListener('pointerup', onRowDragEnd);
}

function onRowDragMove(e) {
  if (!_rowDrag) return;
  e.preventDefault();
  _rowDrag.ghost.style.top = (e.clientY - _rowDrag.offsetY) + 'px';
}

function onRowDragEnd(e) {
  if (!_rowDrag) return;
  document.removeEventListener('pointermove', onRowDragMove);
  document.removeEventListener('pointerup', onRowDragEnd);
  var empId = _rowDrag.empId, date = _rowDrag.date;
  _rowDrag.ghost.remove();
  _rowDrag.dragRowEl.style.opacity = '';
  _rowDrag = null;
  var body = document.getElementById('gantt-body-' + date);
  if (!body) return;
  var handles = Array.from(body.querySelectorAll('[data-emp][data-date="' + date + '"]'));
  var currentOrder = handles.map(function(h) { return h.dataset.emp; });
  var fromIdx = currentOrder.indexOf(empId);
  if (fromIdx > -1) currentOrder.splice(fromIdx, 1);
  var targetEmpId = null, insertBefore = true;
  for (var i = 0; i < handles.length; i++) {
    if (handles[i].dataset.emp === empId) continue;
    var row  = handles[i].closest('.gantt-row');
    if (!row) continue;
    var midY = row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2;
    if (e.clientY < midY) { targetEmpId = handles[i].dataset.emp; insertBefore = true; break; }
    targetEmpId = handles[i].dataset.emp; insertBefore = false;
  }
  if (targetEmpId) {
    var toIdx = currentOrder.indexOf(targetEmpId);
    if (toIdx > -1) currentOrder.splice(insertBefore ? toIdx : toIdx + 1, 0, empId);
    else currentOrder.push(empId);
  } else {
    currentOrder.push(empId);
  }
  _rosterRowOrder[date] = currentOrder;
  body.querySelectorAll('.gantt-row:not(.gantt-row-unassigned)').forEach(function(el) { el.remove(); });
  renderGanttPanel(date);
}
