/* ══════════════════════════════════════════════════════
   Tayla Workforce — Roster (Tanda-style Gantt)
   roster.js
══════════════════════════════════════════════════════ */

let shifts = JSON.parse(localStorage.getItem('wf_shifts') || '[]');
let _currentWeekStart = getWeekStart(new Date().toISOString().split('T')[0]);
let _activeDay = new Date().toISOString().split('T')[0];

const TIMELINE_START = 6;
const TIMELINE_END   = 26;
const TIMELINE_HOURS = TIMELINE_END - TIMELINE_START;
const DRAG_THRESHOLD = 5; // px before drag activates
const DAY_SHORT = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const DAY_LONG  = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];

// ══════════════════════════════════════════════════════
//  SUPABASE
// ══════════════════════════════════════════════════════

async function dbLoadShifts(weekStart, weekEnd) {
  if (!_businessId) return;
  const { data, error } = await _supabase
    .from('shifts').select('*')
    .eq('business_id', _businessId)
    .gte('date', weekStart).lte('date', weekEnd);
  if (error) { console.error('Load shifts failed:', error); return; }
  const other = shifts.filter(s => s.date < weekStart || s.date > weekEnd);
  shifts = [...other, ...(data || [])];
  localStorage.setItem('wf_shifts', JSON.stringify(shifts));
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
  const d = new Date(dateStr);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return d.toISOString().split('T')[0];
}

function weekNav(dir) {
  const d = new Date(_currentWeekStart);
  d.setDate(d.getDate() + dir * 7);
  _currentWeekStart = d.toISOString().split('T')[0];
  _activeDay = _currentWeekStart;
  renderRoster();
}

function goToCurrentWeek() {
  _currentWeekStart = getWeekStart(new Date().toISOString().split('T')[0]);
  _activeDay = new Date().toISOString().split('T')[0];
  renderRoster();
}

function switchDay(date) {
  _activeDay = date;
  // Update tab active state without full re-render
  document.querySelectorAll('.day-tab').forEach(el => {
    el.classList.toggle('active', el.dataset.date === date);
  });
  renderGanttPanel(date);
}

// ══════════════════════════════════════════════════════
//  MAIN RENDER
// ══════════════════════════════════════════════════════

function renderRoster() {
  const weekDates = getWeekDates(_currentWeekStart);
  const weekEnd   = weekDates[6];
  if (!weekDates.includes(_activeDay)) _activeDay = weekDates[0];

  const label = document.getElementById('roster-week-label');
  if (label) {
    const s = new Date(_currentWeekStart), e = new Date(weekEnd);
    label.textContent = `${s.toLocaleDateString('en-AU',{day:'numeric',month:'short'})} — ${e.toLocaleDateString('en-AU',{day:'numeric',month:'short',year:'numeric'})}`;
  }

  dbLoadShifts(_currentWeekStart, weekEnd).then(() => {
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
  const weekShifts = shifts.filter(s => weekDates.includes(s.date) && s.status !== 'cancelled');
  const activeEmps = employees.filter(e => e.active !== false);
  let totalHours = 0, totalCost = 0;
  activeEmps.forEach(emp => {
    const pay = calcWeeklyPay(weekShifts.filter(s => s.employee_id === emp.id), emp);
    totalHours += pay.totalHours;
    totalCost  += pay.totalPay;
  });
  const staffed = new Set(weekShifts.map(s => s.employee_id)).size;
  let weekProj = 0;
  weekDates.forEach(d => { const s = getSalesSummary(d); if (s.proj) weekProj += s.proj; });
  const weekSpch = weekProj && totalHours ? (weekProj / totalHours).toFixed(2) : null;
  el.innerHTML = `
    <div class="kpi"><div class="kpi-label">Shifts This Week</div><div class="kpi-value">${weekShifts.length}</div></div>
    <div class="kpi"><div class="kpi-label">Staff Rostered</div><div class="kpi-value">${staffed} / ${activeEmps.length}</div></div>
    <div class="kpi"><div class="kpi-label">Total Hours</div><div class="kpi-value">${totalHours.toFixed(1)}h</div></div>
    <div class="kpi"><div class="kpi-label">Est. Labour Cost</div><div class="kpi-value negative">${fmt(totalCost)}</div></div>
    ${weekSpch ? `<div class="kpi"><div class="kpi-label">Week SPCH</div><div class="kpi-value" style="color:var(--success);">$${weekSpch}</div></div>` : ''}
  `;
}

// ══════════════════════════════════════════════════════
//  DAY TAB SUB-NAV
// ══════════════════════════════════════════════════════

function renderDayTabs(weekDates) {
  const container = document.getElementById('roster-day-tabs');
  if (!container) return;
  const today = new Date().toISOString().split('T')[0];

  container.innerHTML = weekDates.map((date, i) => {
    const isActive = date === _activeDay;
    const isToday  = date === today;
    const isPH     = isPublicHoliday(date);
    const dayShifts = shifts.filter(s => s.date === date && s.status !== 'cancelled');
    const d = new Date(date);

    let dayCost = 0, dayHours = 0;
    employees.filter(e => e.active !== false).forEach(emp => {
      dayShifts.filter(s => s.employee_id === emp.id).forEach(s => {
        const p = calcShiftPay(s, emp); dayCost += p.totalPay; dayHours += p.workedHours;
      });
    });
    const { proj, trend, target } = getSalesSummary(date);
    const displaySales = proj || trend;
    const spch = displaySales && dayHours ? Math.round(displaySales / dayHours) : null;
    const spchCol = spch && target ? spchColour(spch, target) : 'var(--text3)';

    return `
      <div class="day-tab ${isActive?'active':''} ${isToday?'today':''}" data-date="${date}" onclick="switchDay('${date}')">
        <div class="day-tab-top">
          <span class="day-tab-name">${DAY_SHORT[i]}</span>
          ${isToday ? '<span class="today-dot"></span>' : ''}
          ${isPH    ? '<span class="ph-tag">PH</span>' : ''}
        </div>
        <div class="day-tab-date">${d.getDate()}/${d.getMonth()+1}</div>
        <div class="day-tab-meta">
          <span>${dayShifts.length} shift${dayShifts.length!==1?'s':''}</span>
          ${dayHours > 0 ? `<span>${dayHours.toFixed(1)}h</span>` : ''}
        </div>
        ${dayCost > 0 ? `<div class="day-tab-cost">${fmt(dayCost)}</div>` : ''}
        ${spch ? `<div class="day-tab-spch" style="color:${spchCol};">$${spch}/h</div>` : ''}
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

  const dayShifts  = shifts.filter(s => s.date === date && s.status !== 'cancelled');
  const activeEmps = employees.filter(e => e.active !== false);
  const weekDates  = getWeekDates(_currentWeekStart);
  const dayIdx     = weekDates.indexOf(date);

  let dayHours = 0, dayCost = 0;
  activeEmps.forEach(emp => {
    dayShifts.filter(s => s.employee_id === emp.id).forEach(s => {
      const p = calcShiftPay(s, emp); dayHours += p.workedHours; dayCost += p.totalPay;
    });
  });

  const { proj, trend, target } = getSalesSummary(date);
  const displaySales = proj || trend;
  const spch    = displaySales && dayHours ? (displaySales / dayHours).toFixed(2) : null;
  const spchCol = spch && target ? spchColour(parseFloat(spch), target) : 'var(--text2)';
  const isPH    = isPublicHoliday(date);
  const d       = new Date(date);

  panel.innerHTML = `
    <div class="gantt-day-heading">
      <div>
        <div style="font-family:'DM Serif Display',serif;font-size:22px;line-height:1.1;">
          ${DAY_LONG[dayIdx] || '—'}
          ${isPH ? '<span style="font-size:11px;background:#fde2e2;color:var(--danger);padding:3px 9px;border-radius:99px;margin-left:8px;font-family:\'DM Sans\',sans-serif;">Public Holiday 250%</span>' : ''}
        </div>
        <div style="font-size:12px;color:var(--text3);margin-top:2px;">${d.toLocaleDateString('en-AU',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}</div>
      </div>
      <div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap;">
        <div class="gantt-stat">
          <div class="gantt-stat-label">Hours</div>
          <div class="gantt-stat-value" id="ghd-hours">${dayHours.toFixed(1)}h</div>
        </div>
        <div class="gantt-stat">
          <div class="gantt-stat-label">Labour</div>
          <div class="gantt-stat-value" id="ghd-cost" style="color:var(--danger);">${fmt(dayCost)}</div>
        </div>
        <div class="gantt-stat">
          <div class="gantt-stat-label">SPCH</div>
          <div class="gantt-stat-value" id="ghd-spch" style="color:${spchCol};">${spch ? '$'+spch : '—'}</div>
          ${displaySales ? `<div style="font-size:10px;color:var(--text3);text-align:center;" id="ghd-sales">of $${(displaySales/1000).toFixed(1)}k${proj?'':' (trend)'}</div>` : ''}
        </div>
        <button class="btn btn-primary btn-sm" onclick="openAddShift('','${date}')">+ Add Shift</button>
      </div>
    </div>

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
    if (date !== now.toISOString().split('T')[0]) return null;
    const h = now.getHours() + now.getMinutes() / 60;
    if (h < TIMELINE_START || h > TIMELINE_END) return null;
    return ((h - TIMELINE_START) / TIMELINE_HOURS) * 100;
  })();

  const withShifts = activeEmps.filter(e => dayShifts.some(s => s.employee_id === e.id));
  const without    = activeEmps.filter(e => !dayShifts.some(s => s.employee_id === e.id));
  const ordered    = [...withShifts, ...without];

  if (!ordered.length) return `<div style="padding:48px;text-align:center;color:var(--text3);">No active employees yet.</div>`;

  return `
    <div class="gantt-inner">
      <div class="gantt-ruler">
        <div class="gantt-emp-col"></div>
        <div class="gantt-ruler-track">
          ${hourMarks.map(({label,pct}) => `<div class="gantt-ruler-mark" style="left:${pct}%;">${label}</div>`).join('')}
          ${hourMarks.filter((_,i) => i > 0).map(({pct}) => `<div class="gantt-ruler-line" style="left:${pct}%;"></div>`).join('')}
        </div>
      </div>
      <div class="gantt-body" id="gantt-body-${date}">
        ${hourMarks.slice(1).map(({pct}) => `<div class="gantt-gridline" style="left:calc(var(--gcol) + (100% - var(--gcol)) * ${pct/100});"></div>`).join('')}
        ${nowPct !== null ? `<div class="gantt-now-line" style="left:calc(var(--gcol) + (100% - var(--gcol)) * ${nowPct/100});"></div>` : ''}
        ${ordered.map(emp => buildGanttRow(emp, date, dayShifts.filter(s => s.employee_id === emp.id))).join('')}
      </div>
    </div>
  `;
}

function buildGanttRow(emp, date, empShifts) {
  const initials = ((emp.first_name?.[0]||'')+(emp.last_name?.[0]||'')).toUpperCase();
  let rowHours = 0, rowCost = 0;
  empShifts.forEach(s => { const p = calcShiftPay(s,emp); rowHours += p.workedHours; rowCost += p.totalPay; });

  return `
    <div class="gantt-row" id="gantt-row-${emp.id}-${date}">
      <div class="gantt-emp-col">
        <div class="avatar" style="width:28px;height:28px;font-size:10px;flex-shrink:0;">${initials}</div>
        <div style="min-width:0;flex:1;">
          <div style="font-weight:600;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${emp.first_name} ${emp.last_name}</div>
          <div style="font-size:10px;color:var(--text3);">${emp.employment_type||'casual'}${rowHours>0?` · ${rowHours.toFixed(1)}h · ${fmt(rowCost)}`:''}</div>
        </div>
      </div>
      <div class="gantt-track" data-emp="${emp.id}" data-date="${date}"
        onmousedown="onTrackMouseDown(event,'${emp.id}','${date}')"
        onclick="onTrackClick(event,'${emp.id}','${date}')">
        ${empShifts.map(s => buildShiftBar(s, emp)).join('')}
      </div>
    </div>
  `;
}

function buildShiftBar(shift, emp) {
  const left  = timeToX(shift.start_time);
  const right = timeToX(shift.end_time);
  const width = Math.max(right - left, 1.5);
  const pay   = calcShiftPay(shift, emp);
  const bg    = { permanent:'var(--accent)', casual:'#4f8ef7', parttime:'#805ad5' }[emp.employment_type||'casual'] || '#4f8ef7';
  const slim  = width < 5;

  return `
    <div class="shift-bar" id="bar-${shift.id}"
      style="left:${left}%;width:${width}%;background:${bg};"
      title="${fmtTime(shift.start_time)}–${fmtTime(shift.end_time)} · ${pay.workedHours}h · ${fmt(pay.totalPay)}"
      onmousedown="event.stopPropagation();onBarMouseDown(event,'${shift.id}')">
      <div class="shift-bar-handle left" onmousedown="event.stopPropagation();onHandleMouseDown(event,'${shift.id}','start')"></div>
      <div class="shift-bar-label" style="${slim?'opacity:0;':''}">
        <span>${fmtTime(shift.start_time)}–${fmtTime(shift.end_time)}</span>
        <span style="opacity:.75;">${pay.workedHours}h · ${fmt(pay.totalPay)}</span>
      </div>
      <div class="shift-bar-handle right" onmousedown="event.stopPropagation();onHandleMouseDown(event,'${shift.id}','end')"></div>
    </div>
  `;
}

// ══════════════════════════════════════════════════════
//  DRAG ENGINE
// ══════════════════════════════════════════════════════

// ── 1. CREATE — drag on empty track space
function onTrackMouseDown(e, empId, date) {
  if (e.target.closest('.shift-bar')) return;
  e.preventDefault();
  const trackEl  = e.currentTarget;
  const startX   = e.clientX;
  const startPct = (() => { const r = trackEl.getBoundingClientRect(); return ((e.clientX - r.left) / r.width) * 100; })();

  let ghost  = null;
  let active = false;

  function move(ev) {
    const rect   = trackEl.getBoundingClientRect();
    const curPct = Math.max(0, Math.min(100, ((ev.clientX - rect.left) / rect.width) * 100));

    if (!active && Math.abs(ev.clientX - startX) < DRAG_THRESHOLD) return;
    active = true;

    if (!ghost) {
      ghost = document.createElement('div');
      ghost.className = 'shift-bar ghost-bar';
      ghost.innerHTML = `<div class="shift-bar-label"><span></span></div>`;
      trackEl.appendChild(ghost);
    }

    const lo = Math.min(startPct, curPct);
    const hi = Math.max(startPct, curPct);
    ghost.style.left  = lo + '%';
    ghost.style.width = Math.max(hi - lo, 0.3) + '%';

    const labelEl = ghost.querySelector('span');
    if (hi - lo > 2) {
      labelEl.textContent = `${fmtTime(xToTime(lo))} – ${fmtTime(xToTime(hi))}`;
    } else {
      labelEl.textContent = '';
    }
  }

  function up(ev) {
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', up);
    document.body.style.userSelect = '';
    if (ghost) ghost.remove();
    if (!active) return;

    const rect   = trackEl.getBoundingClientRect();
    const curPct = Math.max(0, Math.min(100, ((ev.clientX - rect.left) / rect.width) * 100));
    const lo = Math.min(startPct, curPct);
    const hi = Math.max(startPct, curPct);
    const newStart = xToTime(lo);
    const newEnd   = xToTime(hi);

    // Need at least 15 min
    const [sh,sm] = newStart.split(':').map(Number);
    const [eh,em] = newEnd.split(':').map(Number);
    let sM = sh*60+sm, eM = eh*60+em;
    if (eM <= sM) eM += 1440;
    if (eM - sM < 15) return;

    openAddShift(empId, date, newStart, newEnd);
  }

  document.body.style.userSelect = 'none';
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
}

// Plain click on empty track → add shift at that hour
function onTrackClick(e, empId, date) {
  if (e.target.closest('.shift-bar')) return;
  const rect = e.currentTarget.getBoundingClientRect();
  const pct  = ((e.clientX - rect.left) / rect.width) * 100;
  const [h]  = xToTime(pct).split(':').map(Number);
  const sh   = String(h).padStart(2,'0');
  const eh   = String((h+4)%24).padStart(2,'0');
  openAddShift(empId, date, `${sh}:00`, `${eh}:00`);
}

// ── 2. MOVE — drag existing bar
function onBarMouseDown(e, shiftId) {
  e.preventDefault();
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

    if (!moved) { openEditShift(shiftId); return; }

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
  e.preventDefault();
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
      const maxLeft = origLeft + origWidth - 1.5;
      const newLeft = Math.min(curPct, maxLeft);
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

function refreshGanttRow(shiftId) {
  const shift = shifts.find(s => s.id === shiftId);
  if (!shift) return;
  const emp   = employees.find(e => e.id === shift.employee_id);
  if (!emp) return;
  const rowEl = document.getElementById(`gantt-row-${emp.id}-${shift.date}`);
  if (!rowEl) return;
  const empShifts = shifts.filter(s => s.employee_id === emp.id && s.date === shift.date && s.status !== 'cancelled');
  rowEl.outerHTML = buildGanttRow(emp, shift.date, empShifts);
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
  const { proj, trend, target } = getSalesSummary(date);
  const displaySales = proj || trend;
  const spch    = displaySales && dayHours ? (displaySales / dayHours).toFixed(2) : null;
  const spchCol = spch && target ? spchColour(parseFloat(spch), target) : 'var(--text2)';

  const hEl = document.getElementById('ghd-hours'); if (hEl) hEl.textContent = `${dayHours.toFixed(1)}h`;
  const cEl = document.getElementById('ghd-cost');  if (cEl) cEl.textContent = fmt(dayCost);
  const sEl = document.getElementById('ghd-spch');  if (sEl) { sEl.textContent = spch ? `$${spch}` : '—'; sEl.style.color = spchCol; }
}

function refreshRosterDaySpch(date) {
  if (date === _activeDay) refreshDayHeading(date);
  renderDayTabs(getWeekDates(_currentWeekStart));
}

// ══════════════════════════════════════════════════════
//  SHIFT MODAL
// ══════════════════════════════════════════════════════

function openAddShift(employeeId, date, startTime, endTime) {
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
  document.getElementById('shift-modal').classList.add('show');
}

function updateShiftPreview() {
  const empId   = document.getElementById('shift-employee').value;
  const date    = document.getElementById('shift-date').value;
  const start   = document.getElementById('shift-start').value;
  const end     = document.getElementById('shift-end').value;
  const breakM  = parseInt(document.getElementById('shift-break').value) || null;
  const preview = document.getElementById('shift-pay-preview');
  if (!preview || !empId || !date || !start || !end) return;
  const emp = employees.find(e => e.id === empId);
  if (!emp) { preview.innerHTML = ''; return; }
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
      ${isPublicHoliday(date)?'<div style="color:var(--danger);margin-top:8px;font-size:11px;">🎉 Public holiday — 250% applies</div>':''}
    </div>`;
}

async function saveShift() {
  const editId    = document.getElementById('shift-edit-id').value;
  const empId     = document.getElementById('shift-employee').value;
  const date      = document.getElementById('shift-date').value;
  const startTime = document.getElementById('shift-start').value;
  const endTime   = document.getElementById('shift-end').value;
  const breakMins = parseInt(document.getElementById('shift-break').value) || null;
  const notes     = document.getElementById('shift-notes').value.trim();
  const status    = document.getElementById('shift-status').value;
  if (!empId)                    { toast('Select an employee'); return; }
  if (!date||!startTime||!endTime){ toast('Date and times required'); return; }
  const shift = { id: editId||uid(), employee_id: empId, date, start_time: startTime, end_time: endTime, break_mins: breakMins, notes, status };
  await dbSaveShift(shift);
  closeModal('shift-modal');
  if (date === _activeDay) renderGanttPanel(date);
  renderDayTabs(getWeekDates(_currentWeekStart));
  renderRosterKPIs(getWeekDates(_currentWeekStart));
  toast(`Shift ${editId?'updated':'added'} ✓`);
}

async function deleteShiftConfirm() {
  const id   = document.getElementById('shift-edit-id').value;
  if (!id || !confirm('Delete this shift?')) return;
  const date = shifts.find(s => s.id === id)?.date;
  await dbDeleteShift(id);
  closeModal('shift-modal');
  if (date === _activeDay) renderGanttPanel(date);
  renderDayTabs(getWeekDates(_currentWeekStart));
  renderRosterKPIs(getWeekDates(_currentWeekStart));
  toast('Shift deleted');
}

function populateShiftEmployeeSelect() {
  const sel = document.getElementById('shift-employee');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">Select employee…</option>' +
    employees.filter(e => e.active !== false).map(e =>
      `<option value="${e.id}" ${e.id===cur?'selected':''}>${e.first_name} ${e.last_name} (${e.employment_type||'casual'})</option>`
    ).join('');
}
